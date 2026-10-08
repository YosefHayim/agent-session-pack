import { stat } from 'node:fs/promises';
import { Effect } from 'effect';
import {
  type DiscoveredSession,
  type ProviderAdapter,
  ProviderDiscoveryError,
  type SessionStore,
} from '../../shared/sessionModel.js';

/**
 * Stores and providers to inspect during a scan.
 */
export type ScanRequest = {
  readonly stores: ReadonlyArray<SessionStore>;
  readonly providers: ReadonlyArray<ProviderAdapter>;
};

/**
 * Aggregated sessions discovered across all scanned stores.
 */
export type ScanReport = {
  readonly sessions: ReadonlyArray<DiscoveredSession>;
};

/**
 * Scans stores by delegating discovery to read-only providers.
 *
 * @param request - Providers and stores to scan.
 * @returns Scan report containing all discovered sessions.
 * @example
 * ```ts
 * import { scanStores } from './scanStores.js';
 *
 * const report = await Effect.runPromise(scanStores({ stores, providers }));
 * ```
 */
export const scanStores = (
  request: ScanRequest,
): Effect.Effect<ScanReport, ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const discovered = yield* Effect.all(
      request.stores.map((store) => {
        const provider = request.providers.find((adapter) => adapter.id === store.provider);

        if (provider === undefined) {
          return Effect.succeed<ReadonlyArray<DiscoveredSession>>([]);
        }

        return discoverStoreSessions(provider, store);
      }),
    );

    return {
      sessions: discovered.flat(),
    };
  });

/**
 * Discovers sessions only when a provider store exists.
 *
 * @param provider - Read-only provider adapter for the store.
 * @param store - Provider store path to inspect.
 * @returns Discovered sessions, or an empty collection when the store is absent.
 * @example
 * ```ts
 * import { discoverStoreSessions } from './scanStores.js';
 *
 * const sessions = await Effect.runPromise(discoverStoreSessions(provider, store));
 * ```
 */
export const discoverStoreSessions = (
  provider: ProviderAdapter,
  store: SessionStore,
): Effect.Effect<ReadonlyArray<DiscoveredSession>, ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const exists = yield* providerStoreExists(store);

    if (!exists) {
      return [];
    }

    return yield* provider.discover(store).pipe(
      Effect.catchTag('ProviderDiscoveryError', (discoveryError) =>
        Effect.flatMap(providerStoreExists(store), (stillExists) => {
          if (!stillExists) {
            return Effect.succeed<ReadonlyArray<DiscoveredSession>>([]);
          }

          return Effect.fail(discoveryError);
        }),
      ),
    );
  });

const providerStoreExists = (store: SessionStore): Effect.Effect<boolean, ProviderDiscoveryError> =>
  Effect.tryPromise({
    try: async () => {
      const storeStat = await stat(store.path).catch((cause: unknown) => {
        if (fileSystemErrorCode(cause) === 'ENOENT') {
          return undefined;
        }

        return Promise.reject(cause);
      });

      return storeStat !== undefined;
    },
    catch: (cause) =>
      new ProviderDiscoveryError({
        provider: store.provider,
        path: store.path,
        message: String(cause),
      }),
  });

const fileSystemErrorCode = (cause: unknown): string | undefined => {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) {
    return undefined;
  }

  return String(cause.code);
};
