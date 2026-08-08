import { runCommand } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from '../src/cli/commands/initCommand.js';

describe('init command', () => {
  const writes: string[] = [];
  const originalStdinIsTty = process.stdin.isTTY;
  const originalStdoutIsTty = process.stdout.isTTY;

  beforeEach(() => {
    writes.length = 0;
    process.exitCode = undefined;
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: false,
    });
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: false,
    });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: originalStdinIsTty,
    });
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalStdoutIsTty,
    });
    vi.restoreAllMocks();
  });

  it('writes stable JSON defaults without prompting when --json is set', async () => {
    await runCommand(initCommand, { rawArgs: ['--json'] });

    const payload = JSON.parse(writes.join(''));
    expect(payload).toEqual({
      vaultPath: '~/.agent-session-pack',
      coldAfter: '7d',
      restoreCacheAfter: '7d',
      lifecycle: 'manual-proof-only',
      plannedLifecycle: 'restore-on-launch-pack-on-close',
      apply: false,
    });
  });

  it('includes apply:true in JSON when --apply is set', async () => {
    await runCommand(initCommand, { rawArgs: ['--json', '--apply'] });

    const payload = JSON.parse(writes.join(''));
    expect(payload.apply).toBe(true);
  });

  it('prints dry-run human defaults on non-TTY without prompts', async () => {
    await runCommand(initCommand, { rawArgs: [] });

    const output = writes.join('');
    expect(output).toContain('Defaults: vault ~/.agent-session-pack');
    expect(output).toContain('Dry run only. Re-run with --apply to write config.');
    expect(output).toContain('No files changed.');
  });

  it('exposes citty metadata and flags', () => {
    expect(initCommand.meta).toMatchObject({
      name: 'init',
      description: 'Show default vault policy and dry-run setup.',
    });
    expect(initCommand.args).toMatchObject({
      apply: { type: 'boolean' },
      json: { type: 'boolean' },
    });
  });
});
