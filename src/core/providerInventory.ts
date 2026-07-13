import { stat } from 'node:fs/promises';
import { Effect } from 'effect';
import type {
  DiscoveredSession,
  ProviderAdapter,
  ProviderDiscoveryError,
  ProviderId,
  ProviderMode,
} from './sessionStore.js';
import { ProviderDiscoveryError as ProviderDiscoveryFailure } from './sessionStore.js';

/**
 * Readiness status reported for a provider store during inventory.
 */
export type ProviderInventoryStatus = 'backup-only' | 'missing' | 'ready';

/**
 * Read-only inventory row summarizing one provider's sessions and bytes.
 */
export type ProviderInventoryRow = {
  readonly provider: ProviderId;
  readonly label: string;
  readonly mode: ProviderMode;
  readonly sessions: number;
  readonly coldSessions: number;
  readonly guardedRecentSessions: number;
  readonly totalBytes: number;
  readonly candidateBytes: number;
  readonly paths: ReadonlyArray<string>;
  readonly status: ProviderInventoryStatus;
};

/**
 * Aggregated inventory report across all inspected providers.
 */
export type ProviderInventoryReport = {
  readonly rows: ReadonlyArray<ProviderInventoryRow>;
};

/**
 * Inputs required to inspect provider stores for inventory.
 */
export type ProviderInventoryRequest = {
  readonly home: string;
  readonly providers: ReadonlyArray<ProviderAdapter>;
  readonly olderThanMs: number;
  readonly now: Date;
};

/**
 * Inspects provider stores for human-facing setup and pack decisions.
 *
 * @param request - Home, providers, cold threshold, and current time.
 * @returns Provider-level read-only inventory report.
 * @example
 * ```ts
 * import { inspectProviderInventory } from './providerInventory.js';
 * import { providers } from '../providers/index.js';
 *
 * const report = await Effect.runPromise(
 *   inspectProviderInventory({
 *     home: process.env.HOME ?? '',
 *     providers,
 *     olderThanMs: 168 * 60 * 60 * 1000,
 *     now: new Date(),
 *   }),
 * );
 * ```
 */
export const inspectProviderInventory = (
  request: ProviderInventoryRequest,
): Effect.Effect<ProviderInventoryReport, ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const rows: ProviderInventoryRow[] = [];
    const cutoffTime = request.now.getTime() - request.olderThanMs;

    for (const provider of request.providers) {
      const discovered = yield* discoverProviderRoots({
        home: request.home,
        provider,
      });

      rows.push(
        createInventoryRow({
          cutoffTime,
          paths: discovered.existingRoots.length > 0 ? discovered.existingRoots : discovered.roots,
          provider,
          sessions: discovered.sessions,
        }),
      );
    }

    return { rows };
  });

type ProviderRootDiscovery = {
  readonly roots: ReadonlyArray<string>;
  readonly existingRoots: ReadonlyArray<string>;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
};

type RootDiscovery = {
  readonly root: string;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
};

const discoverProviderRoots = (request: {
  readonly home: string;
  readonly provider: ProviderAdapter;
}): Effect.Effect<ProviderRootDiscovery, ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const roots = request.provider.defaultRoots(request.home);
    const discoveredRoots = yield* Effect.all(
      roots.map((root) =>
        discoverProviderRoot({
          provider: request.provider,
          root,
        }),
      ),
    );
    const existingRoots = discoveredRoots.filter(isRootDiscovery);

    return {
      roots,
      existingRoots: existingRoots.map((root) => root.root),
      sessions: existingRoots.flatMap((root) => root.sessions),
    };
  });

const discoverProviderRoot = (request: {
  readonly provider: ProviderAdapter;
  readonly root: string;
}): Effect.Effect<RootDiscovery | undefined, ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const exists = yield* pathExists({
      provider: request.provider,
      path: request.root,
    });

    if (!exists) {
      return undefined;
    }

    const sessions = yield* request.provider.discover({
      provider: request.provider.id,
      path: request.root,
    });

    return {
      root: request.root,
      sessions,
    };
  });

const createInventoryRow = (request: {
  readonly cutoffTime: number;
  readonly paths: ReadonlyArray<string>;
  readonly provider: ProviderAdapter;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}): ProviderInventoryRow => {
  if (request.paths.length === 0 || request.sessions.length === 0) {
    return {
      provider: request.provider.id,
      label: request.provider.label,
      mode: request.provider.mode,
      sessions: request.sessions.length,
      coldSessions: 0,
      guardedRecentSessions: 0,
      totalBytes: sumSessionBytes(request.sessions),
      candidateBytes: 0,
      paths: request.paths,
      status: request.sessions.length === 0 ? 'missing' : 'ready',
    };
  }

  if (request.provider.mode === 'backup-only') {
    return {
      provider: request.provider.id,
      label: request.provider.label,
      mode: request.provider.mode,
      sessions: request.sessions.length,
      coldSessions: 0,
      guardedRecentSessions: 0,
      totalBytes: sumSessionBytes(request.sessions),
      candidateBytes: 0,
      paths: request.paths,
      status: 'backup-only',
    };
  }

  const coldSessions = request.sessions.filter(
    (session) => session.modifiedAt.getTime() < request.cutoffTime,
  );

  return {
    provider: request.provider.id,
    label: request.provider.label,
    mode: request.provider.mode,
    sessions: request.sessions.length,
    coldSessions: coldSessions.length,
    guardedRecentSessions: request.sessions.length - coldSessions.length,
    totalBytes: sumSessionBytes(request.sessions),
    candidateBytes: sumSessionBytes(coldSessions),
    paths: request.paths,
    status: 'ready',
  };
};

const pathExists = (request: {
  readonly provider: ProviderAdapter;
  readonly path: string;
}): Effect.Effect<boolean, ProviderDiscoveryError> =>
  Effect.tryPromise({
    try: async () => {
      const entry = await stat(request.path).catch((cause: unknown) => {
        if (errorCode(cause) === 'ENOENT') {
          return undefined;
        }

        return Promise.reject(cause);
      });

      return entry !== undefined;
    },
    catch: (cause) =>
      new ProviderDiscoveryFailure({
        provider: request.provider.id,
        path: request.path,
        message: String(cause),
      }),
  });

const sumSessionBytes = (sessions: ReadonlyArray<DiscoveredSession>): number =>
  sessions.reduce((totalBytes, session) => totalBytes + session.sizeBytes, 0);

const isRootDiscovery = (discovery: RootDiscovery | undefined): discovery is RootDiscovery =>
  discovery !== undefined;

const errorCode = (cause: unknown): string | undefined => {
  if (typeof cause !== 'object' || cause === null) {
    return undefined;
  }

  if (!('code' in cause)) {
    return undefined;
  }

  return String(cause.code);
};
