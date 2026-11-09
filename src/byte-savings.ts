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
 * @param sourceBytes - Original size in bytes.
 * @param archiveBytes - Compressed size in bytes.
 * @returns Saved percent, or 0 when the source is empty.
 * @example
 * ```ts
 * import { readSavedPercent } from './byte-savings.js';
 *
 * readSavedPercent(1000, 250);
 * ```
 */
export const readSavedPercent = (sourceBytes: number, archiveBytes: number): number => {
  const isSourceEmpty = sourceBytes === 0;
  if (isSourceEmpty) {
    return 0;
  }

  return Number((100 - (archiveBytes / sourceBytes) * 100).toFixed(1));
};
