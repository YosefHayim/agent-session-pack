import { describeBytes, describeOptionalBytes, describeOptionalPercent } from '@/byte-format.js';
import { calculateSavedPercent } from '@/byte-savings.js';
import { describeStatus, describeTouched } from '@/report-cells.js';
import type { PackPlan } from './plan.js';
import type { PackSessionsReport } from './sessions.js';

const PENDING_LABEL = 'pending';
const TOTAL_LABEL = 'total';
const DRY_RUN_LABEL = 'dry-run';
const SAFER_PREVIEW_KIND = 'safer';
const BROADER_PREVIEW_KIND = 'broader';
const LINE_BREAK = '\n';
const JSON_INDENT = 2;

const PROVIDER_COLUMN_WIDTH = 10;
const MODE_COLUMN_WIDTH = 12;
const PLAN_FOUND_COLUMN_WIDTH = 5;
const PLAN_CANDIDATES_COLUMN_WIDTH = 10;
const PLAN_BEFORE_COLUMN_WIDTH = 10;
const PLAN_AFTER_COLUMN_WIDTH = 15;
const REPORT_SESSIONS_COLUMN_WIDTH = 9;
const REPORT_CANDIDATES_COLUMN_WIDTH = 10;
const REPORT_PACKED_COLUMN_WIDTH = 6;
const REPORT_BEFORE_COLUMN_WIDTH = 10;
const REPORT_ARCHIVE_COLUMN_WIDTH = 10;
const REPORT_SAVED_COLUMN_WIDTH = 10;
const REPORT_SAVED_PERCENT_COLUMN_WIDTH = 8;
const REPORT_TOUCHED_COLUMN_WIDTH = 6;
const PREVIEW_LABEL_COLUMN_WIDTH = 11;
const PREVIEW_COMMAND_COLUMN_WIDTH = 17;
const PREVIEW_SESSIONS_COLUMN_WIDTH = 11;

type PackReportRow = PackSessionsReport['rows'][number];
type PackPlanRow = PackPlan['rows'][number];
type ThresholdPreview = PackPlan['thresholdPreviews'][number];

export interface PackPlanPrintoutSettings {
  readonly olderThan: string;
}

export function createHumanPackPlan(plan: PackPlan, settings: PackPlanPrintoutSettings): string {
  const totalBeforeBytes = plan.rows.reduce(addPlanBeforeBytes, 0);
  const totalProvider = TOTAL_LABEL.padEnd(PROVIDER_COLUMN_WIDTH);
  const totalMode = ''.padEnd(MODE_COLUMN_WIDTH);
  const totalFound = ''.padStart(PLAN_FOUND_COLUMN_WIDTH);
  const totalCandidates = ''.padStart(PLAN_CANDIDATES_COLUMN_WIDTH);
  const totalBefore = describeBytes(totalBeforeBytes).padEnd(PLAN_BEFORE_COLUMN_WIDTH);
  const totalAfter = describeBytes(totalBeforeBytes).padEnd(PLAN_AFTER_COLUMN_WIDTH);
  const totalCleanup = describeBytes(0);

  return [
    'Pack dry run',
    '',
    `Cold threshold: ${settings.olderThan}`,
    'No files changed. Cleanup is 0 B until --apply is enabled and runs.',
    '',
    'Provider   Mode         Found   Candidates   Before     After dry-run   Cleanup',
    ...plan.rows.map(createPackPlanSummary),
    '--------   ----         -----   ----------   ------     -------------   -------',
    `${totalProvider} ${totalMode} ${totalFound}   ${totalCandidates}   ${totalBefore} ${totalAfter} ${totalCleanup}`,
    '',
    ...createThresholdPreviewBlock(plan.thresholdPreviews),
    '',
    'Backup-only providers are scanned for visibility but skipped for cleanup.',
    'Re-run with --apply to pack cold sessions.',
  ].join(LINE_BREAK);
}

export function createStructuredPackPlan(plan: PackPlan): string {
  return `${JSON.stringify(plan, null, JSON_INDENT)}${LINE_BREAK}`;
}

