import { copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  ArchiveVerificationError,
  type CompressionAdapter,
  sha256Directory,
  writeVerifiedArchive,
} from './archiveWriter.js';

const copyCompression: CompressionAdapter = {
  compress: ({ sourcePath, archivePath }) =>
    Effect.promise(() => copyFile(sourcePath, archivePath)),
  decompress: ({ archivePath, restoredPath }) =>
    Effect.promise(() => copyFile(archivePath, restoredPath)),
};

const corruptCompression: CompressionAdapter = {
  compress: ({ sourcePath, archivePath }) =>
    Effect.promise(() => copyFile(sourcePath, archivePath)),
  decompress: ({ restoredPath }) => Effect.promise(() => writeFile(restoredPath, 'corrupt')),
};

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-archive-'));

describe('archive round trip', () => {
  it('writes an archive, verifies exact restore bytes, and keeps the original on dry run', async () => {
    const workspace = await createWorkspace();
    const sourcePath = join(workspace, 'session.jsonl');
    const archivePath = join(workspace, 'session.jsonl.zst');
    const restoredPath = join(workspace, 'restored-session.jsonl');
    const content = ['{"type":"user","text":"hello"}', '{"type":"assistant","text":"world"}'].join(
      '\n',
    );
    await writeFile(sourcePath, content);

    const archive = await Effect.runPromise(
      writeVerifiedArchive({
        sessionId: 'session-1',
        sourcePath,
        archivePath,
        restoredPath,
        apply: false,
        compression: copyCompression,
      }),
    );

    await expect(readFile(sourcePath, 'utf8')).resolves.toBe(content);
    await expect(readFile(restoredPath, 'utf8')).resolves.toBe(content);
    expect(archive.removedOriginal).toBe(false);
    expect(archive.sourceSha256).toBe(archive.restoredSha256);
    expect(archive.archiveBytes).toBeGreaterThan(0);
  });

  it('removes the original only after archive verification passes in apply mode', async () => {
    const workspace = await createWorkspace();
    const sourcePath = join(workspace, 'session.jsonl');
    const archivePath = join(workspace, 'session.jsonl.zst');
    const restoredPath = join(workspace, 'restored-session.jsonl');
    await writeFile(sourcePath, '{"type":"user","text":"apply"}\n');

    const archive = await Effect.runPromise(
      writeVerifiedArchive({
        sessionId: 'session-2',
        sourcePath,
        archivePath,
        restoredPath,
        apply: true,
        compression: copyCompression,
      }),
    );

    await expect(stat(sourcePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(archive.removedOriginal).toBe(true);
    expect(archive.sourceSha256).toBe(archive.restoredSha256);
  });

  it('keeps the original when restored bytes do not match', async () => {
    const workspace = await createWorkspace();
    const sourcePath = join(workspace, 'session.jsonl');
    const archivePath = join(workspace, 'session.jsonl.zst');
    const restoredPath = join(workspace, 'restored-session.jsonl');
    const content = '{"type":"user","text":"safe"}\n';
    await writeFile(sourcePath, content);

    const failure = await Effect.runPromise(
      Effect.either(
        writeVerifiedArchive({
          sessionId: 'session-3',
          sourcePath,
          archivePath,
          restoredPath,
          apply: true,
          compression: corruptCompression,
        }),
      ),
    );

    expect(Either.isLeft(failure)).toBe(true);
    if (Either.isRight(failure)) {
      expect.fail('expected archive verification to fail');
    }
    expect(failure.left).toBeInstanceOf(ArchiveVerificationError);
    await expect(readFile(sourcePath, 'utf8')).resolves.toBe(content);
  });

  it('archives a multi-file session directory and keeps the original on dry run', async () => {
    const workspace = await createWorkspace();
    const sourcePath = join(workspace, 'session-dir');
    const archivePath = join(workspace, 'session-dir.tar.zst');
    const restoredPath = join(workspace, 'restored-session-dir');
    await mkdir(join(sourcePath, 'terminal'), { recursive: true });
    await writeFile(join(sourcePath, 'summary.json'), '{"title":"dir session"}\n');
    await writeFile(join(sourcePath, 'updates.jsonl'), '{"type":"user","text":"hello"}\n');
    await writeFile(join(sourcePath, 'terminal', 'call.log'), 'log-bytes\n');

    const sourceSha256 = await Effect.runPromise(sha256Directory(sourcePath));
    const archive = await Effect.runPromise(
      writeVerifiedArchive({
        sessionId: 'session-dir-1',
        sourcePath,
        archivePath,
        restoredPath,
        apply: false,
        compression: copyCompression,
        sourceKind: 'directory',
      }),
    );

    const restoredSha256 = await Effect.runPromise(sha256Directory(restoredPath));
    expect(archive.sourceKind).toBe('directory');
    expect(archive.removedOriginal).toBe(false);
    expect(archive.sourceSha256).toBe(sourceSha256);
    expect(restoredSha256).toBe(sourceSha256);
    await expect(readFile(join(sourcePath, 'updates.jsonl'), 'utf8')).resolves.toContain('hello');
  });

  it('removes a session directory only after directory archive verification passes', async () => {
    const workspace = await createWorkspace();
    const sourcePath = join(workspace, 'session-dir-apply');
    const archivePath = join(workspace, 'session-dir-apply.tar.zst');
    const restoredPath = join(workspace, 'restored-session-dir-apply');
    await mkdir(sourcePath, { recursive: true });
    await writeFile(join(sourcePath, 'summary.json'), '{"title":"apply dir"}\n');
    await writeFile(join(sourcePath, 'updates.jsonl'), '{"type":"user","text":"apply"}\n');

    const archive = await Effect.runPromise(
      writeVerifiedArchive({
        sessionId: 'session-dir-2',
        sourcePath,
        archivePath,
        restoredPath,
        apply: true,
        compression: copyCompression,
        sourceKind: 'directory',
      }),
    );

    await expect(stat(sourcePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(archive.removedOriginal).toBe(true);
    expect(archive.sourceSha256).toBe(archive.restoredSha256);
  });
});
