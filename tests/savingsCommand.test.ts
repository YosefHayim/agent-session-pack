import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkCommand,
  runSavingsCommand,
  savingsCommand,
} from '../src/cli/commands/savingsCommand.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-savings-cmd-'));

const writeCodexSession = async (home: string): Promise<string> => {
  const sessionDir = join(home, '.codex', 'sessions', '2026', '06', '01');
  const sessionPath = join(sessionDir, 'session-old.jsonl');
  const content = `${'{"type":"user","text":"savings proof fixture"}\n'.repeat(40)}`;
  const modifiedAt = new Date('2026-06-01T12:00:00.000Z');

  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionPath, content);
  await utimes(sessionPath, modifiedAt, modifiedAt);

  return sessionPath;
};

describe('savings command', () => {
  const originalHome = process.env.HOME;
  const originalCwd = process.cwd();
  const stdoutWrites: string[] = [];
  const stderrWrites: string[] = [];
  let workCwd: string | undefined;

  beforeEach(async () => {
    stdoutWrites.length = 0;
    stderrWrites.length = 0;
    process.exitCode = undefined;
    workCwd = await createWorkspace();
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
    process.exitCode = undefined;
    vi.restoreAllMocks();
    if (workCwd !== undefined) {
      await rm(workCwd, { recursive: true, force: true });
    }
  });

  it('exits with code 1 when HOME is unset', async () => {
    delete process.env.HOME;

    await Effect.runPromise(runSavingsCommand({ json: true }));

    expect(process.exitCode).toBe(1);
    expect(stderrWrites.join('')).toContain('HOME is not set.');
  });

  it('exits with code 2 for an unknown provider without prompting', async () => {
    const home = await createWorkspace();
    process.env.HOME = home;

    await Effect.runPromise(runSavingsCommand({ provider: 'nope', json: true }));

    expect(process.exitCode).toBe(2);
    expect(stderrWrites.join('')).toContain('Unknown provider: nope');
  });

  it('writes empty JSON evidence for a synthetic empty home', async () => {
    const home = await createWorkspace();
    process.env.HOME = home;

    await Effect.runPromise(runSavingsCommand({ provider: 'codex', json: true }));

    const payload = JSON.parse(stdoutWrites.join('')) as {
      readonly workRoot: string;
      readonly evidence: ReadonlyArray<unknown>;
    };
    expect(payload.evidence).toEqual([]);
    expect(payload.workRoot).toContain(join('.vault-test', 'evidence-local', String(process.pid)));
    expect(process.exitCode).toBeUndefined();
  });

  it('writes human empty-state evidence without prompting', async () => {
    const home = await createWorkspace();
    process.env.HOME = home;

    await Effect.runPromise(runSavingsCommand({ provider: 'codex', json: undefined }));

    expect(stdoutWrites.join('')).toContain('No eligible sessions found.');
    expect(stdoutWrites.join('')).toContain('Local evidence');
  });

  it('runs copy-only proof for a synthetic codex session under --json', async () => {
    const home = await createWorkspace();
    const sessionPath = await writeCodexSession(home);
    process.env.HOME = home;

    await Effect.runPromise(runSavingsCommand({ provider: 'codex', json: true }));

    const payload = JSON.parse(stdoutWrites.join('')) as {
      readonly evidence: ReadonlyArray<{
        readonly provider: string;
        readonly originalTouched: boolean;
        readonly byteExact: boolean;
        readonly originalPath?: string;
        readonly foundSessions: number;
      }>;
    };

    expect(payload.evidence).toHaveLength(1);
    expect(payload.evidence[0]).toMatchObject({
      provider: 'codex',
      originalTouched: false,
      byteExact: true,
      originalPath: sessionPath,
      foundSessions: 1,
    });
  });

  it('exposes savings and check citty metadata', () => {
    expect(savingsCommand.meta).toMatchObject({
      name: 'savings',
      description: 'Show copy-only local before/after compression proof.',
    });
    expect(checkCommand.meta).toMatchObject({
      name: 'check',
      description: 'Run the no-install local savings proof.',
    });
    expect(savingsCommand.args).toMatchObject({
      provider: { type: 'string' },
      json: { type: 'boolean' },
    });
  });
});
