import { isPathPresent } from '@/archive/file-system.js';
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

export const discoverStoreSessions = async (
  provider: ProviderAdapter,
  store: SessionStore,
): Promise<ReadonlyArray<DiscoveredSession>> => {
  const isStorePresent = await isPathPresent(store.path);
  const isStoreAbsent = !isStorePresent;

  if (isStoreAbsent) {
    return [];
  }

  try {
    return await provider.discover(store);
  } catch (discoveryError) {
    const isStorePresentAfterFailure = await isPathPresent(store.path);
    const isStoreAbsentAfterFailure = !isStorePresentAfterFailure;

    if (isStoreAbsentAfterFailure) {
      return [];
    }

    throw discoveryError;
  }
};
