import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { Effect } from 'effect';
import type { SessionSourceKind } from '../../shared/sessionModel.js';
import { ArchiveFileSystemError, resolveSourceKind } from './archiveFileSystem.js';

/**
 * Hashes a file as SHA-256.
 *
 * @param path - File path to hash.
 * @returns Effect containing the hex digest.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { sha256File } from './archiveHash.js';
 *
 * const digest = await Effect.runPromise(sha256File('/sessions/abc.jsonl'));
 * ```
 */
export const sha256File = (path: string): Effect.Effect<string, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        const hash = createHash('sha256');
        createReadStream(path)
          .on('data', (chunk) => hash.update(chunk))
          .on('error', reject)
          .on('end', () => resolve(hash.digest('hex')));
      }),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });

/**
 * Hashes a file or directory tree as SHA-256.
 *
 * @param path - File or directory path to hash.
 * @param sourceKind - Explicit source kind when known.
 * @returns Effect containing the hex digest.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { sha256Path } from './archiveHash.js';
 *
 * const digest = await Effect.runPromise(sha256Path('/sessions/abc', 'directory'));
 * ```
 */
export const sha256Path = (
  path: string,
  sourceKind?: SessionSourceKind,
): Effect.Effect<string, ArchiveFileSystemError> =>
  Effect.gen(function* () {
    const kind = yield* resolveSourceKind(path, sourceKind);

    if (kind === 'directory') {
      return yield* sha256Directory(path);
    }

    return yield* sha256File(path);
  });

/**
 * Hashes every file under a directory into one stable content digest.
 *
 * @param path - Directory path to hash.
 * @returns Effect containing the hex digest.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { sha256Directory } from './archiveHash.js';
 *
 * const digest = await Effect.runPromise(sha256Directory('/sessions/abc'));
 * ```
 */
export const sha256Directory = (path: string): Effect.Effect<string, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () => hashDirectoryTree(path),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });

const hashDirectoryTree = async (root: string): Promise<string> => {
  const files: string[] = [];

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const sorted = [...entries].sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of sorted) {
      const entryPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      if (!entry.isFile()) {
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
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
