import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyCompression } from '@/archive/fixtures.js';
import { writeSessionManifest } from '@/archive/manifest-store.js';
import { writeSetupSettings } from '@/setup/config.js';
import { runPreflightCommand } from './preflight-command.js';

describe('preflight command', () => {
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

  it('auto-restores session ids from argv when lifecycle is enabled', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-preflight-'));
    const vaultPath = join(home, '.agent-session-pack');
    const originalPath = join(home, '.codex', 'sessions', 'cold.jsonl');
    const archivePath = join(vaultPath, 'archives', 'codex', 'cold.jsonl.zst');
    const sessionJsonl = '{"type":"user","text":"preflight"}\n';
    const originSha256 = createHash('sha256').update(sessionJsonl).digest('hex');

    await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
    await writeFile(archivePath, sessionJsonl);
    await writeSessionManifest(join(vaultPath, 'manifests', 'codex', 'cold.json'), {
      sessionId: 'cold',
      provider: 'codex',
      title: 'preflight',
      slug: 'preflight',
      originalPath,
      archivePath,
      sourceSha256: originSha256,
      sourceBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      archiveBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      archivedAt: '2026-07-01T00:00:00.000Z',
      sourceKind: 'file',
    });
    await writeSetupSettings({
      home,
      config: {
        version: 1,
        providers: ['codex'],
        vaultPath,
        coldAfter: '7d',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        restoreOnLaunch: true,
      },
    });

    await runPreflightCommand({
      home,
      vaultPath,
      provider: 'codex',
      passthroughArgv: ['resume', 'cold'],
      json: true,
      compression: copyCompression,
    });

    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'preflight',
      provider: 'codex',
      restoreOnLaunchEnabled: true,
      sessionIds: ['cold'],
    });
    await expect(readFile(originalPath, 'utf8')).resolves.toBe(sessionJsonl);
    await rm(home, { recursive: true, force: true });
  });
});
