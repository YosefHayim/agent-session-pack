import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  type DiscoveredSession,
  type ProviderAdapter,
  ProviderDiscoveryError,
} from '../../shared/sessionModel.js';
import { discoverStoreSessions, scanStores } from './scanStores.js';

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
      discover: (store) => Effect.succeed(store.path === codexRoot ? [session] : []),
    };

    const report = await Effect.runPromise(
      scanStores({
        stores: [
          { provider: 'codex', path: codexRoot },
          { provider: 'claude', path: join(workspace, 'claude') },
        ],
        providers: [provider],
      }),
    );

    expect(report.sessions).toEqual([session]);
  });

  it('treats a store removed during provider discovery as absent', async () => {
    const workspace = await createWorkspace();
    const storePath = join(workspace, 'codex');
    await mkdir(storePath, { recursive: true });
    const discoveryError = new ProviderDiscoveryError({
      provider: 'codex',
      path: storePath,
      message: 'store disappeared',
    });
    const provider: ProviderAdapter = {
      id: 'codex',
      label: 'Codex',
      mode: 'archive',
      defaultRoots: () => [storePath],
      discover: () =>
        Effect.promise(() => rm(storePath, { recursive: true })).pipe(
          Effect.zipRight(Effect.fail(discoveryError)),
        ),
    };

    const sessions = await Effect.runPromise(
      discoverStoreSessions(provider, { provider: 'codex', path: storePath }),
    );

    expect(sessions).toEqual([]);
  });

  it('preserves provider discovery errors while the store still exists', async () => {
    const workspace = await createWorkspace();
    const storePath = join(workspace, 'codex');
    await mkdir(storePath, { recursive: true });
    const discoveryError = new ProviderDiscoveryError({
      provider: 'codex',
      path: storePath,
      message: 'permission denied',
    });
    const provider: ProviderAdapter = {
      id: 'codex',
      label: 'Codex',
      mode: 'archive',
      defaultRoots: () => [storePath],
      discover: () => Effect.fail(discoveryError),
    };

    const discovery = await Effect.runPromise(
      Effect.either(discoverStoreSessions(provider, { provider: 'codex', path: storePath })),
    );

    expect(Either.isLeft(discovery)).toBe(true);
    if (Either.isRight(discovery)) {
      expect.fail('expected an existing store discovery error to be preserved');
    }
    expect(discovery.left).toBe(discoveryError);
  });
});
