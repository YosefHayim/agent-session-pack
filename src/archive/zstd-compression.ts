import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { throwWrappedError } from '@/rethrow-as-error.js';
import type { CompressionAdapter } from './writer.js';

const ZSTD_BINARY = 'zstd';
const ZSTD_QUIET_FLAG = '-q';
const ZSTD_FORCE_FLAG = '-f';
const ZSTD_TARGET_FILE_FLAG = '-o';

const execFileAsync = promisify(execFile);

export const createZstdCompression = (): CompressionAdapter => ({
  compress: async ({ sourcePath, archivePath }) => {
    const compressArgumentList = [
      '-9',
      '--long=27',
      ZSTD_QUIET_FLAG,
      ZSTD_FORCE_FLAG,
      sourcePath,
      ZSTD_TARGET_FILE_FLAG,
      archivePath,
    ];
    await execFileAsync(ZSTD_BINARY, compressArgumentList).catch(throwWrappedError);
  },
  decompress: async ({ archivePath, restoredPath }) => {
    const decompressArgumentList = [
      '-d',
      ZSTD_QUIET_FLAG,
      ZSTD_FORCE_FLAG,
      archivePath,
      ZSTD_TARGET_FILE_FLAG,
      restoredPath,
    ];
    await execFileAsync(ZSTD_BINARY, decompressArgumentList).catch(throwWrappedError);
  },
});
