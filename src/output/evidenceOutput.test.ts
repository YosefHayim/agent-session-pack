import { describe, expect, it } from 'vitest';
import { formatHumanEvidenceReport } from './evidenceOutput.js';

describe('human evidence output', () => {
  it('renders local proof as a compact before and after table', () => {
    const output = formatHumanEvidenceReport({
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
      ],
    });

    expect(output).toContain('Local evidence');
    expect(output).toContain('One eligible source per provider is copied and measured.');
    expect(output).toContain('Proof bytes are not a whole-store estimate.');
    expect(output).toContain('Discovered  Samples');
    expect(output).toContain('Proof before');
    expect(output).toContain('Proof after');
    expect(output).toContain('Saved');
    expect(output).toContain('codex');
    expect(output).toContain('42');
    expect(output).toContain('75.0%');
    expect(output).toContain('devin');
    expect(output).toContain('8');
    expect(output).toContain('86.2%');
    expect(output).toContain('sample total');
    expect(output).toContain('50');
    expect(output).toContain('2');
    expect(output).toContain('Original sessions touched: no');
    expect(output).toContain('/tmp/agent-session-pack/evidence');
  });
});
