import { describe, expect, it } from 'vitest';
import { normalizeCliArgv } from '../src/cli/mainArgs.js';

describe('CLI argument aliases', () => {
  it('maps pnpm-friendly flag aliases to subcommands', () => {
    expect(normalizeCliArgv(['node', 'main.js', '--doctor'])).toEqual([
      'node',
      'main.js',
      'doctor',
    ]);
    expect(normalizeCliArgv(['node', 'main.js', '--scan', '--provider', 'devin'])).toEqual([
      'node',
      'main.js',
      'scan',
      '--provider',
      'devin',
    ]);
  });

  it('removes a standalone pnpm separator before a subcommand', () => {
    expect(normalizeCliArgv(['node', 'main.js', '--', 'doctor'])).toEqual([
      'node',
      'main.js',
      'doctor',
    ]);
  });
});
