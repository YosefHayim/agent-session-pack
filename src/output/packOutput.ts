import type { PackPlan } from '../core/index.js';
import { formatBytes } from './byteFormat.js';

export type PackPlanOutputOptions = {
  readonly olderThan: string;
};

/**
 * Formats a non-destructive pack plan for terminal users.
 *
 * @param plan - Dry-run pack plan.
 * @param options - Render options.
 * @returns Human-readable dry-run table.
 */
export const formatHumanPackPlan = (plan: PackPlan, options: PackPlanOutputOptions): string => {
  const totalBeforeBytes = plan.rows.reduce((totalBytes, row) => totalBytes + row.beforeBytes, 0);

  return [
    'Pack dry run',
    '',
    `Cold threshold: ${options.olderThan}`,
    'No files changed. Cleanup is 0 B until --apply is enabled and runs.',
    '',
    'Provider   Mode         Found   Candidates   Before     After dry-run   Cleanup',
    ...plan.rows.map(formatPackPlanRow),
    '--------   ----         -----   ----------   ------     -------------   -------',
    `${'total'.padEnd(10)} ${''.padEnd(12)} ${''.padStart(5)}   ${''.padStart(10)}   ${formatBytes(totalBeforeBytes).padEnd(10)} ${formatBytes(totalBeforeBytes).padEnd(15)} ${formatBytes(0)}`,
    '',
    'Backup-only providers are scanned for visibility but skipped for cleanup.',
    'Apply is intentionally blocked until restore/list indexing is complete.',
  ].join('\n');
};

/**
 * Formats a non-destructive pack plan for scripts and agents.
 *
 * @param plan - Dry-run pack plan.
 * @returns Stable JSON output.
 */
export const formatJsonPackPlan = (plan: PackPlan): string => `${JSON.stringify(plan, null, 2)}\n`;

const formatPackPlanRow = (row: PackPlan['rows'][number]): string => {
  const provider = row.provider.padEnd(10);
  const mode = row.mode.padEnd(12);
  const found = String(row.scannedSessions).padStart(5);
  const candidates = String(row.candidateSessions).padStart(10);
  const before = formatBytes(row.beforeBytes).padEnd(10);
  const after = formatBytes(row.afterDryRunBytes).padEnd(15);
  const cleanup = formatBytes(row.cleanupBytes);

  return `${provider} ${mode} ${found}   ${candidates}   ${before} ${after} ${cleanup}`;
};
