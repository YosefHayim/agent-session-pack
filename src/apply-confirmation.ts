import { confirm, isCancel } from '@clack/prompts';

export type ApplyConfirmationRequest = {
  readonly action: string;
  readonly apply: boolean | undefined;
  readonly json: boolean | undefined;
  readonly yes: boolean | undefined;
};

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

  const isMachineOutputRequested = request.json === true;
  if (isMachineOutputRequested) {
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
