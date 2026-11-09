import type { CommandOutcome } from '@/command-outcome.js';
import type { InteractiveCliRequest } from '@/interactive-cli-request.js';
import type { PromptAdapter } from '@/prompt-adapter.js';
import { runWithSpinner } from '@/spinner-task.js';
import { runUnpackCommand } from './unpack-command.js';

/**
 * Runs the interactive restore flow: vault preview, then confirmed unpack apply.
 *
 * @param request - Interactive request plus resolved prompt adapter.
 * @returns Promise that resolves after restore preview or apply completes.
 */
export const runRestoreFlow = async (
  request: InteractiveCliRequest & { readonly prompts: PromptAdapter },
): Promise<CommandOutcome> => {
  const shouldPreview = await request.prompts.confirm({
    message: 'Preview archived sessions before restore?',
    initialValue: true,
  });

  if (request.prompts.isCancel(shouldPreview) || shouldPreview !== true) {
    request.prompts.cancel('No files changed.');
    return { exitCode: 0 };
  }

  const previewOutcome = await runWithSpinner({
    prompts: request.prompts,
    startMessage: 'Scanning vault manifests...',
    stopMessage: 'Scanned vault manifests.',
    task: () =>
      runUnpackCommand({
        allProviders: true,
        apply: false,
        json: false,
        provider: undefined,
        yes: false,
        confirmed: undefined,
      }),
  });

  const shouldApply = await request.prompts.confirm({
    message: 'Restore archived sessions back to original provider paths?',
    initialValue: false,
  });

  if (request.prompts.isCancel(shouldApply) || shouldApply !== true) {
    request.prompts.outro('No files changed.');
    return previewOutcome;
  }

  const applyOutcome = await runUnpackCommand({
    allProviders: true,
    apply: true,
    json: false,
    provider: undefined,
    yes: true,
    confirmed: true,
  });
  return applyOutcome;
};
