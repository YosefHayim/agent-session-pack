import { createHash } from 'node:crypto';
import type * as NodeFs from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CompressionAdapter,
  copyCompression,
  createArchiveProvider,
  listVaultSessionManifests,
  writeArchivedStub,
  writeColdSession,
  writeSessionManifest,
} from './archive.js';
import {
  createAccessLogPath,
  createWrappersBinPath,
  decideClosePack,
  extractSessionIdsFromArgv,
  installLifecycleWrappers,
  isSessionAccessedSince,
  packColdSessionsOnClose,
  runLifecycleCommand,
  runPreflightCommand,
  saveSessionAccess,
  watchSessionStubs,
} from './lifecycle.js';
import type { DiscoveredSession, ProviderAdapter } from './providers.js';
import { ensureSessionRestored } from './restore.js';
import { createSettingsPath, type SetupSettings, writeSetupSettings } from './setup.js';

const now = new Date('2026-07-08T12:00:00.000Z');
const oneDayMs = 24 * 60 * 60 * 1000;
const coldModifiedAt = new Date('2026-06-01T12:00:00.000Z');

describe('decideClosePack', () => {
  it('does not pack when pack on exit is off', () => {
    const decision = decideClosePack({
      packOnAgentExit: false,
      modifiedAt: coldModifiedAt,
      now,
      coldAfterMs: oneDayMs,
    });

    expect(decision.shouldPack).toBe(false);
  });

  it('does not pack when the setting is missing', () => {
    const decision = decideClosePack({
      packOnAgentExit: undefined,
      modifiedAt: coldModifiedAt,
      now,
      coldAfterMs: oneDayMs,
    });

    expect(decision.shouldPack).toBe(false);
  });

  it('does not pack a warm session', () => {
    const decision = decideClosePack({
      packOnAgentExit: true,
      modifiedAt: now,
      now,
      coldAfterMs: oneDayMs,
    });

    expect(decision.shouldPack).toBe(false);
  });

  it('packs a cold session when pack on exit is on', () => {
    const decision = decideClosePack({
      packOnAgentExit: true,
      modifiedAt: coldModifiedAt,
      now,
      coldAfterMs: oneDayMs,
    });

    expect(decision.shouldPack).toBe(true);
  });
});

describe('sessionAccess', () => {
  it('extracts session ids from resume-style argv', () => {
    expect(
      extractSessionIdsFromArgv(['resume', '019fe213-8c3a-74a1-96bc-e1a9a02a4047', '--json']),
    ).toContain('019fe213-8c3a-74a1-96bc-e1a9a02a4047');

    expect(extractSessionIdsFromArgv(['--session', 'cold-session', 'other'])).toEqual([
      'cold-session',
    ]);
  });

  it('records and detects recent session access', async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), 'asp-access-'));
    const now = new Date('2026-07-07T12:00:00.000Z');

    await saveSessionAccess({
      vaultPath,
      provider: 'codex',
      sessionId: 'cold',
      accessedAt: now,
    });

    const logPath = createAccessLogPath(vaultPath);
    const lines = (await readFile(logPath, 'utf8')).trim().split('\n');
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      provider: 'codex',
      sessionId: 'cold',
    });

    expect(
      isSessionAccessedSince({
        events: [
          {
            provider: 'codex',
            sessionId: 'cold',
            accessedAt: now.toISOString(),
          },
        ],
        provider: 'codex',
        sessionId: 'cold',
        sinceMs: now.getTime() - 1000,
      }),
    ).toBe(true);

    await rm(vaultPath, { recursive: true, force: true });
  });
});

describe('installLifecycleWrappers', () => {
  it('does not install a wrapper for cursor or devin', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agent-session-pack-wrappers-'));
    const vaultPath = join(home, 'vault');

    await installLifecycleWrappers({
      vaultPath,
      cliEntrypoint: '/usr/bin/agent-session-pack',
    });
    const names = await readdir(createWrappersBinPath(vaultPath));

    expect(names).toContain('codex');
    expect(names).not.toContain('cursor');
    expect(names).not.toContain('devin');
  });
});

const nowPackColdSessionsOnClose = new Date('2026-07-08T12:00:00.000Z');
const coldModifiedAtPackColdSessionsOnClose = new Date('2026-06-01T12:00:00.000Z');

function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-close-pack-'));
}

function createSettings(vaultPath: string, packOnAgentExit: boolean | undefined): SetupSettings {
  return {
    version: 1,
    providers: ['codex'],
    vaultPath,
    coldAfter: '7d',
    createdAt: nowPackColdSessionsOnClose.toISOString(),
    updatedAt: nowPackColdSessionsOnClose.toISOString(),
    restoreOnLaunch: true,
    packOnAgentExit,
  };
}

