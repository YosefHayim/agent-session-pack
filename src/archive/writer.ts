import { execFile } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { cp, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { SessionOriginKind } from '@/session-model.js';
import {
  ensureDirectory,
  ensureParentDirectory,
  findOriginKind,
  readDirectorySizeBytes,
  readStatPath,
  removePath,
} from './file-system.js';
import { readSha256Directory, readSha256File } from './hash.js';

const TAR_BINARY = 'tar';

const TAR_EXTENSION = '.tar';

const TAR_FILE_FLAG = '-f';

const TAR_CHANGE_DIR_FLAG = '-C';

const execFileAsync = promisify(execFile);

interface CompressionRequest {
  readonly sourcePath: string;
  readonly archivePath: string;
}

interface DecompressionRequest {
  readonly archivePath: string;
  readonly restoredPath: string;
}

export interface CompressionAdapter {
  readonly compress: (request: CompressionRequest) => Promise<void>;
  readonly decompress: (request: DecompressionRequest) => Promise<void>;
}

export interface ArchiveWriteRequest {
  readonly sessionId: string;
  readonly sourcePath: string;
  readonly archivePath: string;
  readonly restoredPath: string;
  readonly apply: boolean;
  readonly compression: CompressionAdapter;
  readonly sourceKind?: SessionOriginKind;
}

export interface VerifiedArchive {
  readonly sessionId: string;
  readonly archivePath: string;
  readonly sourceSha256: string;
  readonly restoredSha256: string;
  readonly sourceBytes: number;
  readonly archiveBytes: number;
  readonly removedOriginal: boolean;
  readonly sourceKind: SessionOriginKind;
}

export async function writeVerifiedArchive(request: ArchiveWriteRequest): Promise<VerifiedArchive> {
  const originKind = await findOriginKind(request.sourcePath, request.sourceKind);

  const isDirectoryOrigin = originKind === 'directory';

  if (isDirectoryOrigin) {
    return writeVerifiedDirectoryArchive(request);
  }

  return writeVerifiedFileArchive(request);
}

export async function removeOriginalSession(path: string): Promise<void> {
  try {
    const pathStat = await stat(path);
    await rm(path, {
      force: false,
      recursive: pathStat.isDirectory(),
    });
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

async function writeVerifiedFileArchive(request: ArchiveWriteRequest): Promise<VerifiedArchive> {
  await ensureParentDirectory(request.archivePath);
  await ensureParentDirectory(request.restoredPath);

  const originStat = await readStatPath(request.sourcePath);
  const originSha256 = await readSha256File(request.sourcePath);

  await request.compression.compress({
    sourcePath: request.sourcePath,
    archivePath: request.archivePath,
  });
  await request.compression.decompress({
    archivePath: request.archivePath,
    restoredPath: request.restoredPath,
  });

  const restoredSha256 = await readSha256File(request.restoredPath);

  const isRestoreMismatched = originSha256 !== restoredSha256;

  if (isRestoreMismatched) {
    throwVerificationMismatch({
      sessionId: request.sessionId,
      sourceSha256: originSha256,
      restoredSha256,
    });
  }

  const archiveStat = await readStatPath(request.archivePath);

  const isRemovalRequested = request.apply === true;

  if (isRemovalRequested) {
    await removeOriginalSession(request.sourcePath);
  }

  return {
    sessionId: request.sessionId,
    archivePath: request.archivePath,
    sourceSha256: originSha256,
    restoredSha256,
    sourceBytes: originStat.size,
    archiveBytes: archiveStat.size,
    removedOriginal: request.apply,
    sourceKind: 'file',
  };
}

async function writeVerifiedDirectoryArchive(
  request: ArchiveWriteRequest,
): Promise<VerifiedArchive> {
  await ensureParentDirectory(request.archivePath);
  await ensureDirectory(request.restoredPath);
  await removePath(request.restoredPath);
  await ensureParentDirectory(request.restoredPath);

  const originBytes = await readDirectorySizeBytes(request.sourcePath);
  const originSha256 = await readSha256Directory(request.sourcePath);
  const tarPath = `${request.archivePath}${TAR_EXTENSION}`;
  const restoredTarPath = `${request.restoredPath}${TAR_EXTENSION}`;

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

  const restoredSha256 = await readSha256Directory(request.restoredPath);

  const isRestoreMismatched = originSha256 !== restoredSha256;

  if (isRestoreMismatched) {
    throwVerificationMismatch({
      sessionId: request.sessionId,
      sourceSha256: originSha256,
      restoredSha256,
    });
  }

  const archiveStat = await readStatPath(request.archivePath);

  await removePath(tarPath);
  await removePath(restoredTarPath);

  const isRemovalRequested = request.apply === true;

  if (isRemovalRequested) {
    await removeOriginalSession(request.sourcePath);
  }

  return {
    sessionId: request.sessionId,
    archivePath: request.archivePath,
    sourceSha256: originSha256,
    restoredSha256,
    sourceBytes: originBytes,
    archiveBytes: archiveStat.size,
    removedOriginal: request.apply,
    sourceKind: 'directory',
  };
}

export interface DirectoryRestoreRequest {
  readonly sessionId: string;
  readonly archivePath: string;
  readonly restoredPath: string;
  readonly originalPath: string;
  readonly expectedSha256: string;
  readonly compression: CompressionAdapter;
}

export async function restoreDirectoryArchive(request: DirectoryRestoreRequest): Promise<void> {
  await ensureParentDirectory(request.restoredPath);
  await removePath(request.restoredPath);
  await ensureParentDirectory(request.originalPath);
  await removePath(request.originalPath);

  const restoredTarPath = `${request.restoredPath}${TAR_EXTENSION}`;
  await request.compression.decompress({
    archivePath: request.archivePath,
    restoredPath: restoredTarPath,
  });
  await extractTarArchive({
    tarPath: restoredTarPath,
    destinationPath: request.restoredPath,
  });

  const restoredSha256 = await readSha256Directory(request.restoredPath);

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

  const originalSha256 = await readSha256Directory(request.originalPath);

  const isOriginalMismatched = originalSha256 !== request.expectedSha256;

  if (isOriginalMismatched) {
    throwVerificationMismatch({
      sessionId: request.sessionId,
      sourceSha256: request.expectedSha256,
      restoredSha256: originalSha256,
    });
  }
}

function throwVerificationMismatch(mismatch: {
  readonly sessionId: string;
  readonly sourceSha256: string;
  readonly restoredSha256: string;
}): never {
  throw new Error(
    `Archive verification failed for session ${mismatch.sessionId}: source ${mismatch.sourceSha256} does not match restored ${mismatch.restoredSha256}`,
  );
}

async function createTarArchive(request: {
  readonly sourcePath: string;
  readonly tarPath: string;
}): Promise<void> {
  await ensureParentDirectory(request.tarPath);

  const createTarArgumentList = [
    '-c',
    TAR_FILE_FLAG,
    request.tarPath,
    TAR_CHANGE_DIR_FLAG,
    dirname(request.sourcePath),
    basename(request.sourcePath),
  ];

  try {
    await execFileAsync(TAR_BINARY, createTarArgumentList);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

async function extractTarArchive(request: {
  readonly tarPath: string;
  readonly destinationPath: string;
}): Promise<void> {
  const parent = dirname(request.destinationPath);
  const leaf = basename(request.destinationPath);
  const extractRoot = join(parent, `.extract-${leaf}`);

  await ensureDirectory(parent);
  await removePath(request.destinationPath);
  await removePath(extractRoot);
  await ensureDirectory(extractRoot);

  const extractTarArgumentList = [
    '-x',
    TAR_FILE_FLAG,
    request.tarPath,
    TAR_CHANGE_DIR_FLAG,
    extractRoot,
  ];

  try {
    await execFileAsync(TAR_BINARY, extractTarArgumentList);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }

  const extractedDirents = await readExtractedDirents(extractRoot);
  const onlyChild = extractedDirents[0];

  const singleChildMessage = `expected one top-level entry in tar archive: ${request.tarPath}`;
  const hasWrongChildCount = extractedDirents.length !== 1;
  const hasNoChild = onlyChild == null;

  if (hasWrongChildCount) {
    throw new Error(singleChildMessage);
  }

  if (hasNoChild) {
    throw new Error(singleChildMessage);
  }

  const extractedPath = join(extractRoot, onlyChild.name);
  await removePath(request.destinationPath);
  await movePath(extractedPath, request.destinationPath);
  await removePath(extractRoot);
}

async function readExtractedDirents(extractRoot: string): Promise<Dirent[]> {
  try {
    return await readdir(extractRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

async function isRenameFailing(originPath: string, destinationPath: string): Promise<boolean> {
  try {
    await rename(originPath, destinationPath);
    return false;
  } catch {
    return true;
  }
}

async function movePath(originPath: string, destinationPath: string): Promise<void> {
  await ensureParentDirectory(destinationPath);
  await removePath(destinationPath);

  // A rename fails across devices, so copy and delete the source instead.
  const isRenameFailed = await isRenameFailing(originPath, destinationPath);

  if (isRenameFailed) {
    try {
      await cp(originPath, destinationPath, { recursive: true });
    } catch (error) {
      throw new Error(String(error), { cause: error });
    }

    await removePath(originPath);
  }
}
