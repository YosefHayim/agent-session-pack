import { describe, expect, it } from 'vitest';
import { createHumanEvidenceReport } from './output.js';

describe('human evidence output', () => {
  it('renders local proof as a compact before and after table', () => {
    const printout = createHumanEvidenceReport({
      scope: 'sampled-copy-proof',
      workRoot: '/tmp/agent-session-pack/evidence',
      evidence: [
        {
          provider: 'codex',
          foundSessions: 42,
          sampledSources: 1,
          mode: 'archive',
          sourceBytes: 10_000,
          archiveBytes: 2_500,
          savedPercent: 75,
          byteExact: true,
          originalTouched: false,
        },
        {
          provider: 'devin',
          foundSessions: 8,
          sampledSources: 1,
          mode: 'backup-only',
          sourceBytes: 97_058_816,
          archiveBytes: 13_425_614,
          savedPercent: 86.2,
          byteExact: true,
          originalTouched: false,
        },
        {
          provider: 'claude',
          foundSessions: 1,
          sampledSources: 0,
          mode: 'archive',
          originalTouched: false,
        },
      ],
    });

    expect(printout).toContain('Local evidence');
    expect(printout).toContain('One eligible source per provider is copied and measured.');
    expect(printout).toContain('Proof bytes are not a whole-store estimate.');
    expect(printout).toContain('Discovered  Samples');
    expect(printout).toContain('Proof before');
    expect(printout).toContain('Proof after');
    expect(printout).toContain('Saved');
    expect(printout).toContain('codex');
    expect(printout).toContain('42');
    expect(printout).toContain('75.0%');
    expect(printout).toContain('devin');
    expect(printout).toContain('8');
    expect(printout).toContain('86.2%');
    expect(printout).toContain('sample total');
    expect(printout).toContain('51');
    expect(printout).toContain('2');
    expect(printout).toMatch(/claude\s+1\s+0\s+archive\s+-\s+-\s+-\s+-\s+no/);
    expect(printout).toContain('Original sessions touched: no');
    expect(printout).toContain('/tmp/agent-session-pack/evidence');
  });
});
