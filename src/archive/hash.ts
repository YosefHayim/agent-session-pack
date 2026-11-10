import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { throwWrappedError } from '@/rethrow-as-error.js';
import type { SessionOriginKind } from '@/session-model.js';
import { findOriginKind } from './file-system.js';

/**
 * Hashes a file as SHA-256.
 */
export const readSha256File = (path: string): Promise<string> =>
  hashFile(path).catch(throwWrappedError);

/**
 * Hashes a file or directory tree as SHA-256.
 */
export const readSha256Path = async (
  path: string,
  originKind?: SessionOriginKind,
): Promise<string> => {
  const kind = await findOriginKind(path, originKind);

  const isDirectoryOrigin = kind === 'directory';

  if (isDirectoryOrigin) {
    return readSha256Directory(path);
  }

  return readSha256File(path);
};

/**
 * Hashes every file under a directory into one stable content digest.
 */
export const readSha256Directory = (path: string): Promise<string> =>
  hashDirectoryTree(path).catch(throwWrappedError);

const hashDirectoryTree = async (root: string): Promise<string> => {
  const files: string[] = [];

  const walk = async (directory: string): Promise<void> => {
    const dirents = await readdir(directory, { withFileTypes: true });
    const sorted = [...dirents].sort((left, right) => left.name.localeCompare(right.name));

    for (const dirent of sorted) {
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

      files.push(childPath);
    }
  };

  await walk(root);

  const treeHash = createHash('sha256');

  for (const filePath of files) {
    const relativePath = relative(root, filePath).split(sep).join('/');
    const fileDigest = await hashFile(filePath);
    treeHash.update(relativePath);
    treeHash.update('\0');
    treeHash.update(fileDigest);
    treeHash.update('\n');
  }

  return treeHash.digest('hex');
};

const hashFile = (path: string): Promise<string> =>
  new Promise((fulfill, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => fulfill(hash.digest('hex')));
  });
