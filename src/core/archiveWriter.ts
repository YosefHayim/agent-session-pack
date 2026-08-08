import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { Effect, Schema } from 'effect';
import type { SessionSourceKind } from './sessionStore.js';

const execFileAsync = promisify(execFile);

/**
 * Describes a single-file compression request from source to archive path.
 */
export type CompressionRequest = {
  readonly sourcePath: string;
  readonly archivePath: string;
};

/**
 * Describes a single-file decompression request from archive to restored path.
 */
export type DecompressionRequest = {
  readonly archivePath: string;
  readonly restoredPath: string;
};

/**
 * Pluggable compression backend used by archive read and write workflows.
 */
export type CompressionAdapter = {
  readonly compress: (request: CompressionRequest) => Effect.Effect<void, ArchiveFileSystemError>;
  readonly decompress: (
    request: DecompressionRequest,
  ) => Effect.Effect<void, ArchiveFileSystemError>;
};

/**
 * Full request to archive one session and verify its restore.
 */
export type ArchiveWriteRequest = {
  readonly sessionId: string;
  readonly sourcePath: string;
  readonly archivePath: string;
  readonly restoredPath: string;
  readonly apply: boolean;
  readonly compression: CompressionAdapter;
  readonly sourceKind?: SessionSourceKind;
};

/**
 * Verified archive metadata recorded after a byte-exact restore check.
 */
export type VerifiedArchive = {
  readonly sessionId: string;
  readonly archivePath: string;
  readonly sourceSha256: string;
  readonly restoredSha256: string;
  readonly sourceBytes: number;
  readonly archiveBytes: number;
  readonly removedOriginal: boolean;
  readonly sourceKind: SessionSourceKind;
};

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
 * Typed error raised when a restored archive hash does not match the source.
 */
export class ArchiveVerificationError extends Schema.TaggedError<ArchiveVerificationError>()(
  'ArchiveVerificationError',
  {
    sessionId: Schema.String,
    sourceSha256: Schema.String,
    restoredSha256: Schema.String,
  },
) {}

/**
 * Union of errors that an archive write workflow can produce.
 */
export type ArchiveWriteError = ArchiveFileSystemError | ArchiveVerificationError;

/**
 * Writes a compressed archive and verifies byte-exact restore before removal is allowed.
 *
 * @param request - Source session and destination archive paths.
 * @returns Verified archive metadata for the manifest and index.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { writeVerifiedArchive } from './archiveWriter.js';
 * import { createZstdCompression } from './archiveReader.js';
 *
 * const verified = await Effect.runPromise(
 *   writeVerifiedArchive({
 *     sessionId: 'abc',
 *     sourcePath: '/sessions/abc.jsonl',
 *     archivePath: '/vault/abc.jsonl.zst',
 *     restoredPath: '/vault/verify/abc.jsonl',
 *     apply: false,
 *     compression: createZstdCompression(),
 *   }),
 * );
 * ```
 */
export const writeVerifiedArchive = (
  request: ArchiveWriteRequest,
): Effect.Effect<VerifiedArchive, ArchiveWriteError> =>
  Effect.gen(function* () {
    const sourceKind = yield* resolveSourceKind(request.sourcePath, request.sourceKind);

    if (sourceKind === 'directory') {
      return yield* writeVerifiedDirectoryArchive(request);
    }

    return yield* writeVerifiedFileArchive(request);
  });

/**
 * Hashes a file as SHA-256.
 *
 * @param path - File path to hash.
 * @returns Effect containing the hex digest.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { sha256File } from './archiveWriter.js';
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
 * import { sha256Path } from './archiveWriter.js';
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
 * import { sha256Directory } from './archiveWriter.js';
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

/**
 * Measures total file bytes for a file or directory session path.
 *
 * @param path - File or directory path.
 * @param sourceKind - Explicit source kind when known.
 * @returns Effect containing total source bytes.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { measureSourceBytes } from './archiveWriter.js';
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
 * Removes an original session file or directory after verification has passed.
 *
 * @param path - Original provider session path.
 * @returns Effect completing after removal.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { removeOriginalSession } from './archiveWriter.js';
 *
 * await Effect.runPromise(removeOriginalSession('/sessions/abc.jsonl'));
 * ```
 */
export const removeOriginalSession = (path: string): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: async () => {
      const pathStat = await stat(path);
      await rm(path, {
        force: false,
        recursive: pathStat.isDirectory(),
      });
    },
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });

