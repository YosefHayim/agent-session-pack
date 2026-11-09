import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVED_STUB_KIND,
  isArchivedStubPath,
  isDirectoryStubOpened,
  writeArchivedStub,
} from './session-stub.js';

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
