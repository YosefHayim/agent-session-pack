import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { rethrowAsError } from '@/rethrow-as-error.js';
import type { SessionSourceKind } from '@/session-model.js';
import {
  directorySizeBytes,
  ensureDirectory,
  ensureParentDirectory,
  removePath,
  resolveSourceKind,
  statPath,
} from './file-system.js';
import { sha256Directory, sha256File } from './hash.js';

const TAR_BINARY = 'tar';

const TAR_CREATE_FLAG = '-c';

const TAR_EXTRACT_FLAG = '-x';

const TAR_FILE_FLAG = '-f';

const TAR_CHANGE_DIR_FLAG = '-C';

const execFileAsync = promisify(execFile);

type CompressionRequest = {
  readonly sourcePath: string;
  readonly archivePath: string;
};

type DecompressionRequest = {
  readonly archivePath: string;
  readonly restoredPath: string;
};

/**
 * Pluggable compression backend used by archive read and write workflows.
 */
export type CompressionAdapter = {
  readonly compress: (request: CompressionRequest) => Promise<void>;
  readonly decompress: (request: DecompressionRequest) => Promise<void>;
};

/**
 * Full request to archive one session and verify its restore.
 */
export type ArchiveWriteRequest = {
  readonly sessionId: string;
  readonly sourcePath: string;
  readonly archivePath: string;
  readonly restoredPath: string;
  readonly apply: boolean;
  readonly compression: CompressionAdapter;
  readonly sourceKind?: SessionSourceKind;
};

/**
 * Verified archive metadata recorded after a byte-exact restore check.
 */
export type VerifiedArchive = {
  readonly sessionId: string;
  readonly archivePath: string;
  readonly sourceSha256: string;
  readonly restoredSha256: string;
  readonly sourceBytes: number;
  readonly archiveBytes: number;
  readonly removedOriginal: boolean;
  readonly sourceKind: SessionSourceKind;
};

/**
 * Writes a compressed archive and verifies byte-exact restore before removal is allowed.
 */
export const writeVerifiedArchive = async (
  request: ArchiveWriteRequest,
): Promise<VerifiedArchive> => {
  const sourceKind = await resolveSourceKind(request.sourcePath, request.sourceKind);

  const isDirectorySource = sourceKind === 'directory';

  if (isDirectorySource) {
    return writeVerifiedDirectoryArchive(request);
  }

  return writeVerifiedFileArchive(request);
};

/**
 * Removes an original session file or directory after verification has passed.
 */
export const removeOriginalSession = async (path: string): Promise<void> => {
  const pathStat = await stat(path).catch(rethrowAsError);
  await rm(path, {
    force: false,
    recursive: pathStat.isDirectory(),
  }).catch(rethrowAsError);
};

const writeVerifiedFileArchive = async (request: ArchiveWriteRequest): Promise<VerifiedArchive> => {
  await ensureParentDirectory(request.archivePath);
  await ensureParentDirectory(request.restoredPath);

  const sourceStat = await statPath(request.sourcePath);
  const sourceSha256 = await sha256File(request.sourcePath);

  await request.compression.compress({
    sourcePath: request.sourcePath,
    archivePath: request.archivePath,
  });
  await request.compression.decompress({
    archivePath: request.archivePath,
    restoredPath: request.restoredPath,
  });

  const restoredSha256 = await sha256File(request.restoredPath);

  const isRestoreMismatched = sourceSha256 !== restoredSha256;

  if (isRestoreMismatched) {
    throwVerificationMismatch({ sessionId: request.sessionId, sourceSha256, restoredSha256 });
  }

  const archiveStat = await statPath(request.archivePath);

  const isRemovalRequested = request.apply === true;

  if (isRemovalRequested) {
    await removeOriginalSession(request.sourcePath);
  }

  return {
    sessionId: request.sessionId,
    archivePath: request.archivePath,
    sourceSha256,
    restoredSha256,
    sourceBytes: sourceStat.size,
    archiveBytes: archiveStat.size,
    removedOriginal: request.apply,
    sourceKind: 'file',
  };
};

const writeVerifiedDirectoryArchive = async (
  request: ArchiveWriteRequest,
): Promise<VerifiedArchive> => {
  await ensureParentDirectory(request.archivePath);
  await ensureDirectory(request.restoredPath);
  await removePath(request.restoredPath);
  await ensureParentDirectory(request.restoredPath);

  const sourceBytes = await directorySizeBytes(request.sourcePath);
  const sourceSha256 = await sha256Directory(request.sourcePath);
  const tarPath = `${request.archivePath}.tar`;
  const restoredTarPath = `${request.restoredPath}.tar`;

  await createTarArchive({
    sourcePath: request.sourcePath,
    tarPath,
  });
  await request.compression.compress({
    sourcePath: tarPath,
    archivePath: request.archivePath,
  });
  await request.compression.decompress({
    archivePath: request.archivePath,
    restoredPath: restoredTarPath,
  });
  await extractTarArchive({
    tarPath: restoredTarPath,
    destinationPath: request.restoredPath,
  });

  const restoredSha256 = await sha256Directory(request.restoredPath);

  const isRestoreMismatched = sourceSha256 !== restoredSha256;

  if (isRestoreMismatched) {
    throwVerificationMismatch({ sessionId: request.sessionId, sourceSha256, restoredSha256 });
  }

  const archiveStat = await statPath(request.archivePath);

  await removePath(tarPath);
  await removePath(restoredTarPath);

  const isRemovalRequested = request.apply === true;

  if (isRemovalRequested) {
    await removeOriginalSession(request.sourcePath);
  }

  return {
    sessionId: request.sessionId,
    archivePath: request.archivePath,
    sourceSha256,
    restoredSha256,
    sourceBytes,
    archiveBytes: archiveStat.size,
    removedOriginal: request.apply,
    sourceKind: 'directory',
  };
};

