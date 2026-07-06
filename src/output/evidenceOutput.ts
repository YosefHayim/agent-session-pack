import type { LocalEvidenceEntry, LocalEvidenceReport } from '../core/index.js';
import { formatBytes } from './byteFormat.js';

/**
 * Formats local evidence output for terminal users.
 *
 * @param report - Copy-only local evidence report.
 * @returns Human-readable before and after table.
 */
export const formatHumanEvidenceReport = (report: LocalEvidenceReport): string => {
  if (report.evidence.length === 0) {
    return [
      'Local evidence',
      '',
      'No eligible sessions found.',
      `Work root: ${report.workRoot}`,
    ].join('\n');
  }

  const totalSourceBytes = sumEvidenceBytes(report.evidence, 'sourceBytes');
  const totalArchiveBytes = sumEvidenceBytes(report.evidence, 'archiveBytes');
  const totalFoundSessions = report.evidence.reduce(
    (totalSessions, entry) => totalSessions + entry.foundSessions,
    0,
  );
  const touchedOriginals = report.evidence.some((entry) => entry.originalTouched);
  const totalSavedPercent = savedPercent(totalSourceBytes, totalArchiveBytes);

  return [
    'Local evidence',
    '',
    'Copies only. Real session files are not modified.',
    '',
    'Provider   Sessions  Mode         Before     After      Saved    Exact   Touched',
    ...report.evidence.map(formatEvidenceRow),
    '--------   --------  ----         ------     -----      -----    -----   -------',
    `${'total'.padEnd(10)} ${String(totalFoundSessions).padEnd(9)} ${''.padEnd(12)} ${formatBytes(totalSourceBytes).padEnd(10)} ${formatBytes(totalArchiveBytes).padEnd(10)} ${formatPercent(totalSavedPercent).padEnd(8)} ${''.padEnd(7)} ${touchedOriginals ? 'yes' : 'no'}`,
    '',
    `Original sessions touched: ${touchedOriginals ? 'yes' : 'no'}`,
    `Work root: ${report.workRoot}`,
  ].join('\n');
};

/**
 * Formats local evidence output for scripts and agents.
 *
 * @param report - Copy-only local evidence report.
 * @returns Stable JSON output.
 */
export const formatJsonEvidenceReport = (report: LocalEvidenceReport): string =>
  `${JSON.stringify(report, null, 2)}\n`;

const formatEvidenceRow = (entry: LocalEvidenceEntry): string => {
  const provider = entry.provider.padEnd(10);
  const foundSessions = String(entry.foundSessions).padEnd(9);
  const mode = entry.mode.padEnd(12);
  const before = formatBytes(entry.sourceBytes).padEnd(10);
  const after = formatBytes(entry.archiveBytes).padEnd(10);
  const saved = formatPercent(entry.savedPercent).padEnd(8);
  const exact = (entry.byteExact ? 'yes' : 'no').padEnd(7);
  const touched = entry.originalTouched ? 'yes' : 'no';

  return `${provider} ${foundSessions} ${mode} ${before} ${after} ${saved} ${exact} ${touched}`;
};

const sumEvidenceBytes = (
  evidence: ReadonlyArray<LocalEvidenceEntry>,
  key: 'archiveBytes' | 'sourceBytes',
): number => evidence.reduce((totalBytes, entry) => totalBytes + entry[key], 0);

const savedPercent = (sourceBytes: number, archiveBytes: number): number => {
  if (sourceBytes === 0) {
    return 0;
  }

  return Number((100 - (archiveBytes / sourceBytes) * 100).toFixed(1));
};

const formatPercent = (percent: number): string => `${percent.toFixed(1)}%`;
