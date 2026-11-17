import { runCommand } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHumanAgentGuide, createStructuredAgentGuide } from '@/guide/command.js';
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

describe('agent guide output', () => {
  it('shows a safe non-interactive command path for coding agents', () => {
    const printout = createHumanAgentGuide();

    expect(printout).toContain('Agent-first quickstart');
    expect(printout).toContain('Prefer explicit subcommands with --json.');
    expect(printout).toContain('npx --yes agent-session-pack check --json');
    expect(printout).toContain(
      'npx --yes agent-session-pack pack --all-providers --older-than 7d --dry-run --json',
    );
    expect(printout).toContain(
      'npx --yes agent-session-pack pack --all-providers --older-than 7d --apply --yes --json',
    );
    expect(printout).toContain(
      'npx --yes agent-session-pack unpack --all-providers --apply --yes --json',
    );
    expect(printout).toContain('npx --yes agent-session-pack lifecycle enable --json');
    expect(printout).toContain(
      'npx --yes agent-session-pack open --provider codex <session-id> --json',
    );
    expect(printout).toContain('npx --yes agent-session-pack maintain --apply --yes --json');
    expect(printout).toContain('npx --yes agent-session-pack pack --max --dry-run --json');
    expect(printout).toContain('Bare agent-session-pack is for human TTY setup.');
  });

  it('formats a stable JSON guide for agents', () => {
    const guide = JSON.parse(createStructuredAgentGuide());

    expect(guide).toMatchObject({
      name: 'agent-session-pack',
      mode: 'agent-guide',
      safety: {
        bareCommand: 'human-tty-only',
        defaultMutation: 'none',
        machineOutput: '--json',
      },
    });
    expect(guide.recommendedFlow.map((step: { command: string }) => step.command)).toEqual([
      'npx --yes agent-session-pack check --json',
      'npx --yes agent-session-pack pack --all-providers --older-than 7d --dry-run --json',
      'npx --yes agent-session-pack pack --all-providers --older-than 7d --apply --yes --json',
      'npx --yes agent-session-pack unpack --all-providers --apply --yes --json',
      'npx --yes agent-session-pack lifecycle enable --json',
      'npx --yes agent-session-pack open --provider codex <session-id> --json',
      'npx --yes agent-session-pack maintain --apply --yes --json',
    ]);
    expect(guide.commands.openSession).toContain('open');
    expect(guide.commands.maintain).toContain('maintain');
    expect(guide.commands.lifecycleEnable).toContain('lifecycle enable');
  });
});
