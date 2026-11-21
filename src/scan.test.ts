import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { codexProvider, type DiscoveredSession, type ProviderAdapter } from './providers.js';
import {
  createHumanEvidenceReport,
  createHumanScan,
  discoverStoreSessions,
  inspectProviderInventory,
  runLocalEvidence,
  runSavingsCommand,
  runScanCommand,
  type ScanReport,
  scanStores,
  selectNewestSessionWithinSize,
} from './scan.js';

function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-scan-stores-'));
}

describe('scanStores', () => {
  it('scans stores through provider adapters and skips unknown providers', async () => {
    const workspace = await createWorkspace();
    const codexRoot = join(workspace, 'codex');
    await mkdir(codexRoot, { recursive: true });
    const session: DiscoveredSession = {
      id: 'session-1',
      provider: 'codex',
      title: 'Synthetic scan',
      slug: 'synthetic-scan',
      originalPath: join(codexRoot, 'session-1.jsonl'),
      modifiedAt: new Date('2026-06-01T12:00:00.000Z'),
      sizeBytes: 32,
      sourceKind: 'file',
    };

    const provider: ProviderAdapter = {
      id: 'codex',
      label: 'Codex',
      mode: 'archive',
      defaultRoots: (home) => [join(home, '.codex', 'sessions')],
      discover: (store) => {
        const isCodexStore = store.path == codexRoot;
        return Promise.resolve(isCodexStore ? [session] : []);
      },
    };

    const report = await scanStores({
      stores: [
        { provider: 'codex', path: codexRoot },
        { provider: 'claude', path: join(workspace, 'claude') },
      ],
      providers: [provider],
    });

    expect(report.sessions).toEqual([session]);
  });

  it('treats a store removed during provider discovery as absent', async () => {
    const workspace = await createWorkspace();
    const storePath = join(workspace, 'codex');
    await mkdir(storePath, { recursive: true });
    const discoveryError = new Error('store disappeared');
    const provider: ProviderAdapter = {
      id: 'codex',
      label: 'Codex',
      mode: 'archive',
      defaultRoots: () => [storePath],
      discover: async () => {
        await rm(storePath, { recursive: true });
        throw discoveryError;
      },
    };

    const sessions = await discoverStoreSessions(provider, { provider: 'codex', path: storePath });

    expect(sessions).toEqual([]);
  });

  it('preserves provider discovery errors while the store still exists', async () => {
    const workspace = await createWorkspace();
    const storePath = join(workspace, 'codex');
    await mkdir(storePath, { recursive: true });
    const discoveryError = new Error('permission denied');
    const provider: ProviderAdapter = {
      id: 'codex',
      label: 'Codex',
      mode: 'archive',
      defaultRoots: () => [storePath],
      discover: () => Promise.reject(discoveryError),
    };

    await expect(
      discoverStoreSessions(provider, { provider: 'codex', path: storePath }),
    ).rejects.toBe(discoveryError);
  });
});

const now = new Date('2026-07-06T12:00:00.000Z');
const olderThanMs = 7 * 24 * 60 * 60 * 1000;

function createWorkspaceProviderInventory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-inventory-'));
}

async function writeSession(path: string, sessionJsonl: string, modifiedAt: Date): Promise<number> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, sessionJsonl);
  await utimes(path, modifiedAt, modifiedAt);

  return Buffer.byteLength(sessionJsonl, 'utf8');
}

describe('provider inventory', () => {
  it('classifies archive provider sessions into cold candidates and guarded recent sessions', async () => {
    const home = await createWorkspaceProviderInventory();
    const root = join(home, '.codex', 'sessions');
    const oldBytes = await writeSession(
      join(root, '2026', '06', '01', 'session-old.jsonl'),
      '{"type":"user","text":"old codex session"}\n',
      new Date('2026-06-01T12:00:00.000Z'),
    );
    const recentBytes = await writeSession(
      join(root, '2026', '07', '05', 'session-recent.jsonl'),
      '{"type":"user","text":"recent codex session"}\n',
      new Date('2026-07-05T12:00:00.000Z'),
    );

    const report = await inspectProviderInventory({
      home,
      providers: [codexProvider],
      olderThanMs,
      now,
    });

    expect(report.rows).toEqual([
      {
        provider: 'codex',
        label: 'Codex',
        mode: 'archive',
        sessions: 2,
        coldSessions: 1,
        guardedRecentSessions: 1,
        totalBytes: oldBytes + recentBytes,
        candidateBytes: oldBytes,
        paths: [root],
        status: 'ready',
      },
    ]);
  });

  it('keeps backup-only providers visible but removes destructive candidates', async () => {
    const home = await createWorkspaceProviderInventory();
    const root = join(home, 'backup-provider');
    const provider: ProviderAdapter = {
      id: 'devin',
      label: 'Devin',
      mode: 'backup-only',
      defaultRoots: () => [root],
      discover: () =>
        Promise.resolve([
          {
            id: 'devin-session',
            provider: 'devin',
            title: 'Devin session',
            slug: 'devin-session',
            originalPath: join(root, 'sessions.db'),
            modifiedAt: new Date('2026-06-01T12:00:00.000Z'),
            sizeBytes: 10_000,
          },
        ]),
    };

    await mkdir(root, { recursive: true });

    const report = await inspectProviderInventory({
      home,
      providers: [provider],
      olderThanMs,
      now,
    });

    expect(report.rows[0]).toMatchObject({
      provider: 'devin',
      mode: 'backup-only',
      sessions: 1,
      coldSessions: 0,
      guardedRecentSessions: 0,
      totalBytes: 10_000,
      candidateBytes: 0,
      status: 'backup-only',
    });
  });
});

