import { Effect } from 'effect';
import type { InteractiveCliRequest } from '../../shared/interactiveCliRequest.js';
import type { PromptAdapter } from '../../shared/promptAdapter.js';
import { runWithSpinner } from '../../shared/spinnerTask.js';
import { runUnpackCommand } from './unpackCommand.js';

/**
 * Runs the interactive restore flow: vault preview, then confirmed unpack apply.
 *
 * @param request - Interactive request plus resolved prompt adapter.
 * @returns Promise that resolves after restore preview or apply completes.
 * @example
 * ```ts
 * import { runRestoreFlow } from './restoreFlow.js';
 * import { clackPromptAdapter } from '../shared/promptAdapter.js';
 *
 * await runRestoreFlow({ prompts: clackPromptAdapter });
 * ```
 */
export const runRestoreFlow = async (
  request: InteractiveCliRequest & { readonly prompts: PromptAdapter },
): Promise<void> => {
  const shouldPreview = await request.prompts.confirm({
    message: 'Preview archived sessions before restore?',
    initialValue: true,
  });

  if (request.prompts.isCancel(shouldPreview) || shouldPreview !== true) {
    request.prompts.cancel('No files changed.');
    return;
  }

  await runWithSpinner({
    prompts: request.prompts,
    startMessage: 'Scanning vault manifests...',
    stopMessage: 'Scanned vault manifests.',
    task: () =>
      Effect.runPromise(
        runUnpackCommand({
          allProviders: true,
          apply: false,
          json: false,
          provider: undefined,
          yes: false,
          confirmed: undefined,
        }),
      ),
  });

  const shouldApply = await request.prompts.confirm({
    message: 'Restore archived sessions back to original provider paths?',
    initialValue: false,
  });

  if (request.prompts.isCancel(shouldApply) || shouldApply !== true) {
    request.prompts.outro('No files changed.');
    return;
  }

  await Effect.runPromise(
    runUnpackCommand({
      allProviders: true,
      apply: true,
      json: false,
      provider: undefined,
      yes: true,
      confirmed: true,
    }),
  );
};