export function createHumanPackReport(
  report: PackSessionsReport,
  settings: PackPlanPrintoutSettings,
): string {
  const totals = sumPackTotals(report);
  const isApplyReport = report.apply;
  const modeLabel = isApplyReport ? 'apply' : DRY_RUN_LABEL;
  const confirmationLine = isApplyReport
    ? 'Confirmed. Originals are removed only after verified archives and manifests.'
    : 'No files changed. Re-run with --apply to pack cold sessions.';
  const statusLabel = isApplyReport ? 'applied' : DRY_RUN_LABEL;

  const totalProvider = TOTAL_LABEL.padEnd(PROVIDER_COLUMN_WIDTH);
  const totalSessions = String(totals.foundSessions).padEnd(REPORT_SESSIONS_COLUMN_WIDTH);
  const totalMode = ''.padEnd(MODE_COLUMN_WIDTH);
  const totalCandidates = String(totals.candidateSessions).padStart(REPORT_CANDIDATES_COLUMN_WIDTH);
  const totalPacked = String(totals.packedSessions).padStart(REPORT_PACKED_COLUMN_WIDTH);
  const totalBefore = describeBytes(totals.beforeBytes).padEnd(REPORT_BEFORE_COLUMN_WIDTH);
  const totalArchive = describeOptionalBytes(totals.archiveBytes, PENDING_LABEL).padEnd(
    REPORT_ARCHIVE_COLUMN_WIDTH,
  );
  const totalSaved = describeOptionalBytes(totals.savedBytes, PENDING_LABEL).padEnd(
    REPORT_SAVED_COLUMN_WIDTH,
  );
  const totalSavedPercent = describeOptionalPercent(totals.savedPercent, PENDING_LABEL).padEnd(
    REPORT_SAVED_PERCENT_COLUMN_WIDTH,
  );
  const totalTouched = describeTouched(totals.touchedOriginals).padEnd(REPORT_TOUCHED_COLUMN_WIDTH);

  return [
    'Pack all providers',
    '',
    `Mode: ${modeLabel}`,
    `Cold threshold: ${settings.olderThan}`,
    `Vault: ${report.vaultPath}`,
    confirmationLine,
    '',
    'Provider   Sessions  Mode         Candidates  Packed  Before     Archive    Saved      Saved %  Touch  Status',
    ...report.rows.map(createPackReportSummary),
    '--------   --------  ----         ----------  ------  ------     -------    -----      -------  -----  ------',
    `${totalProvider} ${totalSessions} ${totalMode} ${totalCandidates}  ${totalPacked}  ${totalBefore} ${totalArchive} ${totalSaved} ${totalSavedPercent} ${totalTouched} ${statusLabel}`,
    '',
    ...createThresholdPreviewBlock(report.thresholdPreviews),
  ].join(LINE_BREAK);
}

export function createStructuredPackReport(report: PackSessionsReport): string {
  return `${JSON.stringify(report, null, JSON_INDENT)}${LINE_BREAK}`;
}

function addPlanBeforeBytes(totalBytes: number, packPlanSummary: PackPlanRow): number {
  return totalBytes + packPlanSummary.beforeBytes;
}

function createPackPlanSummary(packPlanSummary: PackPlanRow): string {
  const provider = packPlanSummary.provider.padEnd(PROVIDER_COLUMN_WIDTH);
  const mode = packPlanSummary.mode.padEnd(MODE_COLUMN_WIDTH);
  const found = String(packPlanSummary.scannedSessions).padStart(PLAN_FOUND_COLUMN_WIDTH);
  const candidates = String(packPlanSummary.candidateSessions).padStart(
    PLAN_CANDIDATES_COLUMN_WIDTH,
  );
  const before = describeBytes(packPlanSummary.beforeBytes).padEnd(PLAN_BEFORE_COLUMN_WIDTH);
  const after = describeBytes(packPlanSummary.afterDryRunBytes).padEnd(PLAN_AFTER_COLUMN_WIDTH);
  const cleanup = describeBytes(packPlanSummary.cleanupBytes);

  return `${provider} ${mode} ${found}   ${candidates}   ${before} ${after} ${cleanup}`;
}

function createThresholdPreviewBlock(
  previews: PackPlan['thresholdPreviews'],
): ReadonlyArray<string> {
  const isPreviewsEmpty = previews.length === 0;
  if (isPreviewsEmpty) {
    return [];
  }

  return [
    'What if:',
    ...previews.map(createThresholdPreviewLine),
    'Tip: use --max --dry-run to preview every archive-mode session without touching files.',
  ];
}

function createThresholdPreviewLine(preview: ThresholdPreview): string {
  const label = createThresholdPreviewLabel(preview.kind).padEnd(PREVIEW_LABEL_COLUMN_WIDTH);
  const command = createThresholdPreviewCommand(preview).padEnd(PREVIEW_COMMAND_COLUMN_WIDTH);
  const sessions = describeSessionCount(preview.candidateSessions).padEnd(
    PREVIEW_SESSIONS_COLUMN_WIDTH,
  );

  return `${label} ${command} ${sessions} ${describeBytes(preview.beforeBytes)} source`;
}

function createThresholdPreviewLabel(kind: ThresholdPreview['kind']): string {
  const isKindSafer = kind === SAFER_PREVIEW_KIND;
  if (isKindSafer) {
    return SAFER_PREVIEW_KIND;
  }

  const isKindBroader = kind === BROADER_PREVIEW_KIND;
  if (isKindBroader) {
    return BROADER_PREVIEW_KIND;
  }

  return 'max preview';
}

