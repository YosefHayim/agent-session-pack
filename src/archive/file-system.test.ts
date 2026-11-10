import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { measureOriginBytes } from './file-system.js';
import { writeSessionDirectory } from './fixtures.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-archive-file-system-'));

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
