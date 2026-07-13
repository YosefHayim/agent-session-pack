import type { PackPlan, PackSessionsReport, UnpackSessionsReport } from '../core/index.js';
import { formatBytes } from './byteFormat.js';

/**
 * Render options for pack plan and report output.
 */
export type PackPlanOutputOptions = {
  readonly olderThan: string;
};

/**
 * Formats a non-destructive pack plan for terminal users.
 *
 * @param plan - Dry-run pack plan.
 * @param options - Render options.
 * @returns Human-readable dry-run table.
 * @example
 * ```ts
 * import { formatHumanPackPlan } from './packOutput.js';
 *
 * formatHumanPackPlan(plan, { olderThan: '7d' });
 * ```
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
    ...formatThresholdPreviewBlock(plan.thresholdPreviews),
    '',
    'Backup-only providers are scanned for visibility but skipped for cleanup.',
    'Re-run with --apply to pack cold sessions.',
  ].join('\n');
};

/**
 * Formats a non-destructive pack plan for scripts and agents.
 *
 * @param plan - Dry-run pack plan.
 * @returns Stable JSON output.
 * @example
 * ```ts
 * import { formatJsonPackPlan } from './packOutput.js';
 *
 * formatJsonPackPlan(plan);
 * ```
 */
export const formatJsonPackPlan = (plan: PackPlan): string => `${JSON.stringify(plan, null, 2)}\n`;

/**
 * Formats a pack report for terminal users.
 *
 * @param report - Pack workflow report.
 * @param options - Render options.
 * @returns Human-readable pack table.
 * @example
 * ```ts
 * import { formatHumanPackReport } from './packOutput.js';
 *
 * formatHumanPackReport(report, { olderThan: '7d' });
 * ```
 */
export const formatHumanPackReport = (
  report: PackSessionsReport,
  options: PackPlanOutputOptions,
): string => {
  const totals = packTotals(report);

  return [
    'Pack all providers',
    '',
    `Mode: ${report.apply ? 'apply' : 'dry-run'}`,
    `Cold threshold: ${options.olderThan}`,
    `Vault: ${report.vaultPath}`,
    report.apply
      ? 'Confirmed. Originals are removed only after verified archives and manifests.'
      : 'No files changed. Re-run with --apply to pack cold sessions.',
    '',
    'Provider   Sessions  Mode         Candidates  Packed  Before     Archive    Saved      Saved %  Touch  Status',
    ...report.rows.map(formatPackReportRow),
    '--------   --------  ----         ----------  ------  ------     -------    -----      -------  -----  ------',
    `${'total'.padEnd(10)} ${String(totals.foundSessions).padEnd(9)} ${''.padEnd(12)} ${String(totals.candidateSessions).padStart(10)}  ${String(totals.packedSessions).padStart(6)}  ${formatBytes(totals.beforeBytes).padEnd(10)} ${formatMaybeBytes(totals.archiveBytes).padEnd(10)} ${formatMaybeBytes(totals.savedBytes).padEnd(10)} ${formatMaybePercent(totals.savedPercent).padEnd(8)} ${formatTouched(totals.touchedOriginals).padEnd(6)} ${report.apply ? 'applied' : 'dry-run'}`,
    '',
    ...formatThresholdPreviewBlock(report.thresholdPreviews),
  ].join('\n');
};

/**
 * Formats an unpack report for terminal users.
 *
 * @param report - Unpack workflow report.
 * @returns Human-readable unpack table.
 * @example
 * ```ts
 * import { formatHumanUnpackReport } from './packOutput.js';
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

/**
 * Formats a pack or unpack report for scripts and agents.
 *
 * @param report - Stable workflow report.
 * @returns JSON output.
 * @example
 * ```ts
 * import { formatJsonArchiveReport } from './packOutput.js';
 *
 * formatJsonArchiveReport(report);
 * ```
 */
export const formatJsonArchiveReport = (
  report: PackSessionsReport | UnpackSessionsReport,
): string => `${JSON.stringify(report, null, 2)}\n`;

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

const formatThresholdPreviewBlock = (
  previews: PackPlan['thresholdPreviews'],
): ReadonlyArray<string> => {
  if (previews.length === 0) {
    return [];
  }

  return [
    'What if:',
    ...previews.map((preview) => {
      const label = formatThresholdPreviewLabel(preview.kind).padEnd(11);
      const command = formatThresholdPreviewCommand(preview).padEnd(17);
      const sessions = formatSessionCount(preview.candidateSessions).padEnd(11);

      return `${label} ${command} ${sessions} ${formatBytes(preview.beforeBytes)} source`;
    }),
    'Tip: use --max --dry-run to preview every archive-mode session without touching files.',
  ];
};

const formatThresholdPreviewLabel = (
  kind: PackPlan['thresholdPreviews'][number]['kind'],
): string => {
  if (kind === 'safer') {
    return 'safer';
  }

  if (kind === 'broader') {
    return 'broader';
  }

  return 'max preview';
};

const formatThresholdPreviewCommand = (preview: PackPlan['thresholdPreviews'][number]): string => {
  if (preview.kind === 'max') {
    return '--max --dry-run';
  }

  return `--older-than ${preview.olderThan}`;
};

