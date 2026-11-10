import {
  copyPath,
  ensureParentDirectory,
  isPathPresent,
  removePath,
} from '@/archive/file-system.js';
import { readSha256File, readSha256Path } from '@/archive/hash.js';
import type { SessionManifest } from '@/archive/manifest-store.js';
import { isArchivedStubPath } from '@/archive/session-stub.js';
import { restorePathForManifest } from '@/archive/vault-paths.js';
import { type CompressionAdapter, restoreDirectoryArchive } from '@/archive/writer.js';
import type { SessionOriginKind } from '@/session-model.js';

export type RestoreExit = 'already-present' | 'conflict' | 'restored';

export type RestoreManifestRequest = {
  readonly compression: CompressionAdapter;
  readonly manifest: SessionManifest;
  readonly vaultPath: string;
};

export const restoreManifest = async (request: RestoreManifestRequest): Promise<RestoreExit> => {
  const originKind = readManifestOriginKind(request.manifest);

  const liveExit = await findLiveExitWhenPresent(request.manifest, originKind);

  const hasLiveExit = liveExit != null;
  if (hasLiveExit) {
    return liveExit;
  }

  const restoredPath = restorePathForManifest(request.vaultPath, request.manifest, originKind);

  const isOriginDirectory = originKind === 'directory';
  if (isOriginDirectory) {
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

  const restoredSha256 = await readSha256File(restoredPath);

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

  const originalSha256 = await readSha256File(request.manifest.originalPath);

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

const findLiveExitWhenPresent = async (
  manifest: SessionManifest,
  originKind: SessionOriginKind,
): Promise<RestoreExit | null> => {
  const isOriginalPresent = await isPathPresent(manifest.originalPath);

  const isOriginalAbsent = !isOriginalPresent;
  if (isOriginalAbsent) {
    return null;
  }

  const liveExit = await findLiveOriginalExit({
    originalPath: manifest.originalPath,
    sourceKind: originKind,
    sourceSha256: manifest.sourceSha256,
  });

  const isRestoreStillNeeded = liveExit === 'continue-restore';
  if (isRestoreStillNeeded) {
    return null;
  }

  return liveExit;
};

const findLiveOriginalExit = async (request: {
  readonly originalPath: string;
  readonly sourceKind: SessionOriginKind;
  readonly sourceSha256: string;
}): Promise<RestoreExit | 'continue-restore'> => {
  const isStub = await isArchivedStubPath(request.originalPath, request.sourceKind);

  if (isStub) {
    await removePath(request.originalPath);
    return 'continue-restore';
  }

  const existingSha256 = await readSha256Path(request.originalPath, request.sourceKind);

  const isSameSha256 = existingSha256 === request.sourceSha256;

  if (isSameSha256) {
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

const readManifestOriginKind = (manifest: SessionManifest): SessionOriginKind =>
  manifest.sourceKind ?? 'file';
