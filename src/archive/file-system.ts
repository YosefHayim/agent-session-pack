import type { Dirent } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { throwWrappedError } from '@/rethrow-as-error.js';
import type { SessionOriginKind } from '@/session-model.js';

function isMissingPathError(cause: unknown): boolean {
  return cause instanceof Error && 'code' in cause && cause.code === 'ENOENT';
}

export async function readDirectoryDirents(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (cause) {
    const isDirectoryMissing = isMissingPathError(cause);

    if (isDirectoryMissing) {
      return [];
    }

    return throwWrappedError(cause);
  }
}

export async function measureOriginBytes(
  path: string,
  originKind?: SessionOriginKind,
): Promise<number> {
  const kind = await findOriginKind(path, originKind);

  const isFileOrigin = kind === 'file';

  if (isFileOrigin) {
    const fileStat = await readStatPath(path);
    return fileStat.size;
  }

  return readDirectorySizeBytes(path);
}

export async function findOriginKind(
  path: string,
  originKind: SessionOriginKind | undefined,
): Promise<SessionOriginKind> {
  const isOriginKindKnown = originKind != null;

  if (isOriginKindKnown) {
    return originKind;
  }

  const pathStat = await stat(path).catch(throwWrappedError);
  const isPathDirectory = pathStat.isDirectory();
  return isPathDirectory ? 'directory' : 'file';
}

export async function readDirectorySizeBytes(path: string): Promise<number> {
  let sizeBytes = 0;

  async function walk(directory: string): Promise<void> {
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
  }

  await walk(path).catch(throwWrappedError);
  return sizeBytes;
}

export async function ensureParentDirectory(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true }).catch(throwWrappedError);
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true }).catch(throwWrappedError);
}

export async function removePath(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true }).catch(throwWrappedError);
}

export function readStatPath(path: string): Promise<{ readonly size: number }> {
  return stat(path).catch(throwWrappedError);
}

function readFileSystemErrorCode(cause: unknown): string | null {
  const hasNoErrorCode = typeof cause !== 'object' || cause === null || !('code' in cause);
  if (hasNoErrorCode) {
    return null;
  }

  return String(cause.code);
}

export async function isPathPresent(path: string): Promise<boolean> {
  const pathStat = await stat(path).catch((cause: unknown) => {
    const isPathMissing = readFileSystemErrorCode(cause) === 'ENOENT';

    if (isPathMissing) {
      return null;
    }

    return throwWrappedError(cause);
  });

  return pathStat != null;
}

export async function copyPath(originPath: string, destinationPath: string): Promise<void> {
  await copyFile(originPath, destinationPath).catch(throwWrappedError);
}
