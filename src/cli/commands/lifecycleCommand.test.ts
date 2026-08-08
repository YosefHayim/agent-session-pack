import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfigPath } from '../../core/setupConfig.js';
import { runLifecycleCommand } from './lifecycleCommand.js';

describe('lifecycle command', () => {
  const stdoutWrites: string[] = [];
  const stderrWrites: string[] = [];

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
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('enables restore-on-launch and reports status as JSON', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-lifecycle-'));
    const now = new Date('2026-07-07T00:00:00.000Z');

    await Effect.runPromise(
      runLifecycleCommand({
        action: 'enable',
        json: true,
        home,
        now,
      }),
    );

    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'lifecycle',
      action: 'enable',
      restoreOnLaunch: true,
      restoreCacheAfter: '7d',
      configPresent: true,
    });

    const configPath = resolveConfigPath(home);
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      restoreOnLaunch: boolean;
    };
    expect(config.restoreOnLaunch).toBe(true);

    stdoutWrites.length = 0;
    await Effect.runPromise(
      runLifecycleCommand({
        action: 'status',
        json: true,
        home,
      }),
    );
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      restoreOnLaunch: true,
    });

    stdoutWrites.length = 0;
    await Effect.runPromise(
      runLifecycleCommand({
        action: 'disable',
        json: true,
        home,
        now,
      }),
    );
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      restoreOnLaunch: false,
      action: 'disable',
    });

    await rm(home, { recursive: true, force: true });
  });

  it('rejects unknown lifecycle actions', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-lifecycle-bad-'));

    await Effect.runPromise(
      runLifecycleCommand({
        action: 'explode',
        json: true,
        home,
      }),
    );

    expect(process.exitCode).toBe(2);
    expect(stderrWrites.join('')).toContain('Unknown lifecycle action');
    await rm(home, { recursive: true, force: true });
  });
});
