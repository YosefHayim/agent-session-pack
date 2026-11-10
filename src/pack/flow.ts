import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import { describeBytes } from '@/byte-format.js';
import type { CommandExit } from '@/command-outcome.js';
import { HOME_NOT_SET_CANCEL_MESSAGE } from '@/home-env.js';
import type { InteractiveCliRequest } from '@/interactive-cli-request.js';
import type { PromptAdapter } from '@/prompt-adapter.js';
import { allProviders } from '@/providers/all-providers.js';
import { createProviderInventoryTable, loadInventoryWithSpinner } from '@/scan/inventory-prompt.js';
import type { ProviderInventoryReport } from '@/scan/provider-inventory.js';
import { runPackCommand } from './command.js';
import { DEFAULT_COLD_AFTER, DEFAULT_COLD_AFTER_MS } from './plan.js';

/**
 * Runs the interactive pack flow: inventory, dry-run preview, then confirmed apply.
 *
 * @param request - Interactive request plus resolved prompt adapter.
 * @returns Promise that resolves after pack preview or apply completes.
 * @example
 * ```ts
 * import { runPackFlow } from './flow.js';
 * import { clackPromptAdapter } from '@/prompt-adapter.js';
 *
 * await runPackFlow({ prompts: clackPromptAdapter });
 * ```
 */
export const runPackFlow = async (
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

  request.prompts.note(createProviderInventoryTable(inventory), 'Pack cold sessions');

  const shouldPreview = await request.prompts.confirm({
    message: 'Continue with dry-run preview?',
    initialValue: true,
  });

  const isPreviewStopped = request.prompts.isCancel(shouldPreview) || shouldPreview !== true;
  if (isPreviewStopped) {
    request.prompts.cancel('No files changed.');
    return { exitCode: 0 };
  }

  const previewExit = await runPackCommand({
    allProviders: true,
    apply: false,
    dryRun: true,
    json: false,
    olderThan: DEFAULT_COLD_AFTER,
    provider: undefined,
    yes: false,
    confirmed: undefined,
  });

  const shouldApply = await request.prompts.confirm({
    message: createPackApplyQuestion(inventory, home),
    initialValue: false,
  });

  const isApplyStopped = request.prompts.isCancel(shouldApply) || shouldApply !== true;
  if (isApplyStopped) {
    request.prompts.outro('No files changed.');
    return previewExit;
  }

  const applyExit = await runPackCommand({
    allProviders: true,
    apply: true,
    dryRun: false,
    json: false,
    olderThan: DEFAULT_COLD_AFTER,
    provider: undefined,
    yes: true,
    confirmed: true,
  });
  return applyExit;
};

const createPackApplyQuestion = (inventory: ProviderInventoryReport, home: string): string => {
  const candidateSessions = inventory.rows.reduce(
    (totalSessions, inventorySummary) => totalSessions + inventorySummary.coldSessions,
    0,
  );
  const candidateBytes = inventory.rows.reduce(
    (totalBytes, inventorySummary) => totalBytes + inventorySummary.candidateBytes,
    0,
  );
  const providerNames = inventory.rows
    .filter((inventorySummary) => inventorySummary.coldSessions > 0)
    .map((inventorySummary) => inventorySummary.provider)
    .join(', ');

  return [
    'Apply pack now?',
    '',
    `This will archive ${candidateSessions} cold sessions from ${providerNames || 'no providers'} into:`,
    createDefaultVaultPath(home),
    '',
    `Candidate size: ${describeBytes(candidateBytes)}`,
    'Original files are removed only after archive write, restore verification, and manifest write.',
  ].join('\n');
};
