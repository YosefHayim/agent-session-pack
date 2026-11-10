import { join } from 'node:path';

export const createEvidenceWorkRoot = (cwd: string, runId: string): string =>
  join(cwd, '.vault-test', 'evidence-local', runId);
