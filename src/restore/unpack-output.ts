import { createBytes } from '@/byte-format.js';
import { createStatus, createTouched } from '@/report-cells.js';
import type { UnpackSessionsReport } from './unpack-sessions.js';

/**
 * Formats an unpack report for terminal users.
 *
 * @param report - Unpack workflow report.
 * @returns Human-readable unpack table.
 * @example
 * ```ts
 * import { createHumanUnpackReport } from './unpack-output.js';
 *
 * createHumanUnpackReport(report);
 * ```
 */
export const createHumanUnpackReport = (report: UnpackSessionsReport): string => {
  const totals = readUnpackTotals(report);

  return [
    'Unpack all providers',
    '',
    `Mode: ${report.apply ? 'apply' : 'dry-run'}`,
    `Vault: ${report.vaultPath}`,
    report.apply
      ? 'Confirmed. Existing changed live files are not overwritten.'
      : 'No files changed. Re-run with --apply to restore archived sessions.',
    '',
    'Provider   Archived  Restored  Present  Conflicts  Before     Archive    Restored   Touch  Status',
    ...report.rows.map(createUnpackReportRow),
    '--------   --------  --------  -------  ---------  ------     -------    --------   -----  ------',
    `${'total'.padEnd(10)} ${String(totals.archivedSessions).padEnd(9)} ${String(totals.restoredSessions).padEnd(9)} ${String(totals.alreadyPresentSessions).padEnd(8)} ${String(totals.conflictSessions).padEnd(10)} ${createBytes(totals.beforeBytes).padEnd(10)} ${createBytes(totals.archiveBytes).padEnd(10)} ${createBytes(totals.restoredBytes).padEnd(10)} ${createTouched(totals.touchedOriginals).padEnd(6)} ${report.apply ? 'applied' : 'dry-run'}`,
  ].join('\n');
};

const createUnpackReportRow = (unpackSessionRow: UnpackSessionsReport['rows'][number]): string => {
  const provider = unpackSessionRow.provider.padEnd(10);
  const archived = String(unpackSessionRow.archivedSessions).padEnd(9);
  const restored = String(unpackSessionRow.restoredSessions).padEnd(9);
  const present = String(unpackSessionRow.alreadyPresentSessions).padEnd(8);
  const conflicts = String(unpackSessionRow.conflictSessions).padEnd(10);
  const before = createBytes(unpackSessionRow.beforeBytes).padEnd(10);
  const archive = createBytes(unpackSessionRow.archiveBytes).padEnd(10);
  const restoredBytes = createBytes(unpackSessionRow.restoredBytes).padEnd(10);
  const touched = createTouched(unpackSessionRow.touchedOriginals).padEnd(6);

  return `${provider} ${archived} ${restored} ${present} ${conflicts} ${before} ${archive} ${restoredBytes} ${touched} ${createStatus(unpackSessionRow.status, unpackSessionRow.reason)}`;
};

const readUnpackTotals = (
  report: UnpackSessionsReport,
): {
  readonly alreadyPresentSessions: number;
  readonly archiveBytes: number;
  readonly archivedSessions: number;
  readonly beforeBytes: number;
  readonly conflictSessions: number;
  readonly restoredBytes: number;
  readonly restoredSessions: number;
  readonly touchedOriginals: boolean;
} => ({
  alreadyPresentSessions: report.rows.reduce(
    (totalSessions, unpackSessionRow) => totalSessions + unpackSessionRow.alreadyPresentSessions,
    0,
  ),
  archiveBytes: report.rows.reduce(
    (totalBytes, unpackSessionRow) => totalBytes + unpackSessionRow.archiveBytes,
    0,
  ),
  archivedSessions: report.rows.reduce(
    (totalSessions, unpackSessionRow) => totalSessions + unpackSessionRow.archivedSessions,
    0,
  ),
  beforeBytes: report.rows.reduce(
    (totalBytes, unpackSessionRow) => totalBytes + unpackSessionRow.beforeBytes,
    0,
  ),
  conflictSessions: report.rows.reduce(
    (totalSessions, unpackSessionRow) => totalSessions + unpackSessionRow.conflictSessions,
    0,
  ),
  restoredBytes: report.rows.reduce(
    (totalBytes, unpackSessionRow) => totalBytes + unpackSessionRow.restoredBytes,
    0,
  ),
  restoredSessions: report.rows.reduce(
    (totalSessions, unpackSessionRow) => totalSessions + unpackSessionRow.restoredSessions,
    0,
  ),
  touchedOriginals: report.rows.some((unpackSessionRow) => unpackSessionRow.touchedOriginals),
});
