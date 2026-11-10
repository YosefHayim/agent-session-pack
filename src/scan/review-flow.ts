import type { CommandExit } from '@/command-outcome.js';
import { HOME_NOT_SET_CANCEL_MESSAGE } from '@/home-env.js';
import type { InteractiveCliRequest } from '@/interactive-cli-request.js';
import { DEFAULT_COLD_AFTER_MS } from '@/pack/plan.js';
import type { PromptAdapter } from '@/prompt-adapter.js';
import { allProviders } from '@/providers/all-providers.js';
import { runScanCommand } from './command.js';
import { createProviderInventoryTable, loadInventoryWithSpinner } from './inventory-prompt.js';

export const runReviewSessions = async (
  request: InteractiveCliRequest & { readonly prompts: PromptAdapter },
): Promise<CommandExit> => {
  const home = request.home ?? process.env.HOME;

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    request.prompts.cancel(HOME_NOT_SET_CANCEL_MESSAGE);
    return { exitCode: 0 };
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

  request.prompts.note(createProviderInventoryTable(inventory), 'Provider sessions');
  return runScanCommand({});
};
