import type { DiscoveredSession } from './session-model.js';

export const WHOLE_PERCENT = 100;
export const SAVED_PERCENT_DECIMAL_PLACES = 1;

export const sumSessionBytes = (sessions: ReadonlyArray<DiscoveredSession>): number =>
  sessions.reduce((totalBytes, session) => totalBytes + session.sizeBytes, 0);

export const calculateSavedPercent = (originBytes: number, archiveBytes: number): number => {
  const isOriginEmpty = originBytes === 0;
  if (isOriginEmpty) {
    return 0;
  }

  return Number(
    (WHOLE_PERCENT - (archiveBytes / originBytes) * WHOLE_PERCENT).toFixed(
      SAVED_PERCENT_DECIMAL_PLACES,
    ),
  );
};
