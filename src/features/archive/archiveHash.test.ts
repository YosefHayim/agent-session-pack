import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { writeSessionDirectory } from '../../../tests/archiveFixtures.js';
import { ArchiveFileSystemError } from './archiveFileSystem.js';
import { sha256Directory, sha256File, sha256Path } from './archiveHash.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-archive-hash-'));

describe('archiveHash', () => {
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
});
