import { runCommand } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guideCommand, runGuideCommand } from './command.js';

describe('guide command', () => {
  const writes: string[] = [];

  beforeEach(() => {
    writes.length = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes stable JSON guide without prompting', async () => {
    const commandExit = await runGuideCommand({ json: true });

    const printedDocument = JSON.parse(writes.join(''));
    expect(printedDocument).toMatchObject({
      name: 'agent-session-pack',
      mode: 'agent-guide',
      safety: {
        bareCommand: 'human-tty-only',
        machineOutput: '--json',
        applyConfirmation: '--apply --yes',
      },
    });
    expect(commandExit.exitCode).toBe(0);
  });

  it('writes human guide text by default', async () => {
    const commandExit = await runGuideCommand({ json: undefined });

    expect(writes.join('')).toContain('Agent-first quickstart');
    expect(writes.join('')).toContain('Prefer explicit subcommands with --json.');
    expect(commandExit.exitCode).toBe(0);
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

    const printedDocument = JSON.parse(writes.join(''));
    expect(printedDocument.mode).toBe('agent-guide');
  });
});
