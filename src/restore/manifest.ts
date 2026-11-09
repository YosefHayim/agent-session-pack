import { Effect } from 'effect';
import { copyPath, ensureParentDirectory, pathExists, removePath } from '@/archive/file-system.js';
import { sha256File, sha256Path } from '@/archive/hash.js';
import type { SessionManifest } from '@/archive/manifest-store.js';
import { isArchivedStubPath } from '@/archive/session-stub.js';
import { restorePathForManifest } from '@/archive/vault-paths.js';
import { type CompressionAdapter, restoreDirectoryArchive } from '@/archive/writer.js';
import { promiseAsEffect } from '@/effect-bridge.js';
import type { SessionSourceKind } from '@/session-model.js';

/**
 * Result of restoring one archived session to its original path.
 */
export type RestoreOutcome = 'already-present' | 'conflict' | 'restored';

/**
 * Inputs for restoring one archived session.
 */
export type RestoreManifestRequest = {
  readonly compression: CompressionAdapter;
  readonly manifest: SessionManifest;
  readonly vaultPath: string;
};

const resolveLiveOriginalOutcome = (request: {
  readonly originalPath: string;
  readonly sourceKind: SessionSourceKind;
  readonly sourceSha256: string;
}): Effect.Effect<RestoreOutcome | 'continue-restore', Error> =>
  Effect.gen(function* () {
    const isStub = yield* promiseAsEffect(() =>
      isArchivedStubPath(request.originalPath, request.sourceKind),
    );
    if (isStub) {
      yield* promiseAsEffect(() => removePath(request.originalPath));
      return 'continue-restore' as const;
    }

    const existingSha256 = yield* promiseAsEffect(() =>
      sha256Path(request.originalPath, request.sourceKind),
    );
    if (existingSha256 === request.sourceSha256) {
      return 'already-present' as const;
    }

    return 'conflict' as const;
  });

/**
 * Restores one archived session to its original path unless a changed live copy is there.
 *
 * @param request - Compression adapter, manifest, and vault path.
 * @returns Effect containing the restore outcome.
 * @example
 * ```ts
 * import { createZstdCompression } from '@/archive/zstd-compression.js';
 * import { restoreManifest } from './manifest.js';
 *
 * const outcome = await Effect.runPromise(
 *   restoreManifest({ compression: createZstdCompression(), manifest, vaultPath: '/vault' }),
 * );
 * ```
 */
export const restoreManifest = (
  request: RestoreManifestRequest,
): Effect.Effect<RestoreOutcome, Error> =>
  Effect.gen(function* () {
    const sourceKind = manifestSourceKind(request.manifest);
    const originalExists = yield* promiseAsEffect(() => pathExists(request.manifest.originalPath));

    if (originalExists) {
      const liveOutcome = yield* resolveLiveOriginalOutcome({
        originalPath: request.manifest.originalPath,
        sourceKind,
        sourceSha256: request.manifest.sourceSha256,
      });

      if (liveOutcome !== 'continue-restore') {
        return liveOutcome;
      }
    }

    const restoredPath = restorePathForManifest(request.vaultPath, request.manifest, sourceKind);

    if (sourceKind === 'directory') {
      yield* promiseAsEffect(() =>
        restoreDirectoryArchive({
          sessionId: request.manifest.sessionId,
          archivePath: request.manifest.archivePath,
          restoredPath,
          originalPath: request.manifest.originalPath,
          expectedSha256: request.manifest.sourceSha256,
          compression: request.compression,
        }),
      );
      return 'restored';
    }

    yield* promiseAsEffect(() => ensureParentDirectory(restoredPath));
    yield* promiseAsEffect(() =>
      request.compression.decompress({
        archivePath: request.manifest.archivePath,
        restoredPath,
      }),
    );

    const restoredSha256 = yield* promiseAsEffect(() => sha256File(restoredPath));

    if (restoredSha256 !== request.manifest.sourceSha256) {
      return yield* Effect.fail(
        new Error(
          `Archive verification failed for session ${request.manifest.sessionId}: source ${request.manifest.sourceSha256} does not match restored ${restoredSha256}`,
        ),
      );
    }

    yield* promiseAsEffect(() => ensureParentDirectory(request.manifest.originalPath));
    yield* promiseAsEffect(() => copyPath(restoredPath, request.manifest.originalPath));

    const originalSha256 = yield* promiseAsEffect(() => sha256File(request.manifest.originalPath));

    if (originalSha256 !== request.manifest.sourceSha256) {
      return yield* Effect.fail(
        new Error(
          `Archive verification failed for session ${request.manifest.sessionId}: source ${request.manifest.sourceSha256} does not match restored ${originalSha256}`,
        ),
      );
    }

    yield* promiseAsEffect(() => removePath(restoredPath));

    return 'restored';
  });

const manifestSourceKind = (manifest: SessionManifest): SessionSourceKind =>
  manifest.sourceKind ?? 'file';
