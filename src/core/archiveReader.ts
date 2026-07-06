import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { ArchiveFileSystemError, type CompressionAdapter } from './archiveWriter.js';

const execFileAsync = promisify(execFile);

/**
 * Compression adapter backed by the system zstd binary.
 *
 * @returns Adapter used by production archive workflows.
 */
export const createZstdCompression = (): CompressionAdapter => ({
  compress: ({ sourcePath, archivePath }) =>
    Effect.tryPromise({
      try: () =>
        execFileAsync('zstd', ['-9', '--long=27', '-q', '-f', sourcePath, '-o', archivePath]).then(
          () => undefined,
        ),
      catch: (cause) =>
        new ArchiveFileSystemError({
          path: sourcePath,
          message: String(cause),
        }),
    }),
  decompress: ({ archivePath, restoredPath }) =>
    Effect.tryPromise({
      try: () =>
        execFileAsync('zstd', ['-d', '-q', '-f', archivePath, '-o', restoredPath]).then(
          () => undefined,
        ),
      catch: (cause) =>
        new ArchiveFileSystemError({
          path: archivePath,
          message: String(cause),
        }),
    }),
});
