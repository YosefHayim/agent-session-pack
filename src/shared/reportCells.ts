/**
 * Formats whether a workflow touched original session files.
 *
 * @param touched - True when originals were changed.
 * @returns `yes` or `no`.
 * @example
 * ```ts
 * import { formatTouched } from './reportCells.js';
 *
 * formatTouched(false);
 * ```
 */
export const formatTouched = (touched: boolean): string => (touched ? 'yes' : 'no');

/**
 * Formats a report row status with its optional reason.
 *
 * @param status - Row status.
 * @param reason - Why the row has this status, when known.
 * @returns Status text, with the reason in parentheses when present.
 * @example
 * ```ts
 * import { formatStatus } from './reportCells.js';
 *
 * formatStatus('dry-run', '--apply required');
 * ```
 */
export const formatStatus = (status: string, reason: string | undefined): string => {
  if (reason === undefined) {
    return status;
  }

  return `${status} (${reason})`;
};
