import { describeBytes, describeOptionalBytes, describeOptionalPercent } from '@/byte-format.js';
import { calculateSavedPercent } from '@/byte-savings.js';
import type { LocalEvidenceReport, ProviderEvidence } from './local-evidence.js';

const MISSING_LABEL = '-';
const YES_LABEL = 'yes';
const NO_LABEL = 'no';
const PROVIDER_COLUMN_WIDTH = 13;
const DISCOVERED_COLUMN_WIDTH = 11;
const SAMPLES_COLUMN_WIDTH = 8;
const MODE_COLUMN_WIDTH = 12;
const BEFORE_COLUMN_WIDTH = 13;
const AFTER_COLUMN_WIDTH = 12;
const SAVED_COLUMN_WIDTH = 8;
const EXACT_COLUMN_WIDTH = 7;

export function createHumanEvidenceReport(report: LocalEvidenceReport): string {
  const isReportEvidenceEmpty = report.evidence.length === 0;
  if (isReportEvidenceEmpty) {
    return [
      'Local evidence',
      '',
      'No eligible sessions found.',
      `Work root: ${report.workRoot}`,
    ].join('\n');
  }

  const totalOriginBytes = sumEvidenceBytes(report.evidence, 'sourceBytes');
  const totalArchiveBytes = sumEvidenceBytes(report.evidence, 'archiveBytes');
  const totalFoundSessions = report.evidence.reduce(addFoundSessions, 0);
  const totalSampledOrigins = report.evidence.reduce(addSampledSources, 0);
  const touchedOriginals = report.evidence.some(isOriginalTouched);
  const touchedLabel = touchedOriginals ? YES_LABEL : NO_LABEL;
  const totalSavedPercent = describeSampledPercent(
    totalOriginBytes,
    totalArchiveBytes,
    totalSampledOrigins,
  );
  const totalBefore = describeSampledBytes(totalOriginBytes, totalSampledOrigins);
  const totalAfter = describeSampledBytes(totalArchiveBytes, totalSampledOrigins);

  return [
    'Local evidence',
    '',
    'Copies only. Real session files are not modified.',
    'One eligible source per provider is copied and measured.',
    'Proof bytes are not a whole-store estimate.',
    '',
    'Provider      Discovered  Samples  Mode         Proof before  Proof after  Saved    Exact   Touched',
    ...report.evidence.map(createEvidenceLine),
    '------------- -----------  -------- ----------- ------------- ------------ -------- ------- -------',
    `${'sample total'.padEnd(PROVIDER_COLUMN_WIDTH)} ${String(totalFoundSessions).padEnd(DISCOVERED_COLUMN_WIDTH)} ${String(totalSampledOrigins).padEnd(SAMPLES_COLUMN_WIDTH)} ${''.padEnd(MODE_COLUMN_WIDTH)} ${totalBefore.padEnd(BEFORE_COLUMN_WIDTH)} ${totalAfter.padEnd(AFTER_COLUMN_WIDTH)} ${totalSavedPercent.padEnd(SAVED_COLUMN_WIDTH)} ${''.padEnd(EXACT_COLUMN_WIDTH)} ${touchedLabel}`,
    '',
    `Original sessions touched: ${touchedLabel}`,
    `Work root: ${report.workRoot}`,
  ].join('\n');
}

export function createStructuredEvidenceReport(report: LocalEvidenceReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function addFoundSessions(totalSessions: number, providerEvidence: ProviderEvidence): number {
  return totalSessions + providerEvidence.foundSessions;
}

function addSampledSources(totalSamples: number, providerEvidence: ProviderEvidence): number {
  return totalSamples + providerEvidence.sampledSources;
}

function isOriginalTouched(providerEvidence: ProviderEvidence): boolean {
  return providerEvidence.originalTouched;
}

function createEvidenceLine(providerEvidence: ProviderEvidence): string {
  const provider = providerEvidence.provider.padEnd(PROVIDER_COLUMN_WIDTH);
  const foundSessions = String(providerEvidence.foundSessions).padEnd(DISCOVERED_COLUMN_WIDTH);
  const sampledOrigins = String(providerEvidence.sampledSources).padEnd(SAMPLES_COLUMN_WIDTH);
  const mode = providerEvidence.mode.padEnd(MODE_COLUMN_WIDTH);
  const before = describeOptionalBytes(providerEvidence.sourceBytes, MISSING_LABEL).padEnd(
    BEFORE_COLUMN_WIDTH,
  );
  const after = describeOptionalBytes(providerEvidence.archiveBytes, MISSING_LABEL).padEnd(
    AFTER_COLUMN_WIDTH,
  );
  const saved = describeOptionalPercent(providerEvidence.savedPercent, MISSING_LABEL).padEnd(
    SAVED_COLUMN_WIDTH,
  );
  const exact = describeByteExact(providerEvidence.byteExact).padEnd(EXACT_COLUMN_WIDTH);
  const touched = providerEvidence.originalTouched ? YES_LABEL : NO_LABEL;

  return `${provider} ${foundSessions} ${sampledOrigins} ${mode} ${before} ${after} ${saved} ${exact} ${touched}`;
}

function sumEvidenceBytes(
  evidence: ReadonlyArray<ProviderEvidence>,
  key: 'archiveBytes' | 'sourceBytes',
): number {
  function addEvidenceBytes(totalBytes: number, providerEvidence: ProviderEvidence): number {
    return totalBytes + (providerEvidence[key] ?? 0);
  }

  return evidence.reduce(addEvidenceBytes, 0);
}

function describeSampledBytes(bytes: number, sampledOrigins: number): string {
  const isNothingSampled = sampledOrigins === 0;
  return isNothingSampled ? MISSING_LABEL : describeBytes(bytes);
}

function describeSampledPercent(
  originBytes: number,
  archiveBytes: number,
  sampledOrigins: number,
): string {
  const isNothingSampled = sampledOrigins === 0;
  if (isNothingSampled) {
    return describeOptionalPercent(undefined, MISSING_LABEL);
  }

  return describeOptionalPercent(calculateSavedPercent(originBytes, archiveBytes), MISSING_LABEL);
}

function describeByteExact(byteExact: boolean | undefined): string {
  const isByteExactMissing = byteExact == null;
  if (isByteExactMissing) {
    return MISSING_LABEL;
  }

  return byteExact ? YES_LABEL : NO_LABEL;
}
