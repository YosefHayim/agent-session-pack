import { runCommand } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listCommand } from '../src/cli/commands/listCommand.js';

describe('list command', () => {
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

  it('prints scaffold message when no index exists', async () => {
    await runCommand(listCommand, { rawArgs: [] });

    expect(writes.join('')).toBe('No indexed sessions yet. Run agent-session-pack scan first.\n');

    expect(process.exitCode).toBeUndefined();
  });

  it('does not prompt under --json', async () => {
    await runCommand(listCommand, { rawArgs: ['--json', '--provider', 'codex'] });

    expect(writes.join('')).toContain('No indexed sessions yet');
    expect(process.exitCode).toBeUndefined();
  });

  it('exposes citty metadata and flags', () => {
    expect(listCommand.meta).toMatchObject({
      name: 'list',
      description: 'List indexed sessions with date, status, and path.',
    });
    expect(listCommand.args).toMatchObject({
      provider: { type: 'string' },
      json: { type: 'boolean' },
    });
  });
});
