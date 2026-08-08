import { copyFile, mkdir, mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { CompressionAdapter } from './archiveWriter.js';
import {
  listSessionManifestPaths,
  readSessionManifest,
  writeSessionManifest,
} from './manifestStore.js';
import {
  ensureSessionRestored,
  packProviderSessions,
  resolveDefaultVaultPath,
  unpackProviderSessions,
} from './sessionArchive.js';
import type { DiscoveredSession, ProviderAdapter } from './sessionStore.js';

const copyCompression: CompressionAdapter = {
  compress: ({ sourcePath, archivePath }) =>
    Effect.promise(() => copyFile(sourcePath, archivePath)),
  decompress: ({ archivePath, restoredPath }) =>
    Effect.promise(() => copyFile(archivePath, restoredPath)),
};

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-session-archive-'));

const createArchiveProvider = (request: {
  readonly id: ProviderAdapter['id'];
  readonly mode: ProviderAdapter['mode'];
  readonly rootRelative: string;
  readonly discover: ProviderAdapter['discover'];
}): ProviderAdapter => ({
  id: request.id,
  label: request.id,
  mode: request.mode,
  defaultRoots: (home) => [join(home, request.rootRelative)],
  discover: request.discover,
});

const writeColdSession = async (
  home: string,
  relativeDir: string,
  fileName: string,
  content: string,
  modifiedAt: Date,
): Promise<{ readonly path: string; readonly content: string }> => {
  const sessionDir = join(home, relativeDir);
  const sessionPath = join(sessionDir, fileName);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionPath, content);
  await utimes(sessionPath, modifiedAt, modifiedAt);
  return {
    path: sessionPath,
    content,
  };
};

