import type { Dirent } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { throwWrappedError } from '@/rethrow-as-error.js';
import type { SessionOriginKind } from '@/session-model.js';

const isMissingPathError = (cause: unknown): boolean =>
  cause instanceof Error && 'code' in cause && cause.code === 'ENOENT';

export const readDirectoryDirents = async (directory: string): Promise<Dirent[]> => {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (cause) {
    const isDirectoryMissing = isMissingPathError(cause);

    if (isDirectoryMissing) {
      return [];
    }

    return throwWrappedError(cause);
  }
};

export const measureOriginBytes = async (
  path: string,
  originKind?: SessionOriginKind,
): Promise<number> => {
  const kind = await findOriginKind(path, originKind);

  const isFileOrigin = kind === 'file';

  if (isFileOrigin) {
    const fileStat = await readStatPath(path);
    return fileStat.size;
  }

  return readDirectorySizeBytes(path);
};

export const findOriginKind = async (
  path: string,
  originKind: SessionOriginKind | undefined,
): Promise<SessionOriginKind> => {
  const isOriginKindKnown = originKind != null;

  if (isOriginKindKnown) {
    return originKind;
  }

  const pathStat = await stat(path).catch(throwWrappedError);
  const isPathDirectory = pathStat.isDirectory();
  return isPathDirectory ? 'directory' : 'file';
};

export const readDirectorySizeBytes = async (path: string): Promise<number> => {
  let sizeBytes = 0;

  const walk = async (directory: string): Promise<void> => {
    const dirents = await readdir(directory, { withFileTypes: true });

    for (const dirent of dirents) {
      const childPath = join(directory, dirent.name);

      const isChildDirectory = dirent.isDirectory();
      if (isChildDirectory) {
        await walk(childPath);
        continue;
      }

      const isNotFile = !dirent.isFile();
      if (isNotFile) {
        continue;
      }

      const fileStat = await stat(childPath);
      sizeBytes += fileStat.size;
    }
  };

  await walk(path).catch(throwWrappedError);
  return sizeBytes;
};

export const ensureParentDirectory = async (path: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true }).catch(throwWrappedError);
};

export const ensureDirectory = async (path: string): Promise<void> => {
  await mkdir(path, { recursive: true }).catch(throwWrappedError);
};

export const removePath = async (path: string): Promise<void> => {
  await rm(path, { force: true, recursive: true }).catch(throwWrappedError);
};

export const readStatPath = (path: string): Promise<{ readonly size: number }> =>
  stat(path).catch(throwWrappedError);

const readFileSystemErrorCode = (cause: unknown): string | null => {
  const hasNoErrorCode = typeof cause !== 'object' || cause === null || !('code' in cause);
  if (hasNoErrorCode) {
    return null;
  }

  return String(cause.code);
};

export const isPathPresent = async (path: string): Promise<boolean> => {
  const pathStat = await stat(path).catch((cause: unknown) => {
    const isPathMissing = readFileSystemErrorCode(cause) === 'ENOENT';

    if (isPathMissing) {
      return null;
    }

    return throwWrappedError(cause);
  });

  return pathStat != null;
};

export const copyPath = async (originPath: string, destinationPath: string): Promise<void> => {
  await copyFile(originPath, destinationPath).catch(throwWrappedError);
};
