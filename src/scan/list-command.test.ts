import { runCommand } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listCommand } from './list-command.js';

describe('list command', () => {
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

  it('prints scaffold message when no index exists', async () => {
    await runCommand(listCommand, { rawArgs: [] });

    expect(writes.join('')).toBe('No indexed sessions yet. Run agent-session-pack scan first.\n');
  });

  it('does not prompt under --json', async () => {
    await runCommand(listCommand, { rawArgs: ['--json', '--provider', 'codex'] });

    expect(writes.join('')).toContain('No indexed sessions yet');
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
