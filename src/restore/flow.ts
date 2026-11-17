import type { CommandExit } from '@/command-outcome.js';
import type { InteractiveCliRequest } from '@/interactive-cli-request.js';
import type { PromptAdapter } from '@/prompt-adapter.js';
import { runWithSpinner } from '@/spinner-task.js';
import { runUnpackCommand } from './unpack-command.js';

const NO_FILES_CHANGED_MESSAGE = 'No files changed.';

export async function runRestoreFlow(
  request: InteractiveCliRequest & { readonly prompts: PromptAdapter },
): Promise<CommandExit> {
  const shouldPreview = await request.prompts.confirm({
    message: 'Preview archived sessions before restore?',
    initialValue: true,
  });

  const isPreviewCancelled = request.prompts.isCancel(shouldPreview);
  const isPreviewDeclined = shouldPreview !== true;
  const isPreviewStopped = isPreviewCancelled || isPreviewDeclined;
  if (isPreviewStopped) {
    request.prompts.cancel(NO_FILES_CHANGED_MESSAGE);
    return { exitCode: 0 };
  }

  function previewUnpack(): Promise<CommandExit> {
    return runUnpackCommand({
      allProviders: true,
      apply: false,
      json: false,
      provider: undefined,
      yes: false,
      confirmed: undefined,
    });
  }

  const previewExit = await runWithSpinner({
    prompts: request.prompts,
    startMessage: 'Scanning vault manifests...',
    stopMessage: 'Scanned vault manifests.',
    task: previewUnpack,
  });

  const shouldApply = await request.prompts.confirm({
    message: 'Restore archived sessions back to original provider paths?',
    initialValue: false,
  });

  const isApplyCancelled = request.prompts.isCancel(shouldApply);
  const isApplyDeclined = shouldApply !== true;
  const isApplyStopped = isApplyCancelled || isApplyDeclined;
  if (isApplyStopped) {
    request.prompts.outro(NO_FILES_CHANGED_MESSAGE);
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
}
