import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  extractSessionIdsFromArgv,
  recordSessionAccess,
  resolveAccessLogPath,
  wasSessionAccessedSince,
} from './sessionAccess.js';

describe('sessionAccess', () => {
  it('extracts session ids from resume-style argv', () => {
    expect(
      extractSessionIdsFromArgv(['resume', '019fe213-8c3a-74a1-96bc-e1a9a02a4047', '--json']),
    ).toContain('019fe213-8c3a-74a1-96bc-e1a9a02a4047');

    expect(extractSessionIdsFromArgv(['--session', 'cold-session', 'other'])).toEqual([
      'cold-session',
    ]);
  });

  it('records and detects recent session access', async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), 'asp-access-'));
    const now = new Date('2026-07-07T12:00:00.000Z');

    await Effect.runPromise(
      recordSessionAccess({
        vaultPath,
        provider: 'codex',
        sessionId: 'cold',
        accessedAt: now,
      }),
    );

    const logPath = resolveAccessLogPath(vaultPath);
    const lines = (await readFile(logPath, 'utf8')).trim().split('\n');
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      provider: 'codex',
      sessionId: 'cold',
    });

    expect(
      wasSessionAccessedSince({
        events: [
          {
            provider: 'codex',
            sessionId: 'cold',
            accessedAt: now.toISOString(),
          },
        ],
        provider: 'codex',
        sessionId: 'cold',
        sinceMs: now.getTime() - 1000,
      }),
    ).toBe(true);

    await rm(vaultPath, { recursive: true, force: true });
  });
});
