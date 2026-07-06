import { join } from 'node:path';

/**
 * Resolves a run-specific local evidence work root.
 *
 * @param cwd - Current working directory.
 * @param runId - Process or command run identifier.
 * @returns Directory for copied local evidence files.
 */
export const resolveEvidenceWorkRoot = (cwd: string, runId: string): string =>
  join(cwd, '.vault-test', 'evidence-local', runId);
