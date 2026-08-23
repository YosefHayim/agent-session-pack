import type { LocalEvidenceEntry, LocalEvidenceReport } from '../core/localEvidence.js';
import { formatBytes } from './byteFormat.js';

/**
 * Formats local evidence output for terminal users.
 *
 * @param report - Copy-only local evidence report.
 * @returns Human-readable before and after table.
 * @example
 * ```ts
 * import { formatHumanEvidenceReport } from './evidenceOutput.js';
 *
 * formatHumanEvidenceReport(report);
 * ```
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
  const totalSampledSources = report.evidence.reduce(
    (totalSamples, entry) => totalSamples + entry.sampledSources,
    0,
  );
  const touchedOriginals = report.evidence.some((entry) => entry.originalTouched);
  const totalSavedPercent =
    totalSampledSources === 0 ? undefined : savedPercent(totalSourceBytes, totalArchiveBytes);

  return [
    'Local evidence',
    '',
    'Copies only. Real session files are not modified.',
    'One eligible source per provider is copied and measured.',
    'Proof bytes are not a whole-store estimate.',
    '',
    'Provider      Discovered  Samples  Mode         Proof before  Proof after  Saved    Exact   Touched',
    ...report.evidence.map(formatEvidenceRow),
    '------------- -----------  -------- ----------- ------------- ------------ -------- ------- -------',
    `${'sample total'.padEnd(13)} ${String(totalFoundSessions).padEnd(11)} ${String(totalSampledSources).padEnd(8)} ${''.padEnd(12)} ${formatMaybeBytes(totalSourceBytes, totalSampledSources).padEnd(13)} ${formatMaybeBytes(totalArchiveBytes, totalSampledSources).padEnd(12)} ${formatMaybePercent(totalSavedPercent).padEnd(8)} ${''.padEnd(7)} ${touchedOriginals ? 'yes' : 'no'}`,
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
 * @example
 * ```ts
 * import { formatJsonEvidenceReport } from './evidenceOutput.js';
 *
 * formatJsonEvidenceReport(report);
 * ```
 */
export const formatJsonEvidenceReport = (report: LocalEvidenceReport): string =>
  `${JSON.stringify(report, null, 2)}\n`;

const formatEvidenceRow = (entry: LocalEvidenceEntry): string => {
  const provider = entry.provider.padEnd(13);
  const foundSessions = String(entry.foundSessions).padEnd(11);
  const sampledSources = String(entry.sampledSources).padEnd(8);
  const mode = entry.mode.padEnd(12);
  const before = formatOptionalBytes(entry.sourceBytes).padEnd(13);
  const after = formatOptionalBytes(entry.archiveBytes).padEnd(12);
  const saved = formatMaybePercent(entry.savedPercent).padEnd(8);
  const exact = formatExact(entry.byteExact).padEnd(7);
  const touched = entry.originalTouched ? 'yes' : 'no';

  return `${provider} ${foundSessions} ${sampledSources} ${mode} ${before} ${after} ${saved} ${exact} ${touched}`;
};

const sumEvidenceBytes = (
  evidence: ReadonlyArray<LocalEvidenceEntry>,
  key: 'archiveBytes' | 'sourceBytes',
): number => evidence.reduce((totalBytes, entry) => totalBytes + (entry[key] ?? 0), 0);

const formatOptionalBytes = (bytes: number | undefined): string =>
  bytes === undefined ? '-' : formatBytes(bytes);

const formatMaybeBytes = (bytes: number, sampledSources: number): string =>
  sampledSources === 0 ? '-' : formatBytes(bytes);

const savedPercent = (sourceBytes: number, archiveBytes: number): number => {
  if (sourceBytes === 0) {
    return 0;
  }

  return Number((100 - (archiveBytes / sourceBytes) * 100).toFixed(1));
};

const formatPercent = (percent: number): string => `${percent.toFixed(1)}%`;

const formatMaybePercent = (percent: number | undefined): string =>
  percent === undefined ? '-' : formatPercent(percent);

const formatExact = (byteExact: boolean | undefined): string => {
  if (byteExact === undefined) {
    return '-';
  }

  return byteExact ? 'yes' : 'no';
};
