import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  copyCompression,
  createArchiveProvider,
  listSessionManifestPaths,
  readSessionManifest,
  type SessionManifest,
  writeColdSession,
  writeSessionManifest,
} from './archive.js';
import { packProviderSessions, runPackCommand } from './pack.js';
import type { DiscoveredSession, ProviderAdapter } from './providers.js';
import {
  ensureSessionRestored,
  findSessionSelector,
  runEnsureRestoredCommand,
  runOpenCommand,
  runRestoreCommand,
  runUnpackCommand,
  type SessionSelectorRequest,
  unpackProviderSessions,
} from './restore.js';
import { writeSetupSettings } from './setup.js';

type SelectorQuery = Omit<SessionSelectorRequest, 'manifests'>;

function readManifest(
  fields: Pick<SessionManifest, 'sessionId' | 'provider' | 'title' | 'slug'>,
): SessionManifest {
  return {
    ...fields,
    originalPath: `/sessions/${fields.sessionId}.jsonl`,
    archivePath: `/vault/${fields.sessionId}.jsonl.zst`,
    sourceSha256: 'sha',
    sourceBytes: 1,
    archivedAt: '2026-07-01T00:00:00.000Z',
  };
}

const sessionManifests: ReadonlyArray<SessionManifest> = [
  readManifest({
    sessionId: '019a2f10-oly',
    provider: 'codex',
    title: 'Oly App migration',
    slug: 'oly-app-migration',
  }),
  readManifest({
    sessionId: 'c7e4-notes',
    provider: 'claude',
    title: 'Oly App migration notes',
    slug: 'oly-app-migration-notes',
  }),
  readManifest({
    sessionId: 'kiro-1',
    provider: 'kiro',
    title: 'Kiro climb game blueprint',
    slug: 'kiro-climb-game-blueprint',
  }),
  readManifest({ sessionId: 'abc', provider: 'codex', title: 'Short id', slug: 'short-id' }),
  readManifest({ sessionId: 'abcdef', provider: 'codex', title: 'Long id', slug: 'long-id' }),
];

function readSelection(query: SelectorQuery) {
  return findSessionSelector({ ...query, manifests: sessionManifests });
}

describe('session selector', () => {
  it('resolves a provider-prefixed slug', () => {
    const selection = readSelection({
      selector: 'codex:oly-app-migration',
      provider: undefined,
      match: 'fuzzy',
    });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: '019a2f10-oly' } });
  });

  it('resolves an exact session name in any case', () => {
    const selection = readSelection({
      selector: 'kiro CLIMB game blueprint',
      provider: undefined,
      match: 'exact',
    });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: 'kiro-1' } });
  });

  it('resolves a unique session id prefix', () => {
    const selection = readSelection({ selector: '019a', provider: undefined, match: 'fuzzy' });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: '019a2f10-oly' } });
  });

  it('prefers an exact id over longer ids that share it', () => {
    const selection = readSelection({ selector: 'abc', provider: undefined, match: 'fuzzy' });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: 'abc' } });
  });

  it('resolves words found in the session name', () => {
    const selection = readSelection({
      selector: 'climb blueprint',
      provider: undefined,
      match: 'fuzzy',
    });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: 'kiro-1' } });
  });

  it('narrows fuzzy words to the provider flag', () => {
    const selection = readSelection({
      selector: 'oly migration',
      provider: 'claude',
      match: 'fuzzy',
    });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: 'c7e4-notes' } });
  });

  it('returns every candidate when a selector is ambiguous', () => {
    const selection = readSelection({
      selector: 'oly migration',
      provider: undefined,
      match: 'fuzzy',
    });

    expect(selection).toMatchObject({
      status: 'ambiguous',
      candidates: [
        expect.objectContaining({ sessionId: '019a2f10-oly' }),
        expect.objectContaining({ sessionId: 'c7e4-notes' }),
      ],
    });
  });

  it('ignores id prefixes and words in exact mode', () => {
    const idPrefixSelection = readSelection({
      selector: 'abcd',
      provider: undefined,
      match: 'exact',
    });
    const wordSelection = readSelection({
      selector: 'climb blueprint',
      provider: undefined,
      match: 'exact',
    });

    expect(idPrefixSelection).toEqual({ status: 'not-found' });
    expect(wordSelection).toEqual({ status: 'not-found' });
  });

  it('matches nothing for a selector without words', () => {
    const selection = readSelection({
      selector: 'codex: ?? ',
      provider: undefined,
      match: 'fuzzy',
    });

    expect(selection).toEqual({ status: 'not-found' });
  });
});

