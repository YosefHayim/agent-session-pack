import { describeBytes, describeOptionalBytes, describeOptionalPercent } from '@/byte-format.js';
import { calculateSavedPercent } from '@/byte-savings.js';
import type { LocalEvidenceReport, ProviderEvidence } from './local-evidence.js';

const MISSING_LABEL = '-';

export const createHumanEvidenceReport = (report: LocalEvidenceReport): string => {
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
  const totalFoundSessions = report.evidence.reduce(
    (totalSessions, providerEvidence) => totalSessions + providerEvidence.foundSessions,
    0,
  );
  const totalSampledOrigins = report.evidence.reduce(
    (totalSamples, providerEvidence) => totalSamples + providerEvidence.sampledSources,
    0,
  );
  const touchedOriginals = report.evidence.some(
    (providerEvidence) => providerEvidence.originalTouched,
  );
  const isNothingSampledInTotal = totalSampledOrigins === 0;
  const totalSavedPercent = isNothingSampledInTotal
    ? undefined
    : calculateSavedPercent(totalOriginBytes, totalArchiveBytes);

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
    `${'sample total'.padEnd(13)} ${String(totalFoundSessions).padEnd(11)} ${String(totalSampledOrigins).padEnd(8)} ${''.padEnd(12)} ${describeSampledBytes(totalOriginBytes, totalSampledOrigins).padEnd(13)} ${describeSampledBytes(totalArchiveBytes, totalSampledOrigins).padEnd(12)} ${describeOptionalPercent(totalSavedPercent, MISSING_LABEL).padEnd(8)} ${''.padEnd(7)} ${touchedOriginals ? 'yes' : 'no'}`,
    '',
    `Original sessions touched: ${touchedOriginals ? 'yes' : 'no'}`,
    `Work root: ${report.workRoot}`,
  ].join('\n');
};

export const createStructuredEvidenceReport = (report: LocalEvidenceReport): string =>
  `${JSON.stringify(report, null, 2)}\n`;

const createEvidenceLine = (providerEvidence: ProviderEvidence): string => {
  const provider = providerEvidence.provider.padEnd(13);
  const foundSessions = String(providerEvidence.foundSessions).padEnd(11);
  const sampledOrigins = String(providerEvidence.sampledSources).padEnd(8);
  const mode = providerEvidence.mode.padEnd(12);
  const before = describeOptionalBytes(providerEvidence.sourceBytes, MISSING_LABEL).padEnd(13);
  const after = describeOptionalBytes(providerEvidence.archiveBytes, MISSING_LABEL).padEnd(12);
  const saved = describeOptionalPercent(providerEvidence.savedPercent, MISSING_LABEL).padEnd(8);
  const exact = describeByteExact(providerEvidence.byteExact).padEnd(7);
  const touched = providerEvidence.originalTouched ? 'yes' : 'no';

  return `${provider} ${foundSessions} ${sampledOrigins} ${mode} ${before} ${after} ${saved} ${exact} ${touched}`;
};

const sumEvidenceBytes = (
  evidence: ReadonlyArray<ProviderEvidence>,
  key: 'archiveBytes' | 'sourceBytes',
): number =>
  evidence.reduce((totalBytes, providerEvidence) => totalBytes + (providerEvidence[key] ?? 0), 0);

const describeSampledBytes = (bytes: number, sampledOrigins: number): string => {
  const isNothingSampled = sampledOrigins === 0;
  return isNothingSampled ? MISSING_LABEL : describeBytes(bytes);
};

const describeByteExact = (byteExact: boolean | undefined): string => {
  const isByteExactMissing = byteExact == null;
  if (isByteExactMissing) {
    return MISSING_LABEL;
  }

  return byteExact ? 'yes' : 'no';
};
