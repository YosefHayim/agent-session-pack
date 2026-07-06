import { describe, expect, it } from 'vitest';
import { createPackPlan, type ScanReport } from '../src/core/index.js';
import { formatHumanPackPlan, formatHumanScan } from '../src/output/index.js';

describe('human scan output', () => {
  it('keeps session titles on one short terminal row', () => {
    const report: ScanReport = {
      sessions: [
        {
          id: 'session-1',
          provider: 'claude',
          title: [
            '<local-command-caveat>Caveat: generated while running local commands.</local-command-caveat>',
            'This title is intentionally long so the terminal table remains readable.',
          ].join('\n'),
          slug: 'long-title',
          originalPath: '/tmp/session.jsonl',
          modifiedAt: new Date('2026-07-06T10:00:00.000Z'),
          sizeBytes: 1234,
          status: 'live',
        },
      ],
    };

    const output = formatHumanScan(report);
    const rows = output.split('\n');

    expect(rows).toHaveLength(4);
    expect(rows[3]).toContain('generated while running local commands');
    expect(rows[3]).toContain('...');
    expect(rows[3]).not.toContain('This title is intentionally long');
  });
});

describe('human pack output', () => {
  it('does not claim apply is blocked for dry-run plans', () => {
    const plan = createPackPlan({
      now: new Date('2026-07-06T12:00:00.000Z'),
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

    const output = formatHumanPackPlan(plan, { olderThan: '7d' });

    expect(output).toContain('Re-run with --apply to pack cold sessions.');
    expect(output).not.toContain('Apply is intentionally blocked');
  });
});
