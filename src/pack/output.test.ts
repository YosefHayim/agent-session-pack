import { describe, expect, it } from 'vitest';
import { createHumanPackPlan } from './output.js';
import { createPackPlan } from './plan.js';

describe('human pack output', () => {
  it('does not claim apply is blocked for dry-run plans', () => {
    const plan = createPackPlan({
      now: new Date('2026-07-06T12:00:00.000Z'),
      olderThan: '7d',
      olderThanMs: 7 * 24 * 60 * 60 * 1000,
      sessions: [
        {
          id: 'session-1',
          provider: 'codex',
          title: 'Old Codex session',
          slug: 'old-codex-session',
          originalPath: '/tmp/session.jsonl',
          modifiedAt: new Date('2026-06-01T12:00:00.000Z'),
          sizeBytes: 1234,
          status: 'live',
        },
      ],
      providers: [{ id: 'codex', label: 'Codex', mode: 'archive' }],
    });

    const printout = createHumanPackPlan(plan, { olderThan: '7d' });

    expect(printout).toContain('Re-run with --apply to pack cold sessions.');
    expect(printout).not.toContain('Apply is intentionally blocked');
  });

  it('shows threshold curiosity tips for stricter, broader, and max previews', () => {
    const plan = createPackPlan({
      now: new Date('2026-07-06T12:00:00.000Z'),
      olderThan: '7d',
      olderThanMs: 7 * 24 * 60 * 60 * 1000,
      sessions: [
        {
          id: 'session-older',
          provider: 'codex',
          title: 'Older Codex session',
          slug: 'older-codex-session',
          originalPath: '/tmp/session-older.jsonl',
          modifiedAt: new Date('2026-06-16T12:00:00.000Z'),
          sizeBytes: 100,
          status: 'live',
        },
        {
          id: 'session-recent',
          provider: 'codex',
          title: 'Recent Codex session',
          slug: 'recent-codex-session',
          originalPath: '/tmp/session-recent.jsonl',
          modifiedAt: new Date('2026-07-01T12:00:00.000Z'),
          sizeBytes: 200,
          status: 'live',
        },
        {
          id: 'session-fresh',
          provider: 'codex',
          title: 'Fresh Codex session',
          slug: 'fresh-codex-session',
          originalPath: '/tmp/session-fresh.jsonl',
          modifiedAt: new Date('2026-07-06T11:00:00.000Z'),
          sizeBytes: 300,
          status: 'live',
        },
      ],
      providers: [{ id: 'codex', label: 'Codex', mode: 'archive' }],
    });

    const printout = createHumanPackPlan(plan, { olderThan: '7d' });

    expect(printout).toContain('What if:');
    expect(printout).toContain('safer       --older-than 14d  1 session   100 B source');
    expect(printout).toContain('broader     --older-than 3d   2 sessions  300 B source');
    expect(printout).toContain('max preview --max --dry-run   3 sessions  600 B source');
  });
});
