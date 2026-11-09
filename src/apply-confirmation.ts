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
 * import { askApplyConfirmation } from './apply-confirmation.js';
 *
 * const confirmed = await askApplyConfirmation({
 *   action: 'Pack cold sessions',
 *   apply: true,
 *   json: false,
 *   yes: true,
 * });
 * ```
 */
export const askApplyConfirmation = async (
  request: ApplyConfirmationRequest,
): Promise<boolean | undefined> => {
  const isApplyNotRequested = request.apply !== true;
  if (isApplyNotRequested) {
    return undefined;
  }

  const isYesRequested = request.yes === true;
  if (isYesRequested) {
    return true;
  }

  const isJsonOutputRequested = request.json === true;
  if (isJsonOutputRequested) {
    return false;
  }

  const isInteractiveTerminalMissing =
    process.stdin.isTTY !== true || process.stdout.isTTY !== true;
  if (isInteractiveTerminalMissing) {
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