describe('packColdSessionsOnClose', () => {
  it('packs a cold session into a stub and restores the same bytes', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, 'vault');
    const sessionJsonl = '{"type":"user","text":"close pack"}\n';
    const session = await writeColdSession({
      home,
      relativeDir: join('.codex', 'sessions', '2026', '06', '01'),
      fileName: 'cold.jsonl',
      sessionJsonl,
      modifiedAt: coldModifiedAtPackColdSessionsOnClose,
    });
    const sourceSha256 = createHash('sha256').update(sessionJsonl).digest('hex');

    await packColdSessionsOnClose({
      home,
      provider: 'codex',
      settings: createSettings(vaultPath, true),
      now: nowPackColdSessionsOnClose,
      compression: copyCompression,
      providers: [
        createCodexProvider(session.path, sessionJsonl, coldModifiedAtPackColdSessionsOnClose),
      ],
    });

    const stub = JSON.parse(await readFile(session.path, 'utf8')) as {
      agentSessionPack: string;
    };
    const manifests = await listVaultSessionManifests(vaultPath);

    expect(stub.agentSessionPack).toBe('agent-session-pack-archived-stub');
    expect(manifests).toHaveLength(1);
    expect(manifests[0]?.sourceSha256).toBe(sourceSha256);

    const restored = await ensureSessionRestored({
      command: 'ensure-restored',
      vaultPath,
      selector: 'cold',
      selectorMatch: 'exact',
      provider: 'codex',
      compression: copyCompression,
      restoreOnLaunchEnabled: true,
      requireLifecycleEnabled: true,
    });

    expect(restored.status).toBe('restored');
    await expect(readFile(session.path, 'utf8')).resolves.toBe(sessionJsonl);
  });

  it('leaves a young session as a normal file', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, 'vault');
    const sessionJsonl = '{"type":"user","text":"still warm"}\n';
    const session = await writeColdSession({
      home,
      relativeDir: join('.codex', 'sessions', '2026', '07', '08'),
      fileName: 'warm.jsonl',
      sessionJsonl,
      modifiedAt: nowPackColdSessionsOnClose,
    });

    await packColdSessionsOnClose({
      home,
      provider: 'codex',
      settings: createSettings(vaultPath, true),
      now: nowPackColdSessionsOnClose,
      compression: copyCompression,
      providers: [
        createCodexProvider(session.path, sessionJsonl, nowPackColdSessionsOnClose, 'warm'),
      ],
    });

    await expect(readFile(session.path, 'utf8')).resolves.toBe(sessionJsonl);
  });

  it('does not pack when old settings omit packOnAgentExit', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, 'vault');
    const sessionJsonl = '{"type":"user","text":"old settings"}\n';
    const session = await writeColdSession({
      home,
      relativeDir: join('.codex', 'sessions', '2026', '06', '01'),
      fileName: 'old.jsonl',
      sessionJsonl,
      modifiedAt: coldModifiedAtPackColdSessionsOnClose,
    });
    const settings = createSettings(vaultPath, undefined);

    await packColdSessionsOnClose({
      home,
      provider: 'codex',
      settings,
      now: nowPackColdSessionsOnClose,
      compression: copyCompression,
      providers: [
        createCodexProvider(
          session.path,
          sessionJsonl,
          coldModifiedAtPackColdSessionsOnClose,
          'old',
        ),
      ],
    });

    await expect(readFile(session.path, 'utf8')).resolves.toBe(sessionJsonl);
  });

  it('leaves a backup-only cursor store unchanged', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, 'vault');
    const sessionJsonl = '{"type":"user","text":"cursor backup"}\n';
    const session = await writeColdSession({
      home,
      relativeDir: join('.cursor', 'projects', 'demo'),
      fileName: 'backup.jsonl',
      sessionJsonl,
      modifiedAt: coldModifiedAtPackColdSessionsOnClose,
    });
    const discovered: DiscoveredSession = {
      id: 'backup',
      provider: 'cursor',
      title: 'cursor backup',
      slug: 'cursor-backup',
      originalPath: session.path,
      modifiedAt: coldModifiedAtPackColdSessionsOnClose,
      sizeBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      sourceKind: 'file',
    };
    const provider: ProviderAdapter = createArchiveProvider({
      id: 'cursor',
      mode: 'backup-only',
      rootRelative: join('.cursor', 'projects'),
      discover: () => Promise.resolve([discovered]),
    });

    await packColdSessionsOnClose({
      home,
      provider: 'cursor',
      settings: {
        ...createSettings(vaultPath, true),
        providers: ['cursor'],
      },
      now: nowPackColdSessionsOnClose,
      compression: copyCompression,
      providers: [provider],
    });

    await expect(readFile(session.path, 'utf8')).resolves.toBe(sessionJsonl);
  });
});

