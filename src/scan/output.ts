import type { DiscoveredSession } from '@/session-model.js';
import type { ScanReport } from './stores.js';

const MAX_TITLE_PREVIEW_LENGTH = 96;

/**
 * Formats scan output for terminal users.
 *
 * @param report - Scan report to render.
 * @returns Human-readable scan summary.
 * @example
 * ```ts
 * import { formatHumanScan } from './output.js';
 *
 * formatHumanScan(report);
 * ```
 */
export const formatHumanScan = (report: ScanReport): string => {
  const isReportSessionsEmpty = report.sessions.length === 0;
  if (isReportSessionsEmpty) {
    return 'No sessions found.';
  }

  const sessionRows = report.sessions.map(formatSessionRow);

  return [
    'Found sessions',
    '',
    'Provider   Date         Size       Status   Name   Path',
    ...sessionRows,
  ].join('\n');
};

/**
 * Writes scan output for terminal users.
 *
 * @param report - Scan report to render.
 */
export const renderHumanScan = (report: ScanReport): void => {
  console.log(formatHumanScan(report));
};

const formatSessionRow = (session: DiscoveredSession): string => {
  const provider = session.provider.padEnd(10);
  const date = session.modifiedAt.toISOString().slice(0, 10);
  const size = `${session.sizeBytes} B`.padEnd(10);
  const status = formatStatus(session).padEnd(8);
  const title = formatTitlePreview(session.title);

  return `${provider} ${date}   ${size} ${status} ${title}   ${session.originalPath}`;
};

const formatStatus = (session: DiscoveredSession): string => {
  const isSessionStatusKnown = session.status != null;
  if (isSessionStatusKnown) {
    return session.status;
  }

  return 'live';
};

const formatTitlePreview = (title: string): string => {
  const singleLineTitle = title.replace(/\s+/g, ' ').trim();

  const isTitleShortEnough = singleLineTitle.length <= MAX_TITLE_PREVIEW_LENGTH;
  if (isTitleShortEnough) {
    return singleLineTitle;
  }

  return `${singleLineTitle.slice(0, MAX_TITLE_PREVIEW_LENGTH - 3)}...`;
};

const formatJsonScan = (report: ScanReport): string => `${JSON.stringify(report, null, 2)}\n`;

/**
 * Writes scan output for agents.
 *
 * @param report - Scan report to render.
 */
export const renderJsonScan = (report: ScanReport): void => {
  process.stdout.write(formatJsonScan(report));
};