describe('human scan output', () => {
  it('keeps session titles on one short terminal row', () => {
    const report: ScanReport = {
      sessions: [
        {
          id: 'session-1',
          provider: 'claude',
          title: [
            '<local-command-caveat>Caveat: generated while running local commands.</local-command-caveat>',
            'This title is intentionally long so the terminal table remains readable.',
          ].join('\n'),
          slug: 'long-title',
          originalPath: '/tmp/session.jsonl',
          modifiedAt: new Date('2026-07-06T10:00:00.000Z'),
          sizeBytes: 1234,
          status: 'live',
        },
      ],
    };

    const printout = createHumanScan(report);
    const lines = printout.split('\n');

    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain('generated while running local commands');
    expect(lines[3]).toContain('...');
    expect(lines[3]).not.toContain('This title is intentionally long');
  });
});

function createWorkspaceCommand(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-scan-cmd-'));
}

async function writeCodexSession(
  home: string,
): Promise<{ readonly path: string; readonly sessionJsonl: string }> {
  const sessionDir = join(home, '.codex', 'sessions', '2026', '06', '01');
  const sessionPath = join(sessionDir, 'session-old.jsonl');
  const sessionJsonl = '{"type":"user","text":"scan command fixture"}\n';
  const modifiedAt = new Date('2026-06-01T12:00:00.000Z');

  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionPath, sessionJsonl);
  await utimes(sessionPath, modifiedAt, modifiedAt);

  return { path: sessionPath, sessionJsonl };
}

describe('scan command', () => {
  const originalHome = process.env.HOME;
  const stdoutWrites: string[] = [];
  const stderrWrites: string[] = [];
  let consoleLogSpy: ReturnType<typeof vi.spyOn> | undefined;

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
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation((...messages: unknown[]) => {
      stdoutWrites.push(messages.map(String).join(' '));
    });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    consoleLogSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it('exits with code 1 when HOME is unset', async () => {
    delete process.env.HOME;

    const commandExit = await runScanCommand({ json: true });

    expect(commandExit.exitCode).toBe(1);
    const stderr = stderrWrites.join('');
    expect(stderr).toContain('HOME is not set.');
    expect(stderr).toContain('vault and config paths');
  });

  it('exits with code 2 for an unknown provider without prompting', async () => {
    const home = await createWorkspaceCommand();
    process.env.HOME = home;

    const commandExit = await runScanCommand({ provider: 'not-a-provider', json: true });

    expect(commandExit.exitCode).toBe(2);
    expect(stderrWrites.join('')).toContain('Unknown provider: not-a-provider');
  });

  it('writes empty JSON sessions for a synthetic empty store', async () => {
    const home = await createWorkspaceCommand();
    await mkdir(join(home, '.codex', 'sessions'), { recursive: true });
    process.env.HOME = home;

    const commandExit = await runScanCommand({ provider: 'codex', json: true });

    const printedDocument = JSON.parse(stdoutWrites.join('')) as {
      readonly sessions: ReadonlyArray<unknown>;
    };
    expect(printedDocument.sessions).toEqual([]);
    expect(commandExit.exitCode).toBe(0);
  });

  it('treats absent provider roots as providers without installed stores', async () => {
    const home = await createWorkspaceCommand();
    process.env.HOME = home;

    const commandExit = await runScanCommand({ json: true });

    const printedDocument = JSON.parse(stdoutWrites.join('')) as {
      readonly sessions: ReadonlyArray<unknown>;
    };
    expect(printedDocument.sessions).toEqual([]);
    expect(stderrWrites).toEqual([]);
    expect(commandExit.exitCode).toBe(0);
  });

  it('discovers synthetic codex sessions in JSON mode', async () => {
    const home = await createWorkspaceCommand();
    const session = await writeCodexSession(home);
    process.env.HOME = home;

    await runScanCommand({ provider: 'codex', json: true });

    const printedDocument = JSON.parse(stdoutWrites.join('')) as {
      readonly sessions: ReadonlyArray<{
        readonly provider: string;
        readonly originalPath: string;
      }>;
    };
    expect(printedDocument.sessions).toHaveLength(1);
    expect(printedDocument.sessions[0]?.provider).toBe('codex');
    expect(printedDocument.sessions[0]?.originalPath).toBe(session.path);
  });

  it('writes human empty-state output without ANSI prompts', async () => {
    const home = await createWorkspaceCommand();
    await mkdir(join(home, '.codex', 'sessions'), { recursive: true });
    process.env.HOME = home;

    await runScanCommand({ provider: 'codex', json: undefined });

    expect(stdoutWrites.join('')).toContain('No sessions found.');
  });
});

