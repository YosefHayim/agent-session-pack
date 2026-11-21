import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyCompression, createArchiveProvider, writeColdSession } from './archive.js';
import {
  createHumanPackPlan,
  createPackPlan,
  packProviderSessions,
  runPackCommand,
} from './pack.js';
import type { DiscoveredSession, ProviderAdapter } from './providers.js';

const now = new Date('2026-07-06T12:00:00.000Z');

function createSession(
  provider: DiscoveredSession['provider'],
  modifiedAt: string,
  sizeBytes: number,
): DiscoveredSession {
  return {
    id: `${provider}-${modifiedAt}`,
    provider,
    title: `${provider} session`,
    slug: `${provider}-session`,
    originalPath: `/tmp/${provider}.jsonl`,
    modifiedAt: new Date(modifiedAt),
    sizeBytes,
    status: 'live',
  };
}

describe('pack plan', () => {
  it('summarizes dry-run candidates without claiming cleanup', () => {
    const plan = createPackPlan({
      now,
      olderThan: '7d',
      olderThanMs: 7 * 24 * 60 * 60 * 1000,
      sessions: [
        createSession('codex', '2026-06-01T12:00:00.000Z', 1_000),
        createSession('codex', '2026-07-05T12:00:00.000Z', 2_000),
        createSession('devin', '2026-06-01T12:00:00.000Z', 3_000),
      ],
      providers: [
        { id: 'codex', label: 'Codex', mode: 'archive' },
        { id: 'devin', label: 'Devin', mode: 'backup-only' },
      ],
    });

    expect(plan.rows).toEqual([
      {
        provider: 'codex',
        mode: 'archive',
        scannedSessions: 2,
        candidateSessions: 1,
        beforeBytes: 1_000,
        afterDryRunBytes: 1_000,
        cleanupBytes: 0,
        applySupport: 'ready',
      },
      {
        provider: 'devin',
        mode: 'backup-only',
        scannedSessions: 1,
        candidateSessions: 0,
        beforeBytes: 0,
        afterDryRunBytes: 0,
        cleanupBytes: 0,
        applySupport: 'backup-only',
      },
    ]);
    expect(plan.thresholdPreviews).toEqual([
      {
        kind: 'safer',
        olderThan: '14d',
        candidateSessions: 1,
        beforeBytes: 1_000,
      },
      {
        kind: 'broader',
        olderThan: '3d',
        candidateSessions: 1,
        beforeBytes: 1_000,
      },
      {
        kind: 'max',
        olderThan: '0h',
        candidateSessions: 2,
        beforeBytes: 3_000,
      },
    ]);
  });

  it('uses only the max preview when the threshold is already all ages', () => {
    const plan = createPackPlan({
      now,
      olderThan: '0h',
      olderThanMs: 0,
      sessions: [createSession('codex', '2026-07-06T11:00:00.000Z', 2_000)],
      providers: [{ id: 'codex', label: 'Codex', mode: 'archive' }],
    });

    expect(plan.thresholdPreviews).toEqual([
      {
        kind: 'max',
        olderThan: '0h',
        candidateSessions: 1,
        beforeBytes: 2_000,
      },
    ]);
  });
});

function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-pack-sessions-'));
}

