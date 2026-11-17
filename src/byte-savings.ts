import type { DiscoveredSession } from './session-model.js';

const WHOLE_PERCENT = 100;
const SAVED_PERCENT_DECIMAL_PLACES = 1;

export function sumSessionBytes(sessions: ReadonlyArray<DiscoveredSession>): number {
  function addSessionBytes(totalBytes: number, session: DiscoveredSession): number {
    return totalBytes + session.sizeBytes;
  }

  return sessions.reduce(addSessionBytes, 0);
}

export function calculateSavedPercent(originBytes: number, archiveBytes: number): number {
  const isOriginEmpty = originBytes === 0;
  if (isOriginEmpty) {
    return 0;
  }

  return Number(
    (WHOLE_PERCENT - (archiveBytes / originBytes) * WHOLE_PERCENT).toFixed(
      SAVED_PERCENT_DECIMAL_PLACES,
    ),
  );
}
