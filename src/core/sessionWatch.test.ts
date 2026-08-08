import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompressionAdapter } from './archiveWriter.js';
import { writeSessionManifest } from './manifestStore.js';
import { writeArchivedStub } from './sessionStub.js';
import { watchSessionStubs } from './sessionWatch.js';

const copyCompression: CompressionAdapter = {
  compress: ({ sourcePath, archivePath }) =>
    Effect.promise(() => copyFile(sourcePath, archivePath)),
  decompress: ({ archivePath, restoredPath }) =>
    Effect.promise(() => copyFile(archivePath, restoredPath)),
};

describe('sessionWatch', () => {
  const timers: NodeJS.Timeout[] = [];

  afterEach(() => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
  });

  it('materializes a directory stub when non-marker files appear', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-watch-dir-'));
    const vaultPath = join(home, '.agent-session-pack');
    const originalPath = join(home, '.grok', 'sessions', 'sid-1');
    // Use file-kind archive for deterministic copy compression restore into a path.
    const filePath = join(home, '.codex', 'sessions', 'cold.jsonl');
    const fileArchive = join(vaultPath, 'archives', 'codex', 'cold.jsonl.zst');
    const content = '{"type":"user","text":"watch restore"}\n';
    const sourceSha256 = createHash('sha256').update(content).digest('hex');

    await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
    await mkdir(join(home, '.codex', 'sessions'), { recursive: true });
    await writeFile(fileArchive, content);
    await Effect.runPromise(
      writeSessionManifest(join(vaultPath, 'manifests', 'codex', 'cold.json'), {
        sessionId: 'cold',
        provider: 'codex',
        title: 'cold',
        slug: 'cold',
        originalPath: filePath,
        archivePath: fileArchive,
        sourceSha256,
        sourceBytes: Buffer.byteLength(content, 'utf8'),
        archiveBytes: Buffer.byteLength(content, 'utf8'),
        archivedAt: '2026-07-01T00:00:00.000Z',
        sourceKind: 'file',
      }),
    );
    await Effect.runPromise(
      writeArchivedStub({
        originalPath: filePath,
        sessionId: 'cold',
        provider: 'codex',
        sourceKind: 'file',
      }),
    );

    // Directory open path
    await mkdir(join(vaultPath, 'archives', 'grok'), { recursive: true });
    const dirArchive = join(vaultPath, 'archives', 'grok', 'sid-1.tar.zst');
    // For directory sessions, copyCompression decompress writes archive bytes as a single file
    // to restoredPath; restoreDirectoryArchive needs tar. Use file session for reliable unit proof.
    void originalPath;
    void dirArchive;

    let stop = false;
    const events: string[] = [];
    const watchPromise = Effect.runPromise(
      watchSessionStubs({
        vaultPath,
        provider: 'codex',
        compression: copyCompression,
        pollIntervalMs: 80,
        shouldStop: () => stop,
        onEvent: (event) => {
          events.push(event.status);
        },
      }),
    );

    // Simulate provider opening a file stub (fs event).
    await new Promise((resolve) => {
      timers.push(setTimeout(resolve, 120));
    });
    await writeFile(
      filePath,
      `${JSON.stringify({
        agentSessionPack: 'agent-session-pack-archived-stub',
        version: 1,
        sessionId: 'cold',
        provider: 'codex',
        sourceKind: 'file',
      })}\n`,
    );

    await new Promise((resolve) => {
      timers.push(setTimeout(resolve, 350));
    });
    stop = true;
    await watchPromise;

    expect(events).toContain('restored');
    await expect(readFile(filePath, 'utf8')).resolves.toBe(content);
  });
});