describe('packProviderSessions', () => {
  it('reports missing, backup-only, no-candidates, and dry-run pack rows without touching originals', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack-test');
    const coldModifiedAt = new Date('2026-06-01T12:00:00.000Z');
    const warmModifiedAt = new Date('2026-07-06T10:00:00.000Z');
    const now = new Date('2026-07-06T12:00:00.000Z');
    const olderThanMs = 24 * 60 * 60 * 1000;

    const coldSession = await writeColdSession({
      home,
      relativeDir: join('.codex', 'sessions', '2026', '06', '01'),
      fileName: 'cold.jsonl',
      sessionJsonl: '{"type":"user","text":"cold session"}\n',
      modifiedAt: coldModifiedAt,
    });
    const warmSession = await writeColdSession({
      home,
      relativeDir: join('.claude', 'projects', 'demo'),
      fileName: 'warm.jsonl',
      sessionJsonl: '{"type":"user","text":"warm session"}\n',
      modifiedAt: warmModifiedAt,
    });
    const backupSession = await writeColdSession({
      home,
      relativeDir: join('.cursor', 'projects', 'demo'),
      fileName: 'backup.jsonl',
      sessionJsonl: '{"type":"user","text":"backup only"}\n',
      modifiedAt: coldModifiedAt,
    });

    const coldDiscovered: DiscoveredSession = {
      id: 'cold',
      provider: 'codex',
      title: 'cold session',
      slug: 'cold-session',
      originalPath: coldSession.path,
      modifiedAt: coldModifiedAt,
      sizeBytes: Buffer.byteLength(coldSession.sessionJsonl, 'utf8'),
      sourceKind: 'file',
    };
    const warmDiscovered: DiscoveredSession = {
      id: 'warm',
      provider: 'claude',
      title: 'warm session',
      slug: 'warm-session',
      originalPath: warmSession.path,
      modifiedAt: warmModifiedAt,
      sizeBytes: Buffer.byteLength(warmSession.sessionJsonl, 'utf8'),
      sourceKind: 'file',
    };
    const backupDiscovered: DiscoveredSession = {
      id: 'backup',
      provider: 'cursor',
      title: 'backup only',
      slug: 'backup-only',
      originalPath: backupSession.path,
      modifiedAt: coldModifiedAt,
      sizeBytes: Buffer.byteLength(backupSession.sessionJsonl, 'utf8'),
      sourceKind: 'file',
    };

    const providers: ReadonlyArray<ProviderAdapter> = [
      createArchiveProvider({
        id: 'codex',
        mode: 'archive',
        rootRelative: join('.codex', 'sessions'),
        discover: () => Promise.resolve([coldDiscovered]),
      }),
      createArchiveProvider({
        id: 'claude',
        mode: 'archive',
        rootRelative: join('.claude', 'projects'),
        discover: () => Promise.resolve([warmDiscovered]),
      }),
      createArchiveProvider({
        id: 'cursor',
        mode: 'backup-only',
        rootRelative: join('.cursor', 'projects'),
        discover: () => Promise.resolve([backupDiscovered]),
      }),
      createArchiveProvider({
        id: 'kiro',
        mode: 'archive',
        rootRelative: join('.kiro', 'sessions'),
        discover: () => Promise.resolve([]),
      }),
    ];

    const report = await packProviderSessions({
      home,
      vaultPath,
      providers,
      olderThan: '24h',
      olderThanMs,
      now,
      apply: false,
      compression: copyCompression,
    });

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

    await expect(readFile(coldSession.path, 'utf8')).resolves.toBe(coldSession.sessionJsonl);
    await expect(readFile(warmSession.path, 'utf8')).resolves.toBe(warmSession.sessionJsonl);
    await expect(readFile(backupSession.path, 'utf8')).resolves.toBe(backupSession.sessionJsonl);
    await expect(stat(join(vaultPath, 'archives'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('human pack output', () => {
  it('does not claim apply is blocked for dry-run plans', () => {
    const plan = createPackPlan({
      now: new Date('2026-07-06T12:00:00.000Z'),
      olderThan: '7d',
      olderThanMs: 7 * 24 * 60 * 60 * 1000,
      sessions: [
        {
          id: 'session-1',
          provider: 'codex',
          title: 'Old Codex session',
          slug: 'old-codex-session',
          originalPath: '/tmp/session.jsonl',
          modifiedAt: new Date('2026-06-01T12:00:00.000Z'),
          sizeBytes: 1234,
          status: 'live',
        },
      ],
      providers: [{ id: 'codex', label: 'Codex', mode: 'archive' }],
    });

    const printout = createHumanPackPlan(plan, { olderThan: '7d' });

    expect(printout).toContain('Re-run with --apply to pack cold sessions.');
    expect(printout).not.toContain('Apply is intentionally blocked');
  });

  it('shows threshold curiosity tips for stricter, broader, and max previews', () => {
    const plan = createPackPlan({
      now: new Date('2026-07-06T12:00:00.000Z'),
      olderThan: '7d',
      olderThanMs: 7 * 24 * 60 * 60 * 1000,
      sessions: [
        {
          id: 'session-older',
          provider: 'codex',
          title: 'Older Codex session',
          slug: 'older-codex-session',
          originalPath: '/tmp/session-older.jsonl',
          modifiedAt: new Date('2026-06-16T12:00:00.000Z'),
          sizeBytes: 100,
          status: 'live',
        },
        {
          id: 'session-recent',
          provider: 'codex',
          title: 'Recent Codex session',
          slug: 'recent-codex-session',
          originalPath: '/tmp/session-recent.jsonl',
          modifiedAt: new Date('2026-07-01T12:00:00.000Z'),
          sizeBytes: 200,
          status: 'live',
        },
        {
          id: 'session-fresh',
          provider: 'codex',
          title: 'Fresh Codex session',
          slug: 'fresh-codex-session',
          originalPath: '/tmp/session-fresh.jsonl',
          modifiedAt: new Date('2026-07-06T11:00:00.000Z'),
          sizeBytes: 300,
          status: 'live',
        },
      ],
      providers: [{ id: 'codex', label: 'Codex', mode: 'archive' }],
    });

    const printout = createHumanPackPlan(plan, { olderThan: '7d' });

    expect(printout).toContain('What if:');
    expect(printout).toContain('safer       --older-than 14d  1 session   100 B source');
    expect(printout).toContain('broader     --older-than 3d   2 sessions  300 B source');
    expect(printout).toContain('max preview --max --dry-run   3 sessions  600 B source');
  });
});

function createWorkspaceCommand(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-pack-command-'));
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

describe('packCommand', () => {
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

  it('packs every discovered archive-mode provider after explicit confirmation', async () => {
    const home = await createWorkspaceCommand();
    const vaultPath = join(home, '.agent-session-pack-test');
    const session = await createColdCodexSession(home);
    process.env.HOME = home;

    await runPackCommand({
      allProviders: true,
      apply: true,
      compression: copyCompression,
      confirmed: true,
      dryRun: undefined,
      json: undefined,
      olderThan: '7d',
      provider: undefined,
      vaultPath,
      yes: true,
      now: new Date('2026-07-06T12:00:00.000Z'),
    });

    await expect(readFile(session.path, 'utf8')).resolves.toContain(
      'agent-session-pack-archived-stub',
    );
    await expect(
      readFile(join(vaultPath, 'manifests', 'codex', 'session-old.json'), 'utf8'),
    ).resolves.toContain(session.path);
    expect(writes.join('')).toContain('Pack all providers');
    expect(writes.join('')).toContain('Provider   Sessions');
    expect(writes.join('')).toContain('codex');
    expect(writes.join('')).toContain('packed');
  });

  it('refuses max preview in apply mode', async () => {
    const home = await createWorkspaceCommand();
    process.env.HOME = home;

    const commandExit = await runPackCommand({
      allProviders: true,
      apply: true,
      compression: copyCompression,
      confirmed: true,
      dryRun: undefined,
      json: undefined,
      max: true,
      olderThan: undefined,
      provider: undefined,
      vaultPath: join(home, '.agent-session-pack-test'),
      yes: true,
      now: new Date('2026-07-06T12:00:00.000Z'),
    });

    expect(commandExit.exitCode).toBe(2);
    expect(writes.join('')).toContain('Refusing --max with --apply');
  });

  it('pack exits with code 1 when HOME is unset', async () => {
    delete process.env.HOME;

    const commandExit = await runPackCommand({
      allProviders: true,
      apply: undefined,
      compression: copyCompression,
      confirmed: undefined,
      dryRun: true,
      json: true,
      olderThan: '7d',
      provider: undefined,
      yes: undefined,
    });

    expect(commandExit.exitCode).toBe(1);
    const stderr = writes.join('');
    expect(stderr).toContain('HOME is not set.');
    expect(stderr).toContain('vault and config paths');
  });

  it('pack cancels apply without confirmation and sets exit code 2', async () => {
    const home = await createWorkspaceCommand();
    process.env.HOME = home;

    const commandExit = await runPackCommand({
      allProviders: true,
      apply: true,
      compression: copyCompression,
      confirmed: false,
      dryRun: undefined,
      home,
      json: true,
      olderThan: '7d',
      provider: undefined,
      vaultPath: join(home, '.agent-session-pack-test'),
      yes: undefined,
    });

    expect(commandExit.exitCode).toBe(2);
    expect(writes.join('')).toContain('Cancelled. Re-run with --apply and confirm with y');
  });

  it('pack writes JSON archive report for dry-run all-providers', async () => {
    const home = await createWorkspaceCommand();
    await createColdCodexSession(home);
    process.env.HOME = home;

    const commandExit = await runPackCommand({
      allProviders: true,
      apply: false,
      compression: copyCompression,
      confirmed: undefined,
      dryRun: true,
      home,
      json: true,
      olderThan: '7d',
      provider: 'codex',
      vaultPath: join(home, '.agent-session-pack-test'),
      yes: undefined,
      now: new Date('2026-07-06T12:00:00.000Z'),
    });

    const printedDocument = JSON.parse(writes.join('')) as {
      readonly rows: ReadonlyArray<{ readonly provider: string; readonly status: string }>;
    };
    expect(Array.isArray(printedDocument.rows)).toBe(true);
    expect(printedDocument.rows.some((session) => session.provider == 'codex')).toBe(true);
    expect(commandExit.exitCode).toBe(0);
  });

  it('pack reports unknown provider without prompting', async () => {
    const home = await createWorkspaceCommand();
    process.env.HOME = home;

    const commandExit = await runPackCommand({
      allProviders: undefined,
      apply: undefined,
      compression: copyCompression,
      confirmed: undefined,
      dryRun: true,
      home,
      json: true,
      olderThan: '7d',
      provider: 'unknown-agent',
      yes: undefined,
    });

    expect(commandExit.exitCode).toBe(2);
    expect(writes.join('')).toContain('Unknown provider: unknown-agent');
  });
});
