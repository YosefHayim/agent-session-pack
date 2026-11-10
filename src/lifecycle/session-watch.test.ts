import { createHash } from 'node:crypto';
import type * as NodeFs from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyCompression } from '@/archive/fixtures.js';
import { writeSessionManifest } from '@/archive/manifest-store.js';
import { writeArchivedStub } from '@/archive/session-stub.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { watchSessionStubs } from './session-watch.js';

const archivedStubDocument = `${JSON.stringify({
  agentSessionPack: 'agent-session-pack-archived-stub',
  version: 1,
  sessionId: 'cold',
  provider: 'codex',
  sourceKind: 'file',
})}\n`;

const watchListeners = vi.hoisted(() => new Map<string, () => void>());

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();

  return {
    ...actual,
    watch: (path: string, settings: NodeFs.WatchOptions, listener: () => void) => {
      watchListeners.set(path, listener);
      return actual.watch(path, settings, listener);
    },
  };
});

type WatchRun = {
  readonly events: string[];
  readonly stop: () => Promise<void>;
};

const writeArchivedCodexStub = async (
  home: string,
): Promise<{ readonly vaultPath: string; readonly filePath: string; readonly content: string }> => {
  const vaultPath = join(home, '.agent-session-pack');
  const filePath = join(home, '.codex', 'sessions', 'cold.jsonl');
  const archivePath = join(vaultPath, 'archives', 'codex', 'cold.jsonl.zst');
  const sessionJsonl = '{"type":"user","text":"watch restore"}\n';

  await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
  await mkdir(join(home, '.codex', 'sessions'), { recursive: true });
  await writeFile(archivePath, sessionJsonl);
  await writeSessionManifest(join(vaultPath, 'manifests', 'codex', 'cold.json'), {
    sessionId: 'cold',
    provider: 'codex',
    title: 'cold',
    slug: 'cold',
    originalPath: filePath,
    archivePath,
    sourceSha256: createHash('sha256').update(sessionJsonl).digest('hex'),
    sourceBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
    archiveBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
    archivedAt: '2026-07-01T00:00:00.000Z',
    sourceKind: 'file',
  });
  await writeArchivedStub({
    originalPath: filePath,
    sessionId: 'cold',
    provider: 'codex',
    sourceKind: 'file',
  });

  return { vaultPath, filePath, content: sessionJsonl };
};

const startCodexWatch = (vaultPath: string, compression: CompressionAdapter): WatchRun => {
  const control = { stopped: false };
  const events: string[] = [];
  const watchPromise = watchSessionStubs({
    vaultPath,
    provider: 'codex',
    compression,
    pollIntervalMs: 80,
    shouldStop: () => control.stopped,
    onEvent: (event) => {
      events.push(event.status);
    },
  });

  return {
    events,
    stop: () => {
      control.stopped = true;
      return watchPromise;
    },
  };
};

describe('sessionWatch', () => {
  const timers: NodeJS.Timeout[] = [];

  const wait = (ms: number): Promise<void> =>
    new Promise((done) => {
      timers.push(setTimeout(done, ms));
    });

  afterEach(() => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.length = 0;
    watchListeners.clear();
  });

  it('materializes a file stub when the provider opens it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-watch-file-'));
    const session = await writeArchivedCodexStub(home);
    const watchRun = startCodexWatch(session.vaultPath, copyCompression);

    await wait(120);
    await writeFile(session.filePath, archivedStubDocument);
    await wait(350);
    await watchRun.stop();

    expect(watchRun.events).toContain('restored');
    await expect(readFile(session.filePath, 'utf8')).resolves.toBe(session.content);
  });

  it('restores once when several fs events arrive for the same stub', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-watch-burst-'));
    const session = await writeArchivedCodexStub(home);
    const decompressedPaths: string[] = [];
    const countingCompression: CompressionAdapter = {
      compress: copyCompression.compress,
      decompress: async ({ archivePath, restoredPath }) => {
        decompressedPaths.push(restoredPath);
        await copyFile(archivePath, restoredPath);
      },
    };
    const watchRun = startCodexWatch(session.vaultPath, countingCompression);

    await wait(120);
    const stubListener = watchListeners.get(session.filePath);
    stubListener?.();
    stubListener?.();
    await wait(350);
    await watchRun.stop();

    expect(stubListener).toBeDefined();
    expect(decompressedPaths).toHaveLength(1);
    expect(watchRun.events).toEqual(['restored']);
    await expect(readFile(session.filePath, 'utf8')).resolves.toBe(session.content);
  });
});
