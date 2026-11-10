import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyCompression, writeSessionDirectory } from './fixtures.js';
import { readSha256Directory } from './hash.js';
import {
  type CompressionAdapter,
  removeOriginalSession,
  restoreDirectoryArchive,
  writeVerifiedArchive,
} from './writer.js';

const corruptDirectoryCompression: CompressionAdapter = {
  compress: ({ sourcePath: originPath, archivePath }) => copyFile(originPath, archivePath),
  decompress: ({ restoredPath }) => writeFile(restoredPath, 'not-a-tar'),
};

const corruptCompression: CompressionAdapter = {
  compress: ({ sourcePath: originPath, archivePath }) => copyFile(originPath, archivePath),
  decompress: ({ restoredPath }) => writeFile(restoredPath, 'corrupt'),
};

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-archive-writer-'));

describe('archiveWriter', () => {
  it('removes original session files and directories after verification', async () => {
    const workspace = await createWorkspace();
    const filePath = join(workspace, 'remove-me.jsonl');
    await writeFile(filePath, '{"type":"user","text":"remove"}\n');
    const directoryPath = await writeSessionDirectory(workspace);

    await removeOriginalSession(filePath);
    await removeOriginalSession(directoryPath);

    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('throws when removing a missing original', async () => {
    const workspace = await createWorkspace();
    const missingPath = join(workspace, 'already-gone.jsonl');

    await expect(removeOriginalSession(missingPath)).rejects.toThrow(missingPath);
  });

  it('restores a directory archive to the original path after hash verification', async () => {
    const workspace = await createWorkspace();
    const originPath = await writeSessionDirectory(workspace);
    const archivePath = join(workspace, 'session-dir.tar.zst');
    const verifyPath = join(workspace, 'verify-session-dir');
    const restoreWorkPath = join(workspace, 'restore-session-dir');
    const originalPath = join(workspace, 'restored-original');

    const archive = await writeVerifiedArchive({
      sessionId: 'dir-restore-1',
      sourcePath: originPath,
      archivePath,
      restoredPath: verifyPath,
      apply: false,
      compression: copyCompression,
      sourceKind: 'directory',
    });

    await restoreDirectoryArchive({
      sessionId: 'dir-restore-1',
      archivePath,
      restoredPath: restoreWorkPath,
      originalPath,
      expectedSha256: archive.sourceSha256,
      compression: copyCompression,
    });

    const originalSha256 = await readSha256Directory(originalPath);
    expect(originalSha256).toBe(archive.sourceSha256);
    await expect(readFile(join(originalPath, 'updates.jsonl'), 'utf8')).resolves.toContain('hello');
    await expect(stat(restoreWorkPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('throws directory restore when hash does not match', async () => {
    const workspace = await createWorkspace();
    const originPath = await writeSessionDirectory(workspace);
    const archivePath = join(workspace, 'session-dir-bad.tar.zst');
    const verifyPath = join(workspace, 'verify-session-dir-bad');
    const restoreWorkPath = join(workspace, 'restore-session-dir-bad');
    const originalPath = join(workspace, 'restored-original-bad');

    const archive = await writeVerifiedArchive({
      sessionId: 'dir-restore-2',
      sourcePath: originPath,
      archivePath,
      restoredPath: verifyPath,
      apply: false,
      compression: copyCompression,
      sourceKind: 'directory',
    });

    await expect(
      restoreDirectoryArchive({
        sessionId: 'dir-restore-2',
        archivePath,
        restoredPath: restoreWorkPath,
        originalPath,
        expectedSha256: `${archive.sourceSha256.slice(0, -1)}0`,
        compression: copyCompression,
      }),
    ).rejects.toThrow('dir-restore-2');
  });

  it('throws writeVerifiedArchive when the source is missing', async () => {
    const workspace = await createWorkspace();
    const missingPath = join(workspace, 'missing-source.jsonl');
    const archivePath = join(workspace, 'missing-source.jsonl.zst');
    const restoredPath = join(workspace, 'missing-source.restored.jsonl');

    await expect(
      writeVerifiedArchive({
        sessionId: 'missing-source',
        sourcePath: missingPath,
        archivePath,
        restoredPath,
        apply: false,
        compression: copyCompression,
      }),
    ).rejects.toThrow(missingPath);
  });

  it('fails directory archive write when decompression produces a non-tar payload', async () => {
    const workspace = await createWorkspace();
    const originPath = await writeSessionDirectory(workspace);
    const archivePath = join(workspace, 'corrupt-dir.tar.zst');
    const restoredPath = join(workspace, 'corrupt-dir-restored');

    await expect(
      writeVerifiedArchive({
        sessionId: 'corrupt-dir',
        sourcePath: originPath,
        archivePath,
        restoredPath,
        apply: false,
        compression: corruptDirectoryCompression,
        sourceKind: 'directory',
      }),
    ).rejects.toThrow();
    await expect(stat(originPath)).resolves.toBeDefined();
    await rm(restoredPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('detects directory source kind from the filesystem when sourceKind is omitted', async () => {
    const workspace = await createWorkspace();
    const originPath = await writeSessionDirectory(workspace);
    const archivePath = join(workspace, 'auto-dir.tar.zst');
    const restoredPath = join(workspace, 'auto-dir-restored');

    const archive = await writeVerifiedArchive({
      sessionId: 'auto-dir',
      sourcePath: originPath,
      archivePath,
      restoredPath,
      apply: false,
      compression: copyCompression,
    });

    expect(archive.sourceKind).toBe('directory');
    expect(archive.removedOriginal).toBe(false);
    expect(archive.sourceSha256).toBe(archive.restoredSha256);
  });
});

describe('archive round trip', () => {
  it('writes an archive, verifies exact restore bytes, and keeps the original on dry run', async () => {
    const workspace = await createWorkspace();
    const originPath = join(workspace, 'session.jsonl');
    const archivePath = join(workspace, 'session.jsonl.zst');
    const restoredPath = join(workspace, 'restored-session.jsonl');
    const sessionJsonl = [
      '{"type":"user","text":"hello"}',
      '{"type":"assistant","text":"world"}',
    ].join('\n');
    await writeFile(originPath, sessionJsonl);

    const archive = await writeVerifiedArchive({
      sessionId: 'session-1',
      sourcePath: originPath,
      archivePath,
      restoredPath,
      apply: false,
      compression: copyCompression,
    });

    await expect(readFile(originPath, 'utf8')).resolves.toBe(sessionJsonl);
    await expect(readFile(restoredPath, 'utf8')).resolves.toBe(sessionJsonl);
    expect(archive.removedOriginal).toBe(false);
    expect(archive.sourceSha256).toBe(archive.restoredSha256);
    expect(archive.archiveBytes).toBeGreaterThan(0);
  });

  it('removes the original only after archive verification passes in apply mode', async () => {
    const workspace = await createWorkspace();
    const originPath = join(workspace, 'session.jsonl');
    const archivePath = join(workspace, 'session.jsonl.zst');
    const restoredPath = join(workspace, 'restored-session.jsonl');
    await writeFile(originPath, '{"type":"user","text":"apply"}\n');

    const archive = await writeVerifiedArchive({
      sessionId: 'session-2',
      sourcePath: originPath,
      archivePath,
      restoredPath,
      apply: true,
      compression: copyCompression,
    });

    await expect(stat(originPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(archive.removedOriginal).toBe(true);
    expect(archive.sourceSha256).toBe(archive.restoredSha256);
  });

  it('keeps the original when restored bytes do not match', async () => {
    const workspace = await createWorkspace();
    const originPath = join(workspace, 'session.jsonl');
    const archivePath = join(workspace, 'session.jsonl.zst');
    const restoredPath = join(workspace, 'restored-session.jsonl');
    const sessionJsonl = '{"type":"user","text":"safe"}\n';
    await writeFile(originPath, sessionJsonl);

    await expect(
      writeVerifiedArchive({
        sessionId: 'session-3',
        sourcePath: originPath,
        archivePath,
        restoredPath,
        apply: true,
        compression: corruptCompression,
      }),
    ).rejects.toThrow();
    await expect(readFile(originPath, 'utf8')).resolves.toBe(sessionJsonl);
  });

  it('archives a multi-file session directory and keeps the original on dry run', async () => {
    const workspace = await createWorkspace();
    const originPath = join(workspace, 'session-dir');
    const archivePath = join(workspace, 'session-dir.tar.zst');
    const restoredPath = join(workspace, 'restored-session-dir');
    await mkdir(join(originPath, 'terminal'), { recursive: true });
    await writeFile(join(originPath, 'summary.json'), '{"title":"dir session"}\n');
    await writeFile(join(originPath, 'updates.jsonl'), '{"type":"user","text":"hello"}\n');
    await writeFile(join(originPath, 'terminal', 'call.log'), 'log-bytes\n');

    const originSha256 = await readSha256Directory(originPath);
    const archive = await writeVerifiedArchive({
      sessionId: 'session-dir-1',
      sourcePath: originPath,
      archivePath,
      restoredPath,
      apply: false,
      compression: copyCompression,
      sourceKind: 'directory',
    });

    const restoredSha256 = await readSha256Directory(restoredPath);
    expect(archive.sourceKind).toBe('directory');
    expect(archive.removedOriginal).toBe(false);
    expect(archive.sourceSha256).toBe(originSha256);
    expect(restoredSha256).toBe(originSha256);
    await expect(readFile(join(originPath, 'updates.jsonl'), 'utf8')).resolves.toContain('hello');
  });

  it('removes a session directory only after directory archive verification passes', async () => {
    const workspace = await createWorkspace();
    const originPath = join(workspace, 'session-dir-apply');
    const archivePath = join(workspace, 'session-dir-apply.tar.zst');
    const restoredPath = join(workspace, 'restored-session-dir-apply');
    await mkdir(originPath, { recursive: true });
    await writeFile(join(originPath, 'summary.json'), '{"title":"apply dir"}\n');
    await writeFile(join(originPath, 'updates.jsonl'), '{"type":"user","text":"apply"}\n');

    const archive = await writeVerifiedArchive({
      sessionId: 'session-dir-2',
      sourcePath: originPath,
      archivePath,
      restoredPath,
      apply: true,
      compression: copyCompression,
      sourceKind: 'directory',
    });

    await expect(stat(originPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(archive.removedOriginal).toBe(true);
    expect(archive.sourceSha256).toBe(archive.restoredSha256);
  });
});
