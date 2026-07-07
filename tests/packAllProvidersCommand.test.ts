import { copyFile, mkdir, mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises';
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
  mkdtemp(join(tmpdir(), 'agent-session-pack-all-providers-'));

const createColdCodexSession = async (
  home: string,
): Promise<{ readonly path: string; readonly content: string }> => {
  const sessionDir = join(home, '.codex', 'sessions', '2026', '06', '01');
  const sessionPath = join(sessionDir, 'session-old.jsonl');
  const content = '{"type":"user","text":"pack every provider"}\n';
  const modifiedAt = new Date('2026-06-01T12:00:00.000Z');

  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionPath, content);
  await utimes(sessionPath, modifiedAt, modifiedAt);

  return {
    path: sessionPath,
    content,
  };
};

describe('all-provider pack and unpack commands', () => {
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

    await expect(stat(session.path)).rejects.toMatchObject({ code: 'ENOENT' });
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

  it('unpacks every archived provider session back to the original path', async () => {
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
        json: true,
        olderThan: '7d',
        provider: undefined,
        vaultPath,
        yes: true,
        now: new Date('2026-07-06T12:00:00.000Z'),
      }),
    );

    await Effect.runPromise(
      runUnpackCommand({
        allProviders: true,
        apply: true,
        compression: copyCompression,
        confirmed: true,
        json: undefined,
        provider: undefined,
        vaultPath,
        yes: true,
      }),
    );

    await expect(readFile(session.path, 'utf8')).resolves.toBe(session.content);
    expect(writes.join('')).toContain('Unpack all providers');
    expect(writes.join('')).toContain('restored');
  });
});
