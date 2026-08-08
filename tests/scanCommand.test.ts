import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runScanCommand, scanCommand } from '../src/cli/commands/scanCommand.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-scan-cmd-'));

const writeCodexSession = async (
  home: string,
): Promise<{ readonly path: string; readonly content: string }> => {
  const sessionDir = join(home, '.codex', 'sessions', '2026', '06', '01');
  const sessionPath = join(sessionDir, 'session-old.jsonl');
  const content = '{"type":"user","text":"scan command fixture"}\n';
  const modifiedAt = new Date('2026-06-01T12:00:00.000Z');

  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionPath, content);
  await utimes(sessionPath, modifiedAt, modifiedAt);

  return { path: sessionPath, content };
};

describe('scan command', () => {
  const originalHome = process.env.HOME;
  const stdoutWrites: string[] = [];
  const stderrWrites: string[] = [];
  let consoleLogSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    stdoutWrites.length = 0;
    stderrWrites.length = 0;
    process.exitCode = undefined;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrWrites.push(String(chunk));
      return true;
    });
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      stdoutWrites.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.exitCode = undefined;
    consoleLogSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it('exits with code 1 when HOME is unset', async () => {
    delete process.env.HOME;

    await Effect.runPromise(runScanCommand({ json: true }));

    expect(process.exitCode).toBe(1);
    const stderr = stderrWrites.join('');
    expect(stderr).toContain('HOME is not set.');
    expect(stderr).toContain('.env.example');
    expect(stderr).toContain('vault and config paths');
  });

  it('exits with code 2 for an unknown provider without prompting', async () => {
    const home = await createWorkspace();
    process.env.HOME = home;

    await Effect.runPromise(runScanCommand({ provider: 'not-a-provider', json: true }));

    expect(process.exitCode).toBe(2);
    expect(stderrWrites.join('')).toContain('Unknown provider: not-a-provider');
  });

  it('writes empty JSON sessions for a synthetic empty store', async () => {
    const home = await createWorkspace();
    await mkdir(join(home, '.codex', 'sessions'), { recursive: true });
    process.env.HOME = home;

    await Effect.runPromise(runScanCommand({ provider: 'codex', json: true }));

    const payload = JSON.parse(stdoutWrites.join('')) as {
      readonly sessions: ReadonlyArray<unknown>;
    };
    expect(payload.sessions).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it('discovers synthetic codex sessions in JSON mode', async () => {
    const home = await createWorkspace();
    const session = await writeCodexSession(home);
    process.env.HOME = home;

    await Effect.runPromise(runScanCommand({ provider: 'codex', json: true }));

    const payload = JSON.parse(stdoutWrites.join('')) as {
      readonly sessions: ReadonlyArray<{
        readonly provider: string;
        readonly originalPath: string;
      }>;
    };
    expect(payload.sessions).toHaveLength(1);
    expect(payload.sessions[0]?.provider).toBe('codex');
    expect(payload.sessions[0]?.originalPath).toBe(session.path);
  });

  it('writes human empty-state output without ANSI prompts', async () => {
    const home = await createWorkspace();
    await mkdir(join(home, '.codex', 'sessions'), { recursive: true });
    process.env.HOME = home;

    await Effect.runPromise(runScanCommand({ provider: 'codex', json: undefined }));

    expect(stdoutWrites.join('')).toContain('No sessions found.');
  });

  it('exposes citty metadata and flags', () => {
    expect(scanCommand.meta).toMatchObject({
      name: 'scan',
      description: 'Scan provider stores and estimate sessions.',
    });
    expect(scanCommand.args).toMatchObject({
      provider: { type: 'string' },
      json: { type: 'boolean' },
    });
  });
});
