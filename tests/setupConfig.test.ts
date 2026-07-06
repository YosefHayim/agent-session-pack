import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { expandHomePath, validateVaultPath, writeSetupConfig } from '../src/core/setupConfig.js';

const createWorkspace = (): Promise<string> => mkdtemp(join(tmpdir(), 'agent-session-pack-setup-'));

describe('setup config vault paths', () => {
  it('expands home paths and accepts a new vault below a writable parent', async () => {
    const home = await createWorkspace();
    const resolved = await Effect.runPromise(
      validateVaultPath({
        home,
        inputPath: '~/.agent-session-pack',
        providerRoots: [join(home, '.codex', 'sessions')],
      }),
    );

    expect(resolved.path).toBe(join(home, '.agent-session-pack'));
    expect(expandHomePath('~/vault', home)).toBe(join(home, 'vault'));
  });

  it('rejects vault paths inside provider stores', async () => {
    const home = await createWorkspace();
    const providerRoot = join(home, '.codex', 'sessions');

    const result = await Effect.runPromise(
      Effect.either(
        validateVaultPath({
          home,
          inputPath: join(providerRoot, 'vault'),
          providerRoots: [providerRoot],
        }),
      ),
    );

    expect(result).toMatchObject({
      _tag: 'Left',
      left: {
        _tag: 'VaultPathValidationError',
        reason: 'inside-provider-store',
      },
    });
  });

  it('rejects new vault paths when the parent directory does not exist', async () => {
    const home = await createWorkspace();

    const result = await Effect.runPromise(
      Effect.either(
        validateVaultPath({
          home,
          inputPath: join(home, 'missing-parent', 'vault'),
          providerRoots: [],
        }),
      ),
    );

    expect(result).toMatchObject({
      _tag: 'Left',
      left: {
        _tag: 'VaultPathValidationError',
        reason: 'parent-missing',
      },
    });
  });

  it('writes config and creates the vault only after setup confirmation', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack');

    await Effect.runPromise(
      writeSetupConfig({
        home,
        config: {
          version: 1,
          providers: ['codex', 'claude'],
          vaultPath,
          coldAfter: '7d',
          createdAt: '2026-07-07T00:00:00.000Z',
          updatedAt: '2026-07-07T00:00:00.000Z',
        },
      }),
    );

    await expect(stat(vaultPath)).resolves.toSatisfy((entry) => entry.isDirectory());
    await expect(readFile(join(vaultPath, 'config.json'), 'utf8')).resolves.toContain(
      '"providers": [',
    );
  });
});
