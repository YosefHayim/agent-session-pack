import { createHash } from 'node:crypto';
import { createReadStream, type Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { SessionOriginKind } from '@/session-model.js';
import { findOriginKind } from './file-system.js';

const SHA256_ALGORITHM = 'sha256';

const HEX_ENCODING = 'hex';

function compareDirentNames(left: Dirent, right: Dirent): number {
  return left.name.localeCompare(right.name);
}

export async function readSha256File(path: string): Promise<string> {
  try {
    return await hashFile(path);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
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

export async function readSha256Directory(path: string): Promise<string> {
  try {
    return await hashDirectoryTree(path);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

async function hashDirectoryTree(root: string): Promise<string> {
  const files: string[] = [];

  async function walk(directory: string): Promise<void> {
    const dirents = await readdir(directory, { withFileTypes: true });
    const sorted = [...dirents].sort(compareDirentNames);

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

  const treeHash = createHash(SHA256_ALGORITHM);

  for (const filePath of files) {
    const relativePath = relative(root, filePath).split(sep).join('/');
    const fileDigest = await hashFile(filePath);
    treeHash.update(relativePath);
    treeHash.update('\0');
    treeHash.update(fileDigest);
    treeHash.update('\n');
  }

  return treeHash.digest(HEX_ENCODING);
}

function hashFile(path: string): Promise<string> {
  const hash = createHash(SHA256_ALGORITHM);

  function addChunk(chunk: Buffer | string): void {
    hash.update(chunk);
  }

  function waitForDigest(fulfill: (digest: string) => void, reject: (error: Error) => void): void {
    function fulfillWithDigest(): void {
      fulfill(hash.digest(HEX_ENCODING));
    }

    createReadStream(path).on('data', addChunk).on('error', reject).on('end', fulfillWithDigest);
  }

  return new Promise(waitForDigest);
}
