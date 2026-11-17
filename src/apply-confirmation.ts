import { confirm, isCancel } from '@clack/prompts';

export interface ApplyConfirmationRequest {
  readonly action: string;
  readonly apply: boolean | undefined;
  readonly json: boolean | undefined;
  readonly yes: boolean | undefined;
}

export async function askApplyConfirmation(
  request: ApplyConfirmationRequest,
): Promise<boolean | undefined> {
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

  const isInputNotTerminal = process.stdin.isTTY !== true;
  if (isInputNotTerminal) {
    return false;
  }

  const isOutputNotTerminal = process.stdout.isTTY !== true;
  if (isOutputNotTerminal) {
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
}
