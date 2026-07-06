import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { inspectProviderInventory, type ProviderAdapter } from '../src/core/index.js';
import { codexProvider } from '../src/providers/index.js';

const now = new Date('2026-07-06T12:00:00.000Z');
const olderThanMs = 7 * 24 * 60 * 60 * 1000;

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-inventory-'));

const writeSession = async (
  path: string,
  content: string,
  modifiedAt: Date,
): Promise<number> => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
  await utimes(path, modifiedAt, modifiedAt);

  return Buffer.byteLength(content, 'utf8');
};

describe('provider inventory', () => {
  it('classifies archive provider sessions into cold candidates and guarded recent sessions', async () => {
    const home = await createWorkspace();
    const root = join(home, '.codex', 'sessions');
    const oldBytes = await writeSession(
      join(root, '2026', '06', '01', 'session-old.jsonl'),
      '{"type":"user","text":"old codex session"}\n',
      new Date('2026-06-01T12:00:00.000Z'),
    );
    const recentBytes = await writeSession(
      join(root, '2026', '07', '05', 'session-recent.jsonl'),
      '{"type":"user","text":"recent codex session"}\n',
      new Date('2026-07-05T12:00:00.000Z'),
    );

    const report = await Effect.runPromise(
      inspectProviderInventory({
        home,
        providers: [codexProvider],
        olderThanMs,
        now,
      }),
    );

    expect(report.rows).toEqual([
      {
        provider: 'codex',
        label: 'Codex',
        mode: 'archive',
        sessions: 2,
        coldSessions: 1,
        guardedRecentSessions: 1,
        totalBytes: oldBytes + recentBytes,
        candidateBytes: oldBytes,
        paths: [root],
        status: 'ready',
      },
    ]);
  });

  it('keeps backup-only providers visible but removes destructive candidates', async () => {
    const home = await createWorkspace();
    const root = join(home, 'backup-provider');
    const provider: ProviderAdapter = {
      id: 'devin',
      label: 'Devin',
      mode: 'backup-only',
      defaultRoots: () => [root],
      discover: () =>
        Effect.succeed([
          {
            id: 'devin-session',
            provider: 'devin',
            title: 'Devin session',
            slug: 'devin-session',
            originalPath: join(root, 'sessions.db'),
            modifiedAt: new Date('2026-06-01T12:00:00.000Z'),
            sizeBytes: 10_000,
          },
        ]),
    };

    await mkdir(root, { recursive: true });

    const report = await Effect.runPromise(
      inspectProviderInventory({
        home,
        providers: [provider],
        olderThanMs,
        now,
      }),
    );

    expect(report.rows[0]).toMatchObject({
      provider: 'devin',
      mode: 'backup-only',
      sessions: 1,
      coldSessions: 0,
      guardedRecentSessions: 0,
      totalBytes: 10_000,
      candidateBytes: 0,
      status: 'backup-only',
    });
  });
});
