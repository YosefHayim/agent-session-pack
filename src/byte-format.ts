const BYTES_PER_UNIT = 1024;
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Formats bytes for compact terminal tables.
 *
 * @param bytes - Raw byte count.
 * @returns Human-readable byte count.
 * @example
 * ```ts
 * import { describeBytes } from './byte-format.js';
 *
 * describeBytes(2048);
 * ```
 */
export const describeBytes = (bytes: number): string => {
  const isBelowUnit = bytes < BYTES_PER_UNIT;
  if (isBelowUnit) {
    return `${bytes} B`;
  }

  let remainingBytes = bytes;
  let unitIndex = 0;

  while (remainingBytes >= BYTES_PER_UNIT && unitIndex < BYTE_UNITS.length - 1) {
    remainingBytes = remainingBytes / BYTES_PER_UNIT;
    unitIndex += 1;
  }

  const hasThreeOrMoreDigits = remainingBytes >= 100;
  if (hasThreeOrMoreDigits) {
    return `${remainingBytes.toFixed(0)} ${BYTE_UNITS[unitIndex]}`;
  }

  return `${remainingBytes.toFixed(1)} ${BYTE_UNITS[unitIndex]}`;
};

/**
 * Formats an optional byte count, showing `missingLabel` when it is not known.
 */
export const describeOptionalBytes = (bytes: number | undefined, missingLabel: string): string => {
  const isBytesMissing = bytes == null;
  if (isBytesMissing) {
    return missingLabel;
  }

  return describeBytes(bytes);
};

/**
 * Formats an optional percent, showing `missingLabel` when it is not known.
 */
export const describeOptionalPercent = (
  percent: number | undefined,
  missingLabel: string,
): string => {
  const isPercentMissing = percent == null;
  if (isPercentMissing) {
    return missingLabel;
  }

  return `${percent.toFixed(1)}%`;
};
