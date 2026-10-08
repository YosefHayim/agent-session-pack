import { Effect } from 'effect';
import type { SessionSourceKind } from '../../shared/sessionModel.js';
import {
  type ArchiveFileSystemError,
  copyPath,
  ensureParentDirectory,
  pathExists,
  removePath,
} from '../archive/archiveFileSystem.js';
import { sha256File, sha256Path } from '../archive/archiveHash.js';
import {
  ArchiveVerificationError,
  type CompressionAdapter,
  restoreDirectoryArchive,
} from '../archive/archiveWriter.js';
import type { SessionManifest } from '../archive/manifestStore.js';
import { isArchivedStubPath } from '../archive/sessionStub.js';
import { restorePathForManifest } from '../archive/vaultPaths.js';

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
}): Effect.Effect<
  RestoreOutcome | 'continue-restore',
  ArchiveFileSystemError | ArchiveVerificationError
> =>
  Effect.gen(function* () {
    const isStub = yield* isArchivedStubPath(request.originalPath, request.sourceKind);
    if (isStub) {
      yield* removePath(request.originalPath);
      return 'continue-restore' as const;
    }

    const existingSha256 = yield* sha256Path(request.originalPath, request.sourceKind);
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
 * import { createZstdCompression } from '../archive/zstdCompression.js';
 * import { restoreManifest } from './restoreManifest.js';
 *
 * const outcome = await Effect.runPromise(
 *   restoreManifest({ compression: createZstdCompression(), manifest, vaultPath: '/vault' }),
 * );
 * ```
 */
export const restoreManifest = (
  request: RestoreManifestRequest,
): Effect.Effect<RestoreOutcome, ArchiveFileSystemError | ArchiveVerificationError> =>
  Effect.gen(function* () {
    const sourceKind = manifestSourceKind(request.manifest);
    const originalExists = yield* pathExists(request.manifest.originalPath);

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
      yield* restoreDirectoryArchive({
        sessionId: request.manifest.sessionId,
        archivePath: request.manifest.archivePath,
        restoredPath,
        originalPath: request.manifest.originalPath,
        expectedSha256: request.manifest.sourceSha256,
        compression: request.compression,
      });
      return 'restored';
    }

    yield* ensureParentDirectory(restoredPath);
    yield* request.compression.decompress({
      archivePath: request.manifest.archivePath,
      restoredPath,
    });

    const restoredSha256 = yield* sha256File(restoredPath);

    if (restoredSha256 !== request.manifest.sourceSha256) {
      return yield* Effect.fail(
        new ArchiveVerificationError({
          sessionId: request.manifest.sessionId,
          sourceSha256: request.manifest.sourceSha256,
          restoredSha256,
        }),
      );
    }

    yield* ensureParentDirectory(request.manifest.originalPath);
    yield* copyPath(restoredPath, request.manifest.originalPath);

    const originalSha256 = yield* sha256File(request.manifest.originalPath);

    if (originalSha256 !== request.manifest.sourceSha256) {
      return yield* Effect.fail(
        new ArchiveVerificationError({
          sessionId: request.manifest.sessionId,
          sourceSha256: request.manifest.sourceSha256,
          restoredSha256: originalSha256,
        }),
      );
    }

    yield* removePath(restoredPath);

    return 'restored';
  });

const manifestSourceKind = (manifest: SessionManifest): SessionSourceKind =>
  manifest.sourceKind ?? 'file';
