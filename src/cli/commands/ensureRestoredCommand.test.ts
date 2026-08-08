import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompressionAdapter } from '../../core/archiveWriter.js';
import { writeSessionManifest } from '../../core/manifestStore.js';
import { writeSetupConfig } from '../../core/setupConfig.js';
import { runEnsureRestoredCommand } from './ensureRestoredCommand.js';

const copyCompression: CompressionAdapter = {
  compress: ({ sourcePath, archivePath }) =>
    Effect.promise(() => copyFile(sourcePath, archivePath)),
  decompress: ({ archivePath, restoredPath }) =>
    Effect.promise(() => copyFile(archivePath, restoredPath)),
};

describe('ensure-restored command', () => {
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

  it('exits 3 with JSON when restore-on-launch is disabled', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-ensure-disabled-'));
    const vaultPath = join(home, '.agent-session-pack');

    await Effect.runPromise(
      writeSetupConfig({
        home,
        config: {
          version: 1,
          providers: ['codex'],
          vaultPath,
          coldAfter: '7d',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
          restoreOnLaunch: false,
        },
      }),
    );

    await Effect.runPromise(
      runEnsureRestoredCommand({
        home,
        vaultPath,
        provider: 'codex',
        session: 'cold',
        json: true,
        compression: copyCompression,
      }),
    );

    expect(process.exitCode).toBe(3);
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'ensure-restored',
      status: 'lifecycle-disabled',
      restoreOnLaunchEnabled: false,
    });
    await rm(home, { recursive: true, force: true });
  });

  it('restores a missing archived session when lifecycle is enabled', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-ensure-restore-'));
    const vaultPath = join(home, '.agent-session-pack');
    const originalPath = join(home, '.codex', 'sessions', 'cold.jsonl');
    const archivePath = join(vaultPath, 'archives', 'codex', 'cold.jsonl.zst');
    const content = '{"type":"user","text":"ensure"}\n';
    const sourceSha256 = createHash('sha256').update(content).digest('hex');

    await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
    await writeFile(archivePath, content);
    await Effect.runPromise(
      writeSessionManifest(join(vaultPath, 'manifests', 'codex', 'cold.json'), {
        sessionId: 'cold',
        provider: 'codex',
        title: 'ensure',
        slug: 'ensure',
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
      writeSetupConfig({
        home,
        config: {
          version: 1,
          providers: ['codex'],
          vaultPath,
          coldAfter: '7d',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
          restoreOnLaunch: true,
        },
      }),
    );

    await Effect.runPromise(
      runEnsureRestoredCommand({
        home,
        vaultPath,
        provider: 'codex',
        session: 'cold',
        json: true,
        compression: copyCompression,
      }),
    );

    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'ensure-restored',
      status: 'restored',
      provider: 'codex',
      sessionId: 'cold',
      originalPath,
    });
    await expect(readFile(originalPath, 'utf8')).resolves.toBe(content);
    await rm(home, { recursive: true, force: true });
  });
});