function createCodexProvider(
  sessionPath: string,
  sessionJsonl: string,
  modifiedAt: Date,
  sessionId = 'cold',
): ProviderAdapter {
  const discovered: DiscoveredSession = {
    id: sessionId,
    provider: 'codex',
    title: sessionId,
    slug: sessionId,
    originalPath: sessionPath,
    modifiedAt,
    sizeBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
    sourceKind: 'file',
  };

  return createArchiveProvider({
    id: 'codex',
    mode: 'archive',
    rootRelative: join('.codex', 'sessions'),
    discover: () => Promise.resolve([discovered]),
  });
}

const watchListeners = vi.hoisted(() => new Map<string, () => void>());

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();

  return {
    ...actual,
    watch: (path: string, settings: NodeFs.WatchOptions, listener: () => void) => {
      watchListeners.set(path, listener);
      return actual.watch(path, settings, listener);
    },
  };
});

interface WatchRun {
  readonly events: string[];
  readonly stop: () => Promise<void>;
}

async function writeArchivedCodexStub(home: string): Promise<{
  readonly vaultPath: string;
  readonly filePath: string;
  readonly sessionJsonl: string;
}> {
  const vaultPath = join(home, '.agent-session-pack');
  const filePath = join(home, '.codex', 'sessions', 'cold.jsonl');
  const archivePath = join(vaultPath, 'archives', 'codex', 'cold.jsonl.zst');
  const sessionJsonl = '{"type":"user","text":"watch restore"}\n';

  await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
  await mkdir(join(home, '.codex', 'sessions'), { recursive: true });
  await writeFile(archivePath, sessionJsonl);
  await writeSessionManifest(join(vaultPath, 'manifests', 'codex', 'cold.json'), {
    sessionId: 'cold',
    provider: 'codex',
    title: 'cold',
    slug: 'cold',
    originalPath: filePath,
    archivePath,
    sourceSha256: createHash('sha256').update(sessionJsonl).digest('hex'),
    sourceBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
    archiveBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
    archivedAt: '2026-07-01T00:00:00.000Z',
    sourceKind: 'file',
  });
  await writeArchivedStub({
    originalPath: filePath,
    sessionId: 'cold',
    provider: 'codex',
    sourceKind: 'file',
  });

  return { vaultPath, filePath, sessionJsonl };
}

function startCodexWatch(vaultPath: string, compression: CompressionAdapter): WatchRun {
  const control = { stopped: false };
  const events: string[] = [];
  const watchPromise = watchSessionStubs({
    vaultPath,
    provider: 'codex',
    compression,
    pollIntervalMs: 80,
    shouldStop: () => control.stopped,
    onEvent: (event) => {
      events.push(event.status);
    },
  });

  return {
    events,
    stop: () => {
      control.stopped = true;
      return watchPromise;
    },
  };
}

describe('sessionWatch', () => {
  const timers: NodeJS.Timeout[] = [];

  function wait(ms: number): Promise<void> {
    return new Promise((done) => {
      timers.push(setTimeout(done, ms));
    });
  }

  afterEach(() => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    watchListeners.clear();
  });

  it('materializes a file stub when the provider opens it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-watch-file-'));
    const session = await writeArchivedCodexStub(home);
    const watchRun = startCodexWatch(session.vaultPath, copyCompression);

    await wait(120);
    await writeFile(
      session.filePath,
      `${JSON.stringify({
        agentSessionPack: 'agent-session-pack-archived-stub',
        version: 1,
        sessionId: 'cold',
        provider: 'codex',
        sourceKind: 'file',
      })}\n`,
    );
    await wait(350);
    await watchRun.stop();

    expect(watchRun.events).toContain('restored');
    await expect(readFile(session.filePath, 'utf8')).resolves.toBe(session.sessionJsonl);
  });

  it('restores once when several fs events arrive for the same stub', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-watch-burst-'));
    const session = await writeArchivedCodexStub(home);
    const decompressedPaths: string[] = [];
    const countingCompression: CompressionAdapter = {
      compress: copyCompression.compress,
      decompress: async ({ archivePath, restoredPath }) => {
        decompressedPaths.push(restoredPath);
        await copyFile(archivePath, restoredPath);
      },
    };
    const watchRun = startCodexWatch(session.vaultPath, countingCompression);

    await wait(120);
    const stubListener = watchListeners.get(session.filePath);
    stubListener?.();
    stubListener?.();
    await wait(350);
    await watchRun.stop();

    expect(stubListener).toBeDefined();
    expect(decompressedPaths).toHaveLength(1);
    expect(watchRun.events).toEqual(['restored']);
    await expect(readFile(session.filePath, 'utf8')).resolves.toBe(session.sessionJsonl);
  });
});

