/**
 * Formats whether a workflow touched original session files.
 *
 * @param touched - True when originals were changed.
 * @returns `yes` or `no`.
 * @example
 * ```ts
 * import { describeTouched } from './report-cells.js';
 *
 * describeTouched(false);
 * ```
 */
export const describeTouched = (touched: boolean): string => (touched ? 'yes' : 'no');

/**
 * Formats a report row status with its optional reason.
 *
 * @param status - Row status.
 * @param reason - Why the row has this status, when known.
 * @returns Status text, with the reason in parentheses when present.
 * @example
 * ```ts
 * import { describeStatus } from './report-cells.js';
 *
 * describeStatus('dry-run', '--apply required');
 * ```
 */
export const describeStatus = (status: string, reason: string | undefined): string => {
  const isReasonMissing = reason == null;
  if (isReasonMissing) {
    return status;
  }

  return `${status} (${reason})`;
};
