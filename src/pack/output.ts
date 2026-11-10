import { describeBytes, describeOptionalBytes, describeOptionalPercent } from '@/byte-format.js';
import { calculateSavedPercent } from '@/byte-savings.js';
import { describeStatus, describeTouched } from '@/report-cells.js';
import type { PackPlan } from './plan.js';
import type { PackSessionsReport } from './sessions.js';

/**
 * Render options for pack plan and report output.
 */
export type PackPlanPrintoutSettings = {
  readonly olderThan: string;
};

/**
 * Formats a non-destructive pack plan for terminal users.
 *
 * @param plan - Dry-run pack plan.
 * @param settings - Render options.
 * @returns Human-readable dry-run table.
 * @example
 * ```ts
 * import { createHumanPackPlan } from './output.js';
 *
 * createHumanPackPlan(plan, { olderThan: '7d' });
 * ```
 */
export const createHumanPackPlan = (plan: PackPlan, settings: PackPlanPrintoutSettings): string => {
  const totalBeforeBytes = plan.rows.reduce(
    (totalBytes, packPlanSummary) => totalBytes + packPlanSummary.beforeBytes,
    0,
  );

  return [
    'Pack dry run',
    '',
    `Cold threshold: ${settings.olderThan}`,
    'No files changed. Cleanup is 0 B until --apply is enabled and runs.',
    '',
    'Provider   Mode         Found   Candidates   Before     After dry-run   Cleanup',
    ...plan.rows.map(createPackPlanSummary),
    '--------   ----         -----   ----------   ------     -------------   -------',
    `${'total'.padEnd(10)} ${''.padEnd(12)} ${''.padStart(5)}   ${''.padStart(10)}   ${describeBytes(totalBeforeBytes).padEnd(10)} ${describeBytes(totalBeforeBytes).padEnd(15)} ${describeBytes(0)}`,
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
export const createStructuredPackPlan = (plan: PackPlan): string =>
  `${JSON.stringify(plan, null, 2)}\n`;

/**
 * Formats a pack report for terminal users.
 *
 * @param report - Pack workflow report.
 * @param settings - Render options.
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
  settings: PackPlanPrintoutSettings,
): string => {
  const totals = sumPackTotals(report);

  return [
    'Pack all providers',
    '',
    `Mode: ${report.apply ? 'apply' : 'dry-run'}`,
    `Cold threshold: ${settings.olderThan}`,
    `Vault: ${report.vaultPath}`,
    report.apply
      ? 'Confirmed. Originals are removed only after verified archives and manifests.'
      : 'No files changed. Re-run with --apply to pack cold sessions.',
    '',
    'Provider   Sessions  Mode         Candidates  Packed  Before     Archive    Saved      Saved %  Touch  Status',
    ...report.rows.map(createPackReportSummary),
    '--------   --------  ----         ----------  ------  ------     -------    -----      -------  -----  ------',
    `${'total'.padEnd(10)} ${String(totals.foundSessions).padEnd(9)} ${''.padEnd(12)} ${String(totals.candidateSessions).padStart(10)}  ${String(totals.packedSessions).padStart(6)}  ${describeBytes(totals.beforeBytes).padEnd(10)} ${describeOptionalBytes(totals.archiveBytes).padEnd(10)} ${describeOptionalBytes(totals.savedBytes).padEnd(10)} ${describeOptionalPercent(totals.savedPercent).padEnd(8)} ${describeTouched(totals.touchedOriginals).padEnd(6)} ${report.apply ? 'applied' : 'dry-run'}`,
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
export const createStructuredPackReport = (report: PackSessionsReport): string =>
  `${JSON.stringify(report, null, 2)}\n`;

const createPackPlanSummary = (packPlanSummary: PackPlan['rows'][number]): string => {
  const provider = packPlanSummary.provider.padEnd(10);
  const mode = packPlanSummary.mode.padEnd(12);
  const found = String(packPlanSummary.scannedSessions).padStart(5);
  const candidates = String(packPlanSummary.candidateSessions).padStart(10);
  const before = describeBytes(packPlanSummary.beforeBytes).padEnd(10);
  const after = describeBytes(packPlanSummary.afterDryRunBytes).padEnd(15);
  const cleanup = describeBytes(packPlanSummary.cleanupBytes);

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
      const sessions = describeSessionCount(preview.candidateSessions).padEnd(11);

      return `${label} ${command} ${sessions} ${describeBytes(preview.beforeBytes)} source`;
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

const describeSessionCount = (sessions: number): string => {
  const isSingleSession = sessions === 1;
  if (isSingleSession) {
    return '1 session';
  }

  return `${sessions} sessions`;
};

const createPackReportSummary = (
  packSessionSummary: PackSessionsReport['rows'][number],
): string => {
  const provider = packSessionSummary.provider.padEnd(10);
  const sessions = String(packSessionSummary.foundSessions).padEnd(9);
  const mode = packSessionSummary.mode.padEnd(12);
  const candidates = String(packSessionSummary.candidateSessions).padStart(10);
  const packed = String(packSessionSummary.packedSessions).padStart(6);
  const before = describeBytes(packSessionSummary.beforeBytes).padEnd(10);
  const archive = describeOptionalBytes(packSessionSummary.archiveBytes, 'pending').padEnd(10);
  const saved = describeOptionalBytes(packSessionSummary.savedBytes, 'pending').padEnd(10);
  const savedPercent = describeOptionalPercent(packSessionSummary.savedPercent, 'pending').padEnd(
    8,
  );
  const touched = describeTouched(packSessionSummary.touchedOriginals).padEnd(6);

  return `${provider} ${sessions} ${mode} ${candidates}  ${packed}  ${before} ${archive} ${saved} ${savedPercent} ${touched} ${describeStatus(packSessionSummary.status, packSessionSummary.reason)}`;
};

const sumPackTotals = (
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
  const archiveBytes = sumMaybe(
    report.rows.map((packSessionSummary) => packSessionSummary.archiveBytes),
  );
  const beforeBytes = report.rows.reduce(
    (totalBytes, packSessionSummary) => totalBytes + packSessionSummary.beforeBytes,
    0,
  );
  const isArchiveBytesMissing = archiveBytes == null;
  const savedBytes = isArchiveBytesMissing ? undefined : beforeBytes - archiveBytes;

  return {
    archiveBytes,
    beforeBytes,
    candidateSessions: report.rows.reduce(
      (totalSessions, packSessionSummary) => totalSessions + packSessionSummary.candidateSessions,
      0,
    ),
    foundSessions: report.rows.reduce(
      (totalSessions, packSessionSummary) => totalSessions + packSessionSummary.foundSessions,
      0,
    ),
    packedSessions: report.rows.reduce(
      (totalSessions, packSessionSummary) => totalSessions + packSessionSummary.packedSessions,
      0,
    ),
    savedBytes,
    savedPercent: isArchiveBytesMissing
      ? undefined
      : calculateSavedPercent(beforeBytes, archiveBytes),
    touchedOriginals: report.rows.some((packSessionSummary) => packSessionSummary.touchedOriginals),
  };
};

const sumMaybe = (numbers: ReadonlyArray<number | undefined>): number | undefined => {
  const hasMissingNumber = numbers.some((number) => number == null);
  if (hasMissingNumber) {
    return undefined;
  }

  let totalBytes = 0;

  for (const number of numbers) {
    totalBytes += Number(number);
  }

  return totalBytes;
};
