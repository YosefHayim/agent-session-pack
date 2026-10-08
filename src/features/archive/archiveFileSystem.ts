import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect, Schema } from 'effect';
import type { SessionSourceKind } from '../../shared/sessionModel.js';

/**
 * Typed error raised when an archive file system operation fails.
 */
export class ArchiveFileSystemError extends Schema.TaggedError<ArchiveFileSystemError>()(
  'ArchiveFileSystemError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

/**
 * Measures total file bytes for a file or directory session path.
 *
 * @param path - File or directory path.
 * @param sourceKind - Explicit source kind when known.
 * @returns Effect containing total source bytes.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { measureSourceBytes } from './archiveFileSystem.js';
 *
 * const bytes = await Effect.runPromise(measureSourceBytes('/sessions/abc', 'directory'));
 * ```
 */
export const measureSourceBytes = (
  path: string,
  sourceKind?: SessionSourceKind,
): Effect.Effect<number, ArchiveFileSystemError> =>
  Effect.gen(function* () {
    const kind = yield* resolveSourceKind(path, sourceKind);

    if (kind === 'file') {
      const fileStat = yield* statPath(path);
      return fileStat.size;
    }

    return yield* directorySizeBytes(path);
  });

/**
 * Resolves whether a session path is a file or a directory, trusting a known kind.
 *
 * @param path - Session path on disk.
 * @param sourceKind - Known kind, or undefined to stat the path.
 * @returns Effect containing the source kind.
 * @example
 * ```ts
 * import { resolveSourceKind } from './archiveFileSystem.js';
 *
 * const kind = await Effect.runPromise(resolveSourceKind('/sessions/abc', undefined));
 * ```
 */
export const resolveSourceKind = (
  path: string,
  sourceKind: SessionSourceKind | undefined,
): Effect.Effect<SessionSourceKind, ArchiveFileSystemError> => {
  if (sourceKind !== undefined) {
    return Effect.succeed(sourceKind);
  }

  return Effect.tryPromise({
    try: async () => {
      const pathStat = await stat(path);
      return pathStat.isDirectory() ? ('directory' as const) : ('file' as const);
    },
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });
};

/**
 * Sums the bytes of every file under a directory.
 *
 * @param path - Directory path.
 * @returns Effect containing the total size in bytes.
 * @example
 * ```ts
 * import { directorySizeBytes } from './archiveFileSystem.js';
 *
 * const bytes = await Effect.runPromise(directorySizeBytes('/sessions/abc'));
 * ```
 */
export const directorySizeBytes = (path: string): Effect.Effect<number, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: async () => {
      let sizeBytes = 0;

      const walk = async (directory: string): Promise<void> => {
        const entries = await readdir(directory, { withFileTypes: true });

        for (const entry of entries) {
          const entryPath = join(directory, entry.name);

          if (entry.isDirectory()) {
            await walk(entryPath);
            continue;
          }

          if (!entry.isFile()) {
            continue;
          }

          const fileStat = await stat(entryPath);
          sizeBytes += fileStat.size;
        }
      };

      await walk(path);
      return sizeBytes;
    },
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });

/**
 * Creates the parent directory of a path when missing.
 *
 * @param path - File path whose parent should exist.
 * @returns Effect that completes once the parent exists.
 * @example
 * ```ts
 * import { ensureParentDirectory } from './archiveFileSystem.js';
 *
 * await Effect.runPromise(ensureParentDirectory('/vault/archives/codex/abc.zst'));
 * ```
 */
export const ensureParentDirectory = (path: string): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () => mkdir(dirname(path), { recursive: true }).then(() => undefined),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });

/**
 * Creates a directory and its parents when missing.
 *
 * @param path - Directory path.
 * @returns Effect that completes once the directory exists.
 * @example
 * ```ts
 * import { ensureDirectory } from './archiveFileSystem.js';
 *
 * await Effect.runPromise(ensureDirectory('/vault/restore'));
 * ```
 */
export const ensureDirectory = (path: string): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }).then(() => undefined),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });

/**
 * Removes a file or directory tree, ignoring a missing path.
 *
 * @param path - File or directory path.
 * @returns Effect that completes once the path is gone.
 * @example
 * ```ts
 * import { removePath } from './archiveFileSystem.js';
 *
 * await Effect.runPromise(removePath('/vault/verify/abc'));
 * ```
 */
export const removePath = (path: string): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () => rm(path, { force: true, recursive: true }).then(() => undefined),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });

/**
 * Reads file system stats for a path.
 *
 * @param path - File or directory path.
 * @returns Effect containing the path size.
 * @example
 * ```ts
 * import { statPath } from './archiveFileSystem.js';
 *
 * const { size } = await Effect.runPromise(statPath('/vault/archives/codex/abc.zst'));
 * ```
 */
export const statPath = (
  path: string,
): Effect.Effect<{ readonly size: number }, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });

/**
 * Checks whether a path exists.
 *
 * @param path - File or directory path.
 * @returns Effect containing true when the path exists.
 * @example
 * ```ts
 * import { pathExists } from './archiveFileSystem.js';
 *
 * const exists = await Effect.runPromise(pathExists('/sessions/abc.jsonl'));
 * ```
 */
export const pathExists = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    stat(path)
      .then(() => true)
      .catch(() => false),
  );

/**
 * Copies one file to a destination path.
 *
 * @param sourcePath - File to copy.
 * @param destinationPath - Where the copy is written.
 * @returns Effect that completes once the copy exists.
 * @example
 * ```ts
 * import { copyPath } from './archiveFileSystem.js';
 *
 * await Effect.runPromise(copyPath('/vault/restore/abc.jsonl', '/sessions/abc.jsonl'));
 * ```
 */
export const copyPath = (
  sourcePath: string,
  destinationPath: string,
): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () => copyFile(sourcePath, destinationPath).then(() => undefined),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path: destinationPath,
        message: String(cause),
      }),
  });
