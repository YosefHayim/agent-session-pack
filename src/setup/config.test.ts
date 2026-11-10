import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandHomePath, validateVaultPath, writeSetupSettings } from './config.js';

const createWorkspace = (): Promise<string> => mkdtemp(join(tmpdir(), 'agent-session-pack-setup-'));

describe('setup config vault paths', () => {
  it('expands home paths and accepts a new vault below a writable parent', async () => {
    const home = await createWorkspace();
    const validatedPath = await validateVaultPath({
      home,
      inputPath: '~/.agent-session-pack',
      providerRoots: [join(home, '.codex', 'sessions')],
    });

    expect(validatedPath.path).toBe(join(home, '.agent-session-pack'));
    expect(expandHomePath('~/vault', home)).toBe(join(home, 'vault'));
  });

  it('rejects vault paths inside provider stores', async () => {
    const home = await createWorkspace();
    const providerRoot = join(home, '.codex', 'sessions');

    const validation = validateVaultPath({
      home,
      inputPath: join(providerRoot, 'vault'),
      providerRoots: [providerRoot],
    });

    await expect(validation).rejects.toThrow(
      'Vault path cannot be inside a provider session store.',
    );
  });

  it('rejects new vault paths when the parent directory does not exist', async () => {
    const home = await createWorkspace();

    const validation = validateVaultPath({
      home,
      inputPath: join(home, 'missing-parent', 'vault'),
      providerRoots: [],
    });

    await expect(validation).rejects.toThrow('Vault parent directory does not exist.');
  });

  it('writes config and creates the vault only after setup confirmation', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack');

    await writeSetupSettings({
      home,
      config: {
        version: 1,
        providers: ['codex', 'claude'],
        vaultPath,
        coldAfter: '7d',
        createdAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
      },
    });

    await expect(stat(vaultPath)).resolves.toSatisfy((vaultStats) => vaultStats.isDirectory());
    await expect(readFile(join(vaultPath, 'config.json'), 'utf8')).resolves.toContain(
      '"providers": [',
    );
  });
});