function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-ensure-restored-'));
}

describe('ensureSessionRestored', () => {
  it('ensures one archived session is restored with lifecycle enabled and refuses conflicts', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack-test');
    const now = new Date('2026-07-06T12:00:00.000Z');
    const coldModifiedAt = new Date('2026-06-01T12:00:00.000Z');
    const sessionJsonl = '{"type":"user","text":"ensure restored"}\n';
    const session = await writeColdSession({
      home,
      relativeDir: join('.codex', 'sessions', '2026', '06', '01'),
      fileName: 'ensure-session.jsonl',
      sessionJsonl,
      modifiedAt: coldModifiedAt,
    });

    const discovered: DiscoveredSession = {
      id: 'ensure-session',
      provider: 'codex',
      title: 'ensure restored',
      slug: 'ensure-restored',
      originalPath: session.path,
      modifiedAt: coldModifiedAt,
      sizeBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      sourceKind: 'file',
    };

    const providers: ReadonlyArray<ProviderAdapter> = [
      createArchiveProvider({
        id: 'codex',
        mode: 'archive',
        rootRelative: join('.codex', 'sessions'),
        discover: () => Promise.resolve([discovered]),
      }),
    ];

    await packProviderSessions({
      home,
      vaultPath,
      providers,
      olderThan: '7d',
      olderThanMs: 7 * 24 * 60 * 60 * 1000,
      now,
      apply: true,
      compression: copyCompression,
    });
    const stubAfterPack = JSON.parse(await readFile(session.path, 'utf8')) as {
      agentSessionPack: string;
    };
    expect(stubAfterPack.agentSessionPack).toBe('agent-session-pack-archived-stub');

    const disabled = await ensureSessionRestored({
      command: 'ensure-restored',
      vaultPath,
      selector: 'ensure-session',
      selectorMatch: 'exact',
      provider: 'codex',
      compression: copyCompression,
      restoreOnLaunchEnabled: false,
      requireLifecycleEnabled: true,
    });
    expect(disabled.status).toBe('lifecycle-disabled');
    await expect(readFile(session.path, 'utf8')).resolves.toContain(
      'agent-session-pack-archived-stub',
    );

    const restored = await ensureSessionRestored({
      command: 'ensure-restored',
      vaultPath,
      selector: 'codex:ensure-session',
      selectorMatch: 'exact',
      provider: undefined,
      compression: copyCompression,
      restoreOnLaunchEnabled: true,
      requireLifecycleEnabled: true,
    });
    expect(restored).toMatchObject({
      status: 'restored',
      provider: 'codex',
      sessionId: 'ensure-session',
      originalPath: session.path,
    });
    await expect(readFile(session.path, 'utf8')).resolves.toBe(sessionJsonl);

    const alreadyPresent = await ensureSessionRestored({
      command: 'restore',
      vaultPath,
      selector: 'ensure-session',
      selectorMatch: 'exact',
      provider: 'codex',
      compression: copyCompression,
      restoreOnLaunchEnabled: true,
      requireLifecycleEnabled: false,
    });
    expect(alreadyPresent.status).toBe('already-present');

    await writeFile(session.path, '{"type":"user","text":"changed live"}\n');
    const conflict = await ensureSessionRestored({
      command: 'restore',
      vaultPath,
      selector: 'ensure-session',
      selectorMatch: 'exact',
      provider: 'codex',
      compression: copyCompression,
      restoreOnLaunchEnabled: true,
      requireLifecycleEnabled: false,
    });
    expect(conflict.status).toBe('conflict');
    await expect(readFile(session.path, 'utf8')).resolves.toBe(
      '{"type":"user","text":"changed live"}\n',
    );
  });
});

