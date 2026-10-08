import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyCompression } from '../../../tests/archiveFixtures.js';
import { writeSessionManifest } from '../archive/manifestStore.js';
import { runRestoreCommand } from './restoreCommand.js';

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
  const content = `{"type":"user","text":"${request.title}"}\n`;

  await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
  await writeFile(archivePath, content);
  await Effect.runPromise(
    writeSessionManifest(join(vaultPath, 'manifests', 'codex', `${request.sessionId}.json`), {
      sessionId: request.sessionId,
      provider: 'codex',
      title: request.title,
      slug: request.title.toLowerCase().replaceAll(' ', '-'),
      originalPath,
      archivePath,
      sourceSha256: createHash('sha256').update(content).digest('hex'),
      sourceBytes: Buffer.byteLength(content, 'utf8'),
      archiveBytes: Buffer.byteLength(content, 'utf8'),
      archivedAt: '2026-07-01T00:00:00.000Z',
      sourceKind: 'file',
    }),
  );

  return { originalPath, content };
};

describe('restore command', () => {
  const stdoutWrites: string[] = [];
  const stderrWrites: string[] = [];

  beforeEach(() => {
    stdoutWrites.length = 0;
    stderrWrites.length = 0;
    process.exitCode = undefined;
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
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('exits with code 2 when selector is missing', async () => {
    await Effect.runPromise(
      runRestoreCommand({
        selector: undefined,
        provider: undefined,
        to: undefined,
        json: true,
        home: '/tmp/synthetic-home',
      }),
    );

    expect(stderrWrites.join('')).toContain(
      'Missing selector. Use agent-session-pack restore <selector>.',
    );
    expect(process.exitCode).toBe(2);
  });

  it('restores an archived session without requiring lifecycle enable', async () => {
    const home = await mkdtemp(join(tmpdir(), 'asp-restore-cmd-'));
    const vaultPath = join(home, '.agent-session-pack');
    const session = await writeArchivedSession({
      home,
      sessionId: 'cold',
      title: 'manual restore',
    });

    await Effect.runPromise(
      runRestoreCommand({
        home,
        vaultPath,
        selector: 'codex:cold',
        provider: undefined,
        to: 'original',
        json: true,
        compression: copyCompression,
      }),
    );

    expect(process.exitCode).toBeUndefined();
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

    await Effect.runPromise(
      runRestoreCommand({
        home,
        selector: 'cold-a',
        provider: undefined,
        to: undefined,
        json: true,
        compression: copyCompression,
      }),
    );

    expect(process.exitCode).toBeUndefined();
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

    await Effect.runPromise(
      runRestoreCommand({
        home,
        selector: 'fix login',
        provider: undefined,
        to: undefined,
        json: true,
        compression: copyCompression,
      }),
    );

    expect(process.exitCode).toBe(2);
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
    const { restoreCommand } = await import('./restoreCommand.js');
    expect(restoreCommand.meta).toMatchObject({
      name: 'restore',
    });
    expect(restoreCommand.args).toMatchObject({
      selector: { type: 'positional' },
      json: { type: 'boolean' },
    });
  });
});
