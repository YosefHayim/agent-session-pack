import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeSessionDirectory } from './fixtures.js';
import { readSha256Directory, readSha256File, readSha256Path } from './hash.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-archive-hash-'));

describe('archiveHash', () => {
  it('hashes files and directories through sha256Path', async () => {
    const workspace = await createWorkspace();
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
    const workspace = await createWorkspace();
    const missingPath = join(workspace, 'missing.jsonl');

    await expect(readSha256File(missingPath)).rejects.toThrow(missingPath);
  });
});
