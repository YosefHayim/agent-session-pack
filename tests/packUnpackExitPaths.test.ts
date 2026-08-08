import { copyFile, mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPackCommand } from '../src/cli/commands/packCommand.js';
import { runUnpackCommand } from '../src/cli/commands/unpackCommand.js';
import type { CompressionAdapter } from '../src/core/index.js';

const copyCompression: CompressionAdapter = {
  compress: ({ sourcePath, archivePath }) =>
    Effect.promise(() => copyFile(sourcePath, archivePath)),
  decompress: ({ archivePath, restoredPath }) =>
    Effect.promise(() => copyFile(archivePath, restoredPath)),
};

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-pack-exit-'));

const writeCodexSession = async (home: string): Promise<void> => {
  const sessionDir = join(home, '.codex', 'sessions', '2026', '06', '01');
  const sessionPath = join(sessionDir, 'session-old.jsonl');
  const modifiedAt = new Date('2026-06-01T12:00:00.000Z');

  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionPath, '{"type":"user","text":"pack exit fixture"}\n');
  await utimes(sessionPath, modifiedAt, modifiedAt);
};

describe('pack and unpack exit paths', () => {
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
    expect(writes.join('')).toContain('HOME is not set.');
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
    await writeCodexSession(home);
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

  it('unpack exits with code 1 when HOME is unset', async () => {
    delete process.env.HOME;

    await Effect.runPromise(
      runUnpackCommand({
        allProviders: true,
        apply: undefined,
        compression: copyCompression,
        confirmed: undefined,
        json: true,
        provider: undefined,
        yes: undefined,
      }),
    );

    expect(process.exitCode).toBe(1);
    expect(writes.join('')).toContain('HOME is not set.');
  });

  it('unpack cancels apply without confirmation and sets exit code 2', async () => {
    const home = await createWorkspace();
    process.env.HOME = home;

    await Effect.runPromise(
      runUnpackCommand({
        allProviders: true,
        apply: true,
        compression: copyCompression,
        confirmed: false,
        home,
        json: true,
        provider: undefined,
        vaultPath: join(home, '.agent-session-pack-test'),
        yes: undefined,
      }),
    );

    expect(process.exitCode).toBe(2);
    expect(writes.join('')).toContain('Cancelled. Re-run with --apply and confirm with y');
  });

  it('unpack writes JSON report for empty vault dry-run', async () => {
    const home = await createWorkspace();
    process.env.HOME = home;

    await Effect.runPromise(
      runUnpackCommand({
        allProviders: true,
        apply: false,
        compression: copyCompression,
        confirmed: undefined,
        home,
        json: true,
        provider: 'codex',
        vaultPath: join(home, '.agent-session-pack-test'),
        yes: undefined,
      }),
    );

    const payload = JSON.parse(writes.join('')) as {
      readonly rows: ReadonlyArray<unknown>;
    };
    expect(Array.isArray(payload.rows)).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });
});