function createWorkspaceUnpackSessions(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-unpack-sessions-'));
}

describe('unpackProviderSessions', () => {
  it('reports unpack dry-run and no-archives rows without restoring originals', async () => {
    const home = await createWorkspaceUnpackSessions();
    const vaultPath = join(home, '.agent-session-pack-test');
    const originalPath = join(home, '.codex', 'sessions', 'cold.jsonl');
    const archivePath = join(vaultPath, 'archives', 'codex', 'cold.jsonl.zst');
    const manifestPath = join(vaultPath, 'manifests', 'codex', 'cold.json');
    const sessionJsonl = '{"type":"user","text":"archived"}\n';

    await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
    await writeFile(archivePath, sessionJsonl);
    await writeSessionManifest(manifestPath, {
      sessionId: 'cold',
      provider: 'codex',
      title: 'archived',
      slug: 'archived',
      originalPath,
      archivePath,
      sourceSha256: 'deadbeef',
      sourceBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      archiveBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      archivedAt: '2026-07-01T00:00:00.000Z',
      sourceKind: 'file',
    });

    const providers: ReadonlyArray<ProviderAdapter> = [
      createArchiveProvider({
        id: 'codex',
        mode: 'archive',
        rootRelative: join('.codex', 'sessions'),
        discover: () => Promise.resolve([]),
      }),
      createArchiveProvider({
        id: 'claude',
        mode: 'archive',
        rootRelative: join('.claude', 'projects'),
        discover: () => Promise.resolve([]),
      }),
    ];

    const report = await unpackProviderSessions({
      vaultPath,
      providers,
      apply: false,
      compression: copyCompression,
    });

    expect(report.command).toBe('unpack');
    expect(report.apply).toBe(false);
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'codex',
          status: 'dry-run',
          archivedSessions: 1,
          restoredSessions: 0,
          beforeBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
          archiveBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
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
    const manifests = await listSessionManifestPaths(join(vaultPath, 'manifests'));
    expect(manifests).toEqual([manifestPath]);
    const manifest = await readSessionManifest(manifestPath);
    expect(manifest.sessionId).toBe('cold');
  });

  it('packs a cold file session on apply and unpacks it back with byte-exact content', async () => {
    const home = await createWorkspaceUnpackSessions();
    const vaultPath = join(home, '.agent-session-pack-test');
    const now = new Date('2026-07-06T12:00:00.000Z');
    const coldModifiedAt = new Date('2026-06-01T12:00:00.000Z');
    const sessionJsonl = '{"type":"user","text":"apply pack unpack"}\n';
    const session = await writeColdSession({
      home,
      relativeDir: join('.codex', 'sessions', '2026', '06', '01'),
      fileName: 'apply-session.jsonl',
      sessionJsonl,
      modifiedAt: coldModifiedAt,
    });

    const discovered: DiscoveredSession = {
      id: 'apply-session',
      provider: 'codex',
      title: 'apply pack unpack',
      slug: 'apply-pack-unpack',
      originalPath: session.path,
      modifiedAt: coldModifiedAt,
      sizeBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      sourceKind: 'file',
    };

    const providers: ReadonlyArray<ProviderAdapter> = [
      createArchiveProvider({
        id: 'codex',
        mode: 'archive',
        rootRelative: join('.codex', 'sessions'),
        discover: () => Promise.resolve([discovered]),
      }),
    ];

    const packReport = await packProviderSessions({
      home,
      vaultPath,
      providers,
      olderThan: '7d',
      olderThanMs: 7 * 24 * 60 * 60 * 1000,
      now,
      apply: true,
      compression: copyCompression,
    });

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

    const unpackReport = await unpackProviderSessions({
      vaultPath,
      providers,
      apply: true,
      compression: copyCompression,
    });

    expect(unpackReport.rows).toEqual([
      expect.objectContaining({
        provider: 'codex',
        status: 'restored',
        restoredSessions: 1,
        touchedOriginals: true,
      }),
    ]);
    await expect(readFile(session.path, 'utf8')).resolves.toBe(sessionJsonl);

    const alreadyPresent = await unpackProviderSessions({
      vaultPath,
      providers,
      apply: true,
      compression: copyCompression,
    });

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

interface ArchivedSessionRequest {
  readonly home: string;
  readonly sessionId: string;
  readonly title: string;
}

async function writeArchivedSession(
  request: ArchivedSessionRequest,
): Promise<{ readonly originalPath: string; readonly sessionJsonl: string }> {
  const vaultPath = join(request.home, '.agent-session-pack');
  const originalPath = join(request.home, '.codex', 'sessions', `${request.sessionId}.jsonl`);
  const archivePath = join(vaultPath, 'archives', 'codex', `${request.sessionId}.jsonl.zst`);
  const sessionJsonl = `{"type":"user","text":"${request.title}"}\n`;

  await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
  await writeFile(archivePath, sessionJsonl);
  await writeSessionManifest(join(vaultPath, 'manifests', 'codex', `${request.sessionId}.json`), {
    sessionId: request.sessionId,
    provider: 'codex',
    title: request.title,
    slug: request.title.toLowerCase().replaceAll(' ', '-'),
    originalPath,
    archivePath,
    sourceSha256: createHash('sha256').update(sessionJsonl).digest('hex'),
    sourceBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
    archiveBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
    archivedAt: '2026-07-01T00:00:00.000Z',
    sourceKind: 'file',
  });

  return { originalPath, sessionJsonl };
}

describe('restore command', () => {
  const stdoutWrites: string[] = [];
  const stderrWrites: string[] = [];

  beforeEach(() => {
    stdoutWrites.length = 0;
    stderrWrites.length = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrWrites.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits with code 2 when selector is missing', async () => {
    const commandExit = await runRestoreCommand({
      selector: undefined,
      provider: undefined,
      to: undefined,
      json: true,
      home: '/tmp/synthetic-home',
    });

    expect(stderrWrites.join('')).toContain(
      'Missing selector. Use agent-session-pack restore <selector>.',
    );
    expect(commandExit.exitCode).toBe(2);
  });

  it('restores an archived session without requiring lifecycle enable', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-restore-cmd-'));
    const vaultPath = join(home, '.agent-session-pack');
    const session = await writeArchivedSession({
      home,
      sessionId: 'cold',
      title: 'manual restore',
    });

    const commandExit = await runRestoreCommand({
      home,
      vaultPath,
      selector: 'codex:cold',
      provider: undefined,
      to: 'original',
      json: true,
      compression: copyCompression,
    });

    expect(commandExit.exitCode).toBe(0);
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'restore',
      status: 'restored',
      sessionId: 'cold',
      provider: 'codex',
    });
    await expect(readFile(session.originalPath, 'utf8')).resolves.toBe(session.sessionJsonl);
    await rm(home, { recursive: true, force: true });
  });

  it('restores a session by a unique id prefix', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-restore-prefix-'));
    const pageSession = await writeArchivedSession({
      home,
      sessionId: 'cold-a1',
      title: 'Fix login page',
    });
    await writeArchivedSession({ home, sessionId: 'cold-b2', title: 'Fix login api' });

    const commandExit = await runRestoreCommand({
      home,
      selector: 'cold-a',
      provider: undefined,
      to: undefined,
      json: true,
      compression: copyCompression,
    });

    expect(commandExit.exitCode).toBe(0);
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      status: 'restored',
      sessionId: 'cold-a1',
    });
    await expect(readFile(pageSession.originalPath, 'utf8')).resolves.toBe(
      pageSession.sessionJsonl,
    );
    await rm(home, { recursive: true, force: true });
  });

  it('lists the candidates and exits 2 when the selector is ambiguous', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-restore-ambiguous-'));
    const pageSession = await writeArchivedSession({
      home,
      sessionId: 'cold-a1',
      title: 'Fix login page',
    });
    await writeArchivedSession({ home, sessionId: 'cold-b2', title: 'Fix login api' });

    const commandExit = await runRestoreCommand({
      home,
      selector: 'fix login',
      provider: undefined,
      to: undefined,
      json: true,
      compression: copyCompression,
    });

    expect(commandExit.exitCode).toBe(2);
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      status: 'ambiguous-selector',
      candidates: [
        { provider: 'codex', sessionId: 'cold-a1', title: 'Fix login page' },
        { provider: 'codex', sessionId: 'cold-b2', title: 'Fix login api' },
      ],
    });
    await expect(readFile(pageSession.originalPath, 'utf8')).rejects.toThrow();
    await rm(home, { recursive: true, force: true });
  });
});

