import { formatBytes } from '../../shared/byteFormat.js';
import { formatStatus, formatTouched } from '../../shared/reportCells.js';
import type { UnpackSessionsReport } from './unpackSessions.js';

/**
 * Formats an unpack report for terminal users.
 *
 * @param report - Unpack workflow report.
 * @returns Human-readable unpack table.
 * @example
 * ```ts
 * import { formatHumanUnpackReport } from './unpackOutput.js';
 *
 * formatHumanUnpackReport(report);
 * ```
 */
export const formatHumanUnpackReport = (report: UnpackSessionsReport): string => {
  const totals = unpackTotals(report);

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
    ...report.rows.map(formatUnpackReportRow),
    '--------   --------  --------  -------  ---------  ------     -------    --------   -----  ------',
    `${'total'.padEnd(10)} ${String(totals.archivedSessions).padEnd(9)} ${String(totals.restoredSessions).padEnd(9)} ${String(totals.alreadyPresentSessions).padEnd(8)} ${String(totals.conflictSessions).padEnd(10)} ${formatBytes(totals.beforeBytes).padEnd(10)} ${formatBytes(totals.archiveBytes).padEnd(10)} ${formatBytes(totals.restoredBytes).padEnd(10)} ${formatTouched(totals.touchedOriginals).padEnd(6)} ${report.apply ? 'applied' : 'dry-run'}`,
  ].join('\n');
};

const formatUnpackReportRow = (unpackSessionRow: UnpackSessionsReport['rows'][number]): string => {
  const provider = unpackSessionRow.provider.padEnd(10);
  const archived = String(unpackSessionRow.archivedSessions).padEnd(9);
  const restored = String(unpackSessionRow.restoredSessions).padEnd(9);
  const present = String(unpackSessionRow.alreadyPresentSessions).padEnd(8);
  const conflicts = String(unpackSessionRow.conflictSessions).padEnd(10);
  const before = formatBytes(unpackSessionRow.beforeBytes).padEnd(10);
  const archive = formatBytes(unpackSessionRow.archiveBytes).padEnd(10);
  const restoredBytes = formatBytes(unpackSessionRow.restoredBytes).padEnd(10);
  const touched = formatTouched(unpackSessionRow.touchedOriginals).padEnd(6);

  return `${provider} ${archived} ${restored} ${present} ${conflicts} ${before} ${archive} ${restoredBytes} ${touched} ${formatStatus(unpackSessionRow.status, unpackSessionRow.reason)}`;
};

const unpackTotals = (
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
