import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyCompression } from '@/archive/fixtures.js';
import { writeSessionManifest } from '@/archive/manifest-store.js';
import { runOpenCommand } from './open-command.js';

describe('open command', () => {
  const stdoutWrites: string[] = [];

  beforeEach(() => {
    stdoutWrites.length = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('auto-restores a packed session on open lookup', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-open-'));
    const vaultPath = join(home, '.agent-session-pack');
    const originalPath = join(home, '.codex', 'sessions', 'cold.jsonl');
    const archivePath = join(vaultPath, 'archives', 'codex', 'cold.jsonl.zst');
    const sessionJsonl = '{"type":"user","text":"open me"}\n';
    const originSha256 = createHash('sha256').update(sessionJsonl).digest('hex');

    await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
    await writeFile(archivePath, sessionJsonl);
    await writeSessionManifest(join(vaultPath, 'manifests', 'codex', 'cold.json'), {
      sessionId: 'cold',
      provider: 'codex',
      title: 'open me',
      slug: 'open-me',
      originalPath,
      archivePath,
      sourceSha256: originSha256,
      sourceBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      archiveBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      archivedAt: '2026-07-01T00:00:00.000Z',
      sourceKind: 'file',
    });

    const commandExit = await runOpenCommand({
      home,
      vaultPath,
      provider: 'codex',
      session: 'cold',
      json: true,
      compression: copyCompression,
      now: new Date('2026-07-07T00:00:00.000Z'),
    });

    expect(commandExit.exitCode).toBe(0);
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'open',
      status: 'restored',
      sessionId: 'cold',
      originalPath,
    });
    await expect(readFile(originalPath, 'utf8')).resolves.toBe(sessionJsonl);
    await rm(home, { recursive: true, force: true });
  });
});
