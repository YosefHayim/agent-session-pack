import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVED_STUB_KIND,
  type CompressionAdapter,
  copyCompression,
  createDefaultVaultPath,
  createZstdCompression,
  isArchivedStubPath,
  isDirectoryStubOpened,
  listSessionManifestPaths,
  measureOriginBytes,
  readSessionManifest,
  readSha256Directory,
  readSha256File,
  readSha256Path,
  removeOriginalSession,
  restoreDirectoryArchive,
  type SessionManifest,
  writeArchivedStub,
  writeSessionDirectory,
  writeSessionManifest,
  writeVerifiedArchive,
} from './archive.js';

function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-archive-file-system-'));
}

describe('archiveFileSystem', () => {
  it('measures source bytes for a single file and a directory tree', async () => {
    const workspace = await createWorkspace();
    const filePath = join(workspace, 'session.jsonl');
    const fileString = '{"type":"user","text":"measure"}\n';
    await writeFile(filePath, fileString);

    const directoryPath = await writeSessionDirectory(workspace);

    const fileBytes = await measureOriginBytes(filePath, 'file');
    const directoryBytes = await measureOriginBytes(directoryPath, 'directory');
    const autoFileBytes = await measureOriginBytes(filePath);
    const autoDirectoryBytes = await measureOriginBytes(directoryPath);

    expect(fileBytes).toBe(Buffer.byteLength(fileString, 'utf8'));
    expect(autoFileBytes).toBe(fileBytes);
    expect(directoryBytes).toBeGreaterThan(0);
    expect(autoDirectoryBytes).toBe(directoryBytes);
  });

  it('throws when measuring a missing path', async () => {
    const workspace = await createWorkspace();
    const missingPath = join(workspace, 'missing.jsonl');

    await expect(measureOriginBytes(missingPath)).rejects.toThrow(missingPath);
  });
});

function createWorkspaceHash(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-archive-hash-'));
}

describe('archiveHash', () => {
  it('hashes files and directories through sha256Path', async () => {
    const workspace = await createWorkspaceHash();
    const filePath = join(workspace, 'session.jsonl');
    await writeFile(filePath, '{"type":"user","text":"hash"}\n');
    const directoryPath = await writeSessionDirectory(workspace);

    const fileDigest = await readSha256File(filePath);
    const directoryDigest = await readSha256Directory(directoryPath);
    const pathFileDigest = await readSha256Path(filePath, 'file');
    const pathDirectoryDigest = await readSha256Path(directoryPath, 'directory');
    const autoDirectoryDigest = await readSha256Path(directoryPath);

    expect(pathFileDigest).toBe(fileDigest);
    expect(pathDirectoryDigest).toBe(directoryDigest);
    expect(autoDirectoryDigest).toBe(directoryDigest);
  });

  it('throws when hashing a missing file', async () => {
    const workspace = await createWorkspaceHash();
    const missingPath = join(workspace, 'missing.jsonl');

    await expect(readSha256File(missingPath)).rejects.toThrow(missingPath);
  });
});

describe('session stubs', () => {
  it('writes and detects file stubs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asp-stub-file-'));
    const originalPath = join(root, 'session.jsonl');

    await writeArchivedStub({
      originalPath,
      sessionId: 's1',
      provider: 'codex',
      sourceKind: 'file',
    });

    await expect(readFile(originalPath, 'utf8')).resolves.toContain(ARCHIVED_STUB_KIND);
    await expect(isArchivedStubPath(originalPath, 'file')).resolves.toBe(true);
  });

  it('writes directory stubs and detects open activity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asp-stub-dir-'));
    const originalPath = join(root, 'session-dir');

    await writeArchivedStub({
      originalPath,
      sessionId: 's2',
      provider: 'grok',
      sourceKind: 'directory',
    });

    await expect(isArchivedStubPath(originalPath, 'directory')).resolves.toBe(true);
    await expect(isDirectoryStubOpened(originalPath)).resolves.toBe(false);

    await mkdir(originalPath, { recursive: true });
    await writeFile(join(originalPath, 'chat_history.jsonl'), 'x\n');
    await expect(isDirectoryStubOpened(originalPath)).resolves.toBe(true);
  });
});

describe('vaultPaths', () => {
  it('resolves the default vault path under the home directory', () => {
    expect(createDefaultVaultPath('/Users/synthetic')).toBe(
      join('/Users/synthetic', '.agent-session-pack'),
    );
  });
});

