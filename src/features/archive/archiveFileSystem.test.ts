import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { writeSessionDirectory } from '../../../tests/archiveFixtures.js';
import { ArchiveFileSystemError, measureSourceBytes } from './archiveFileSystem.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-archive-file-system-'));

describe('archiveFileSystem', () => {
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
});
