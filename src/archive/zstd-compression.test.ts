import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createZstdCompression } from './zstd-compression.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-archive-reader-'));

describe('zstdCompression createZstdCompression', () => {
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
    await compression.compress({
      sourcePath,
      archivePath,
    });
    await compression.decompress({
      archivePath,
      restoredPath,
    });

    await expect(readFile(restoredPath, 'utf8')).resolves.toBe(content);
    const archiveBytes = Buffer.byteLength(await readFile(archivePath));
    expect(archiveBytes).toBeGreaterThan(0);
    expect(archiveBytes).toBeLessThan(Buffer.byteLength(content, 'utf8') + 128);
  });

  it('throws when compressing a missing source', async () => {
    const workspace = await createWorkspace();
    const missingPath = join(workspace, 'missing.jsonl');
    const archivePath = join(workspace, 'missing.jsonl.zst');
    const compression = createZstdCompression();

    await expect(
      compression.compress({
        sourcePath: missingPath,
        archivePath,
      }),
    ).rejects.toThrow(missingPath);
  });

  it('throws when decompressing a missing archive', async () => {
    const workspace = await createWorkspace();
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
