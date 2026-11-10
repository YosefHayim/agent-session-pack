import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { throwWrappedError } from '@/rethrow-as-error.js';
import type { CompressionAdapter } from './writer.js';

const ZSTD_BINARY = 'zstd';
const ZSTD_LEVEL_FLAG = '-9';
const ZSTD_LONG_WINDOW_FLAG = '--long=27';
const ZSTD_QUIET_FLAG = '-q';
const ZSTD_FORCE_FLAG = '-f';
const ZSTD_DECOMPRESS_FLAG = '-d';
const ZSTD_TARGET_FILE_FLAG = '-o';

const execFileAsync = promisify(execFile);

/**
 * Compression adapter backed by the system zstd binary.
 *
 * @returns Adapter used by production archive workflows.
 * @example
 * ```ts
 * import { createZstdCompression } from './zstd-compression.js';
 *
 * const compression = createZstdCompression();
 * ```
 */
/**
 * Compression adapter backed by the system zstd binary.
 */
export const createZstdCompression = (): CompressionAdapter => ({
  compress: async ({ sourcePath, archivePath }) => {
    // Compress sourcePath to archivePath: zstd level 9, long window 27, quiet, force overwrite.
    const compressArgumentList = [
      ZSTD_LEVEL_FLAG,
      ZSTD_LONG_WINDOW_FLAG,
      ZSTD_QUIET_FLAG,
      ZSTD_FORCE_FLAG,
      sourcePath,
      ZSTD_TARGET_FILE_FLAG,
      archivePath,
    ];
    await execFileAsync(ZSTD_BINARY, compressArgumentList).catch(throwWrappedError);
  },
  decompress: async ({ archivePath, restoredPath }) => {
    // Decompress archivePath to restoredPath: quiet, force overwrite.
    const decompressArgumentList = [
      ZSTD_DECOMPRESS_FLAG,
      ZSTD_QUIET_FLAG,
      ZSTD_FORCE_FLAG,
      archivePath,
      ZSTD_TARGET_FILE_FLAG,
      restoredPath,
    ];
    await execFileAsync(ZSTD_BINARY, decompressArgumentList).catch(throwWrappedError);
  },
});
