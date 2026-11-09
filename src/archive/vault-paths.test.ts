import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultVaultPath } from './vault-paths.js';

describe('vaultPaths', () => {
  it('resolves the default vault path under the home directory', () => {
    expect(createDefaultVaultPath('/Users/synthetic')).toBe(
      join('/Users/synthetic', '.agent-session-pack'),
    );
  });
});
