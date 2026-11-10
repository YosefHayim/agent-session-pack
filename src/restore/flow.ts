import type { CommandExit } from '@/command-outcome.js';
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
): Promise<CommandExit> => {
  const shouldPreview = await request.prompts.confirm({
    message: 'Preview archived sessions before restore?',
    initialValue: true,
  });

  const isPreviewStopped = request.prompts.isCancel(shouldPreview) || shouldPreview !== true;
  if (isPreviewStopped) {
    request.prompts.cancel('No files changed.');
    return { exitCode: 0 };
  }

  const previewExit = await runWithSpinner({
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

  const isApplyStopped = request.prompts.isCancel(shouldApply) || shouldApply !== true;
  if (isApplyStopped) {
    request.prompts.outro('No files changed.');
    return previewExit;
  }

  const applyExit = await runUnpackCommand({
    allProviders: true,
    apply: true,
    json: false,
    provider: undefined,
    yes: true,
    confirmed: true,
  });
  return applyExit;
};
