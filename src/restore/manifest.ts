import { copyPath, ensureParentDirectory, pathExists, removePath } from '@/archive/file-system.js';
import { sha256File, sha256Path } from '@/archive/hash.js';
import type { SessionManifest } from '@/archive/manifest-store.js';
import { isArchivedStubPath } from '@/archive/session-stub.js';
import { restorePathForManifest } from '@/archive/vault-paths.js';
import { type CompressionAdapter, restoreDirectoryArchive } from '@/archive/writer.js';
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

/**
 * Restores one archived session to its original path unless a changed live copy is there.
 */
export const restoreManifest = async (request: RestoreManifestRequest): Promise<RestoreOutcome> => {
  const sourceKind = manifestSourceKind(request.manifest);
  const isOriginalPresent = await pathExists(request.manifest.originalPath);

  if (isOriginalPresent) {
    const liveOutcome = await resolveLiveOriginalOutcome({
      originalPath: request.manifest.originalPath,
      sourceKind,
      sourceSha256: request.manifest.sourceSha256,
    });
    const isRestoreStillNeeded = liveOutcome === 'continue-restore';

    if (!isRestoreStillNeeded) {
      return liveOutcome;
    }
  }

  const restoredPath = restorePathForManifest(request.vaultPath, request.manifest, sourceKind);

  if (sourceKind === 'directory') {
    await restoreDirectoryArchive({
      sessionId: request.manifest.sessionId,
      archivePath: request.manifest.archivePath,
      restoredPath,
      originalPath: request.manifest.originalPath,
      expectedSha256: request.manifest.sourceSha256,
      compression: request.compression,
    });
    return 'restored';
  }

  await ensureParentDirectory(restoredPath);
  await request.compression.decompress({
    archivePath: request.manifest.archivePath,
    restoredPath,
  });

  const restoredSha256 = await sha256File(restoredPath);
  const isRestoredMismatched = restoredSha256 !== request.manifest.sourceSha256;

  if (isRestoredMismatched) {
    throw createVerificationError({
      sessionId: request.manifest.sessionId,
      sourceSha256: request.manifest.sourceSha256,
      restoredSha256,
    });
  }

  await ensureParentDirectory(request.manifest.originalPath);
  await copyPath(restoredPath, request.manifest.originalPath);

  const originalSha256 = await sha256File(request.manifest.originalPath);
  const isOriginalMismatched = originalSha256 !== request.manifest.sourceSha256;

  if (isOriginalMismatched) {
    throw createVerificationError({
      sessionId: request.manifest.sessionId,
      sourceSha256: request.manifest.sourceSha256,
      restoredSha256: originalSha256,
    });
  }

  await removePath(restoredPath);

  return 'restored';
};

const resolveLiveOriginalOutcome = async (request: {
  readonly originalPath: string;
  readonly sourceKind: SessionSourceKind;
  readonly sourceSha256: string;
}): Promise<RestoreOutcome | 'continue-restore'> => {
  const isStub = await isArchivedStubPath(request.originalPath, request.sourceKind);

  if (isStub) {
    await removePath(request.originalPath);
    return 'continue-restore';
  }

  const existingSha256 = await sha256Path(request.originalPath, request.sourceKind);
  const isSameContent = existingSha256 === request.sourceSha256;

  if (isSameContent) {
    return 'already-present';
  }

  return 'conflict';
};

const createVerificationError = (mismatch: {
  readonly sessionId: string;
  readonly sourceSha256: string;
  readonly restoredSha256: string;
}): Error =>
  new Error(
    `Archive verification failed for session ${mismatch.sessionId}: source ${mismatch.sourceSha256} does not match restored ${mismatch.restoredSha256}`,
  );

const manifestSourceKind = (manifest: SessionManifest): SessionSourceKind =>
  manifest.sourceKind ?? 'file';
