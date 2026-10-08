import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  copyCompression,
  createArchiveProvider,
  writeColdSession,
} from '../../../tests/archiveFixtures.js';
import type { DiscoveredSession, ProviderAdapter } from '../../shared/sessionModel.js';
import {
  listSessionManifestPaths,
  readSessionManifest,
  writeSessionManifest,
} from '../archive/manifestStore.js';
import { packProviderSessions } from '../pack/packSessions.js';
import { unpackProviderSessions } from './unpackSessions.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-unpack-sessions-'));

describe('unpackProviderSessions', () => {
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
    // Packed path keeps a listable stub so GUIs can still see the session.
    const stubAfterPack = JSON.parse(await readFile(session.path, 'utf8')) as {
      agentSessionPack: string;
    };
    expect(stubAfterPack.agentSessionPack).toBe('agent-session-pack-archived-stub');

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
});
