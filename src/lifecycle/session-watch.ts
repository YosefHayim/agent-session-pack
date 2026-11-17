import { watch } from 'node:fs';
import type { SessionManifest } from '@/archive/manifest-store.js';
import { listVaultSessionManifests } from '@/archive/manifest-store.js';
import { isArchivedStubPath, isDirectoryStubOpened } from '@/archive/session-stub.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import { ensureSessionRestored } from '@/restore/ensure-restored.js';
import type { ProviderId } from '@/session-model.js';

export const DEFAULT_POLL_INTERVAL_MS = 750;

export interface SessionWatchEvent {
  readonly sessionId: string;
  readonly provider: ProviderId;
  readonly status: string;
  readonly originalPath: string;
}

export interface WatchSessionStubsRequest {
  readonly vaultPath: string;
  readonly provider: ProviderId | undefined;
  readonly compression?: CompressionAdapter;
  readonly pollIntervalMs?: number;
  readonly shouldStop: () => boolean;
  readonly onEvent?: (event: SessionWatchEvent) => void;
}

export async function watchSessionStubs(request: WatchSessionStubsRequest): Promise<void> {
  const compression = request.compression ?? createZstdCompression();
  const pollIntervalMs = request.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const watchers = new Map<string, ReturnType<typeof watch>>();
  const restoringPaths = new Set<string>();

  function isManifestInScope(manifest: SessionManifest): boolean {
    const isAnyProviderWanted = request.provider == null;
    const isWantedProvider = manifest.provider === request.provider;

    return isAnyProviderWanted || isWantedProvider;
  }

  function refreshWatchers(manifests: ReadonlyArray<SessionManifest>): void {
    const activePaths = new Set<string>();

    for (const manifest of manifests) {
      const isProviderMismatched = !isManifestInScope(manifest);
      if (isProviderMismatched) {
        continue;
      }

      activePaths.add(manifest.originalPath);

      const isOriginalPathWatched = watchers.has(manifest.originalPath);
      if (isOriginalPathWatched) {
        continue;
      }

      function materializeOnFileEvent(): void {
        void materializeIfNeeded(manifest, true);
      }

      try {
        const watcher = watch(manifest.originalPath, { persistent: true }, materializeOnFileEvent);
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
  }

  async function materializeIfNeeded(
    manifest: SessionManifest,
    forceFromFsEvent: boolean,
  ): Promise<void> {
    const originKind = manifest.sourceKind ?? 'file';

    const isPathArchivedStub = await isArchivedStubPath(manifest.originalPath, originKind);

    const isNotStub = !isPathArchivedStub;
    if (isNotStub) {
      return;
    }

    const isDirectoryStubCheckNeeded = !forceFromFsEvent && originKind === 'directory';
    const isStubOpenedWhenChecked = isDirectoryStubCheckNeeded
      ? await isDirectoryStubOpened(manifest.originalPath)
      : false;

    const isDirectoryStubClosed = isDirectoryStubCheckNeeded && !isStubOpenedWhenChecked;
    if (isDirectoryStubClosed) {
      return;
    }

    const isFileEventWithoutForce = !forceFromFsEvent && originKind === 'file';
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
  }

  while (!request.shouldStop()) {
    const manifests = await listVaultSessionManifests(request.vaultPath);
    const scoped = manifests.filter(isManifestInScope);

    refreshWatchers(scoped);

    for (const manifest of scoped) {
      await materializeIfNeeded(manifest, false);
    }

    function schedulePollWakeUp(wakeUp: () => void): void {
      setTimeout(wakeUp, pollIntervalMs);
    }

    await new Promise<void>(schedulePollWakeUp);
  }

  for (const watcher of watchers.values()) {
    watcher.close();
  }
}