const writeVerifiedFileArchive = (
  request: ArchiveWriteRequest,
): Effect.Effect<VerifiedArchive, ArchiveWriteError> =>
  Effect.gen(function* () {
    yield* ensureParentDirectory(request.archivePath);
    yield* ensureParentDirectory(request.restoredPath);

    const sourceStat = yield* statPath(request.sourcePath);
    const sourceSha256 = yield* sha256File(request.sourcePath);

    yield* request.compression.compress({
      sourcePath: request.sourcePath,
      archivePath: request.archivePath,
    });
    yield* request.compression.decompress({
      archivePath: request.archivePath,
      restoredPath: request.restoredPath,
    });

    const restoredSha256 = yield* sha256File(request.restoredPath);

    if (sourceSha256 !== restoredSha256) {
      return yield* Effect.fail(
        new ArchiveVerificationError({
          sessionId: request.sessionId,
          sourceSha256,
          restoredSha256,
        }),
      );
    }

    const archiveStat = yield* statPath(request.archivePath);

    if (request.apply === true) {
      yield* removeOriginalSession(request.sourcePath);
    }

    return {
      sessionId: request.sessionId,
      archivePath: request.archivePath,
      sourceSha256,
      restoredSha256,
      sourceBytes: sourceStat.size,
      archiveBytes: archiveStat.size,
      removedOriginal: request.apply,
      sourceKind: 'file' as const,
    };
  });

const writeVerifiedDirectoryArchive = (
  request: ArchiveWriteRequest,
): Effect.Effect<VerifiedArchive, ArchiveWriteError> =>
  Effect.gen(function* () {
    yield* ensureParentDirectory(request.archivePath);
    yield* ensureDirectory(request.restoredPath);
    yield* removePath(request.restoredPath);
    yield* ensureParentDirectory(request.restoredPath);

    const sourceBytes = yield* directorySizeBytes(request.sourcePath);
    const sourceSha256 = yield* sha256Directory(request.sourcePath);
    const tarPath = `${request.archivePath}.tar`;
    const restoredTarPath = `${request.restoredPath}.tar`;

    yield* createTarArchive({
      sourcePath: request.sourcePath,
      tarPath,
    });
    yield* request.compression.compress({
      sourcePath: tarPath,
      archivePath: request.archivePath,
    });
    yield* request.compression.decompress({
      archivePath: request.archivePath,
      restoredPath: restoredTarPath,
    });
    yield* extractTarArchive({
      tarPath: restoredTarPath,
      destinationPath: request.restoredPath,
    });

    const restoredSha256 = yield* sha256Directory(request.restoredPath);

    if (sourceSha256 !== restoredSha256) {
      return yield* Effect.fail(
        new ArchiveVerificationError({
          sessionId: request.sessionId,
          sourceSha256,
          restoredSha256,
        }),
      );
    }

    const archiveStat = yield* statPath(request.archivePath);

    yield* removePath(tarPath);
    yield* removePath(restoredTarPath);

    if (request.apply === true) {
      yield* removeOriginalSession(request.sourcePath);
    }

    return {
      sessionId: request.sessionId,
      archivePath: request.archivePath,
      sourceSha256,
      restoredSha256,
      sourceBytes,
      archiveBytes: archiveStat.size,
      removedOriginal: request.apply,
      sourceKind: 'directory' as const,
    };
  });

/**
 * Request used to restore a directory-backed session archive.
 */
export type DirectoryRestoreRequest = {
  readonly sessionId: string;
  readonly archivePath: string;
  readonly restoredPath: string;
  readonly originalPath: string;
  readonly expectedSha256: string;
  readonly compression: CompressionAdapter;
};

/**
 * Restores a directory archive to an original provider path after hash verification.
 *
 * @param request - Archive path, restored work path, original destination, and expected hash.
 * @returns Effect completing after verified restore.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { restoreDirectoryArchive } from './archiveWriter.js';
 * import { createZstdCompression } from './archiveReader.js';
 *
 * await Effect.runPromise(
 *   restoreDirectoryArchive({
 *     sessionId: 'abc',
 *     archivePath: '/vault/abc.tar.zst',
 *     restoredPath: '/vault/restore/abc',
 *     originalPath: '/sessions/abc',
 *     expectedSha256: 'abc',
 *     compression: createZstdCompression(),
 *   }),
 * );
 * ```
 */
