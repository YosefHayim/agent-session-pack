import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfigPath } from '@/setup/config.js';
import { runLifecycleCommand } from './command.js';

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

    const commandOutcome = await runLifecycleCommand({
      action: 'enable',
      json: true,
      home,
      now,
    });

    expect(commandOutcome.exitCode).toBe(0);
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

    const configPath = createConfigPath(home);
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      restoreOnLaunch: boolean;
    };
    expect(config.restoreOnLaunch).toBe(true);

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
      action: 'disable',
    });

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

    const commandOutcome = await runLifecycleCommand({
      action: 'explode',
      json: true,
      home,
    });

    expect(commandOutcome.exitCode).toBe(2);
    expect(stderrWrites.join('')).toContain('Unknown lifecycle action');
    await rm(home, { recursive: true, force: true });
  });
});