const formatSessionCount = (sessions: number): string => {
  if (sessions === 1) {
    return '1 session';
  }

  return `${sessions} sessions`;
};

const formatPackReportRow = (row: PackSessionsReport['rows'][number]): string => {
  const provider = row.provider.padEnd(10);
  const sessions = String(row.foundSessions).padEnd(9);
  const mode = row.mode.padEnd(12);
  const candidates = String(row.candidateSessions).padStart(10);
  const packed = String(row.packedSessions).padStart(6);
  const before = formatBytes(row.beforeBytes).padEnd(10);
  const archive = formatMaybeBytes(row.archiveBytes).padEnd(10);
  const saved = formatMaybeBytes(row.savedBytes).padEnd(10);
  const savedPercent = formatMaybePercent(row.savedPercent).padEnd(8);
  const touched = formatTouched(row.touchedOriginals).padEnd(6);

  return `${provider} ${sessions} ${mode} ${candidates}  ${packed}  ${before} ${archive} ${saved} ${savedPercent} ${touched} ${formatStatus(row.status, row.reason)}`;
};

const formatUnpackReportRow = (row: UnpackSessionsReport['rows'][number]): string => {
  const provider = row.provider.padEnd(10);
  const archived = String(row.archivedSessions).padEnd(9);
  const restored = String(row.restoredSessions).padEnd(9);
  const present = String(row.alreadyPresentSessions).padEnd(8);
  const conflicts = String(row.conflictSessions).padEnd(10);
  const before = formatBytes(row.beforeBytes).padEnd(10);
  const archive = formatBytes(row.archiveBytes).padEnd(10);
  const restoredBytes = formatBytes(row.restoredBytes).padEnd(10);
  const touched = formatTouched(row.touchedOriginals).padEnd(6);

  return `${provider} ${archived} ${restored} ${present} ${conflicts} ${before} ${archive} ${restoredBytes} ${touched} ${formatStatus(row.status, row.reason)}`;
};

const packTotals = (
  report: PackSessionsReport,
): {
  readonly archiveBytes: number | undefined;
  readonly beforeBytes: number;
  readonly candidateSessions: number;
  readonly foundSessions: number;
  readonly packedSessions: number;
  readonly savedBytes: number | undefined;
  readonly savedPercent: number | undefined;
  readonly touchedOriginals: boolean;
} => {
  const archiveBytes = sumMaybe(report.rows.map((row) => row.archiveBytes));
  const beforeBytes = report.rows.reduce((totalBytes, row) => totalBytes + row.beforeBytes, 0);
  const savedBytes = archiveBytes === undefined ? undefined : beforeBytes - archiveBytes;

  return {
    archiveBytes,
    beforeBytes,
    candidateSessions: report.rows.reduce(
      (totalSessions, row) => totalSessions + row.candidateSessions,
      0,
    ),
    foundSessions: report.rows.reduce((totalSessions, row) => totalSessions + row.foundSessions, 0),
    packedSessions: report.rows.reduce(
      (totalSessions, row) => totalSessions + row.packedSessions,
      0,
    ),
    savedBytes,
    savedPercent: archiveBytes === undefined ? undefined : savedPercent(beforeBytes, archiveBytes),
    touchedOriginals: report.rows.some((row) => row.touchedOriginals),
  };
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
    (totalSessions, row) => totalSessions + row.alreadyPresentSessions,
    0,
  ),
  archiveBytes: report.rows.reduce((totalBytes, row) => totalBytes + row.archiveBytes, 0),
  archivedSessions: report.rows.reduce(
    (totalSessions, row) => totalSessions + row.archivedSessions,
    0,
  ),
  beforeBytes: report.rows.reduce((totalBytes, row) => totalBytes + row.beforeBytes, 0),
  conflictSessions: report.rows.reduce(
    (totalSessions, row) => totalSessions + row.conflictSessions,
    0,
  ),
  restoredBytes: report.rows.reduce((totalBytes, row) => totalBytes + row.restoredBytes, 0),
  restoredSessions: report.rows.reduce(
    (totalSessions, row) => totalSessions + row.restoredSessions,
    0,
  ),
  touchedOriginals: report.rows.some((row) => row.touchedOriginals),
});

const sumMaybe = (values: ReadonlyArray<number | undefined>): number | undefined => {
  if (values.some((value) => value === undefined)) {
    return undefined;
  }

  let totalBytes = 0;

  for (const value of values) {
    totalBytes += Number(value);
  }

  return totalBytes;
};

const savedPercent = (sourceBytes: number, archiveBytes: number): number => {
  if (sourceBytes === 0) {
    return 0;
  }

  return Number((100 - (archiveBytes / sourceBytes) * 100).toFixed(1));
};

const formatMaybeBytes = (bytes: number | undefined): string => {
  if (bytes === undefined) {
    return 'pending';
  }

  return formatBytes(bytes);
};

const formatMaybePercent = (percent: number | undefined): string => {
  if (percent === undefined) {
    return 'pending';
  }

  return `${percent.toFixed(1)}%`;
};

const formatTouched = (touched: boolean): string => (touched ? 'yes' : 'no');

const formatStatus = (status: string, reason: string | undefined): string => {
  if (reason === undefined) {
    return status;
  }

  return `${status} (${reason})`;
};
