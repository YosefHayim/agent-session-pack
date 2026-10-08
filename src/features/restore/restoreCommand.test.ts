import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompressionAdapter } from '../archive/archiveWriter.js';
import { writeSessionManifest } from '../archive/manifestStore.js';
import { runRestoreCommand } from './restoreCommand.js';

const copyCompression: CompressionAdapter = {
  compress: ({ sourcePath, archivePath }) =>
    Effect.promise(() => copyFile(sourcePath, archivePath)),
  decompress: ({ archivePath, restoredPath }) =>
    Effect.promise(() => copyFile(archivePath, restoredPath)),
};

describe('restore command', () => {
  const stdoutWrites: string[] = [];
  const stderrWrites: string[] = [];

  beforeEach(() => {
    stdoutWrites.length = 0;
    stderrWrites.length = 0;
    process.exitCode = undefined;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrWrites.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('exits with code 2 when selector is missing', async () => {
    await Effect.runPromise(
      runRestoreCommand({
        selector: undefined,
        provider: undefined,
        to: undefined,
        json: true,
        home: '/tmp/synthetic-home',
      }),
    );

    expect(stderrWrites.join('')).toContain(
      'Missing selector. Use agent-session-pack restore <selector>.',
    );
    expect(process.exitCode).toBe(2);
  });

  it('restores an archived session without requiring lifecycle enable', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-restore-cmd-'));
    const vaultPath = join(home, '.agent-session-pack');
    const originalPath = join(home, '.codex', 'sessions', 'cold.jsonl');
    const archivePath = join(vaultPath, 'archives', 'codex', 'cold.jsonl.zst');
    const content = '{"type":"user","text":"manual restore"}\n';
    const sourceSha256 = createHash('sha256').update(content).digest('hex');

    await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
    await writeFile(archivePath, content);
    await Effect.runPromise(
      writeSessionManifest(join(vaultPath, 'manifests', 'codex', 'cold.json'), {
        sessionId: 'cold',
        provider: 'codex',
        title: 'manual restore',
        slug: 'manual-restore',
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
      runRestoreCommand({
        home,
        vaultPath,
        selector: 'codex:cold',
        provider: undefined,
        to: 'original',
        json: true,
        compression: copyCompression,
      }),
    );

    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'restore',
      status: 'restored',
      sessionId: 'cold',
      provider: 'codex',
    });
    await expect(readFile(originalPath, 'utf8')).resolves.toBe(content);
    await rm(home, { recursive: true, force: true });
  });

  it('exposes citty metadata and flags', async () => {
    const { restoreCommand } = await import('./restoreCommand.js');
    expect(restoreCommand.meta).toMatchObject({
      name: 'restore',
    });
    expect(restoreCommand.args).toMatchObject({
      selector: { type: 'positional' },
      json: { type: 'boolean' },
    });
  });
});
