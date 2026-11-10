import type { DiscoveredSession } from './session-model.js';

/**
 * Sums the source bytes of discovered sessions.
 *
 * @param sessions - Sessions to total.
 * @returns Total size in bytes.
 * @example
 * ```ts
 * import { sumSessionBytes } from './byte-savings.js';
 *
 * const totalBytes = sumSessionBytes(sessions);
 * ```
 */
export const sumSessionBytes = (sessions: ReadonlyArray<DiscoveredSession>): number =>
  sessions.reduce((totalBytes, session) => totalBytes + session.sizeBytes, 0);

/**
 * Computes the percent of source bytes saved by an archive, rounded to one decimal.
 *
 * @param originBytes - Original size in bytes.
 * @param archiveBytes - Compressed size in bytes.
 * @returns Saved percent, or 0 when the source is empty.
 * @example
 * ```ts
 * import { calculateSavedPercent } from './byte-savings.js';
 *
 * calculateSavedPercent(1000, 250);
 * ```
 */
export const calculateSavedPercent = (originBytes: number, archiveBytes: number): number => {
  const isOriginEmpty = originBytes === 0;
  if (isOriginEmpty) {
    return 0;
  }

  return Number((100 - (archiveBytes / originBytes) * 100).toFixed(1));
};