describe('evidence sample', () => {
  it('selects the newest session that fits under the size cap', () => {
    const selected = selectNewestSessionWithinSize(
      [
        { id: 'older-small', modifiedAt: new Date('2026-07-01T10:00:00.000Z'), sizeBytes: 10 },
        { id: 'newer-large', modifiedAt: new Date('2026-07-03T10:00:00.000Z'), sizeBytes: 500 },
        { id: 'newest-small', modifiedAt: new Date('2026-07-02T10:00:00.000Z'), sizeBytes: 20 },
      ],
      100,
    );

    expect(selected?.id).toBe('newest-small');
  });

  it('falls back to the smallest session when every session is over the size cap', () => {
    const selected = selectNewestSessionWithinSize(
      [
        { id: 'huge', modifiedAt: new Date('2026-07-03T10:00:00.000Z'), sizeBytes: 500 },
        { id: 'less-huge', modifiedAt: new Date('2026-07-01T10:00:00.000Z'), sizeBytes: 200 },
      ],
      100,
    );

    expect(selected?.id).toBe('less-huge');
  });
});

function createWorkspaceLocalEvidence(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-local-evidence-'));
}

describe('local evidence', () => {
  it('retains discovery counts when every source is too large to sample', async () => {
    const workspace = await createWorkspaceLocalEvidence();
    const storePath = join(workspace, 'sessions');
    await mkdir(storePath, { recursive: true });
    const provider: ProviderAdapter = {
      id: 'codex',
      label: 'Codex',
      mode: 'archive',
      defaultRoots: () => [storePath],
      discover: () =>
        Promise.resolve([
          {
            id: 'oversized',
            provider: 'codex',
            title: 'Oversized proof source',
            slug: 'oversized-proof-source',
            originalPath: join(storePath, 'oversized.jsonl'),
            modifiedAt: new Date('2026-08-23T12:00:00.000Z'),
            sizeBytes: 30 * 1024 * 1024,
            sourceKind: 'file' as const,
          },
        ]),
    };

    const report = await runLocalEvidence({
      home: workspace,
      workRoot: join(workspace, 'proof'),
      providers: [provider],
    });

    expect(report.evidence).toEqual([
      {
        provider: 'codex',
        foundSessions: 1,
        sampledSources: 0,
        mode: 'archive',
        originalTouched: false,
        maxEvidenceSourceBytes: 25 * 1024 * 1024,
      },
    ]);
  });
});

describe('human evidence output', () => {
  it('renders local proof as a compact before and after table', () => {
    const printout = createHumanEvidenceReport({
      scope: 'sampled-copy-proof',
      workRoot: '/tmp/agent-session-pack/evidence',
      evidence: [
        {
          provider: 'codex',
          foundSessions: 42,
          sampledSources: 1,
          mode: 'archive',
          sourceBytes: 10_000,
          archiveBytes: 2_500,
          savedPercent: 75,
          byteExact: true,
          originalTouched: false,
        },
        {
          provider: 'devin',
          foundSessions: 8,
          sampledSources: 1,
          mode: 'backup-only',
          sourceBytes: 97_058_816,
          archiveBytes: 13_425_614,
          savedPercent: 86.2,
          byteExact: true,
          originalTouched: false,
        },
        {
          provider: 'claude',
          foundSessions: 1,
          sampledSources: 0,
          mode: 'archive',
          originalTouched: false,
        },
      ],
    });

    expect(printout).toContain('Local evidence');
    expect(printout).toContain('One eligible source per provider is copied and measured.');
    expect(printout).toContain('Proof bytes are not a whole-store estimate.');
    expect(printout).toContain('Discovered  Samples');
    expect(printout).toContain('Proof before');
    expect(printout).toContain('Proof after');
    expect(printout).toContain('Saved');
    expect(printout).toContain('codex');
    expect(printout).toContain('42');
    expect(printout).toContain('75.0%');
    expect(printout).toContain('devin');
    expect(printout).toContain('8');
    expect(printout).toContain('86.2%');
    expect(printout).toContain('sample total');
    expect(printout).toContain('51');
    expect(printout).toContain('2');
    expect(printout).toMatch(/claude\s+1\s+0\s+archive\s+-\s+-\s+-\s+-\s+no/);
    expect(printout).toContain('Original sessions touched: no');
    expect(printout).toContain('/tmp/agent-session-pack/evidence');
  });
});