describe('ensure-restored command', () => {
  const stdoutWrites: string[] = [];
  const stderrWrites: string[] = [];

  beforeEach(() => {
    stdoutWrites.length = 0;
    stderrWrites.length = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrWrites.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits 1 with JSON when restore-on-launch is disabled', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-ensure-disabled-'));
    const vaultPath = join(home, '.agent-session-pack');

    await writeSetupSettings({
      home,
      config: {
        version: 1,
        providers: ['codex'],
        vaultPath,
        coldAfter: '7d',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        restoreOnLaunch: false,
      },
    });

    const commandExit = await runEnsureRestoredCommand({
      home,
      vaultPath,
      provider: 'codex',
      session: 'cold',
      json: true,
      compression: copyCompression,
    });

    expect(commandExit.exitCode).toBe(1);
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'ensure-restored',
      status: 'lifecycle-disabled',
      restoreOnLaunchEnabled: false,
    });
    await rm(home, { recursive: true, force: true });
  });

  it('restores a missing archived session when lifecycle is enabled', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-ensure-restore-'));
    const vaultPath = join(home, '.agent-session-pack');
    const originalPath = join(home, '.codex', 'sessions', 'cold.jsonl');
    const archivePath = join(vaultPath, 'archives', 'codex', 'cold.jsonl.zst');
    const sessionJsonl = '{"type":"user","text":"ensure"}\n';
    const originSha256 = createHash('sha256').update(sessionJsonl).digest('hex');

    await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
    await writeFile(archivePath, sessionJsonl);
    await writeSessionManifest(join(vaultPath, 'manifests', 'codex', 'cold.json'), {
      sessionId: 'cold',
      provider: 'codex',
      title: 'ensure',
      slug: 'ensure',
      originalPath,
      archivePath,
      sourceSha256: originSha256,
      sourceBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      archiveBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      archivedAt: '2026-07-01T00:00:00.000Z',
      sourceKind: 'file',
    });
    await writeSetupSettings({
      home,
      config: {
        version: 1,
        providers: ['codex'],
        vaultPath,
        coldAfter: '7d',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        restoreOnLaunch: true,
      },
    });

    const commandExit = await runEnsureRestoredCommand({
      home,
      vaultPath,
      provider: 'codex',
      session: 'cold',
      json: true,
      compression: copyCompression,
    });

    expect(commandExit.exitCode).toBe(0);
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'ensure-restored',
      status: 'restored',
      provider: 'codex',
      sessionId: 'cold',
      originalPath,
    });
    await expect(readFile(originalPath, 'utf8')).resolves.toBe(sessionJsonl);
    await rm(home, { recursive: true, force: true });
  });
});

