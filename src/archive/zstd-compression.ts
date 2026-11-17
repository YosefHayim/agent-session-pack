import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CompressionAdapter } from './writer.js';

const ZSTD_BINARY = 'zstd';
const ZSTD_QUIET_FLAG = '-q';
const ZSTD_FORCE_FLAG = '-f';
const ZSTD_TARGET_FILE_FLAG = '-o';

const execFileAsync = promisify(execFile);

async function runZstd(argumentList: string[]): Promise<void> {
  try {
    await execFileAsync(ZSTD_BINARY, argumentList);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

export function createZstdCompression(): CompressionAdapter {
  async function compress(request: {
    uncompressedPath: string;
    archivePath: string;
  }): Promise<void> {
    const compressArgumentList = [
      '-9',
      '--long=27',
      ZSTD_QUIET_FLAG,
      ZSTD_FORCE_FLAG,
      request.uncompressedPath,
      ZSTD_TARGET_FILE_FLAG,
      request.archivePath,
    ];
    await runZstd(compressArgumentList);
  }

  async function decompress(request: { archivePath: string; restoredPath: string }): Promise<void> {
    const decompressArgumentList = [
      '-d',
      ZSTD_QUIET_FLAG,
      ZSTD_FORCE_FLAG,
      request.archivePath,
      ZSTD_TARGET_FILE_FLAG,
      request.restoredPath,
    ];
    await runZstd(decompressArgumentList);
  }

  return { compress, decompress };
}
