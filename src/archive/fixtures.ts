import { copyFile, mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompressionAdapter } from '@/archive/writer.js';
import type { ProviderAdapter } from '@/session-model.js';

export const copyCompression: CompressionAdapter = {
  compress: ({ sourcePath: originPath, archivePath }) => copyFile(originPath, archivePath),
  decompress: ({ archivePath, restoredPath }) => copyFile(archivePath, restoredPath),
};

export type ArchiveProviderRequest = {
  readonly id: ProviderAdapter['id'];
  readonly mode: ProviderAdapter['mode'];
  readonly rootRelative: string;
  readonly discover: ProviderAdapter['discover'];
};

export const createArchiveProvider = (request: ArchiveProviderRequest): ProviderAdapter => ({
  id: request.id,
  label: request.id,
  mode: request.mode,
  defaultRoots: (home) => [join(home, request.rootRelative)],
  discover: request.discover,
});

export interface WriteColdSessionDetails {
  home: string;
  relativeDir: string;
  fileName: string;
  content: string;
  modifiedAt: Date;
}

export const writeColdSession = async ({
  home,
  relativeDir,
  fileName,
  content: sessionJsonl,
  modifiedAt,
}: WriteColdSessionDetails): Promise<{ readonly path: string; readonly content: string }> => {
  const sessionDir = join(home, relativeDir);
  const sessionPath = join(sessionDir, fileName);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionPath, sessionJsonl);
  await utimes(sessionPath, modifiedAt, modifiedAt);
  return {
    path: sessionPath,
    content: sessionJsonl,
  };
};

export const writeSessionDirectory = async (root: string): Promise<string> => {
  const originPath = join(root, 'session-dir');
  await mkdir(join(originPath, 'nested'), { recursive: true });
  await writeFile(join(originPath, 'summary.json'), '{"title":"dir session"}\n');
  await writeFile(join(originPath, 'updates.jsonl'), '{"type":"user","text":"hello"}\n');
  await writeFile(join(originPath, 'nested', 'call.log'), 'log-bytes\n');
  return originPath;
};
