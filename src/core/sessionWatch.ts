import { watch } from 'node:fs';
import { Effect, Schema } from 'effect';
import { createZstdCompression } from './archiveReader.js';
import type {
  ArchiveFileSystemError,
  ArchiveVerificationError,
  CompressionAdapter,
} from './archiveWriter.js';
import type { ManifestStoreError, SessionManifest } from './manifestStore.js';
import { ensureSessionRestored, listVaultSessionManifests } from './sessionArchive.js';
import type { ProviderId } from './sessionStore.js';
import { directoryStubWasOpened, isArchivedStubPath } from './sessionStub.js';

/**
 * Typed error raised when session watch setup fails.
 */
export class SessionWatchError extends Schema.TaggedError<SessionWatchError>()(
  'SessionWatchError',
  {
    message: Schema.String,
  },
) {}

/**
 * One materialization event emitted while watching stubs for provider open activity.
 */
export type SessionWatchEvent = {
  readonly sessionId: string;
  readonly provider: ProviderId;
  readonly status: string;
  readonly originalPath: string;
};

/**
 * Inputs for watching session stubs and materializing on open.
 */
export type WatchSessionStubsRequest = {
  readonly vaultPath: string;
  readonly provider: ProviderId | undefined;
  readonly compression?: CompressionAdapter;
  readonly pollIntervalMs?: number;
  readonly shouldStop: () => boolean;
  readonly onEvent?: (event: SessionWatchEvent) => void;
};

/**
 * Watches archived stubs and materializes a session when the provider opens it.
 *
 * Detection: directory stubs gain non-marker files, or file stubs are replaced/touched.
 * Polls as a fallback when fs.watch misses events.
 *
 * @param request - Watch configuration for vault, provider, and stop signal.
 * @returns Effect that runs until `shouldStop` returns true.
 * @example
 * ```ts
 * import { watchSessionStubs } from './sessionWatch.js';
 *
 * await Effect.runPromise(
 *   watchSessionStubs({
 *     vaultPath: '/vault',
 *     provider: 'grok',
 *     shouldStop: () => false,
 *     onEvent: () => undefined,
 *   }),
 * );
 * ```
 */
export const watchSessionStubs = (
  request: WatchSessionStubsRequest,
): Effect.Effect<
  void,
  ArchiveFileSystemError | ArchiveVerificationError | ManifestStoreError | SessionWatchError
> =>
  Effect.gen(function* () {
    const compression = request.compression ?? createZstdCompression();
    const pollIntervalMs = request.pollIntervalMs ?? 750;
    const watchers = new Map<string, ReturnType<typeof watch>>();

    const refreshWatchers = (manifests: ReadonlyArray<SessionManifest>): void => {
      const activePaths = new Set<string>();

      for (const manifest of manifests) {
        if (request.provider !== undefined && manifest.provider !== request.provider) {
          continue;
        }

        activePaths.add(manifest.originalPath);
        if (watchers.has(manifest.originalPath)) {
          continue;
        }

        try {
          const watcher = watch(manifest.originalPath, { persistent: true }, () => {
            // Any FS event on a stub is treated as provider open intent.
            void materializeIfNeeded(manifest, true);
          });
          watchers.set(manifest.originalPath, watcher);
        } catch {
          // Path may not exist yet; poll path will create watchers later.
        }
      }

      for (const [path, watcher] of watchers) {
        if (!activePaths.has(path)) {
          watcher.close();
          watchers.delete(path);
        }
      }
    };

    const materializeIfNeeded = async (
      manifest: SessionManifest,
      forceFromFsEvent: boolean,
    ): Promise<void> => {
      const sourceKind = manifest.sourceKind ?? 'file';
      const isStub = await Effect.runPromise(isArchivedStubPath(manifest.originalPath, sourceKind));

      if (!isStub) {
        return;
      }

      if (!forceFromFsEvent && sourceKind === 'directory') {
        const opened = await Effect.runPromise(directoryStubWasOpened(manifest.originalPath));
        if (!opened) {
          return;
        }
      }

      if (!forceFromFsEvent && sourceKind === 'file') {
        // File stubs only materialize on fs events (reads/writes from the provider).
        return;
      }

      const report = await Effect.runPromise(
        ensureSessionRestored({
          command: 'ensure-restored',
          vaultPath: request.vaultPath,
          selector: manifest.sessionId,
          provider: manifest.provider,
          compression,
          restoreOnLaunchEnabled: true,
          requireLifecycleEnabled: false,
        }),
      );

      request.onEvent?.({
        sessionId: manifest.sessionId,
        provider: manifest.provider,
        status: report.status,
        originalPath: manifest.originalPath,
      });
    };

    while (!request.shouldStop()) {
      const manifests = yield* listVaultSessionManifests(request.vaultPath);
      const scoped = manifests.filter(
        (manifest) => request.provider === undefined || manifest.provider === request.provider,
      );

      refreshWatchers(scoped);

      for (const manifest of scoped) {
        yield* Effect.promise(() => materializeIfNeeded(manifest, false));
      }

      yield* Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, pollIntervalMs);
          }),
      );
    }

    for (const watcher of watchers.values()) {
      watcher.close();
    }
  });
