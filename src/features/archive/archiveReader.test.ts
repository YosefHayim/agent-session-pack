import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { createZstdCompression } from './archiveReader.js';
import { ArchiveFileSystemError } from './archiveWriter.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-archive-reader-'));

describe('archiveReader createZstdCompression', () => {
  it('compresses and decompresses a file with the system zstd binary', async () => {
    const workspace = await createWorkspace();
    const sourcePath = join(workspace, 'session.jsonl');
    const archivePath = join(workspace, 'session.jsonl.zst');
    const restoredPath = join(workspace, 'session.restored.jsonl');
    const content = ['{"type":"user","text":"zstd roundtrip"}', '{"type":"assistant","text":"ok"}']
      .join('\n')
      .concat('\n');
    await writeFile(sourcePath, content);

    const compression = createZstdCompression();
    await Effect.runPromise(
      compression.compress({
        sourcePath,
        archivePath,
      }),
    );
    await Effect.runPromise(
      compression.decompress({
        archivePath,
        restoredPath,
      }),
    );

    await expect(readFile(restoredPath, 'utf8')).resolves.toBe(content);
    const archiveBytes = Buffer.byteLength(await readFile(archivePath));
    expect(archiveBytes).toBeGreaterThan(0);
    expect(archiveBytes).toBeLessThan(Buffer.byteLength(content, 'utf8') + 128);
  });

  it('returns ArchiveFileSystemError when compressing a missing source', async () => {
    const workspace = await createWorkspace();
    const missingPath = join(workspace, 'missing.jsonl');
    const archivePath = join(workspace, 'missing.jsonl.zst');
    const compression = createZstdCompression();

    const result = await Effect.runPromise(
      Effect.either(
        compression.compress({
          sourcePath: missingPath,
          archivePath,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) {
      expect.fail('expected zstd compress to fail for a missing source');
    }
    expect(result.left).toBeInstanceOf(ArchiveFileSystemError);
    expect(result.left).toMatchObject({
      _tag: 'ArchiveFileSystemError',
      path: missingPath,
    });
  });

  it('returns ArchiveFileSystemError when decompressing a missing archive', async () => {
    const workspace = await createWorkspace();
    const missingArchive = join(workspace, 'missing.jsonl.zst');
    const restoredPath = join(workspace, 'restored.jsonl');
    const compression = createZstdCompression();

    const result = await Effect.runPromise(
      Effect.either(
        compression.decompress({
          archivePath: missingArchive,
          restoredPath,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) {
      expect.fail('expected zstd decompress to fail for a missing archive');
    }
    expect(result.left).toBeInstanceOf(ArchiveFileSystemError);
    expect(result.left).toMatchObject({
      _tag: 'ArchiveFileSystemError',
      path: missingArchive,
    });
  });
});
