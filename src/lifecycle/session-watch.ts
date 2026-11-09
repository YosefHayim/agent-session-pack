import { watch } from 'node:fs';
import type { SessionManifest } from '@/archive/manifest-store.js';
import { listVaultSessionManifests } from '@/archive/manifest-store.js';
import { directoryStubWasOpened, isArchivedStubPath } from '@/archive/session-stub.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import { ensureSessionRestored } from '@/restore/ensure-restored.js';
import type { ProviderId } from '@/session-model.js';

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
 */
export const watchSessionStubs = async (request: WatchSessionStubsRequest): Promise<void> => {
  const compression = request.compression ?? createZstdCompression();
  const pollIntervalMs = request.pollIntervalMs ?? 750;
  const watchers = new Map<string, ReturnType<typeof watch>>();
  const restoringPaths = new Set<string>();

  const refreshWatchers = (manifests: ReadonlyArray<SessionManifest>): void => {
    const activePaths = new Set<string>();

    for (const manifest of manifests) {
      const isProviderMismatched =
        request.provider !== undefined && manifest.provider !== request.provider;
      if (isProviderMismatched) {
        continue;
      }

      activePaths.add(manifest.originalPath);

      const isOriginalPathWatched = watchers.has(manifest.originalPath);
      if (isOriginalPathWatched) {
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
      const isNotPathInActivePaths = !activePaths.has(path);
      if (isNotPathInActivePaths) {
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

    const isNotStub = !(await isArchivedStubPath(manifest.originalPath, sourceKind));

    if (isNotStub) {
      return;
    }

    const isDirectoryEventWithoutForce = !forceFromFsEvent && sourceKind === 'directory';
    if (isDirectoryEventWithoutForce) {
      const opened = await directoryStubWasOpened(manifest.originalPath);

      const isOpenedMissing = !opened;
      if (isOpenedMissing) {
        return;
      }
    }

    const isFileEventWithoutForce = !forceFromFsEvent && sourceKind === 'file';
    if (isFileEventWithoutForce) {
      // File stubs only materialize on fs events (reads/writes from the provider).
      return;
    }

    // One write fires several fs events; concurrent restores would share one staging path.
    const isOriginalPathRestoring = restoringPaths.has(manifest.originalPath);
    if (isOriginalPathRestoring) {
      return;
    }

    restoringPaths.add(manifest.originalPath);
    try {
      const report = await ensureSessionRestored({
        command: 'ensure-restored',
        vaultPath: request.vaultPath,
        selector: manifest.sessionId,
        selectorMatch: 'exact',
        provider: manifest.provider,
        compression,
        restoreOnLaunchEnabled: true,
        requireLifecycleEnabled: false,
      });

      request.onEvent?.({
        sessionId: manifest.sessionId,
        provider: manifest.provider,
        status: report.status,
        originalPath: manifest.originalPath,
      });
    } finally {
      restoringPaths.delete(manifest.originalPath);
    }
  };

  while (!request.shouldStop()) {
    const manifests = await listVaultSessionManifests(request.vaultPath);
    const scoped = manifests.filter(
      (manifest) => request.provider === undefined || manifest.provider === request.provider,
    );

    refreshWatchers(scoped);

    for (const manifest of scoped) {
      await materializeIfNeeded(manifest, false);
    }

    await new Promise<void>((wakeUp) => {
      setTimeout(wakeUp, pollIntervalMs);
    });
  }

  for (const watcher of watchers.values()) {
    watcher.close();
  }
};
