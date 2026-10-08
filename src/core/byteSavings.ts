import type { DiscoveredSession } from './sessionStore.js';

/**
 * Sums the source bytes of discovered sessions.
 *
 * @param sessions - Sessions to total.
 * @returns Total size in bytes.
 * @example
 * ```ts
 * import { sumSessionBytes } from './byteSavings.js';
 *
 * const totalBytes = sumSessionBytes(sessions);
 * ```
 */
export const sumSessionBytes = (sessions: ReadonlyArray<DiscoveredSession>): number =>
  sessions.reduce((totalBytes, session) => totalBytes + session.sizeBytes, 0);

/**
 * Computes the percent of source bytes saved by an archive, rounded to one decimal.
 *
 * @param sourceBytes - Original size in bytes.
 * @param archiveBytes - Compressed size in bytes.
 * @returns Saved percent, or 0 when the source is empty.
 * @example
 * ```ts
 * import { savedPercent } from './byteSavings.js';
 *
 * savedPercent(1000, 250);
 * ```
 */
export const savedPercent = (sourceBytes: number, archiveBytes: number): number => {
  if (sourceBytes === 0) {
    return 0;
  }

  return Number((100 - (archiveBytes / sourceBytes) * 100).toFixed(1));
};
