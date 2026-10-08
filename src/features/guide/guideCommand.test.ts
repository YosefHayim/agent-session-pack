import { runCommand } from 'citty';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guideCommand, runGuideCommand } from './guideCommand.js';

describe('guide command', () => {
  const writes: string[] = [];

  beforeEach(() => {
    writes.length = 0;
    process.exitCode = undefined;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('writes stable JSON guide without prompting', async () => {
    await Effect.runPromise(runGuideCommand({ json: true }));

    const payload = JSON.parse(writes.join(''));
    expect(payload).toMatchObject({
      name: 'agent-session-pack',
      mode: 'agent-guide',
      safety: {
        bareCommand: 'human-tty-only',
        machineOutput: '--json',
        applyConfirmation: '--apply --yes',
      },
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('writes human guide text by default', async () => {
    await Effect.runPromise(runGuideCommand({ json: undefined }));

    expect(writes.join('')).toContain('Agent-first quickstart');
    expect(writes.join('')).toContain('Prefer explicit subcommands with --json.');
    expect(process.exitCode).toBeUndefined();
  });

  it('exposes citty metadata and --json flag', () => {
    expect(guideCommand.meta).toMatchObject({
      name: 'guide',
      description: 'Show safe commands for agents and automation.',
    });
    expect(guideCommand.args).toMatchObject({
      json: {
        type: 'boolean',
      },
    });
  });

  it('routes citty run through JSON mode', async () => {
    await runCommand(guideCommand, { rawArgs: ['--json'] });

    const payload = JSON.parse(writes.join(''));
    expect(payload.mode).toBe('agent-guide');
  });
});
