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

export type ProviderInventoryStatus = 'backup-only' | 'missing' | 'ready';

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

export type ProviderInventoryReport = {
  readonly rows: ReadonlyArray<ProviderInventoryRow>;
};

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
 */
export const inspectProviderInventory = (
  request: ProviderInventoryRequest,
): Effect.Effect<ProviderInventoryReport, ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const rows: ProviderInventoryRow[] = [];
    const cutoffTime = request.now.getTime() - request.olderThanMs;

    for (const provider of request.providers) {
      const roots = provider.defaultRoots(request.home);
      const existingRoots: string[] = [];
      const sessions: DiscoveredSession[] = [];

      for (const root of roots) {
        const exists = yield* pathExists({
          provider,
          path: root,
        });

        if (!exists) {
          continue;
        }

        existingRoots.push(root);
        sessions.push(
          ...(yield* provider.discover({
            provider: provider.id,
            path: root,
          })),
        );
      }

      rows.push(
        createInventoryRow({
          cutoffTime,
          paths: existingRoots.length > 0 ? existingRoots : roots,
          provider,
          sessions,
        }),
      );
    }

    return { rows };
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

const errorCode = (cause: unknown): string | undefined => {
  if (typeof cause !== 'object' || cause === null) {
    return undefined;
  }

  if (!('code' in cause)) {
    return undefined;
  }

  return String(cause.code);
};
