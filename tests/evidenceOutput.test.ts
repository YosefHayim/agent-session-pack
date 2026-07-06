import { describe, expect, it } from 'vitest';
import { formatHumanEvidenceReport } from '../src/output/evidenceOutput.js';

describe('human evidence output', () => {
  it('renders local proof as a compact before and after table', () => {
    const output = formatHumanEvidenceReport({
      workRoot: '/tmp/agent-recall/evidence',
      evidence: [
        {
          provider: 'codex',
          mode: 'archive',
          sourceBytes: 10_000,
          archiveBytes: 2_500,
          savedPercent: 75,
          byteExact: true,
          originalTouched: false,
        },
        {
          provider: 'devin',
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
    expect(output).toContain('Provider');
    expect(output).toContain('Before');
    expect(output).toContain('After');
    expect(output).toContain('Saved');
    expect(output).toContain('codex');
    expect(output).toContain('75.0%');
    expect(output).toContain('devin');
    expect(output).toContain('86.2%');
    expect(output).toContain('Original sessions touched: no');
    expect(output).toContain('/tmp/agent-recall/evidence');
  });
});
