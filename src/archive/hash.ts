import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { throwWrappedError } from '@/rethrow-as-error.js';
import type { SessionOriginKind } from '@/session-model.js';
import { findOriginKind } from './file-system.js';

export function readSha256File(path: string): Promise<string> {
  return hashFile(path).catch(throwWrappedError);
}

export async function readSha256Path(
  path: string,
  originKind?: SessionOriginKind,
): Promise<string> {
  const kind = await findOriginKind(path, originKind);

  const isDirectoryOrigin = kind === 'directory';

  if (isDirectoryOrigin) {
    return readSha256Directory(path);
  }

  return readSha256File(path);
}

export function readSha256Directory(path: string): Promise<string> {
  return hashDirectoryTree(path).catch(throwWrappedError);
}

async function hashDirectoryTree(root: string): Promise<string> {
  const files: string[] = [];

  async function walk(directory: string): Promise<void> {
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
  }

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
}

function hashFile(path: string): Promise<string> {
  return new Promise((fulfill, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => fulfill(hash.digest('hex')));
  });
}
