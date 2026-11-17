import { copyFile, mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompressionAdapter } from '@/archive/writer.js';
import type { ProviderAdapter } from '@/session-model.js';

function copyOriginToArchive(request: {
  uncompressedPath: string;
  archivePath: string;
}): Promise<void> {
  return copyFile(request.uncompressedPath, request.archivePath);
}

function copyArchiveToRestored(request: {
  archivePath: string;
  restoredPath: string;
}): Promise<void> {
  return copyFile(request.archivePath, request.restoredPath);
}

export const copyCompression: CompressionAdapter = {
  compress: copyOriginToArchive,
  decompress: copyArchiveToRestored,
};

export interface ArchiveProviderRequest {
  readonly id: ProviderAdapter['id'];
  readonly mode: ProviderAdapter['mode'];
  readonly rootRelative: string;
  readonly discover: ProviderAdapter['discover'];
}

export function createArchiveProvider(request: ArchiveProviderRequest): ProviderAdapter {
  function listDefaultRoots(home: string): string[] {
    return [join(home, request.rootRelative)];
  }

  return {
    id: request.id,
    label: request.id,
    mode: request.mode,
    defaultRoots: listDefaultRoots,
    discover: request.discover,
  };
}

export interface WriteColdSessionDetails {
  home: string;
  relativeDir: string;
  fileName: string;
  sessionJsonl: string;
  modifiedAt: Date;
}

export async function writeColdSession({
  home,
  relativeDir,
  fileName,
  sessionJsonl,
  modifiedAt,
}: WriteColdSessionDetails): Promise<{ readonly path: string; readonly sessionJsonl: string }> {
  const sessionDir = join(home, relativeDir);
  const sessionPath = join(sessionDir, fileName);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionPath, sessionJsonl);
  await utimes(sessionPath, modifiedAt, modifiedAt);

  return {
    path: sessionPath,
    sessionJsonl,
  };
}

export async function writeSessionDirectory(root: string): Promise<string> {
  const originPath = join(root, 'session-dir');
  await mkdir(join(originPath, 'nested'), { recursive: true });
  await writeFile(join(originPath, 'summary.json'), '{"title":"dir session"}\n');
  await writeFile(join(originPath, 'updates.jsonl'), '{"type":"user","text":"hello"}\n');
  await writeFile(join(originPath, 'nested', 'call.log'), 'log-bytes\n');
  return originPath;
}
