import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyCompression } from '@/archive/fixtures.js';
import { writeSessionManifest } from '@/archive/manifest-store.js';
import { writeSetupSettings } from '@/setup/config.js';
import { runEnsureRestoredCommand } from './ensure-restored-command.js';

describe('ensure-restored command', () => {
  const stdoutWrites: string[] = [];
  const stderrWrites: string[] = [];

  beforeEach(() => {
    stdoutWrites.length = 0;
    stderrWrites.length = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrWrites.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits 1 with JSON when restore-on-launch is disabled', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-ensure-disabled-'));
    const vaultPath = join(home, '.agent-session-pack');

    await writeSetupSettings({
      home,
      config: {
        version: 1,
        providers: ['codex'],
        vaultPath,
        coldAfter: '7d',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        restoreOnLaunch: false,
      },
    });

    const commandExit = await runEnsureRestoredCommand({
      home,
      vaultPath,
      provider: 'codex',
      session: 'cold',
      json: true,
      compression: copyCompression,
    });

    expect(commandExit.exitCode).toBe(1);
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'ensure-restored',
      status: 'lifecycle-disabled',
      restoreOnLaunchEnabled: false,
    });
    await rm(home, { recursive: true, force: true });
  });

  it('restores a missing archived session when lifecycle is enabled', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-ensure-restore-'));
    const vaultPath = join(home, '.agent-session-pack');
    const originalPath = join(home, '.codex', 'sessions', 'cold.jsonl');
    const archivePath = join(vaultPath, 'archives', 'codex', 'cold.jsonl.zst');
    const sessionJsonl = '{"type":"user","text":"ensure"}\n';
    const originSha256 = createHash('sha256').update(sessionJsonl).digest('hex');

    await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
    await writeFile(archivePath, sessionJsonl);
    await writeSessionManifest(join(vaultPath, 'manifests', 'codex', 'cold.json'), {
      sessionId: 'cold',
      provider: 'codex',
      title: 'ensure',
      slug: 'ensure',
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

    const commandExit = await runEnsureRestoredCommand({
      home,
      vaultPath,
      provider: 'codex',
      session: 'cold',
      json: true,
      compression: copyCompression,
    });

    expect(commandExit.exitCode).toBe(0);
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'ensure-restored',
      status: 'restored',
      provider: 'codex',
      sessionId: 'cold',
      originalPath,
    });
    await expect(readFile(originalPath, 'utf8')).resolves.toBe(sessionJsonl);
    await rm(home, { recursive: true, force: true });
  });
});