export const restoreDirectoryArchive = (
  request: DirectoryRestoreRequest,
): Effect.Effect<void, ArchiveWriteError> =>
  Effect.gen(function* () {
    yield* ensureParentDirectory(request.restoredPath);
    yield* removePath(request.restoredPath);
    yield* ensureParentDirectory(request.originalPath);
    yield* removePath(request.originalPath);

    const restoredTarPath = `${request.restoredPath}.tar`;
    yield* request.compression.decompress({
      archivePath: request.archivePath,
      restoredPath: restoredTarPath,
    });
    yield* extractTarArchive({
      tarPath: restoredTarPath,
      destinationPath: request.restoredPath,
    });

    const restoredSha256 = yield* sha256Directory(request.restoredPath);

    if (restoredSha256 !== request.expectedSha256) {
      return yield* Effect.fail(
        new ArchiveVerificationError({
          sessionId: request.sessionId,
          sourceSha256: request.expectedSha256,
          restoredSha256,
        }),
      );
    }

    yield* movePath(request.restoredPath, request.originalPath);
    yield* removePath(restoredTarPath);

    const originalSha256 = yield* sha256Directory(request.originalPath);

    if (originalSha256 !== request.expectedSha256) {
      return yield* Effect.fail(
        new ArchiveVerificationError({
          sessionId: request.sessionId,
          sourceSha256: request.expectedSha256,
          restoredSha256: originalSha256,
        }),
      );
    }
  });

const resolveSourceKind = (
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

const directorySizeBytes = (path: string): Effect.Effect<number, ArchiveFileSystemError> =>
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

const createTarArchive = (request: {
  readonly sourcePath: string;
  readonly tarPath: string;
}): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(request.tarPath), { recursive: true });
      await execFileAsync('tar', [
        '-cf',
        request.tarPath,
        '-C',
        dirname(request.sourcePath),
        basename(request.sourcePath),
      ]);
    },
    catch: (cause) =>
      new ArchiveFileSystemError({
        path: request.sourcePath,
        message: String(cause),
      }),
  });

const extractTarArchive = (request: {
  readonly tarPath: string;
  readonly destinationPath: string;
}): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: async () => {
      const parent = dirname(request.destinationPath);
      const leaf = basename(request.destinationPath);
      await mkdir(parent, { recursive: true });
      await rm(request.destinationPath, { recursive: true, force: true });

      const extractRoot = join(parent, `.extract-${leaf}`);
      await rm(extractRoot, { recursive: true, force: true });
      await mkdir(extractRoot, { recursive: true });
      await execFileAsync('tar', ['-xf', request.tarPath, '-C', extractRoot]);

      const extractedEntries = await readdir(extractRoot, { withFileTypes: true });
      const onlyEntry = extractedEntries[0];

      if (extractedEntries.length !== 1 || onlyEntry === undefined) {
        throw new ArchiveFileSystemError({
          path: request.tarPath,
          message: `expected one top-level entry in tar archive: ${request.tarPath}`,
        });
      }

      const extractedPath = join(extractRoot, onlyEntry.name);
      await rm(request.destinationPath, { recursive: true, force: true });
      await movePathAsync(extractedPath, request.destinationPath);
      await rm(extractRoot, { recursive: true, force: true });
    },
    catch: (cause) => {
      if (cause instanceof ArchiveFileSystemError) {
        return cause;
      }

      return new ArchiveFileSystemError({
        path: request.destinationPath,
        message: String(cause),
      });
    },
  });

const movePath = (
  sourcePath: string,
  destinationPath: string,
): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () => movePathAsync(sourcePath, destinationPath),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path: destinationPath,
        message: String(cause),
      }),
  });

const movePathAsync = async (sourcePath: string, destinationPath: string): Promise<void> => {
  await mkdir(dirname(destinationPath), { recursive: true });
  await rm(destinationPath, { recursive: true, force: true });

  try {
    const { rename } = await import('node:fs/promises');
    await rename(sourcePath, destinationPath);
  } catch {
    const { cp } = await import('node:fs/promises');
    await cp(sourcePath, destinationPath, { recursive: true });
    await rm(sourcePath, { recursive: true, force: true });
  }
};

const ensureParentDirectory = (path: string): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () => mkdir(dirname(path), { recursive: true }).then(() => undefined),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });

const ensureDirectory = (path: string): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }).then(() => undefined),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });

const removePath = (path: string): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () => rm(path, { force: true, recursive: true }).then(() => undefined),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });

const statPath = (path: string): Effect.Effect<{ readonly size: number }, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });
