import { runCommand } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doctorCommand, runDoctorCommand } from '../src/cli/commands/doctorCommand.js';

describe('doctor command', () => {
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

  it('writes stable JSON prerequisite status', async () => {
    await runDoctorCommand({ json: true });

    const payload = JSON.parse(writes.join('')) as {
      readonly sqlite3: { readonly available: boolean; readonly version?: string };
      readonly zstd: { readonly available: boolean; readonly version?: string };
    };

    expect(payload).toHaveProperty('sqlite3');
    expect(payload).toHaveProperty('zstd');
    expect(typeof payload.sqlite3.available).toBe('boolean');
    expect(typeof payload.zstd.available).toBe('boolean');

    if (payload.zstd.available) {
      expect(typeof payload.zstd.version).toBe('string');
    }
    if (payload.sqlite3.available) {
      expect(typeof payload.sqlite3.version).toBe('string');
    }
  });

  it('writes human-readable prerequisite lines', async () => {
    await runDoctorCommand({ json: undefined });

    const output = writes.join('');
    expect(output).toMatch(/^zstd: (missing|.+)/m);
    expect(output).toMatch(/^sqlite3: (missing|.+)/m);
  });

  it('exposes citty metadata and --json flag', () => {
    expect(doctorCommand.meta).toMatchObject({
      name: 'doctor',
      description: 'Check local prerequisites.',
    });
    expect(doctorCommand.args).toMatchObject({
      json: {
        type: 'boolean',
      },
    });
  });

  it('routes citty run through JSON mode', async () => {
    await runCommand(doctorCommand, { rawArgs: ['--json'] });

    const payload = JSON.parse(writes.join(''));
    expect(payload).toHaveProperty('zstd');
    expect(payload).toHaveProperty('sqlite3');
  });
});
