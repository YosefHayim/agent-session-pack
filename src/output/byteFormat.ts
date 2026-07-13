const bytesPerUnit = 1024;
const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

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
  if (bytes < bytesPerUnit) {
    return `${bytes} B`;
  }

  let value = bytes;
  let unitIndex = 0;

  while (value >= bytesPerUnit && unitIndex < units.length - 1) {
    value = value / bytesPerUnit;
    unitIndex += 1;
  }

  if (value >= 100) {
    return `${value.toFixed(0)} ${units[unitIndex]}`;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
};