function createWorkspaceManifestStore(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-manifest-'));
}

function sampleManifest(overrides: Partial<SessionManifest> = {}): SessionManifest {
  return {
    sessionId: 'session-1',
    provider: 'codex',
    title: 'Pack cold sessions',
    slug: 'pack-cold-sessions',
    originalPath: '/tmp/synthetic/session-1.jsonl',
    archivePath: '/tmp/synthetic/session-1.jsonl.zst',
    sourceSha256: 'abc123',
    sourceBytes: 128,
    archiveBytes: 40,
    archivedAt: '2026-07-06T12:00:00.000Z',
    sourceKind: 'file',
    ...overrides,
  };
}

describe('manifestStore', () => {
  it('writes and reads a session manifest with optional fields', async () => {
    const workspace = await createWorkspaceManifestStore();
    const manifestPath = join(workspace, 'manifests', 'codex', 'session-1.json');
    const manifest = sampleManifest({
      sourceKind: 'directory',
      archiveBytes: 99,
    });

    await writeSessionManifest(manifestPath, manifest);
    const decoded = await readSessionManifest(manifestPath);

    expect(decoded).toEqual(manifest);
  });

  it('lists nested manifest JSON paths and ignores non-json files', async () => {
    const workspace = await createWorkspaceManifestStore();
    const root = join(workspace, 'manifests');
    const codexPath = join(root, 'codex', 'session-a.json');
    const claudePath = join(root, 'claude', 'nested', 'session-b.json');
    const ignored = join(root, 'codex', 'notes.txt');

    await writeSessionManifest(codexPath, sampleManifest({ sessionId: 'a' }));
    await writeSessionManifest(
      claudePath,
      sampleManifest({
        sessionId: 'b',
        provider: 'claude',
      }),
    );
    await mkdir(join(root, 'codex'), { recursive: true });
    await writeFile(ignored, 'not a manifest');

    const paths = await listSessionManifestPaths(root);

    expect(paths).toHaveLength(2);
    expect(paths).toEqual(expect.arrayContaining([codexPath, claudePath]));
    expect(paths).not.toContain(ignored);
  });

  it('returns an empty list when the manifest root is missing', async () => {
    const workspace = await createWorkspaceManifestStore();
    const missingRoot = join(workspace, 'does-not-exist');

    const paths = await listSessionManifestPaths(missingRoot);

    expect(paths).toEqual([]);
  });

  it('throws when reading a missing manifest', async () => {
    const workspace = await createWorkspaceManifestStore();
    const missingPath = join(workspace, 'missing.json');

    await expect(readSessionManifest(missingPath)).rejects.toThrow(missingPath);
  });

  it('throws when a required field is missing and leaves the session file alone', async () => {
    const workspace = await createWorkspaceManifestStore();
    const originalPath = join(workspace, 'session.jsonl');
    const badPath = join(workspace, 'missing-title.json');
    const sessionJsonl = 'original-bytes\n';
    await writeFile(originalPath, sessionJsonl);
    await writeFile(
      badPath,
      `${JSON.stringify({
        sessionId: 'session-1',
        provider: 'codex',
        slug: 'pack',
        originalPath,
        archivePath: join(workspace, 'missing.zst'),
        sourceSha256: 'abc',
        sourceBytes: 1,
        archivedAt: '2026-07-06T12:00:00.000Z',
      })}\n`,
    );

    await expect(readSessionManifest(badPath)).rejects.toSatisfy((error: unknown) => {
      const isError = error instanceof Error;

      if (!isError) {
        return false;
      }

      const cause = error.cause;
      const isCauseError = cause instanceof Error;

      if (!isCauseError) {
        return false;
      }

      return cause.message.includes('title');
    });
    await expect(readFile(originalPath, 'utf8')).resolves.toBe(sessionJsonl);
  });

  it('throws when the manifest JSON is invalid', async () => {
    const workspace = await createWorkspaceManifestStore();
    const badPath = join(workspace, 'bad.json');
    await writeFile(badPath, '{"sessionId":123}\n');

    await expect(readSessionManifest(badPath)).rejects.toThrow(badPath);
  });

  it('throws when writing to an unwritable path', async () => {
    const workspace = await createWorkspaceManifestStore();
    const blockedParent = join(workspace, 'blocked');
    await writeFile(blockedParent, 'I am a file, not a directory');
    const destination = join(blockedParent, 'child', 'manifest.json');

    await expect(writeSessionManifest(destination, sampleManifest())).rejects.toThrow(destination);
  });
});

