import { copyFile, mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompressionAdapter } from '@/archive/writer.js';
import type { ProviderAdapter } from '@/session-model.js';

/**
 * Compression adapter for tests that copies bytes instead of compressing them.
 */
export const copyCompression: CompressionAdapter = {
  compress: ({ sourcePath, archivePath }) => copyFile(sourcePath, archivePath),
  decompress: ({ archivePath, restoredPath }) => copyFile(archivePath, restoredPath),
};

/**
 * Inputs for a test provider adapter rooted below home.
 */
export type ArchiveProviderRequest = {
  readonly id: ProviderAdapter['id'];
  readonly mode: ProviderAdapter['mode'];
  readonly rootRelative: string;
  readonly discover: ProviderAdapter['discover'];
};

/**
 * Builds a provider adapter whose sessions live below one home-relative root.
 *
 * @param request - Provider id, mode, home-relative root, and discover effect.
 * @returns Provider adapter for archive workflow tests.
 * @example
 * ```ts
 * import { createArchiveProvider } from './fixtures.js';
 *
 * const provider = createArchiveProvider({
 *   id: 'codex',
 *   mode: 'archive',
 *   rootRelative: '.codex/sessions',
 *   discover: async () => [],
 * });
 * ```
 */
export const createArchiveProvider = (request: ArchiveProviderRequest): ProviderAdapter => ({
  id: request.id,
  label: request.id,
  mode: request.mode,
  defaultRoots: (home) => [join(home, request.rootRelative)],
  discover: request.discover,
});

/**
 * Writes a session file below home and sets its modified time.
 *
 * @param home - Test home directory.
 * @param relativeDir - Session directory relative to home.
 * @param fileName - Session file name.
 * @param content - Session file content.
 * @param modifiedAt - Modified time to set on the file.
 * @returns Written session path and content.
 * @example
 * ```ts
 * import { writeColdSession } from './fixtures.js';
 *
 * const session = await writeColdSession(home, '.codex/sessions', 'cold.jsonl', '{}\n', coldDate);
 * ```
 */
export const writeColdSession = async (
  home: string,
  relativeDir: string,
  fileName: string,
  content: string,
  modifiedAt: Date,
): Promise<{ readonly path: string; readonly content: string }> => {
  const sessionDir = join(home, relativeDir);
  const sessionPath = join(sessionDir, fileName);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionPath, content);
  await utimes(sessionPath, modifiedAt, modifiedAt);
  return {
    path: sessionPath,
    content,
  };
};

/**
 * Writes a multi-file session directory with a nested file below root.
 *
 * @param root - Directory that receives `session-dir`.
 * @returns Path of the written session directory.
 * @example
 * ```ts
 * import { writeSessionDirectory } from './fixtures.js';
 *
 * const sessionPath = await writeSessionDirectory(workspace);
 * ```
 */
export const writeSessionDirectory = async (root: string): Promise<string> => {
  const sourcePath = join(root, 'session-dir');
  await mkdir(join(sourcePath, 'nested'), { recursive: true });
  await writeFile(join(sourcePath, 'summary.json'), '{"title":"dir session"}\n');
  await writeFile(join(sourcePath, 'updates.jsonl'), '{"type":"user","text":"hello"}\n');
  await writeFile(join(sourcePath, 'nested', 'call.log'), 'log-bytes\n');
  return sourcePath;
};
