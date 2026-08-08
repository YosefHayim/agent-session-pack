const BYTES_PER_UNIT = 1024;
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Formats bytes for compact terminal tables.
 *
 * @param bytes - Raw byte count.
 * @returns Human-readable byte count.
 * @example
 * ```ts
 * import { formatBytes } from './byteFormat.js';
 *
 * formatBytes(2048);
 * ```
 */
export const formatBytes = (bytes: number): string => {
  if (bytes < BYTES_PER_UNIT) {
    return `${bytes} B`;
  }

  let value = bytes;
  let unitIndex = 0;

  while (value >= BYTES_PER_UNIT && unitIndex < BYTE_UNITS.length - 1) {
    value = value / BYTES_PER_UNIT;
    unitIndex += 1;
  }

  if (value >= 100) {
    return `${value.toFixed(0)} ${BYTE_UNITS[unitIndex]}`;
  }

  return `${value.toFixed(1)} ${BYTE_UNITS[unitIndex]}`;
};