describe('open command', () => {
  const stdoutWrites: string[] = [];

  beforeEach(() => {
    stdoutWrites.length = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('auto-restores a packed session on open lookup', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-open-'));
    const vaultPath = join(home, '.agent-session-pack');
    const originalPath = join(home, '.codex', 'sessions', 'cold.jsonl');
    const archivePath = join(vaultPath, 'archives', 'codex', 'cold.jsonl.zst');
    const sessionJsonl = '{"type":"user","text":"open me"}\n';
    const originSha256 = createHash('sha256').update(sessionJsonl).digest('hex');

    await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
    await writeFile(archivePath, sessionJsonl);
    await writeSessionManifest(join(vaultPath, 'manifests', 'codex', 'cold.json'), {
      sessionId: 'cold',
      provider: 'codex',
      title: 'open me',
      slug: 'open-me',
      originalPath,
      archivePath,
      sourceSha256: originSha256,
      sourceBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      archiveBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      archivedAt: '2026-07-01T00:00:00.000Z',
      sourceKind: 'file',
    });

    const commandExit = await runOpenCommand({
      home,
      vaultPath,
      provider: 'codex',
      session: 'cold',
      json: true,
      compression: copyCompression,
      now: new Date('2026-07-07T00:00:00.000Z'),
    });

    expect(commandExit.exitCode).toBe(0);
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'open',
      status: 'restored',
      sessionId: 'cold',
      originalPath,
    });
    await expect(readFile(originalPath, 'utf8')).resolves.toBe(sessionJsonl);
    await rm(home, { recursive: true, force: true });
  });
});

