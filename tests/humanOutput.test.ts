import { describe, expect, it } from 'vitest';
import type { ScanReport } from '../src/core/index.js';
import { formatHumanScan } from '../src/output/index.js';

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
