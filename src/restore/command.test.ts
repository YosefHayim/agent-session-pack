import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyCompression } from '@/archive/fixtures.js';
import { writeSessionManifest } from '@/archive/manifest-store.js';
import { runRestoreCommand } from './command.js';

type ArchivedSessionRequest = {
  readonly home: string;
  readonly sessionId: string;
  readonly title: string;
};

const writeArchivedSession = async (
  request: ArchivedSessionRequest,
): Promise<{ readonly originalPath: string; readonly content: string }> => {
  const vaultPath = join(request.home, '.agent-session-pack');
  const originalPath = join(request.home, '.codex', 'sessions', `${request.sessionId}.jsonl`);
  const archivePath = join(vaultPath, 'archives', 'codex', `${request.sessionId}.jsonl.zst`);
  const sessionJsonl = `{"type":"user","text":"${request.title}"}\n`;

  await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
  await writeFile(archivePath, sessionJsonl);
  await writeSessionManifest(join(vaultPath, 'manifests', 'codex', `${request.sessionId}.json`), {
    sessionId: request.sessionId,
    provider: 'codex',
    title: request.title,
    slug: request.title.toLowerCase().replaceAll(' ', '-'),
    originalPath,
    archivePath,
    sourceSha256: createHash('sha256').update(sessionJsonl).digest('hex'),
    sourceBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
    archiveBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
    archivedAt: '2026-07-01T00:00:00.000Z',
    sourceKind: 'file',
  });

  return { originalPath, content: sessionJsonl };
};

describe('restore command', () => {
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

  it('exits with code 2 when selector is missing', async () => {
    const commandExit = await runRestoreCommand({
      selector: undefined,
      provider: undefined,
      to: undefined,
      json: true,
      home: '/tmp/synthetic-home',
    });

    expect(stderrWrites.join('')).toContain(
      'Missing selector. Use agent-session-pack restore <selector>.',
    );
    expect(commandExit.exitCode).toBe(2);
  });

  it('restores an archived session without requiring lifecycle enable', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-restore-cmd-'));
    const vaultPath = join(home, '.agent-session-pack');
    const session = await writeArchivedSession({
      home,
      sessionId: 'cold',
      title: 'manual restore',
    });

    const commandExit = await runRestoreCommand({
      home,
      vaultPath,
      selector: 'codex:cold',
      provider: undefined,
      to: 'original',
      json: true,
      compression: copyCompression,
    });

    expect(commandExit.exitCode).toBe(0);
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      command: 'restore',
      status: 'restored',
      sessionId: 'cold',
      provider: 'codex',
    });
    await expect(readFile(session.originalPath, 'utf8')).resolves.toBe(session.content);
    await rm(home, { recursive: true, force: true });
  });

  it('restores a session by a unique id prefix', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-restore-prefix-'));
    const pageSession = await writeArchivedSession({
      home,
      sessionId: 'cold-a1',
      title: 'Fix login page',
    });
    await writeArchivedSession({ home, sessionId: 'cold-b2', title: 'Fix login api' });

    const commandExit = await runRestoreCommand({
      home,
      selector: 'cold-a',
      provider: undefined,
      to: undefined,
      json: true,
      compression: copyCompression,
    });

    expect(commandExit.exitCode).toBe(0);
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      status: 'restored',
      sessionId: 'cold-a1',
    });
    await expect(readFile(pageSession.originalPath, 'utf8')).resolves.toBe(pageSession.content);
    await rm(home, { recursive: true, force: true });
  });

  it('lists the candidates and exits 2 when the selector is ambiguous', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-restore-ambiguous-'));
    const pageSession = await writeArchivedSession({
      home,
      sessionId: 'cold-a1',
      title: 'Fix login page',
    });
    await writeArchivedSession({ home, sessionId: 'cold-b2', title: 'Fix login api' });

    const commandExit = await runRestoreCommand({
      home,
      selector: 'fix login',
      provider: undefined,
      to: undefined,
      json: true,
      compression: copyCompression,
    });

    expect(commandExit.exitCode).toBe(2);
    expect(JSON.parse(stdoutWrites.join(''))).toMatchObject({
      status: 'ambiguous-selector',
      candidates: [
        { provider: 'codex', sessionId: 'cold-a1', title: 'Fix login page' },
        { provider: 'codex', sessionId: 'cold-b2', title: 'Fix login api' },
      ],
    });
    await expect(readFile(pageSession.originalPath, 'utf8')).rejects.toThrow();
    await rm(home, { recursive: true, force: true });
  });

  it('exposes citty metadata and flags', async () => {
    const { restoreCommand } = await import('./command.js');
    expect(restoreCommand.meta).toMatchObject({
      name: 'restore',
    });
    expect(restoreCommand.args).toMatchObject({
      selector: { type: 'positional' },
      json: { type: 'boolean' },
    });
  });
});
