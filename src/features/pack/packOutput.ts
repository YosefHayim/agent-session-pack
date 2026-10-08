import { formatBytes } from '../../shared/byteFormat.js';
import { savedPercent } from '../../shared/byteSavings.js';
import { formatStatus, formatTouched } from '../../shared/reportCells.js';
import type { PackPlan } from './packPlan.js';
import type { PackSessionsReport } from './packSessions.js';

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
  const totalBeforeBytes = plan.rows.reduce(
    (totalBytes, packPlanRow) => totalBytes + packPlanRow.beforeBytes,
    0,
  );

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
 * Formats a pack report for scripts and agents.
 *
 * @param report - Stable pack report.
 * @returns JSON output.
 * @example
 * ```ts
 * import { formatJsonPackReport } from './packOutput.js';
 *
 * formatJsonPackReport(report);
 * ```
 */
export const formatJsonPackReport = (report: PackSessionsReport): string =>
  `${JSON.stringify(report, null, 2)}\n`;

const formatPackPlanRow = (packPlanRow: PackPlan['rows'][number]): string => {
  const provider = packPlanRow.provider.padEnd(10);
  const mode = packPlanRow.mode.padEnd(12);
  const found = String(packPlanRow.scannedSessions).padStart(5);
  const candidates = String(packPlanRow.candidateSessions).padStart(10);
  const before = formatBytes(packPlanRow.beforeBytes).padEnd(10);
  const after = formatBytes(packPlanRow.afterDryRunBytes).padEnd(15);
  const cleanup = formatBytes(packPlanRow.cleanupBytes);

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

const formatPackReportRow = (packSessionRow: PackSessionsReport['rows'][number]): string => {
  const provider = packSessionRow.provider.padEnd(10);
  const sessions = String(packSessionRow.foundSessions).padEnd(9);
  const mode = packSessionRow.mode.padEnd(12);
  const candidates = String(packSessionRow.candidateSessions).padStart(10);
  const packed = String(packSessionRow.packedSessions).padStart(6);
  const before = formatBytes(packSessionRow.beforeBytes).padEnd(10);
  const archive = formatMaybeBytes(packSessionRow.archiveBytes).padEnd(10);
  const saved = formatMaybeBytes(packSessionRow.savedBytes).padEnd(10);
  const savedPercent = formatMaybePercent(packSessionRow.savedPercent).padEnd(8);
  const touched = formatTouched(packSessionRow.touchedOriginals).padEnd(6);

  return `${provider} ${sessions} ${mode} ${candidates}  ${packed}  ${before} ${archive} ${saved} ${savedPercent} ${touched} ${formatStatus(packSessionRow.status, packSessionRow.reason)}`;
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
  const archiveBytes = sumMaybe(report.rows.map((packSessionRow) => packSessionRow.archiveBytes));
  const beforeBytes = report.rows.reduce(
    (totalBytes, packSessionRow) => totalBytes + packSessionRow.beforeBytes,
    0,
  );
  const savedBytes = archiveBytes === undefined ? undefined : beforeBytes - archiveBytes;

  return {
    archiveBytes,
    beforeBytes,
    candidateSessions: report.rows.reduce(
      (totalSessions, packSessionRow) => totalSessions + packSessionRow.candidateSessions,
      0,
    ),
    foundSessions: report.rows.reduce(
      (totalSessions, packSessionRow) => totalSessions + packSessionRow.foundSessions,
      0,
    ),
    packedSessions: report.rows.reduce(
      (totalSessions, packSessionRow) => totalSessions + packSessionRow.packedSessions,
      0,
    ),
    savedBytes,
    savedPercent: archiveBytes === undefined ? undefined : savedPercent(beforeBytes, archiveBytes),
    touchedOriginals: report.rows.some((packSessionRow) => packSessionRow.touchedOriginals),
  };
};

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