describe('lifecycle command', () => {
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

  it('enables restore-on-launch and reports status as JSON', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-lifecycle-'));
    const now = new Date('2026-07-07T00:00:00.000Z');

    const commandExit = await runLifecycleCommand({
      action: 'enable',
      json: true,
      home,
      now,
    });

    expect(commandExit.exitCode).toBe(0);
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'lifecycle',
      action: 'enable',
      restoreOnLaunch: true,
      restoreCacheAfter: '7d',
      configPresent: true,
    });
    const enabled = JSON.parse(stdoutWrites.join('')) as {
      wrappersBin: string;
      pathHint: string;
    };
    expect(enabled.wrappersBin).toContain('.agent-session-pack');
    expect(enabled.pathHint).toContain('PATH=');

    const settingsPath = createSettingsPath(home);
    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      restoreOnLaunch: boolean;
      packOnAgentExit: boolean;
    };
    expect(settings.restoreOnLaunch).toBe(true);
    expect(settings.packOnAgentExit).toBe(true);
    expect(stderrWrites.join('')).toContain('packOnAgentExit: true');
    expect(stderrWrites.join('')).toContain('vaultPath:');
    expect(stderrWrites.join('')).toContain('coldAfter:');

    stdoutWrites.length = 0;
    await runLifecycleCommand({
      action: 'status',
      json: true,
      home,
    });
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      restoreOnLaunch: true,
    });

    stdoutWrites.length = 0;
    await runLifecycleCommand({
      action: 'disable',
      json: true,
      home,
      now,
    });
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      restoreOnLaunch: false,
      packOnAgentExit: false,
      action: 'disable',
    });
    const disabledSettings = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      packOnAgentExit: boolean;
    };
    expect(disabledSettings.packOnAgentExit).toBe(false);

    await rm(home, { recursive: true, force: true });
  });

  it('points the provider wrappers at the running CLI script', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-lifecycle-entry-'));
    const runningCliPath = '/usr/local/lib/agent-session-pack/dist/cli/main.js';
    const argvBeforeTest = [...process.argv];

    process.argv[1] = runningCliPath;
    try {
      await runLifecycleCommand({
        action: 'enable',
        json: true,
        home,
        now: new Date('2026-07-07T00:00:00.000Z'),
      });
    } finally {
      process.argv.splice(0, process.argv.length, ...argvBeforeTest);
    }

    const { wrappersBin } = JSON.parse(stdoutWrites.join('')) as { wrappersBin: string };
    const codexWrapper = await readFile(join(wrappersBin, 'codex'), 'utf8');
    expect(codexWrapper).toContain(`CLI_ENTRY="${runningCliPath}"`);
    await rm(home, { recursive: true, force: true });
  });

  it('rejects unknown lifecycle actions', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-lifecycle-bad-'));

    const commandExit = await runLifecycleCommand({
      action: 'explode',
      json: true,
      home,
    });

    expect(commandExit.exitCode).toBe(2);
    expect(stderrWrites.join('')).toContain('Unknown lifecycle action');
    await rm(home, { recursive: true, force: true });
  });
});

describe('preflight command', () => {
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

  it('auto-restores session ids from argv when lifecycle is enabled', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-preflight-'));
    const vaultPath = join(home, '.agent-session-pack');
    const originalPath = join(home, '.codex', 'sessions', 'cold.jsonl');
    const archivePath = join(vaultPath, 'archives', 'codex', 'cold.jsonl.zst');
    const sessionJsonl = '{"type":"user","text":"preflight"}\n';
    const originSha256 = createHash('sha256').update(sessionJsonl).digest('hex');

    await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
    await writeFile(archivePath, sessionJsonl);
    await writeSessionManifest(join(vaultPath, 'manifests', 'codex', 'cold.json'), {
      sessionId: 'cold',
      provider: 'codex',
      title: 'preflight',
      slug: 'preflight',
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

    await runPreflightCommand({
      home,
      vaultPath,
      provider: 'codex',
      passthroughArgv: ['resume', 'cold'],
      json: true,
      compression: copyCompression,
    });

    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'preflight',
      provider: 'codex',
      restoreOnLaunchEnabled: true,
      sessionIds: ['cold'],
    });
    await expect(readFile(originalPath, 'utf8')).resolves.toBe(sessionJsonl);
    await rm(home, { recursive: true, force: true });
  });
});
