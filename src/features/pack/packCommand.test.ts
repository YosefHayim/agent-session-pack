import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyCompression, writeColdSession } from '../../../tests/archiveFixtures.js';
import { runPackCommand } from './packCommand.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-pack-command-'));

const createColdCodexSession = (
  home: string,
): Promise<{ readonly path: string; readonly content: string }> =>
  writeColdSession(
    home,
    join('.codex', 'sessions', '2026', '06', '01'),
    'session-old.jsonl',
    '{"type":"user","text":"pack every provider"}\n',
    new Date('2026-06-01T12:00:00.000Z'),
  );

describe('packCommand', () => {
  const originalHome = process.env.HOME;
  const writes: string[] = [];

  beforeEach(() => {
    writes.length = 0;
    process.exitCode = undefined;
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
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('packs every discovered archive-mode provider after explicit confirmation', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack-test');
    const session = await createColdCodexSession(home);
    process.env.HOME = home;

    await Effect.runPromise(
      runPackCommand({
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
      }),
    );

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
    const home = await createWorkspace();
    process.env.HOME = home;

    await Effect.runPromise(
      runPackCommand({
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
      }),
    );

    expect(process.exitCode).toBe(2);
    expect(writes.join('')).toContain('Refusing --max with --apply');
  });

  it('pack exits with code 1 when HOME is unset', async () => {
    delete process.env.HOME;

    await Effect.runPromise(
      runPackCommand({
        allProviders: true,
        apply: undefined,
        compression: copyCompression,
        confirmed: undefined,
        dryRun: true,
        json: true,
        olderThan: '7d',
        provider: undefined,
        yes: undefined,
      }),
    );

    expect(process.exitCode).toBe(1);
    const stderr = writes.join('');
    expect(stderr).toContain('HOME is not set.');
    expect(stderr).toContain('.env.example');
    expect(stderr).toContain('vault and config paths');
  });

  it('pack cancels apply without confirmation and sets exit code 2', async () => {
    const home = await createWorkspace();
    process.env.HOME = home;

    await Effect.runPromise(
      runPackCommand({
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
      }),
    );

    expect(process.exitCode).toBe(2);
    expect(writes.join('')).toContain('Cancelled. Re-run with --apply and confirm with y');
  });

  it('pack writes JSON archive report for dry-run all-providers', async () => {
    const home = await createWorkspace();
    await createColdCodexSession(home);
    process.env.HOME = home;

    await Effect.runPromise(
      runPackCommand({
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
      }),
    );

    const payload = JSON.parse(writes.join('')) as {
      readonly rows: ReadonlyArray<{ readonly provider: string; readonly status: string }>;
    };
    expect(Array.isArray(payload.rows)).toBe(true);
    expect(payload.rows.some((row) => row.provider === 'codex')).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('pack reports unknown provider without prompting', async () => {
    const home = await createWorkspace();
    process.env.HOME = home;

    await Effect.runPromise(
      runPackCommand({
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
      }),
    );

    expect(process.exitCode).toBe(2);
    expect(writes.join('')).toContain('Unknown provider: unknown-agent');
  });
});
