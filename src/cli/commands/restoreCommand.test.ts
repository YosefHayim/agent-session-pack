import { runCommand } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreCommand } from './restoreCommand.js';

describe('restore command', () => {
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

  it('exits with code 2 when selector is missing', async () => {
    // Citty rejects a missing positional before run; invoke the handler to
    // cover the command-level guard that main/entrypoint may still hit.
    await restoreCommand.run?.({
      args: { _: [] } as never,
      rawArgs: [],
      cmd: restoreCommand,
    });

    expect(process.exitCode).toBe(2);
    expect(stderrWrites.join('')).toContain(
      'Missing selector. Use agent-session-pack restore <selector>.',
    );
    expect(stdoutWrites.join('')).toBe('');
  });

  it('exits with code 2 under --json when selector is missing without prompting', async () => {
    await restoreCommand.run?.({
      args: { json: true, _: [] } as never,
      rawArgs: ['--json'],
      cmd: restoreCommand,
    });

    expect(process.exitCode).toBe(2);
    expect(stderrWrites.join('')).toContain('Missing selector');
  });

  it('prints scaffold message for a provided selector', async () => {
    await runCommand(restoreCommand, {
      rawArgs: ['codex:session-old', '--to', 'original'],
    });

    expect(process.exitCode).toBeUndefined();
    expect(stdoutWrites.join('')).toBe('restore is scaffolded for selector: codex:session-old\n');
  });

  it('exposes citty metadata and flags', () => {
    expect(restoreCommand.meta).toMatchObject({
      name: 'restore',
      description: 'Restore a packed session by id, name, slug, or picker.',
    });
    expect(restoreCommand.args).toMatchObject({
      selector: { type: 'positional' },
      to: { type: 'string' },
      json: { type: 'boolean' },
    });
  });
});
