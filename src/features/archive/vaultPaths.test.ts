import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDefaultVaultPath } from './vaultPaths.js';

describe('vaultPaths', () => {
  it('resolves the default vault path under the home directory', () => {
    expect(resolveDefaultVaultPath('/Users/synthetic')).toBe(
      join('/Users/synthetic', '.agent-session-pack'),
    );
  });
});
