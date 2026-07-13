import { confirm, isCancel } from '@clack/prompts';

/**
 * Describes an apply-mode confirmation request for a destructive command.
 */
export type ApplyConfirmationRequest = {
  readonly action: string;
  readonly apply: boolean | undefined;
  readonly json: boolean | undefined;
  readonly yes: boolean | undefined;
};

/**
 * Resolves whether an apply-mode command is confirmed.
 *
 * @param request - Apply flags and prompt message.
 * @returns Confirmation state for the command workflow.
 * @example
 * ```ts
 * import { resolveApplyConfirmation } from './applyConfirmation.js';
 *
 * const confirmed = await resolveApplyConfirmation({
 *   action: 'Pack cold sessions',
 *   apply: true,
 *   json: false,
 *   yes: true,
 * });
 * ```
 */
export const resolveApplyConfirmation = async (
  request: ApplyConfirmationRequest,
): Promise<boolean | undefined> => {
  if (request.apply !== true) {
    return undefined;
  }

  if (request.yes === true) {
    return true;
  }

  if (request.json === true) {
    return false;
  }

  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    return false;
  }

  const answer = await confirm({
    message: `${request.action}. Continue?`,
    initialValue: false,
  });

  if (isCancel(answer)) {
    return false;
  }

  return answer === true;
};
