import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompressionAdapter } from '../../core/archiveWriter.js';
import { writeSessionManifest } from '../../core/manifestStore.js';
import { runOpenCommand } from './openCommand.js';

const copyCompression: CompressionAdapter = {
  compress: ({ sourcePath, archivePath }) =>
    Effect.promise(() => copyFile(sourcePath, archivePath)),
  decompress: ({ archivePath, restoredPath }) =>
    Effect.promise(() => copyFile(archivePath, restoredPath)),
};

describe('open command', () => {
  const stdoutWrites: string[] = [];

  beforeEach(() => {
    stdoutWrites.length = 0;
    process.exitCode = undefined;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('auto-restores a packed session on open lookup', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-open-'));
    const vaultPath = join(home, '.agent-session-pack');
    const originalPath = join(home, '.codex', 'sessions', 'cold.jsonl');
    const archivePath = join(vaultPath, 'archives', 'codex', 'cold.jsonl.zst');
    const content = '{"type":"user","text":"open me"}\n';
    const sourceSha256 = createHash('sha256').update(content).digest('hex');

    await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
    await writeFile(archivePath, content);
    await Effect.runPromise(
      writeSessionManifest(join(vaultPath, 'manifests', 'codex', 'cold.json'), {
        sessionId: 'cold',
        provider: 'codex',
        title: 'open me',
        slug: 'open-me',
        originalPath,
        archivePath,
        sourceSha256,
        sourceBytes: Buffer.byteLength(content, 'utf8'),
        archiveBytes: Buffer.byteLength(content, 'utf8'),
        archivedAt: '2026-07-01T00:00:00.000Z',
        sourceKind: 'file',
      }),
    );

    await Effect.runPromise(
      runOpenCommand({
        home,
        vaultPath,
        provider: 'codex',
        session: 'cold',
        json: true,
        compression: copyCompression,
        now: new Date('2026-07-07T00:00:00.000Z'),
      }),
    );

    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'open',
      status: 'restored',
      sessionId: 'cold',
      originalPath,
    });
    await expect(readFile(originalPath, 'utf8')).resolves.toBe(content);
    await rm(home, { recursive: true, force: true });
  });
});
