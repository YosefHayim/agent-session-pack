import { stat } from 'node:fs/promises';
import { rethrowAsError } from '@/rethrow-as-error.js';
import type { DiscoveredSession, ProviderAdapter, SessionStore } from '@/session-model.js';

/**
 * Stores and providers to inspect during a scan.
 */
export interface ScanRequest {
  readonly stores: ReadonlyArray<SessionStore>;
  readonly providers: ReadonlyArray<ProviderAdapter>;
}

/**
 * Aggregated sessions discovered across all scanned stores.
 */
export interface ScanReport {
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}

/**
 * Scans each store with its provider and returns every session found.
 */
export const scanStores = async (request: ScanRequest): Promise<ScanReport> => {
  const sessions: DiscoveredSession[] = [];

  for (const store of request.stores) {
    const provider = request.providers.find((adapter) => adapter.id === store.provider);

    const isProviderMissing = provider == null;

    if (isProviderMissing) {
      continue;
    }

    const storeSessions = await discoverStoreSessions(provider, store);
    sessions.push(...storeSessions);
  }

  return { sessions };
};

/**
 * Reports whether a path exists, treating only a missing path as absent.
 */
export const isPathPresent = async (path: string): Promise<boolean> => {
  const pathStat = await stat(path).catch((cause: unknown) => {
    const isPathMissing = fileSystemErrorCode(cause) === 'ENOENT';

    if (isPathMissing) {
      return undefined;
    }

    return rethrowAsError(cause);
  });

  return pathStat != null;
};

export const discoverStoreSessions = async (
  provider: ProviderAdapter,
  store: SessionStore,
): Promise<ReadonlyArray<DiscoveredSession>> => {
  const isStorePresent = await isPathPresent(store.path);
  const isStoreMissing = !isStorePresent;

  if (isStoreMissing) {
    return [];
  }

  try {
    return await provider.discover(store);
  } catch (discoveryError) {
    const isStorePresentAfterFailure = await isPathPresent(store.path);
    const isStoreMissingAfterFailure = !isStorePresentAfterFailure;

    if (isStoreMissingAfterFailure) {
      return [];
    }

    throw discoveryError;
  }
};

const fileSystemErrorCode = (cause: unknown): string | undefined => {
  const hasNoErrorCode = typeof cause !== 'object' || cause === null || !('code' in cause);
  if (hasNoErrorCode) {
    return undefined;
  }

  return String(cause.code);
};
