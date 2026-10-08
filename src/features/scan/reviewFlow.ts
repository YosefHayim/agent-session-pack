import { Effect } from 'effect';
import { allProviders } from '../../providers/allProviders.js';
import { HOME_NOT_SET_CANCEL_MESSAGE } from '../../shared/homeEnv.js';
import type { InteractiveCliRequest } from '../../shared/interactiveCliRequest.js';
import type { PromptAdapter } from '../../shared/promptAdapter.js';
import { DEFAULT_COLD_AFTER_MS } from '../pack/packPlan.js';
import { formatProviderInventoryTable, loadInventoryWithSpinner } from './inventoryPrompt.js';
import { runScanCommand } from './scanCommand.js';

/**
 * Reviews provider sessions with a spinner-backed inventory scan and scan command.
 *
 * @param request - Interactive request plus resolved prompt adapter.
 * @returns Promise that resolves after review output is shown.
 * @example
 * ```ts
 * import { runReviewSessions } from './reviewFlow.js';
 * import { clackPromptAdapter } from '../shared/promptAdapter.js';
 *
 * await runReviewSessions({ prompts: clackPromptAdapter });
 * ```
 */
export const runReviewSessions = async (
  request: InteractiveCliRequest & { readonly prompts: PromptAdapter },
): Promise<void> => {
  const home = request.home ?? process.env.HOME;

  if (home === undefined) {
    request.prompts.cancel(HOME_NOT_SET_CANCEL_MESSAGE);
    return;
  }

  const inventory = await loadInventoryWithSpinner({
    home,
    now: request.now ?? new Date(),
    olderThanMs: request.olderThanMs ?? DEFAULT_COLD_AFTER_MS,
    prompts: request.prompts,
    providers: request.providers ?? allProviders,
    startMessage: 'Scanning provider stores...',
    stopMessage: 'Scanned provider stores.',
  });

  request.prompts.note(formatProviderInventoryTable(inventory), 'Provider sessions');
  await Effect.runPromise(runScanCommand({}));
};
