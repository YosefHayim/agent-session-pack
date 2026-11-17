import type { DiscoveredSession } from '@/session-model.js';
import type { ScanReport } from './stores.js';

const MAX_TITLE_PREVIEW_LENGTH = 96;

export function createHumanScan(report: ScanReport): string {
  const isReportSessionsEmpty = report.sessions.length === 0;
  if (isReportSessionsEmpty) {
    return 'No sessions found.';
  }

  const sessionLines = report.sessions.map(createSessionLine);

  return [
    'Found sessions',
    '',
    'Provider   Date         Size       Status   Name   Path',
    ...sessionLines,
  ].join('\n');
}

export function writeHumanScan(report: ScanReport): void {
  console.log(createHumanScan(report));
}

function createSessionLine(session: DiscoveredSession): string {
  const provider = session.provider.padEnd(10);
  const isoDateLength = 10;
  const date = session.modifiedAt.toISOString().slice(0, isoDateLength);
  const size = `${session.sizeBytes} B`.padEnd(10);
  const status = describeSessionStatus(session).padEnd(8);
  const title = createTitlePreview(session.title);

  return `${provider} ${date}   ${size} ${status} ${title}   ${session.originalPath}`;
}

function describeSessionStatus(session: DiscoveredSession): string {
  const isSessionStatusKnown = session.status != null;
  if (isSessionStatusKnown) {
    return session.status;
  }

  return 'live';
}

function createTitlePreview(title: string): string {
  const singleLineTitle = title.replace(/\s+/g, ' ').trim();

  const isTitleShortEnough = singleLineTitle.length <= MAX_TITLE_PREVIEW_LENGTH;
  if (isTitleShortEnough) {
    return singleLineTitle;
  }

  return `${singleLineTitle.slice(0, MAX_TITLE_PREVIEW_LENGTH - 3)}...`;
}

function createStructuredScan(report: ScanReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function writeStructuredScan(report: ScanReport): void {
  process.stdout.write(createStructuredScan(report));
}