function createThresholdPreviewCommand(preview: ThresholdPreview): string {
  const isPreviewKindMax = preview.kind === 'max';
  if (isPreviewKindMax) {
    return '--max --dry-run';
  }

  return `--older-than ${preview.olderThan}`;
}

function describeSessionCount(sessions: number): string {
  const isSingleSession = sessions === 1;
  if (isSingleSession) {
    return '1 session';
  }

  return `${sessions} sessions`;
}

function createPackReportSummary(packSessionSummary: PackReportRow): string {
  const provider = packSessionSummary.provider.padEnd(PROVIDER_COLUMN_WIDTH);
  const sessions = String(packSessionSummary.foundSessions).padEnd(REPORT_SESSIONS_COLUMN_WIDTH);
  const mode = packSessionSummary.mode.padEnd(MODE_COLUMN_WIDTH);
  const candidates = String(packSessionSummary.candidateSessions).padStart(
    REPORT_CANDIDATES_COLUMN_WIDTH,
  );
  const packed = String(packSessionSummary.packedSessions).padStart(REPORT_PACKED_COLUMN_WIDTH);
  const before = describeBytes(packSessionSummary.beforeBytes).padEnd(REPORT_BEFORE_COLUMN_WIDTH);
  const archive = describeOptionalBytes(packSessionSummary.archiveBytes, PENDING_LABEL).padEnd(
    REPORT_ARCHIVE_COLUMN_WIDTH,
  );
  const saved = describeOptionalBytes(packSessionSummary.savedBytes, PENDING_LABEL).padEnd(
    REPORT_SAVED_COLUMN_WIDTH,
  );
  const savedPercent = describeOptionalPercent(
    packSessionSummary.savedPercent,
    PENDING_LABEL,
  ).padEnd(REPORT_SAVED_PERCENT_COLUMN_WIDTH);
  const touched = describeTouched(packSessionSummary.touchedOriginals).padEnd(
    REPORT_TOUCHED_COLUMN_WIDTH,
  );
  const status = describeStatus(packSessionSummary.status, packSessionSummary.reason);

  return `${provider} ${sessions} ${mode} ${candidates}  ${packed}  ${before} ${archive} ${saved} ${savedPercent} ${touched} ${status}`;
}

function readArchiveBytes(packSessionSummary: PackReportRow): number | undefined {
  return packSessionSummary.archiveBytes;
}

function addReportBeforeBytes(totalBytes: number, packSessionSummary: PackReportRow): number {
  return totalBytes + packSessionSummary.beforeBytes;
}

function addCandidateSessions(totalSessions: number, packSessionSummary: PackReportRow): number {
  return totalSessions + packSessionSummary.candidateSessions;
}

function addFoundSessions(totalSessions: number, packSessionSummary: PackReportRow): number {
  return totalSessions + packSessionSummary.foundSessions;
}

function addPackedSessions(totalSessions: number, packSessionSummary: PackReportRow): number {
  return totalSessions + packSessionSummary.packedSessions;
}

function hasTouchedOriginals(packSessionSummary: PackReportRow): boolean {
  return packSessionSummary.touchedOriginals;
}

function sumPackTotals(report: PackSessionsReport): {
  readonly archiveBytes: number | undefined;
  readonly beforeBytes: number;
  readonly candidateSessions: number;
  readonly foundSessions: number;
  readonly packedSessions: number;
  readonly savedBytes: number | undefined;
  readonly savedPercent: number | undefined;
  readonly touchedOriginals: boolean;
} {
  const archiveBytesSum = sumMaybe(report.rows.map(readArchiveBytes));
  const archiveBytes = archiveBytesSum ?? undefined;
  const beforeBytes = report.rows.reduce(addReportBeforeBytes, 0);
  const isArchiveBytesMissing = archiveBytes == null;
  const savedBytes = isArchiveBytesMissing ? undefined : beforeBytes - archiveBytes;

  return {
    archiveBytes,
    beforeBytes,
    candidateSessions: report.rows.reduce(addCandidateSessions, 0),
    foundSessions: report.rows.reduce(addFoundSessions, 0),
    packedSessions: report.rows.reduce(addPackedSessions, 0),
    savedBytes,
    savedPercent: isArchiveBytesMissing
      ? undefined
      : calculateSavedPercent(beforeBytes, archiveBytes),
    touchedOriginals: report.rows.some(hasTouchedOriginals),
  };
}

function isNumberMissing(maybeBytes: number | undefined): boolean {
  return maybeBytes == null;
}

function sumMaybe(maybeByteCounts: ReadonlyArray<number | undefined>): number | null {
  const hasMissingNumber = maybeByteCounts.some(isNumberMissing);
  if (hasMissingNumber) {
    return null;
  }

  let totalBytes = 0;

  for (const maybeBytes of maybeByteCounts) {
    totalBytes += Number(maybeBytes);
  }

  return totalBytes;
}
