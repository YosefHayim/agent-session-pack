import { describe, expect, it } from 'vitest';
import { rewriteCommandFlagAliases } from './mainArgs.js';

describe('rewriteCommandFlagAliases', () => {
  it('rewrites supported command flag aliases into subcommands', () => {
    expect(rewriteCommandFlagAliases(['node', 'main.js', '--check'])).toEqual([
      'node',
      'main.js',
      'check',
    ]);
    expect(rewriteCommandFlagAliases(['node', 'main.js', '--doctor'])).toEqual([
      'node',
      'main.js',
      'doctor',
    ]);
    expect(rewriteCommandFlagAliases(['node', 'main.js', '--scan', '--provider', 'devin'])).toEqual(
      ['node', 'main.js', 'scan', '--provider', 'devin'],
    );
    expect(rewriteCommandFlagAliases(['node', 'main.js', '--savings'])).toEqual([
      'node',
      'main.js',
      'savings',
    ]);
    expect(rewriteCommandFlagAliases(['node', 'main.js', '--guide'])).toEqual([
      'node',
      'main.js',
      'guide',
    ]);
    expect(rewriteCommandFlagAliases(['node', 'main.js', '--unpack', '--all-providers'])).toEqual([
      'node',
      'main.js',
      'unpack',
      '--all-providers',
    ]);
  });

  it('strips a bare -- separator before the first command', () => {
    expect(rewriteCommandFlagAliases(['node', 'main.js', '--', 'doctor'])).toEqual([
      'node',
      'main.js',
      'doctor',
    ]);
  });
});