/**
 * Request used to restore a directory-backed session archive.
 */
export type DirectoryRestoreRequest = {
  readonly sessionId: string;
  readonly archivePath: string;
  readonly restoredPath: string;
  readonly originalPath: string;
  readonly expectedSha256: string;
  readonly compression: CompressionAdapter;
};

/**
 * Restores a directory archive to an original provider path after hash verification.
 */
export const restoreDirectoryArchive = async (request: DirectoryRestoreRequest): Promise<void> => {
  await ensureParentDirectory(request.restoredPath);
  await removePath(request.restoredPath);
  await ensureParentDirectory(request.originalPath);
  await removePath(request.originalPath);

  const restoredTarPath = `${request.restoredPath}.tar`;
  await request.compression.decompress({
    archivePath: request.archivePath,
    restoredPath: restoredTarPath,
  });
  await extractTarArchive({
    tarPath: restoredTarPath,
    destinationPath: request.restoredPath,
  });

  const restoredSha256 = await sha256Directory(request.restoredPath);

  const isRestoredMismatched = restoredSha256 !== request.expectedSha256;

  if (isRestoredMismatched) {
    throwVerificationMismatch({
      sessionId: request.sessionId,
      sourceSha256: request.expectedSha256,
      restoredSha256,
    });
  }

  await movePath(request.restoredPath, request.originalPath);
  await removePath(restoredTarPath);

  const originalSha256 = await sha256Directory(request.originalPath);

  const isOriginalMismatched = originalSha256 !== request.expectedSha256;

  if (isOriginalMismatched) {
    throwVerificationMismatch({
      sessionId: request.sessionId,
      sourceSha256: request.expectedSha256,
      restoredSha256: originalSha256,
    });
  }
};

const throwVerificationMismatch = (mismatch: {
  readonly sessionId: string;
  readonly sourceSha256: string;
  readonly restoredSha256: string;
}): never => {
  throw new Error(
    `Archive verification failed for session ${mismatch.sessionId}: source ${mismatch.sourceSha256} does not match restored ${mismatch.restoredSha256}`,
  );
};

const createTarArchive = async (request: {
  readonly sourcePath: string;
  readonly tarPath: string;
}): Promise<void> => {
  await mkdir(dirname(request.tarPath), { recursive: true }).catch(rethrowAsError);
  // Pack sourcePath into tarPath: create archive from parent so the leaf name is the top entry.
  const createTarArgs = [
    TAR_CREATE_FLAG,
    TAR_FILE_FLAG,
    request.tarPath,
    TAR_CHANGE_DIR_FLAG,
    dirname(request.sourcePath),
    basename(request.sourcePath),
  ];
  await execFileAsync(TAR_BINARY, createTarArgs).catch(rethrowAsError);
};

const extractTarArchive = async (request: {
  readonly tarPath: string;
  readonly destinationPath: string;
}): Promise<void> => {
  const parent = dirname(request.destinationPath);
  const leaf = basename(request.destinationPath);
  const extractRoot = join(parent, `.extract-${leaf}`);

  await mkdir(parent, { recursive: true }).catch(rethrowAsError);
  await rm(request.destinationPath, { recursive: true, force: true }).catch(rethrowAsError);
  await rm(extractRoot, { recursive: true, force: true }).catch(rethrowAsError);
  await mkdir(extractRoot, { recursive: true }).catch(rethrowAsError);

  // Extract tarPath into extractRoot: unpack archive contents under the staging directory.
  const extractTarArgs = [
    TAR_EXTRACT_FLAG,
    TAR_FILE_FLAG,
    request.tarPath,
    TAR_CHANGE_DIR_FLAG,
    extractRoot,
  ];
  await execFileAsync(TAR_BINARY, extractTarArgs).catch(rethrowAsError);

  const extractedEntries = await readdir(extractRoot, { withFileTypes: true }).catch(
    rethrowAsError,
  );
  const onlyEntry = extractedEntries[0];

  const isNotSingleEntry = extractedEntries.length !== 1 || onlyEntry == null;

  if (isNotSingleEntry) {
    throw new Error(`expected one top-level entry in tar archive: ${request.tarPath}`);
  }

  const extractedPath = join(extractRoot, onlyEntry.name);
  await rm(request.destinationPath, { recursive: true, force: true }).catch(rethrowAsError);
  await movePath(extractedPath, request.destinationPath);
  await rm(extractRoot, { recursive: true, force: true }).catch(rethrowAsError);
};

const movePath = async (sourcePath: string, destinationPath: string): Promise<void> => {
  await mkdir(dirname(destinationPath), { recursive: true }).catch(rethrowAsError);
  await rm(destinationPath, { recursive: true, force: true }).catch(rethrowAsError);

  // A rename fails across devices, so copy and delete the source instead.
  const isRenameFailed = await rename(sourcePath, destinationPath).then(
    () => false,
    () => true,
  );

  if (isRenameFailed) {
    await cp(sourcePath, destinationPath, { recursive: true }).catch(rethrowAsError);
    await rm(sourcePath, { recursive: true, force: true }).catch(rethrowAsError);
  }
};
