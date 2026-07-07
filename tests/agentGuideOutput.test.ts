import { describe, expect, it } from 'vitest';
import { formatHumanAgentGuide, formatJsonAgentGuide } from '../src/output/index.js';

describe('agent guide output', () => {
  it('shows a safe non-interactive command path for coding agents', () => {
    const output = formatHumanAgentGuide();

    expect(output).toContain('Agent-first quickstart');
    expect(output).toContain('Prefer explicit subcommands with --json.');
    expect(output).toContain('npx --yes agent-session-pack check --json');
    expect(output).toContain(
      'npx --yes agent-session-pack pack --all-providers --older-than 7d --dry-run --json',
    );
    expect(output).toContain(
      'npx --yes agent-session-pack pack --all-providers --older-than 7d --apply --yes --json',
    );
    expect(output).toContain(
      'npx --yes agent-session-pack unpack --all-providers --apply --yes --json',
    );
    expect(output).toContain('npx --yes agent-session-pack pack --max --dry-run --json');
    expect(output).toContain('Bare agent-session-pack is for human TTY setup.');
  });

  it('formats a stable JSON guide for agents', () => {
    const guide = JSON.parse(formatJsonAgentGuide());

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
    ]);
    expect(guide.commands.maxPreview).toBe(
      'npx --yes agent-session-pack pack --max --dry-run --json',
    );
  });
});
