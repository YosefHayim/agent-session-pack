import { describe, expect, it } from 'vitest';
import type { DiscoveredSession } from '../src/core/index.js';
import { createPackPlan } from '../src/core/packPlan.js';

const now = new Date('2026-07-06T12:00:00.000Z');

const createSession = (
  provider: DiscoveredSession['provider'],
  modifiedAt: string,
  sizeBytes: number,
): DiscoveredSession => ({
  id: `${provider}-${modifiedAt}`,
  provider,
  title: `${provider} session`,
  slug: `${provider}-session`,
  originalPath: `/tmp/${provider}.jsonl`,
  modifiedAt: new Date(modifiedAt),
  sizeBytes,
  status: 'live',
});

describe('pack plan', () => {
  it('summarizes dry-run candidates without claiming cleanup', () => {
    const plan = createPackPlan({
      now,
      olderThanMs: 7 * 24 * 60 * 60 * 1000,
      sessions: [
        createSession('codex', '2026-06-01T12:00:00.000Z', 1_000),
        createSession('codex', '2026-07-05T12:00:00.000Z', 2_000),
        createSession('devin', '2026-06-01T12:00:00.000Z', 3_000),
      ],
      providers: [
        { id: 'codex', label: 'Codex', mode: 'archive' },
        { id: 'devin', label: 'Devin', mode: 'backup-only' },
      ],
    });

    expect(plan.rows).toEqual([
      {
        provider: 'codex',
        mode: 'archive',
        scannedSessions: 2,
        candidateSessions: 1,
        beforeBytes: 1_000,
        afterDryRunBytes: 1_000,
        cleanupBytes: 0,
        applySupport: 'ready',
      },
      {
        provider: 'devin',
        mode: 'backup-only',
        scannedSessions: 1,
        candidateSessions: 0,
        beforeBytes: 0,
        afterDryRunBytes: 0,
        cleanupBytes: 0,
        applySupport: 'backup-only',
      },
    ]);
  });
});
