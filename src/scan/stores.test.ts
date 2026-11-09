import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DiscoveredSession, ProviderAdapter } from '@/session-model.js';
import { discoverStoreSessions, scanStores } from './stores.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-scan-stores-'));

describe('scanStores', () => {
  it('scans stores through provider adapters and skips unknown providers', async () => {
    const workspace = await createWorkspace();
    const codexRoot = join(workspace, 'codex');
    await mkdir(codexRoot, { recursive: true });
    const session: DiscoveredSession = {
      id: 'session-1',
      provider: 'codex',
      title: 'Synthetic scan',
      slug: 'synthetic-scan',
      originalPath: join(codexRoot, 'session-1.jsonl'),
      modifiedAt: new Date('2026-06-01T12:00:00.000Z'),
      sizeBytes: 32,
      sourceKind: 'file',
    };

    const provider: ProviderAdapter = {
      id: 'codex',
      label: 'Codex',
      mode: 'archive',
      defaultRoots: (home) => [join(home, '.codex', 'sessions')],
      discover: (store) => {
        const isStorePathEqualsCodexRoot = store.path === codexRoot;
        return Promise.resolve(isStorePathEqualsCodexRoot ? [session] : []);
      },
    };

    const report = await scanStores({
      stores: [
        { provider: 'codex', path: codexRoot },
        { provider: 'claude', path: join(workspace, 'claude') },
      ],
      providers: [provider],
    });

    expect(report.sessions).toEqual([session]);
  });

  it('treats a store removed during provider discovery as absent', async () => {
    const workspace = await createWorkspace();
    const storePath = join(workspace, 'codex');
    await mkdir(storePath, { recursive: true });
    const discoveryError = new Error('store disappeared');
    const provider: ProviderAdapter = {
      id: 'codex',
      label: 'Codex',
      mode: 'archive',
      defaultRoots: () => [storePath],
      discover: async () => {
        await rm(storePath, { recursive: true });
        throw discoveryError;
      },
    };

    const sessions = await discoverStoreSessions(provider, { provider: 'codex', path: storePath });

    expect(sessions).toEqual([]);
  });

  it('preserves provider discovery errors while the store still exists', async () => {
    const workspace = await createWorkspace();
    const storePath = join(workspace, 'codex');
    await mkdir(storePath, { recursive: true });
    const discoveryError = new Error('permission denied');
    const provider: ProviderAdapter = {
      id: 'codex',
      label: 'Codex',
      mode: 'archive',
      defaultRoots: () => [storePath],
      discover: () => Promise.reject(discoveryError),
    };

    await expect(
      discoverStoreSessions(provider, { provider: 'codex', path: storePath }),
    ).rejects.toBe(discoveryError);
  });
});
