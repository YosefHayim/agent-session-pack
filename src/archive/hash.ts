import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { throwWrappedError } from '@/rethrow-as-error.js';
import type { SessionSourceKind } from '@/session-model.js';
import { findSourceKind } from './file-system.js';

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
  sourceKind?: SessionSourceKind,
): Promise<string> => {
  const kind = await findSourceKind(path, sourceKind);

  const isDirectorySource = kind === 'directory';

  if (isDirectorySource) {
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
    const entries = await readdir(directory, { withFileTypes: true });
    const sorted = [...entries].sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of sorted) {
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

      files.push(entryPath);
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
