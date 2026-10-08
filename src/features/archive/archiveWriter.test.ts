import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { copyCompression, writeSessionDirectory } from '../../../tests/archiveFixtures.js';
import { ArchiveFileSystemError } from './archiveFileSystem.js';
import { sha256Directory } from './archiveHash.js';
import {
  ArchiveVerificationError,
  type CompressionAdapter,
  removeOriginalSession,
  restoreDirectoryArchive,
  writeVerifiedArchive,
} from './archiveWriter.js';

const corruptDirectoryCompression: CompressionAdapter = {
  compress: ({ sourcePath, archivePath }) =>
    Effect.promise(() => copyFile(sourcePath, archivePath)),
  decompress: ({ restoredPath }) => Effect.promise(() => writeFile(restoredPath, 'not-a-tar')),
};

const corruptCompression: CompressionAdapter = {
  compress: ({ sourcePath, archivePath }) =>
    Effect.promise(() => copyFile(sourcePath, archivePath)),
  decompress: ({ restoredPath }) => Effect.promise(() => writeFile(restoredPath, 'corrupt')),
};

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-archive-writer-'));

describe('archiveWriter', () => {
  it('removes original session files and directories after verification', async () => {
    const workspace = await createWorkspace();
    const filePath = join(workspace, 'remove-me.jsonl');
    await writeFile(filePath, '{"type":"user","text":"remove"}\n');
    const directoryPath = await writeSessionDirectory(workspace);

    await Effect.runPromise(removeOriginalSession(filePath));
    await Effect.runPromise(removeOriginalSession(directoryPath));

    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns ArchiveFileSystemError when removing a missing original', async () => {
    const workspace = await createWorkspace();
    const missingPath = join(workspace, 'already-gone.jsonl');

    const result = await Effect.runPromise(Effect.either(removeOriginalSession(missingPath)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) {
      expect.fail('expected removeOriginalSession to fail for a missing path');
    }
    expect(result.left).toBeInstanceOf(ArchiveFileSystemError);
    expect(result.left).toMatchObject({
      _tag: 'ArchiveFileSystemError',
      path: missingPath,
    });
  });

  it('restores a directory archive to the original path after hash verification', async () => {
    const workspace = await createWorkspace();
    const sourcePath = await writeSessionDirectory(workspace);
    const archivePath = join(workspace, 'session-dir.tar.zst');
    const verifyPath = join(workspace, 'verify-session-dir');
    const restoreWorkPath = join(workspace, 'restore-session-dir');
    const originalPath = join(workspace, 'restored-original');

    const archive = await Effect.runPromise(
      writeVerifiedArchive({
        sessionId: 'dir-restore-1',
        sourcePath,
        archivePath,
        restoredPath: verifyPath,
        apply: false,
        compression: copyCompression,
        sourceKind: 'directory',
      }),
    );

    await Effect.runPromise(
      restoreDirectoryArchive({
        sessionId: 'dir-restore-1',
        archivePath,
        restoredPath: restoreWorkPath,
        originalPath,
        expectedSha256: archive.sourceSha256,
        compression: copyCompression,
      }),
    );

    const originalSha256 = await Effect.runPromise(sha256Directory(originalPath));
    expect(originalSha256).toBe(archive.sourceSha256);
    await expect(readFile(join(originalPath, 'updates.jsonl'), 'utf8')).resolves.toContain('hello');
    await expect(stat(restoreWorkPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails directory restore with ArchiveVerificationError when hash does not match', async () => {
    const workspace = await createWorkspace();
    const sourcePath = await writeSessionDirectory(workspace);
    const archivePath = join(workspace, 'session-dir-bad.tar.zst');
    const verifyPath = join(workspace, 'verify-session-dir-bad');
    const restoreWorkPath = join(workspace, 'restore-session-dir-bad');
    const originalPath = join(workspace, 'restored-original-bad');

    const archive = await Effect.runPromise(
      writeVerifiedArchive({
        sessionId: 'dir-restore-2',
        sourcePath,
        archivePath,
        restoredPath: verifyPath,
        apply: false,
        compression: copyCompression,
        sourceKind: 'directory',
      }),
    );

    const result = await Effect.runPromise(
      Effect.either(
        restoreDirectoryArchive({
          sessionId: 'dir-restore-2',
          archivePath,
          restoredPath: restoreWorkPath,
          originalPath,
          expectedSha256: `${archive.sourceSha256.slice(0, -1)}0`,
          compression: copyCompression,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) {
      expect.fail('expected restoreDirectoryArchive to fail verification');
    }
    expect(result.left).toBeInstanceOf(ArchiveVerificationError);
    expect(result.left).toMatchObject({
      _tag: 'ArchiveVerificationError',
      sessionId: 'dir-restore-2',
    });
  });

  it('fails writeVerifiedArchive with ArchiveFileSystemError when the source is missing', async () => {
    const workspace = await createWorkspace();
    const missingPath = join(workspace, 'missing-source.jsonl');
    const archivePath = join(workspace, 'missing-source.jsonl.zst');
    const restoredPath = join(workspace, 'missing-source.restored.jsonl');

    const result = await Effect.runPromise(
      Effect.either(
        writeVerifiedArchive({
          sessionId: 'missing-source',
          sourcePath: missingPath,
          archivePath,
          restoredPath,
          apply: false,
          compression: copyCompression,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) {
      expect.fail('expected writeVerifiedArchive to fail for a missing source');
    }
    expect(result.left).toBeInstanceOf(ArchiveFileSystemError);
    expect(result.left).toMatchObject({
      _tag: 'ArchiveFileSystemError',
      path: missingPath,
    });
  });

  it('fails directory archive write when decompression produces a non-tar payload', async () => {
    const workspace = await createWorkspace();
    const sourcePath = await writeSessionDirectory(workspace);
    const archivePath = join(workspace, 'corrupt-dir.tar.zst');
    const restoredPath = join(workspace, 'corrupt-dir-restored');

    const result = await Effect.runPromise(
      Effect.either(
        writeVerifiedArchive({
          sessionId: 'corrupt-dir',
          sourcePath,
          archivePath,
          restoredPath,
          apply: false,
          compression: corruptDirectoryCompression,
          sourceKind: 'directory',
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) {
      expect.fail('expected directory archive write to fail for corrupt compression');
    }
    expect(result.left).toBeInstanceOf(ArchiveFileSystemError);
    expect(result.left).toMatchObject({
      _tag: 'ArchiveFileSystemError',
    });
    await expect(stat(sourcePath)).resolves.toBeDefined();
    await rm(restoredPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('detects directory source kind from the filesystem when sourceKind is omitted', async () => {
    const workspace = await createWorkspace();
    const sourcePath = await writeSessionDirectory(workspace);
    const archivePath = join(workspace, 'auto-dir.tar.zst');
    const restoredPath = join(workspace, 'auto-dir-restored');

    const archive = await Effect.runPromise(
      writeVerifiedArchive({
        sessionId: 'auto-dir',
        sourcePath,
        archivePath,
        restoredPath,
        apply: false,
        compression: copyCompression,
      }),
    );

    expect(archive.sourceKind).toBe('directory');
    expect(archive.removedOriginal).toBe(false);
    expect(archive.sourceSha256).toBe(archive.restoredSha256);
  });
});

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
