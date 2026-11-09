import type { Dirent } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { rethrowAsError } from '@/rethrow-as-error.js';
import type { SessionSourceKind } from '@/session-model.js';

const isMissingPathError = (cause: unknown): boolean =>
  cause instanceof Error && 'code' in cause && cause.code === 'ENOENT';

/**
 * Lists a directory's entries, or an empty list when the directory does not exist.
 */
export const readDirectoryEntries = async (directory: string): Promise<Dirent[]> => {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (cause) {
    const isDirectoryMissing = isMissingPathError(cause);

    if (isDirectoryMissing) {
      return [];
    }

    return rethrowAsError(cause);
  }
};

/**
 * Measures total file bytes for a file or directory session path.
 */
export const measureSourceBytes = async (
  path: string,
  sourceKind?: SessionSourceKind,
): Promise<number> => {
  const kind = await resolveSourceKind(path, sourceKind);

  const isFileSource = kind === 'file';

  if (isFileSource) {
    const fileStat = await statPath(path);
    return fileStat.size;
  }

  return directorySizeBytes(path);
};

/**
 * Resolves whether a session path is a file or a directory, trusting a known kind.
 */
export const resolveSourceKind = async (
  path: string,
  sourceKind: SessionSourceKind | undefined,
): Promise<SessionSourceKind> => {
  const isSourceKindKnown = sourceKind !== undefined;

  if (isSourceKindKnown) {
    return sourceKind;
  }

  const pathStat = await stat(path).catch(rethrowAsError);
  const isPathDirectory = pathStat.isDirectory();
  return isPathDirectory ? 'directory' : 'file';
};

/**
 * Sums the bytes of every file under a directory.
 */
export const directorySizeBytes = async (path: string): Promise<number> => {
  let sizeBytes = 0;

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(directory, entry.name);

      const isDirectoryEntry = entry.isDirectory();
      if (isDirectoryEntry) {
        await walk(entryPath);
        continue;
      }

      const isNotFile = !entry.isFile();
      if (isNotFile) {
        continue;
      }

      const fileStat = await stat(entryPath);
      sizeBytes += fileStat.size;
    }
  };

  await walk(path).catch(rethrowAsError);
  return sizeBytes;
};

/**
 * Creates the parent directory of a path when missing.
 */
export const ensureParentDirectory = async (path: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true }).catch(rethrowAsError);
};

/**
 * Creates a directory and its parents when missing.
 */
export const ensureDirectory = async (path: string): Promise<void> => {
  await mkdir(path, { recursive: true }).catch(rethrowAsError);
};

/**
 * Removes a file or directory tree, ignoring a missing path.
 */
export const removePath = async (path: string): Promise<void> => {
  await rm(path, { force: true, recursive: true }).catch(rethrowAsError);
};

/**
 * Reads file system stats for a path.
 */
export const statPath = (path: string): Promise<{ readonly size: number }> =>
  stat(path).catch(rethrowAsError);

/**
 * Checks whether a path exists.
 */
export const pathExists = async (path: string): Promise<boolean> => {
  const isPathFound = await stat(path).then(
    () => true,
    () => false,
  );
  return isPathFound;
};

/**
 * Copies one file to a destination path.
 */
export const copyPath = async (sourcePath: string, destinationPath: string): Promise<void> => {
  await copyFile(sourcePath, destinationPath).catch(rethrowAsError);
};
