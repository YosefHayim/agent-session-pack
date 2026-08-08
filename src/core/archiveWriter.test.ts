import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  ArchiveFileSystemError,
  ArchiveVerificationError,
  type CompressionAdapter,
  measureSourceBytes,
  removeOriginalSession,
  restoreDirectoryArchive,
  sha256Directory,
  sha256File,
  sha256Path,
  writeVerifiedArchive,
} from './archiveWriter.js';

const copyCompression: CompressionAdapter = {
  compress: ({ sourcePath, archivePath }) =>
    Effect.promise(() => copyFile(sourcePath, archivePath)),
  decompress: ({ archivePath, restoredPath }) =>
    Effect.promise(() => copyFile(archivePath, restoredPath)),
};

const corruptDirectoryCompression: CompressionAdapter = {
  compress: ({ sourcePath, archivePath }) =>
    Effect.promise(() => copyFile(sourcePath, archivePath)),
  decompress: ({ restoredPath }) => Effect.promise(() => writeFile(restoredPath, 'not-a-tar')),
};

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-archive-writer-'));

const writeSessionDirectory = async (root: string): Promise<string> => {
  const sourcePath = join(root, 'session-dir');
  await mkdir(join(sourcePath, 'nested'), { recursive: true });
  await writeFile(join(sourcePath, 'summary.json'), '{"title":"dir session"}\n');
  await writeFile(join(sourcePath, 'updates.jsonl'), '{"type":"user","text":"hello"}\n');
  await writeFile(join(sourcePath, 'nested', 'call.log'), 'log-bytes\n');
  return sourcePath;
};

describe('archiveWriter helpers and edge paths', () => {
  it('measures source bytes for a single file and a directory tree', async () => {
    const workspace = await createWorkspace();
    const filePath = join(workspace, 'session.jsonl');
    const fileContent = '{"type":"user","text":"measure"}\n';
    await writeFile(filePath, fileContent);

    const directoryPath = await writeSessionDirectory(workspace);

    const fileBytes = await Effect.runPromise(measureSourceBytes(filePath, 'file'));
    const directoryBytes = await Effect.runPromise(measureSourceBytes(directoryPath, 'directory'));
    const autoFileBytes = await Effect.runPromise(measureSourceBytes(filePath));
    const autoDirectoryBytes = await Effect.runPromise(measureSourceBytes(directoryPath));

    expect(fileBytes).toBe(Buffer.byteLength(fileContent, 'utf8'));
    expect(autoFileBytes).toBe(fileBytes);
    expect(directoryBytes).toBeGreaterThan(0);
    expect(autoDirectoryBytes).toBe(directoryBytes);
  });

  it('returns ArchiveFileSystemError when measuring a missing path', async () => {
    const workspace = await createWorkspace();
    const missingPath = join(workspace, 'missing.jsonl');

    const result = await Effect.runPromise(Effect.either(measureSourceBytes(missingPath)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) {
      expect.fail('expected measureSourceBytes to fail for a missing path');
    }
    expect(result.left).toBeInstanceOf(ArchiveFileSystemError);
    expect(result.left).toMatchObject({
      _tag: 'ArchiveFileSystemError',
      path: missingPath,
    });
  });

  it('hashes files and directories through sha256Path', async () => {
    const workspace = await createWorkspace();
    const filePath = join(workspace, 'session.jsonl');
    await writeFile(filePath, '{"type":"user","text":"hash"}\n');
    const directoryPath = await writeSessionDirectory(workspace);

    const fileDigest = await Effect.runPromise(sha256File(filePath));
    const directoryDigest = await Effect.runPromise(sha256Directory(directoryPath));
    const pathFileDigest = await Effect.runPromise(sha256Path(filePath, 'file'));
    const pathDirectoryDigest = await Effect.runPromise(sha256Path(directoryPath, 'directory'));
    const autoDirectoryDigest = await Effect.runPromise(sha256Path(directoryPath));

    expect(pathFileDigest).toBe(fileDigest);
    expect(pathDirectoryDigest).toBe(directoryDigest);
    expect(autoDirectoryDigest).toBe(directoryDigest);
  });

  it('returns ArchiveFileSystemError when hashing a missing file', async () => {
    const workspace = await createWorkspace();
    const missingPath = join(workspace, 'missing.jsonl');

    const result = await Effect.runPromise(Effect.either(sha256File(missingPath)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) {
      expect.fail('expected sha256File to fail for a missing path');
    }
    expect(result.left).toBeInstanceOf(ArchiveFileSystemError);
    expect(result.left).toMatchObject({
      _tag: 'ArchiveFileSystemError',
      path: missingPath,
    });
  });

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
