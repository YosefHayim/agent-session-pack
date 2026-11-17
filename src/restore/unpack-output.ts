import { describeBytes } from '@/byte-format.js';
import { describeStatus, describeTouched } from '@/report-cells.js';
import type { UnpackSessionsReport } from './unpack-sessions.js';

type UnpackSessionSummary = UnpackSessionsReport['rows'][number];

type SummableField =
  | 'alreadyPresentSessions'
  | 'archiveBytes'
  | 'archivedSessions'
  | 'beforeBytes'
  | 'conflictSessions'
  | 'restoredBytes'
  | 'restoredSessions';

const DRY_RUN_LABEL = 'dry-run';
const PROVIDER_COLUMN_WIDTH = 10;
const ARCHIVED_COLUMN_WIDTH = 9;
const RESTORED_COLUMN_WIDTH = 9;
const PRESENT_COLUMN_WIDTH = 8;
const CONFLICTS_COLUMN_WIDTH = 10;
const BYTES_COLUMN_WIDTH = 10;
const TOUCHED_COLUMN_WIDTH = 6;

export function createHumanUnpackReport(report: UnpackSessionsReport): string {
  const totals = sumUnpackTotals(report);
  const isApplyMode = report.apply;

  const modeLabel = isApplyMode ? 'apply' : DRY_RUN_LABEL;
  const appliedLabel = isApplyMode ? 'applied' : DRY_RUN_LABEL;
  const applyNotice = isApplyMode
    ? 'Confirmed. Existing changed live files are not overwritten.'
    : 'No files changed. Re-run with --apply to restore archived sessions.';
  const totalLine = createUnpackReportLine({
    provider: 'total',
    summary: totals,
    status: appliedLabel,
  });

  return [
    'Unpack all providers',
    '',
    `Mode: ${modeLabel}`,
    `Vault: ${report.vaultPath}`,
    applyNotice,
    '',
    'Provider   Archived  Restored  Present  Conflicts  Before     Archive    Restored   Touch  Status',
    ...report.rows.map(createUnpackReportSummary),
    '--------   --------  --------  -------  ---------  ------     -------    --------   -----  ------',
    totalLine,
  ].join('\n');
}

function createUnpackReportSummary(unpackSessionSummary: UnpackSessionSummary): string {
  return createUnpackReportLine({
    provider: unpackSessionSummary.provider,
    summary: unpackSessionSummary,
    status: describeStatus(unpackSessionSummary.status, unpackSessionSummary.reason),
  });
}

function createUnpackReportLine(line: {
  readonly provider: string;
  readonly summary: UnpackTotals;
  readonly status: string;
}): string {
  const summary = line.summary;
  const provider = line.provider.padEnd(PROVIDER_COLUMN_WIDTH);
  const archived = String(summary.archivedSessions).padEnd(ARCHIVED_COLUMN_WIDTH);
  const restored = String(summary.restoredSessions).padEnd(RESTORED_COLUMN_WIDTH);
  const present = String(summary.alreadyPresentSessions).padEnd(PRESENT_COLUMN_WIDTH);
  const conflicts = String(summary.conflictSessions).padEnd(CONFLICTS_COLUMN_WIDTH);
  const before = describeBytes(summary.beforeBytes).padEnd(BYTES_COLUMN_WIDTH);
  const archive = describeBytes(summary.archiveBytes).padEnd(BYTES_COLUMN_WIDTH);
  const restoredBytes = describeBytes(summary.restoredBytes).padEnd(BYTES_COLUMN_WIDTH);
  const touched = describeTouched(summary.touchedOriginals).padEnd(TOUCHED_COLUMN_WIDTH);

  return `${provider} ${archived} ${restored} ${present} ${conflicts} ${before} ${archive} ${restoredBytes} ${touched} ${line.status}`;
}

interface UnpackTotals {
  readonly alreadyPresentSessions: number;
  readonly archiveBytes: number;
  readonly archivedSessions: number;
  readonly beforeBytes: number;
  readonly conflictSessions: number;
  readonly restoredBytes: number;
  readonly restoredSessions: number;
  readonly touchedOriginals: boolean;
}

function sumUnpackTotals(report: UnpackSessionsReport): UnpackTotals {
  const rows = report.rows;

  function isTouched(unpackSessionSummary: UnpackSessionSummary): boolean {
    return unpackSessionSummary.touchedOriginals;
  }

  return {
    alreadyPresentSessions: sumRowField(rows, 'alreadyPresentSessions'),
    archiveBytes: sumRowField(rows, 'archiveBytes'),
    archivedSessions: sumRowField(rows, 'archivedSessions'),
    beforeBytes: sumRowField(rows, 'beforeBytes'),
    conflictSessions: sumRowField(rows, 'conflictSessions'),
    restoredBytes: sumRowField(rows, 'restoredBytes'),
    restoredSessions: sumRowField(rows, 'restoredSessions'),
    touchedOriginals: rows.some(isTouched),
  };
}

function sumRowField(rows: ReadonlyArray<UnpackSessionSummary>, field: SummableField): number {
  let total = 0;
  for (const unpackSessionSummary of rows) {
    total += unpackSessionSummary[field];
  }
  return total;
}
