import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveEvidenceWorkRoot } from '../src/core/evidenceWorkRoot.js';

describe('evidence work root', () => {
  it('uses a run-specific directory to avoid parallel command collisions', () => {
    expect(resolveEvidenceWorkRoot('/repo', '12345')).toBe(
      join('/repo', '.vault-test', 'evidence-local', '12345'),
    );
  });
});
