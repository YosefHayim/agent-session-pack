import { describeBytes } from '@/byte-format.js';
import { describeStatus, describeTouched } from '@/report-cells.js';
import type { UnpackSessionsReport } from './unpack-sessions.js';

export const createHumanUnpackReport = (report: UnpackSessionsReport): string => {
  const totals = sumUnpackTotals(report);

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
    ...report.rows.map(createUnpackReportSummary),
    '--------   --------  --------  -------  ---------  ------     -------    --------   -----  ------',
    `${'total'.padEnd(10)} ${String(totals.archivedSessions).padEnd(9)} ${String(totals.restoredSessions).padEnd(9)} ${String(totals.alreadyPresentSessions).padEnd(8)} ${String(totals.conflictSessions).padEnd(10)} ${describeBytes(totals.beforeBytes).padEnd(10)} ${describeBytes(totals.archiveBytes).padEnd(10)} ${describeBytes(totals.restoredBytes).padEnd(10)} ${describeTouched(totals.touchedOriginals).padEnd(6)} ${report.apply ? 'applied' : 'dry-run'}`,
  ].join('\n');
};

const createUnpackReportSummary = (
  unpackSessionSummary: UnpackSessionsReport['rows'][number],
): string => {
  const provider = unpackSessionSummary.provider.padEnd(10);
  const archived = String(unpackSessionSummary.archivedSessions).padEnd(9);
  const restored = String(unpackSessionSummary.restoredSessions).padEnd(9);
  const present = String(unpackSessionSummary.alreadyPresentSessions).padEnd(8);
  const conflicts = String(unpackSessionSummary.conflictSessions).padEnd(10);
  const before = describeBytes(unpackSessionSummary.beforeBytes).padEnd(10);
  const archive = describeBytes(unpackSessionSummary.archiveBytes).padEnd(10);
  const restoredBytes = describeBytes(unpackSessionSummary.restoredBytes).padEnd(10);
  const touched = describeTouched(unpackSessionSummary.touchedOriginals).padEnd(6);

  return `${provider} ${archived} ${restored} ${present} ${conflicts} ${before} ${archive} ${restoredBytes} ${touched} ${describeStatus(unpackSessionSummary.status, unpackSessionSummary.reason)}`;
};

const sumUnpackTotals = (
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
    (totalSessions, unpackSessionSummary) =>
      totalSessions + unpackSessionSummary.alreadyPresentSessions,
    0,
  ),
  archiveBytes: report.rows.reduce(
    (totalBytes, unpackSessionSummary) => totalBytes + unpackSessionSummary.archiveBytes,
    0,
  ),
  archivedSessions: report.rows.reduce(
    (totalSessions, unpackSessionSummary) => totalSessions + unpackSessionSummary.archivedSessions,
    0,
  ),
  beforeBytes: report.rows.reduce(
    (totalBytes, unpackSessionSummary) => totalBytes + unpackSessionSummary.beforeBytes,
    0,
  ),
  conflictSessions: report.rows.reduce(
    (totalSessions, unpackSessionSummary) => totalSessions + unpackSessionSummary.conflictSessions,
    0,
  ),
  restoredBytes: report.rows.reduce(
    (totalBytes, unpackSessionSummary) => totalBytes + unpackSessionSummary.restoredBytes,
    0,
  ),
  restoredSessions: report.rows.reduce(
    (totalSessions, unpackSessionSummary) => totalSessions + unpackSessionSummary.restoredSessions,
    0,
  ),
  touchedOriginals: report.rows.some(
    (unpackSessionSummary) => unpackSessionSummary.touchedOriginals,
  ),
});