function copyOriginToArchive(request: {
  uncompressedPath: string;
  archivePath: string;
}): Promise<void> {
  return copyFile(request.uncompressedPath, request.archivePath);
}

function writeNotTarPayload(request: { restoredPath: string }): Promise<void> {
  return writeFile(request.restoredPath, 'not-a-tar');
}

function writeCorruptPayload(request: { restoredPath: string }): Promise<void> {
  return writeFile(request.restoredPath, 'corrupt');
}

const corruptDirectoryCompression: CompressionAdapter = {
  compress: copyOriginToArchive,
  decompress: writeNotTarPayload,
};

const corruptCompression: CompressionAdapter = {
  compress: copyOriginToArchive,
  decompress: writeCorruptPayload,
};

function createWorkspaceWriter(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-archive-writer-'));
}

describe('archiveWriter', () => {
  it('removes original session files and directories after verification', async () => {
    const workspace = await createWorkspaceWriter();
    const filePath = join(workspace, 'remove-me.jsonl');
    await writeFile(filePath, '{"type":"user","text":"remove"}\n');
    const directoryPath = await writeSessionDirectory(workspace);

    await removeOriginalSession(filePath);
    await removeOriginalSession(directoryPath);

    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('throws when removing a missing original', async () => {
    const workspace = await createWorkspaceWriter();
    const missingPath = join(workspace, 'already-gone.jsonl');

    await expect(removeOriginalSession(missingPath)).rejects.toThrow(missingPath);
  });

  it('restores a directory archive to the original path after hash verification', async () => {
    const workspace = await createWorkspaceWriter();
    const originPath = await writeSessionDirectory(workspace);
    const archivePath = join(workspace, 'session-dir.tar.zst');
    const verifyPath = join(workspace, 'verify-session-dir');
    const restoreWorkPath = join(workspace, 'restore-session-dir');
    const originalPath = join(workspace, 'restored-original');

    const archive = await writeVerifiedArchive({
      sessionId: 'dir-restore-1',
      sessionPath: originPath,
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
    const workspace = await createWorkspaceWriter();
    const originPath = await writeSessionDirectory(workspace);
    const archivePath = join(workspace, 'session-dir-bad.tar.zst');
    const verifyPath = join(workspace, 'verify-session-dir-bad');
    const restoreWorkPath = join(workspace, 'restore-session-dir-bad');
    const originalPath = join(workspace, 'restored-original-bad');

    const archive = await writeVerifiedArchive({
      sessionId: 'dir-restore-2',
      sessionPath: originPath,
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
    const workspace = await createWorkspaceWriter();
    const missingPath = join(workspace, 'missing-source.jsonl');
    const archivePath = join(workspace, 'missing-source.jsonl.zst');
    const restoredPath = join(workspace, 'missing-source.restored.jsonl');

    await expect(
      writeVerifiedArchive({
        sessionId: 'missing-source',
        sessionPath: missingPath,
        archivePath,
        restoredPath,
        apply: false,
        compression: copyCompression,
      }),
    ).rejects.toThrow(missingPath);
  });

  it('fails directory archive write when decompression produces a non-tar payload', async () => {
    const workspace = await createWorkspaceWriter();
    const originPath = await writeSessionDirectory(workspace);
    const archivePath = join(workspace, 'corrupt-dir.tar.zst');
    const restoredPath = join(workspace, 'corrupt-dir-restored');

    await expect(
      writeVerifiedArchive({
        sessionId: 'corrupt-dir',
        sessionPath: originPath,
        archivePath,
        restoredPath,
        apply: false,
        compression: corruptDirectoryCompression,
        sourceKind: 'directory',
      }),
    ).rejects.toThrow();
    await expect(stat(originPath)).resolves.toBeDefined();
    await rm(restoredPath, { recursive: true, force: true });
  });

  it('detects directory source kind from the filesystem when sourceKind is omitted', async () => {
    const workspace = await createWorkspaceWriter();
    const originPath = await writeSessionDirectory(workspace);
    const archivePath = join(workspace, 'auto-dir.tar.zst');
    const restoredPath = join(workspace, 'auto-dir-restored');

    const archive = await writeVerifiedArchive({
      sessionId: 'auto-dir',
      sessionPath: originPath,
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
    const workspace = await createWorkspaceWriter();
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
      sessionPath: originPath,
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
    const workspace = await createWorkspaceWriter();
    const originPath = join(workspace, 'session.jsonl');
    const archivePath = join(workspace, 'session.jsonl.zst');
    const restoredPath = join(workspace, 'restored-session.jsonl');
    await writeFile(originPath, '{"type":"user","text":"apply"}\n');

    const archive = await writeVerifiedArchive({
      sessionId: 'session-2',
      sessionPath: originPath,
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
    const workspace = await createWorkspaceWriter();
    const originPath = join(workspace, 'session.jsonl');
    const archivePath = join(workspace, 'session.jsonl.zst');
    const restoredPath = join(workspace, 'restored-session.jsonl');
    const sessionJsonl = '{"type":"user","text":"safe"}\n';
    await writeFile(originPath, sessionJsonl);

    await expect(
      writeVerifiedArchive({
        sessionId: 'session-3',
        sessionPath: originPath,
        archivePath,
        restoredPath,
        apply: true,
        compression: corruptCompression,
      }),
    ).rejects.toThrow();
    await expect(readFile(originPath, 'utf8')).resolves.toBe(sessionJsonl);
  });

  it('archives a multi-file session directory and keeps the original on dry run', async () => {
    const workspace = await createWorkspaceWriter();
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
      sessionPath: originPath,
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
    const workspace = await createWorkspaceWriter();
    const originPath = join(workspace, 'session-dir-apply');
    const archivePath = join(workspace, 'session-dir-apply.tar.zst');
    const restoredPath = join(workspace, 'restored-session-dir-apply');
    await mkdir(originPath, { recursive: true });
    await writeFile(join(originPath, 'summary.json'), '{"title":"apply dir"}\n');
    await writeFile(join(originPath, 'updates.jsonl'), '{"type":"user","text":"apply"}\n');

    const archive = await writeVerifiedArchive({
      sessionId: 'session-dir-2',
      sessionPath: originPath,
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

function createWorkspaceZstdCompression(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-archive-reader-'));
}

describe('zstdCompression createZstdCompression', () => {
  it('compresses and decompresses a file with the system zstd binary', async () => {
    const workspace = await createWorkspaceZstdCompression();
    const originPath = join(workspace, 'session.jsonl');
    const archivePath = join(workspace, 'session.jsonl.zst');
    const restoredPath = join(workspace, 'session.restored.jsonl');
    const sessionJsonl = [
      '{"type":"user","text":"zstd roundtrip"}',
      '{"type":"assistant","text":"ok"}',
    ]
      .join('\n')
      .concat('\n');
    await writeFile(originPath, sessionJsonl);

    const compression = createZstdCompression();
    await compression.compress({
      uncompressedPath: originPath,
      archivePath,
    });
    await compression.decompress({
      archivePath,
      restoredPath,
    });

    await expect(readFile(restoredPath, 'utf8')).resolves.toBe(sessionJsonl);
    const archiveBytes = Buffer.byteLength(await readFile(archivePath));
    expect(archiveBytes).toBeGreaterThan(0);
    expect(archiveBytes).toBeLessThan(Buffer.byteLength(sessionJsonl, 'utf8') + 128);
  });

  it('throws when compressing a missing source', async () => {
    const workspace = await createWorkspaceZstdCompression();
    const missingPath = join(workspace, 'missing.jsonl');
    const archivePath = join(workspace, 'missing.jsonl.zst');
    const compression = createZstdCompression();

    await expect(
      compression.compress({
        uncompressedPath: missingPath,
        archivePath,
      }),
    ).rejects.toThrow(missingPath);
  });

  it('throws when decompressing a missing archive', async () => {
    const workspace = await createWorkspaceZstdCompression();
    const missingArchive = join(workspace, 'missing.jsonl.zst');
    const restoredPath = join(workspace, 'restored.jsonl');
    const compression = createZstdCompression();

    await expect(
      compression.decompress({
        archivePath: missingArchive,
        restoredPath,
      }),
    ).rejects.toThrow(missingArchive);
  });
});
