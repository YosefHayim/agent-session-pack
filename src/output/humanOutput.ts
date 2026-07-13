import { Effect } from 'effect';
import type { DiscoveredSession, ScanReport } from '../core/index.js';

const maxTitlePreviewLength = 96;

/**
 * Formats scan output for terminal users.
 *
 * @param report - Scan report to render.
 * @returns Human-readable scan summary.
 * @example
 * ```ts
 * import { formatHumanScan } from './humanOutput.js';
 *
 * formatHumanScan(report);
 * ```
 */
export const formatHumanScan = (report: ScanReport): string => {
  if (report.sessions.length === 0) {
    return 'No sessions found.';
  }

  const rows = report.sessions.map(formatSessionRow);

  return [
    'Found sessions',
    '',
    'Provider   Date         Size       Status   Name   Path',
    ...rows,
  ].join('\n');
};

/**
 * Writes scan output for terminal users.
 *
 * @param report - Scan report to render.
 * @returns Effect completing after output.
 * @example
 * ```ts
 * import { renderHumanScan } from './humanOutput.js';
 *
 * renderHumanScan(report);
 * ```
 */
export const renderHumanScan = (report: ScanReport): Effect.Effect<void> =>
  Effect.sync(() => {
    console.log(formatHumanScan(report));
  });

const formatSessionRow = (session: DiscoveredSession): string => {
  const provider = session.provider.padEnd(10);
  const date = session.modifiedAt.toISOString().slice(0, 10);
  const size = `${session.sizeBytes} B`.padEnd(10);
  const status = formatStatus(session).padEnd(8);
  const title = formatTitlePreview(session.title);

  return `${provider} ${date}   ${size} ${status} ${title}   ${session.originalPath}`;
};

const formatStatus = (session: DiscoveredSession): string => {
  if (session.status !== undefined) {
    return session.status;
  }

  return 'live';
};

const formatTitlePreview = (title: string): string => {
  const singleLineTitle = title.replace(/\s+/g, ' ').trim();

  if (singleLineTitle.length <= maxTitlePreviewLength) {
    return singleLineTitle;
  }

  return `${singleLineTitle.slice(0, maxTitlePreviewLength - 3)}...`;
};
