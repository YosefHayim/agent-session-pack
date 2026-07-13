import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Effect, Schema } from 'effect';

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
    };
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
 * Removes an original session file after verification has passed.
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
    try: () => rm(path, { force: false }),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });

const ensureParentDirectory = (path: string): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () => mkdir(dirname(path), { recursive: true }).then(() => undefined),
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
