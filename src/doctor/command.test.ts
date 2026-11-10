import { runCommand } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doctorCommand, runDoctorCommand } from './command.js';

describe('doctor command', () => {
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

  it('writes stable JSON prerequisite status', async () => {
    await runDoctorCommand({ json: true });

    const printedDocument = JSON.parse(writes.join('')) as {
      readonly sqlite3: { readonly available: boolean; readonly version?: string };
      readonly zstd: { readonly available: boolean; readonly version?: string };
    };

    expect(printedDocument).toHaveProperty('sqlite3');
    expect(printedDocument).toHaveProperty('zstd');
    expect(typeof printedDocument.sqlite3.available).toBe('boolean');
    expect(typeof printedDocument.zstd.available).toBe('boolean');

    if (printedDocument.zstd.available) {
      expect(typeof printedDocument.zstd.version).toBe('string');
    }

    if (printedDocument.sqlite3.available) {
      expect(typeof printedDocument.sqlite3.version).toBe('string');
    }
  });

  it('writes human-readable prerequisite lines', async () => {
    await runDoctorCommand({ json: undefined });

    const printout = writes.join('');
    expect(printout).toMatch(/^zstd: (missing|.+)/m);
    expect(printout).toMatch(/^sqlite3: (missing|.+)/m);
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

    const printedDocument = JSON.parse(writes.join(''));
    expect(printedDocument).toHaveProperty('zstd');
    expect(printedDocument).toHaveProperty('sqlite3');
  });
});