function createWorkspaceUnpackCommand(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-unpack-command-'));
}

function createColdCodexSession(
  home: string,
): Promise<{ readonly path: string; readonly sessionJsonl: string }> {
  return writeColdSession({
    home,
    relativeDir: join('.codex', 'sessions', '2026', '06', '01'),
    fileName: 'session-old.jsonl',
    sessionJsonl: '{"type":"user","text":"pack every provider"}\n',
    modifiedAt: new Date('2026-06-01T12:00:00.000Z'),
  });
}

describe('unpackCommand', () => {
  const originalHome = process.env.HOME;
  const writes: string[] = [];

  beforeEach(() => {
    writes.length = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    vi.restoreAllMocks();
  });

  it('unpacks every archived provider session back to the original path', async () => {
    const home = await createWorkspaceUnpackCommand();
    const vaultPath = join(home, '.agent-session-pack-test');
    const session = await createColdCodexSession(home);
    process.env.HOME = home;

    await runPackCommand({
      allProviders: true,
      apply: true,
      compression: copyCompression,
      confirmed: true,
      dryRun: undefined,
      json: true,
      olderThan: '7d',
      provider: undefined,
      vaultPath,
      yes: true,
      now: new Date('2026-07-06T12:00:00.000Z'),
    });

    await runUnpackCommand({
      allProviders: true,
      apply: true,
      compression: copyCompression,
      confirmed: true,
      json: undefined,
      provider: undefined,
      vaultPath,
      yes: true,
    });

    await expect(readFile(session.path, 'utf8')).resolves.toBe(session.sessionJsonl);
    expect(writes.join('')).toContain('Unpack all providers');
    expect(writes.join('')).toContain('restored');
  });

  it('unpack exits with code 1 when HOME is unset', async () => {
    delete process.env.HOME;

    const commandExit = await runUnpackCommand({
      allProviders: true,
      apply: undefined,
      compression: copyCompression,
      confirmed: undefined,
      json: true,
      provider: undefined,
      yes: undefined,
    });

    expect(commandExit.exitCode).toBe(1);
    const stderr = writes.join('');
    expect(stderr).toContain('HOME is not set.');
    expect(stderr).toContain('vault and config paths');
  });

  it('unpack cancels apply without confirmation and sets exit code 2', async () => {
    const home = await createWorkspaceUnpackCommand();
    process.env.HOME = home;

    const commandExit = await runUnpackCommand({
      allProviders: true,
      apply: true,
      compression: copyCompression,
      confirmed: false,
      home,
      json: true,
      provider: undefined,
      vaultPath: join(home, '.agent-session-pack-test'),
      yes: undefined,
    });

    expect(commandExit.exitCode).toBe(2);
    expect(writes.join('')).toContain('Cancelled. Re-run with --apply and confirm with y');
  });

  it('unpack writes JSON report for empty vault dry-run', async () => {
    const home = await createWorkspaceUnpackCommand();
    process.env.HOME = home;

    const commandExit = await runUnpackCommand({
      allProviders: true,
      apply: false,
      compression: copyCompression,
      confirmed: undefined,
      home,
      json: true,
      provider: 'codex',
      vaultPath: join(home, '.agent-session-pack-test'),
      yes: undefined,
    });

    const printedDocument = JSON.parse(writes.join('')) as {
      readonly rows: ReadonlyArray<unknown>;
    };
    expect(Array.isArray(printedDocument.rows)).toBe(true);
    expect(commandExit.exitCode).toBe(0);
  });
});