function createWorkspaceSavingsCommand(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-savings-cmd-'));
}

async function writeCodexSessionSavingsCommand(home: string): Promise<string> {
  const sessionDir = join(home, '.codex', 'sessions', '2026', '06', '01');
  const sessionPath = join(sessionDir, 'session-old.jsonl');
  const sessionJsonl = `${'{"type":"user","text":"savings proof fixture"}\n'.repeat(40)}`;
  const modifiedAt = new Date('2026-06-01T12:00:00.000Z');

  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionPath, sessionJsonl);
  await utimes(sessionPath, modifiedAt, modifiedAt);

  return sessionPath;
}

describe('savings command', () => {
  const originalHome = process.env.HOME;
  const originalCwd = process.cwd();
  const stdoutWrites: string[] = [];
  const stderrWrites: string[] = [];
  let workCwd: string | undefined;

  beforeEach(async () => {
    stdoutWrites.length = 0;
    stderrWrites.length = 0;
    workCwd = await createWorkspaceSavingsCommand();
    process.chdir(workCwd);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrWrites.push(String(chunk));
      return true;
    });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.env.HOME = originalHome;
    vi.restoreAllMocks();

    const createdWorkCwd = workCwd;

    if (createdWorkCwd != null) {
      await rm(createdWorkCwd, { recursive: true, force: true });
    }
  });

  it('exits with code 1 when HOME is unset', async () => {
    delete process.env.HOME;

    const commandExit = await runSavingsCommand({ json: true });

    expect(commandExit.exitCode).toBe(1);
    const stderr = stderrWrites.join('');
    expect(stderr).toContain('HOME is not set.');
    expect(stderr).toContain('vault and config paths');
  });

  it('exits with code 2 for an unknown provider without prompting', async () => {
    const home = await createWorkspaceSavingsCommand();
    process.env.HOME = home;

    const commandExit = await runSavingsCommand({ provider: 'nope', json: true });

    expect(commandExit.exitCode).toBe(2);
    expect(stderrWrites.join('')).toContain('Unknown provider: nope');
  });

  it('writes empty JSON evidence for a synthetic empty home', async () => {
    const home = await createWorkspaceSavingsCommand();
    process.env.HOME = home;

    const commandExit = await runSavingsCommand({ provider: 'codex', json: true });

    const printedDocument = JSON.parse(stdoutWrites.join('')) as {
      readonly workRoot: string;
      readonly evidence: ReadonlyArray<unknown>;
    };
    expect(printedDocument.evidence).toEqual([]);
    expect(printedDocument.workRoot).toContain(
      join('.vault-test', 'evidence-local', String(process.pid)),
    );
    expect(commandExit.exitCode).toBe(0);
  });

  it('writes human empty-state evidence without prompting', async () => {
    const home = await createWorkspaceSavingsCommand();
    process.env.HOME = home;

    await runSavingsCommand({ provider: 'codex', json: undefined });

    expect(stdoutWrites.join('')).toContain('No eligible sessions found.');
    expect(stdoutWrites.join('')).toContain('Local evidence');
  });

  it('runs copy-only proof for a synthetic codex session under --json', async () => {
    const home = await createWorkspaceSavingsCommand();
    const sessionPath = await writeCodexSessionSavingsCommand(home);
    process.env.HOME = home;

    await runSavingsCommand({ provider: 'codex', json: true });

    const printedDocument = JSON.parse(stdoutWrites.join('')) as {
      readonly scope: string;
      readonly evidence: ReadonlyArray<{
        readonly provider: string;
        readonly originalTouched: boolean;
        readonly byteExact: boolean;
        readonly originalPath?: string;
        readonly foundSessions: number;
        readonly sampledSources: number;
      }>;
    };

    expect(printedDocument.scope).toBe('sampled-copy-proof');
    expect(printedDocument.evidence).toHaveLength(1);
    expect(printedDocument.evidence[0]).toMatchObject({
      provider: 'codex',
      originalTouched: false,
      byteExact: true,
      originalPath: sessionPath,
      foundSessions: 1,
      sampledSources: 1,
    });
  });
});
