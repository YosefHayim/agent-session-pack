import type { Dirent } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SessionOriginKind } from '@/session-model.js';

function isMissingPathError(error: unknown): boolean {
  const isNotError = !(error instanceof Error);
  if (isNotError) {
    return false;
  }

  const hasNoErrorCode = !('code' in error);
  if (hasNoErrorCode) {
    return false;
  }

  return error.code === 'ENOENT';
}

export async function readDirectoryDirents(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const isDirectoryMissing = isMissingPathError(error);

    if (isDirectoryMissing) {
      return [];
    }

    throw new Error(String(error), { cause: error });
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

  try {
    const pathStat = await stat(path);
    const isPathDirectory = pathStat.isDirectory();
    return isPathDirectory ? 'directory' : 'file';
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
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

  try {
    await walk(path);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }

  return sizeBytes;
}

export async function ensureParentDirectory(path: string): Promise<void> {
  await ensureDirectory(dirname(path));
}

export async function ensureDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

export async function removePath(path: string): Promise<void> {
  try {
    await rm(path, { force: true, recursive: true });
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

export async function readStatPath(path: string): Promise<{ readonly size: number }> {
  try {
    return await stat(path);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

function readFileSystemErrorCode(error: unknown): string | null {
  const isNotObject = typeof error !== 'object';
  if (isNotObject) {
    return null;
  }

  const isNull = error === null;
  if (isNull) {
    return null;
  }

  const hasNoErrorCode = !('code' in error);
  if (hasNoErrorCode) {
    return null;
  }

  return String(error.code);
}

export async function isPathPresent(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    const isPathMissing = readFileSystemErrorCode(error) === 'ENOENT';

    if (isPathMissing) {
      return false;
    }

    throw new Error(String(error), { cause: error });
  }
}

export async function copyPath(originPath: string, destinationPath: string): Promise<void> {
  try {
    await copyFile(originPath, destinationPath);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}
