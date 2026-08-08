import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { ArchiveFileSystemError, type CompressionAdapter } from './archiveWriter.js';

const ZSTD_BINARY = 'zstd';
const ZSTD_LEVEL_FLAG = '-9';
const ZSTD_LONG_WINDOW_FLAG = '--long=27';
const ZSTD_QUIET_FLAG = '-q';
const ZSTD_FORCE_FLAG = '-f';
const ZSTD_DECOMPRESS_FLAG = '-d';
const ZSTD_OUTPUT_FLAG = '-o';

const execFileAsync = promisify(execFile);

/**
 * Compression adapter backed by the system zstd binary.
 *
 * @returns Adapter used by production archive workflows.
 * @example
 * ```ts
 * import { createZstdCompression } from './archiveReader.js';
 *
 * const compression = createZstdCompression();
 * ```
 */
export const createZstdCompression = (): CompressionAdapter => ({
  compress: ({ sourcePath, archivePath }) =>
    Effect.tryPromise({
      try: () =>
        execFileAsync(ZSTD_BINARY, [
          ZSTD_LEVEL_FLAG,
          ZSTD_LONG_WINDOW_FLAG,
          ZSTD_QUIET_FLAG,
          ZSTD_FORCE_FLAG,
          sourcePath,
          ZSTD_OUTPUT_FLAG,
          archivePath,
        ]).then(() => undefined),
      catch: (cause) =>
        new ArchiveFileSystemError({
          path: sourcePath,
          message: String(cause),
        }),
    }),
  decompress: ({ archivePath, restoredPath }) =>
    Effect.tryPromise({
      try: () =>
        execFileAsync(ZSTD_BINARY, [
          ZSTD_DECOMPRESS_FLAG,
          ZSTD_QUIET_FLAG,
          ZSTD_FORCE_FLAG,
          archivePath,
          ZSTD_OUTPUT_FLAG,
          restoredPath,
        ]).then(() => undefined),
      catch: (cause) =>
        new ArchiveFileSystemError({
          path: archivePath,
          message: String(cause),
        }),
    }),
});