describe('sessionArchive dry-run and status paths', () => {
  it('resolves the default vault path under the home directory', () => {
    expect(resolveDefaultVaultPath('/Users/synthetic')).toBe(
      join('/Users/synthetic', '.agent-session-pack'),
    );
  });

  it('reports missing, backup-only, no-candidates, and dry-run pack rows without touching originals', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack-test');
    const coldModifiedAt = new Date('2026-06-01T12:00:00.000Z');
    const warmModifiedAt = new Date('2026-07-06T10:00:00.000Z');
    const now = new Date('2026-07-06T12:00:00.000Z');
    const olderThanMs = 24 * 60 * 60 * 1000;

    const coldSession = await writeColdSession(
      home,
      join('.codex', 'sessions', '2026', '06', '01'),
      'cold.jsonl',
      '{"type":"user","text":"cold session"}\n',
      coldModifiedAt,
    );
    const warmSession = await writeColdSession(
      home,
      join('.claude', 'projects', 'demo'),
      'warm.jsonl',
      '{"type":"user","text":"warm session"}\n',
      warmModifiedAt,
    );
    const backupSession = await writeColdSession(
      home,
      join('.cursor', 'projects', 'demo'),
      'backup.jsonl',
      '{"type":"user","text":"backup only"}\n',
      coldModifiedAt,
    );

    const coldDiscovered: DiscoveredSession = {
      id: 'cold',
      provider: 'codex',
      title: 'cold session',
      slug: 'cold-session',
      originalPath: coldSession.path,
      modifiedAt: coldModifiedAt,
      sizeBytes: Buffer.byteLength(coldSession.content, 'utf8'),
      sourceKind: 'file',
    };
    const warmDiscovered: DiscoveredSession = {
      id: 'warm',
      provider: 'claude',
      title: 'warm session',
      slug: 'warm-session',
      originalPath: warmSession.path,
      modifiedAt: warmModifiedAt,
      sizeBytes: Buffer.byteLength(warmSession.content, 'utf8'),
      sourceKind: 'file',
    };
    const backupDiscovered: DiscoveredSession = {
      id: 'backup',
      provider: 'cursor',
      title: 'backup only',
      slug: 'backup-only',
      originalPath: backupSession.path,
      modifiedAt: coldModifiedAt,
      sizeBytes: Buffer.byteLength(backupSession.content, 'utf8'),
      sourceKind: 'file',
    };

    const providers: ReadonlyArray<ProviderAdapter> = [
      createArchiveProvider({
        id: 'codex',
        mode: 'archive',
        rootRelative: join('.codex', 'sessions'),
        discover: () => Effect.succeed([coldDiscovered]),
      }),
      createArchiveProvider({
        id: 'claude',
        mode: 'archive',
        rootRelative: join('.claude', 'projects'),
        discover: () => Effect.succeed([warmDiscovered]),
      }),
      createArchiveProvider({
        id: 'cursor',
        mode: 'backup-only',
        rootRelative: join('.cursor', 'projects'),
        discover: () => Effect.succeed([backupDiscovered]),
      }),
      createArchiveProvider({
        id: 'kiro',
        mode: 'archive',
        rootRelative: join('.kiro', 'sessions'),
        discover: () => Effect.succeed([]),
      }),
    ];

    const report = await Effect.runPromise(
      packProviderSessions({
        home,
        vaultPath,
        providers,
        olderThan: '24h',
        olderThanMs,
        now,
        apply: false,
        compression: copyCompression,
      }),
    );

    expect(report.command).toBe('pack');
    expect(report.apply).toBe(false);
    expect(report.vaultPath).toBe(vaultPath);
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'codex',
          status: 'dry-run',
          foundSessions: 1,
          candidateSessions: 1,
          packedSessions: 0,
          beforeBytes: coldDiscovered.sizeBytes,
          touchedOriginals: false,
          reason: '--apply required to write archives',
        }),
        expect.objectContaining({
          provider: 'claude',
          status: 'no-candidates',
          foundSessions: 1,
          candidateSessions: 0,
          reason: 'no sessions older than threshold',
        }),
        expect.objectContaining({
          provider: 'cursor',
          status: 'backup-only',
          foundSessions: 1,
          reason: 'backup-only provider is not mutated',
        }),
        expect.objectContaining({
          provider: 'kiro',
          status: 'missing',
          foundSessions: 0,
          reason: 'provider store not found',
        }),
      ]),
    );
    expect(report.thresholdPreviews.length).toBeGreaterThan(0);

    await expect(readFile(coldSession.path, 'utf8')).resolves.toBe(coldSession.content);
    await expect(readFile(warmSession.path, 'utf8')).resolves.toBe(warmSession.content);
    await expect(readFile(backupSession.path, 'utf8')).resolves.toBe(backupSession.content);
    await expect(stat(join(vaultPath, 'archives'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports unpack dry-run and no-archives rows without restoring originals', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack-test');
    const originalPath = join(home, '.codex', 'sessions', 'cold.jsonl');
    const archivePath = join(vaultPath, 'archives', 'codex', 'cold.jsonl.zst');
    const manifestPath = join(vaultPath, 'manifests', 'codex', 'cold.json');
    const content = '{"type":"user","text":"archived"}\n';

    await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
    await writeFile(archivePath, content);
    await Effect.runPromise(
      writeSessionManifest(manifestPath, {
        sessionId: 'cold',
        provider: 'codex',
        title: 'archived',
        slug: 'archived',
        originalPath,
        archivePath,
        sourceSha256: 'deadbeef',
        sourceBytes: Buffer.byteLength(content, 'utf8'),
        archiveBytes: Buffer.byteLength(content, 'utf8'),
        archivedAt: '2026-07-01T00:00:00.000Z',
        sourceKind: 'file',
      }),
    );

    const providers: ReadonlyArray<ProviderAdapter> = [
      createArchiveProvider({
        id: 'codex',
        mode: 'archive',
        rootRelative: join('.codex', 'sessions'),
        discover: () => Effect.succeed([]),
      }),
      createArchiveProvider({
        id: 'claude',
        mode: 'archive',
        rootRelative: join('.claude', 'projects'),
        discover: () => Effect.succeed([]),
      }),
    ];

    const report = await Effect.runPromise(
      unpackProviderSessions({
        vaultPath,
        providers,
        apply: false,
        compression: copyCompression,
      }),
    );

    expect(report.command).toBe('unpack');
    expect(report.apply).toBe(false);
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'codex',
          status: 'dry-run',
          archivedSessions: 1,
          restoredSessions: 0,
          beforeBytes: Buffer.byteLength(content, 'utf8'),
          archiveBytes: Buffer.byteLength(content, 'utf8'),
          touchedOriginals: false,
          reason: '--apply required to restore originals',
        }),
        expect.objectContaining({
          provider: 'claude',
          status: 'no-archives',
          archivedSessions: 0,
          reason: 'no manifests found in vault',
        }),
      ]),
    );

    await expect(stat(originalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const manifests = await Effect.runPromise(
      listSessionManifestPaths(join(vaultPath, 'manifests')),
    );
    expect(manifests).toEqual([manifestPath]);
    const manifest = await Effect.runPromise(readSessionManifest(manifestPath));
    expect(manifest.sessionId).toBe('cold');
  });

  it('packs a cold file session on apply and unpacks it back with byte-exact content', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack-test');
    const now = new Date('2026-07-06T12:00:00.000Z');
    const coldModifiedAt = new Date('2026-06-01T12:00:00.000Z');
    const content = '{"type":"user","text":"apply pack unpack"}\n';
    const session = await writeColdSession(
      home,
      join('.codex', 'sessions', '2026', '06', '01'),
      'apply-session.jsonl',
      content,
      coldModifiedAt,
    );

    const discovered: DiscoveredSession = {
      id: 'apply-session',
      provider: 'codex',
      title: 'apply pack unpack',
      slug: 'apply-pack-unpack',
      originalPath: session.path,
      modifiedAt: coldModifiedAt,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      sourceKind: 'file',
    };

    const providers: ReadonlyArray<ProviderAdapter> = [
      createArchiveProvider({
        id: 'codex',
        mode: 'archive',
        rootRelative: join('.codex', 'sessions'),
        discover: () => Effect.succeed([discovered]),
      }),
    ];

    const packReport = await Effect.runPromise(
      packProviderSessions({
        home,
        vaultPath,
        providers,
        olderThan: '7d',
        olderThanMs: 7 * 24 * 60 * 60 * 1000,
        now,
        apply: true,
        compression: copyCompression,
      }),
    );

    expect(packReport.rows).toEqual([
      expect.objectContaining({
        provider: 'codex',
        status: 'packed',
        packedSessions: 1,
        touchedOriginals: true,
      }),
    ]);
    await expect(stat(session.path)).rejects.toMatchObject({ code: 'ENOENT' });

    const unpackReport = await Effect.runPromise(
      unpackProviderSessions({
        vaultPath,
        providers,
        apply: true,
        compression: copyCompression,
      }),
    );

    expect(unpackReport.rows).toEqual([
      expect.objectContaining({
        provider: 'codex',
        status: 'restored',
        restoredSessions: 1,
        touchedOriginals: true,
      }),
    ]);
    await expect(readFile(session.path, 'utf8')).resolves.toBe(content);

    const alreadyPresent = await Effect.runPromise(
      unpackProviderSessions({
        vaultPath,
        providers,
        apply: true,
        compression: copyCompression,
      }),
    );

    expect(alreadyPresent.rows).toEqual([
      expect.objectContaining({
        provider: 'codex',
        status: 'already-present',
        alreadyPresentSessions: 1,
        restoredSessions: 0,
        touchedOriginals: false,
      }),
    ]);
  });

  it('ensures one archived session is restored with lifecycle enabled and refuses conflicts', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack-test');
    const now = new Date('2026-07-06T12:00:00.000Z');
    const coldModifiedAt = new Date('2026-06-01T12:00:00.000Z');
    const content = '{"type":"user","text":"ensure restored"}\n';
    const session = await writeColdSession(
      home,
      join('.codex', 'sessions', '2026', '06', '01'),
      'ensure-session.jsonl',
      content,
      coldModifiedAt,
    );

    const discovered: DiscoveredSession = {
      id: 'ensure-session',
      provider: 'codex',
      title: 'ensure restored',
      slug: 'ensure-restored',
      originalPath: session.path,
      modifiedAt: coldModifiedAt,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      sourceKind: 'file',
    };

    const providers: ReadonlyArray<ProviderAdapter> = [
      createArchiveProvider({
        id: 'codex',
        mode: 'archive',
        rootRelative: join('.codex', 'sessions'),
        discover: () => Effect.succeed([discovered]),
      }),
    ];

    await Effect.runPromise(
      packProviderSessions({
        home,
        vaultPath,
        providers,
        olderThan: '7d',
        olderThanMs: 7 * 24 * 60 * 60 * 1000,
        now,
        apply: true,
        compression: copyCompression,
      }),
    );
    await expect(stat(session.path)).rejects.toMatchObject({ code: 'ENOENT' });

    const disabled = await Effect.runPromise(
      ensureSessionRestored({
        command: 'ensure-restored',
        vaultPath,
        selector: 'ensure-session',
        provider: 'codex',
        compression: copyCompression,
        restoreOnLaunchEnabled: false,
        requireLifecycleEnabled: true,
      }),
    );
    expect(disabled.status).toBe('lifecycle-disabled');
    await expect(stat(session.path)).rejects.toMatchObject({ code: 'ENOENT' });

    const restored = await Effect.runPromise(
      ensureSessionRestored({
        command: 'ensure-restored',
        vaultPath,
        selector: 'codex:ensure-session',
        provider: undefined,
        compression: copyCompression,
        restoreOnLaunchEnabled: true,
        requireLifecycleEnabled: true,
      }),
    );
    expect(restored).toMatchObject({
      status: 'restored',
      provider: 'codex',
      sessionId: 'ensure-session',
      originalPath: session.path,
    });
    await expect(readFile(session.path, 'utf8')).resolves.toBe(content);

    const alreadyPresent = await Effect.runPromise(
      ensureSessionRestored({
        command: 'restore',
        vaultPath,
        selector: 'ensure-session',
        provider: 'codex',
        compression: copyCompression,
        restoreOnLaunchEnabled: true,
        requireLifecycleEnabled: false,
      }),
    );
    expect(alreadyPresent.status).toBe('already-present');

    await writeFile(session.path, '{"type":"user","text":"changed live"}\n');
    const conflict = await Effect.runPromise(
      ensureSessionRestored({
        command: 'restore',
        vaultPath,
        selector: 'ensure-session',
        provider: 'codex',
        compression: copyCompression,
        restoreOnLaunchEnabled: true,
        requireLifecycleEnabled: false,
      }),
    );
    expect(conflict.status).toBe('conflict');
    await expect(readFile(session.path, 'utf8')).resolves.toBe(
      '{"type":"user","text":"changed live"}\n',
    );
  });
});
