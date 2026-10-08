import { execFile } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { Effect, Schema } from 'effect';
import type { SessionSourceKind } from '../../shared/sessionModel.js';
import {
  ArchiveFileSystemError,
  directorySizeBytes,
  ensureDirectory,
  ensureParentDirectory,
  removePath,
  resolveSourceKind,
  statPath,
} from './archiveFileSystem.js';
import { sha256Directory, sha256File } from './archiveHash.js';

const TAR_BINARY = 'tar';

const TAR_CREATE_FLAG = '-c';

const TAR_EXTRACT_FLAG = '-x';

const TAR_FILE_FLAG = '-f';

const TAR_CHANGE_DIR_FLAG = '-C';

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
 * import { createZstdCompression } from './zstdCompression.js';
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
 * import { createZstdCompression } from './zstdCompression.js';
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

const createTarArchive = (request: {
  readonly sourcePath: string;
  readonly tarPath: string;
}): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(request.tarPath), { recursive: true });
      // Pack sourcePath into tarPath: create archive from parent so the leaf name is the top entry.
      const createTarArgs = [
        TAR_CREATE_FLAG,
        TAR_FILE_FLAG,
        request.tarPath,
        TAR_CHANGE_DIR_FLAG,
        dirname(request.sourcePath),
        basename(request.sourcePath),
      ];
      await execFileAsync(TAR_BINARY, createTarArgs);
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
      // Extract tarPath into extractRoot: unpack archive contents under the staging directory.
      const extractTarArgs = [
        TAR_EXTRACT_FLAG,
        TAR_FILE_FLAG,
        request.tarPath,
        TAR_CHANGE_DIR_FLAG,
        extractRoot,
      ];
      await execFileAsync(TAR_BINARY, extractTarArgs);

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
