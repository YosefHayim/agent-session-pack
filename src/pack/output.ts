import { createBytes } from '@/byte-format.js';
import { readSavedPercent } from '@/byte-savings.js';
import { createStatus, createTouched } from '@/report-cells.js';
import type { PackPlan } from './plan.js';
import type { PackSessionsReport } from './sessions.js';

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
 * import { createHumanPackPlan } from './output.js';
 *
 * createHumanPackPlan(plan, { olderThan: '7d' });
 * ```
 */
export const createHumanPackPlan = (plan: PackPlan, options: PackPlanOutputOptions): string => {
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
    ...plan.rows.map(createPackPlanRow),
    '--------   ----         -----   ----------   ------     -------------   -------',
    `${'total'.padEnd(10)} ${''.padEnd(12)} ${''.padStart(5)}   ${''.padStart(10)}   ${createBytes(totalBeforeBytes).padEnd(10)} ${createBytes(totalBeforeBytes).padEnd(15)} ${createBytes(0)}`,
    '',
    ...createThresholdPreviewBlock(plan.thresholdPreviews),
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
 * import { createJsonPackPlan } from './output.js';
 *
 * createJsonPackPlan(plan);
 * ```
 */
export const createJsonPackPlan = (plan: PackPlan): string => `${JSON.stringify(plan, null, 2)}\n`;

/**
 * Formats a pack report for terminal users.
 *
 * @param report - Pack workflow report.
 * @param options - Render options.
 * @returns Human-readable pack table.
 * @example
 * ```ts
 * import { createHumanPackReport } from './output.js';
 *
 * createHumanPackReport(report, { olderThan: '7d' });
 * ```
 */
export const createHumanPackReport = (
  report: PackSessionsReport,
  options: PackPlanOutputOptions,
): string => {
  const totals = readPackTotals(report);

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
    ...report.rows.map(createPackReportRow),
    '--------   --------  ----         ----------  ------  ------     -------    -----      -------  -----  ------',
    `${'total'.padEnd(10)} ${String(totals.foundSessions).padEnd(9)} ${''.padEnd(12)} ${String(totals.candidateSessions).padStart(10)}  ${String(totals.packedSessions).padStart(6)}  ${createBytes(totals.beforeBytes).padEnd(10)} ${createMaybeBytes(totals.archiveBytes).padEnd(10)} ${createMaybeBytes(totals.savedBytes).padEnd(10)} ${createMaybePercent(totals.savedPercent).padEnd(8)} ${createTouched(totals.touchedOriginals).padEnd(6)} ${report.apply ? 'applied' : 'dry-run'}`,
    '',
    ...createThresholdPreviewBlock(report.thresholdPreviews),
  ].join('\n');
};

/**
 * Formats a pack report for scripts and agents.
 *
 * @param report - Stable pack report.
 * @returns JSON output.
 * @example
 * ```ts
 * import { createJsonPackReport } from './output.js';
 *
 * createJsonPackReport(report);
 * ```
 */
export const createJsonPackReport = (report: PackSessionsReport): string =>
  `${JSON.stringify(report, null, 2)}\n`;

const createPackPlanRow = (packPlanRow: PackPlan['rows'][number]): string => {
  const provider = packPlanRow.provider.padEnd(10);
  const mode = packPlanRow.mode.padEnd(12);
  const found = String(packPlanRow.scannedSessions).padStart(5);
  const candidates = String(packPlanRow.candidateSessions).padStart(10);
  const before = createBytes(packPlanRow.beforeBytes).padEnd(10);
  const after = createBytes(packPlanRow.afterDryRunBytes).padEnd(15);
  const cleanup = createBytes(packPlanRow.cleanupBytes);

  return `${provider} ${mode} ${found}   ${candidates}   ${before} ${after} ${cleanup}`;
};

const createThresholdPreviewBlock = (
  previews: PackPlan['thresholdPreviews'],
): ReadonlyArray<string> => {
  const isPreviewsEmpty = previews.length === 0;
  if (isPreviewsEmpty) {
    return [];
  }

  return [
    'What if:',
    ...previews.map((preview) => {
      const label = createThresholdPreviewLabel(preview.kind).padEnd(11);
      const command = createThresholdPreviewCommand(preview).padEnd(17);
      const sessions = createSessionCount(preview.candidateSessions).padEnd(11);

      return `${label} ${command} ${sessions} ${createBytes(preview.beforeBytes)} source`;
    }),
    'Tip: use --max --dry-run to preview every archive-mode session without touching files.',
  ];
};

const createThresholdPreviewLabel = (
  kind: PackPlan['thresholdPreviews'][number]['kind'],
): string => {
  const isKindSafer = kind === 'safer';
  if (isKindSafer) {
    return 'safer';
  }

  const isKindBroader = kind === 'broader';
  if (isKindBroader) {
    return 'broader';
  }

  return 'max preview';
};

const createThresholdPreviewCommand = (preview: PackPlan['thresholdPreviews'][number]): string => {
  const isPreviewKindMax = preview.kind === 'max';
  if (isPreviewKindMax) {
    return '--max --dry-run';
  }

  return `--older-than ${preview.olderThan}`;
};

const createSessionCount = (sessions: number): string => {
  const isSingleSession = sessions === 1;
  if (isSingleSession) {
    return '1 session';
  }

  return `${sessions} sessions`;
};

const createPackReportRow = (packSessionRow: PackSessionsReport['rows'][number]): string => {
  const provider = packSessionRow.provider.padEnd(10);
  const sessions = String(packSessionRow.foundSessions).padEnd(9);
  const mode = packSessionRow.mode.padEnd(12);
  const candidates = String(packSessionRow.candidateSessions).padStart(10);
  const packed = String(packSessionRow.packedSessions).padStart(6);
  const before = createBytes(packSessionRow.beforeBytes).padEnd(10);
  const archive = createMaybeBytes(packSessionRow.archiveBytes).padEnd(10);
  const saved = createMaybeBytes(packSessionRow.savedBytes).padEnd(10);
  const savedPercent = createMaybePercent(packSessionRow.savedPercent).padEnd(8);
  const touched = createTouched(packSessionRow.touchedOriginals).padEnd(6);

  return `${provider} ${sessions} ${mode} ${candidates}  ${packed}  ${before} ${archive} ${saved} ${savedPercent} ${touched} ${createStatus(packSessionRow.status, packSessionRow.reason)}`;
};

const readPackTotals = (
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
  const isArchiveBytesMissing = archiveBytes == null;
  const savedBytes = isArchiveBytesMissing ? undefined : beforeBytes - archiveBytes;

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
    savedPercent: isArchiveBytesMissing ? undefined : readSavedPercent(beforeBytes, archiveBytes),
    touchedOriginals: report.rows.some((packSessionRow) => packSessionRow.touchedOriginals),
  };
};

const sumMaybe = (values: ReadonlyArray<number | undefined>): number | undefined => {
  const hasMissingValue = values.some((value) => value == null);
  if (hasMissingValue) {
    return undefined;
  }

  let totalBytes = 0;

  for (const value of values) {
    totalBytes += Number(value);
  }

  return totalBytes;
};

const createMaybeBytes = (bytes: number | undefined): string => {
  const isBytesMissing = bytes == null;
  if (isBytesMissing) {
    return 'pending';
  }

  return createBytes(bytes);
};

const createMaybePercent = (percent: number | undefined): string => {
  const isPercentMissing = percent == null;
  if (isPercentMissing) {
    return 'pending';
  }

  return `${percent.toFixed(1)}%`;
};
