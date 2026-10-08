import { Effect } from 'effect';
import { allProviders } from '../../providers/allProviders.js';
import { formatBytes } from '../../shared/byteFormat.js';
import { HOME_NOT_SET_CANCEL_MESSAGE } from '../../shared/homeEnv.js';
import type { InteractiveCliRequest } from '../../shared/interactiveCliRequest.js';
import type { PromptAdapter } from '../../shared/promptAdapter.js';
import { resolveDefaultVaultPath } from '../archive/vaultPaths.js';
import { formatProviderInventoryTable, loadInventoryWithSpinner } from '../scan/inventoryPrompt.js';
import type { ProviderInventoryReport } from '../scan/providerInventory.js';
import { runPackCommand } from './packCommand.js';
import { DEFAULT_COLD_AFTER, DEFAULT_COLD_AFTER_MS } from './packPlan.js';

/**
 * Runs the interactive pack flow: inventory, dry-run preview, then confirmed apply.
 *
 * @param request - Interactive request plus resolved prompt adapter.
 * @returns Promise that resolves after pack preview or apply completes.
 * @example
 * ```ts
 * import { runPackFlow } from './packFlow.js';
 * import { clackPromptAdapter } from '../../shared/promptAdapter.js';
 *
 * await runPackFlow({ prompts: clackPromptAdapter });
 * ```
 */
export const runPackFlow = async (
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

  request.prompts.note(formatProviderInventoryTable(inventory), 'Pack cold sessions');

  const shouldPreview = await request.prompts.confirm({
    message: 'Continue with dry-run preview?',
    initialValue: true,
  });

  if (request.prompts.isCancel(shouldPreview) || shouldPreview !== true) {
    request.prompts.cancel('No files changed.');
    return;
  }

  await Effect.runPromise(
    runPackCommand({
      allProviders: true,
      apply: false,
      dryRun: true,
      json: false,
      olderThan: DEFAULT_COLD_AFTER,
      provider: undefined,
      yes: false,
      confirmed: undefined,
    }),
  );

  const shouldApply = await request.prompts.confirm({
    message: formatPackApplyQuestion(inventory, home),
    initialValue: false,
  });

  if (request.prompts.isCancel(shouldApply) || shouldApply !== true) {
    request.prompts.outro('No files changed.');
    return;
  }

  await Effect.runPromise(
    runPackCommand({
      allProviders: true,
      apply: true,
      dryRun: false,
      json: false,
      olderThan: DEFAULT_COLD_AFTER,
      provider: undefined,
      yes: true,
      confirmed: true,
    }),
  );
};

const formatPackApplyQuestion = (inventory: ProviderInventoryReport, home: string): string => {
  const candidateSessions = inventory.rows.reduce(
    (totalSessions, inventoryRow) => totalSessions + inventoryRow.coldSessions,
    0,
  );
  const candidateBytes = inventory.rows.reduce(
    (totalBytes, inventoryRow) => totalBytes + inventoryRow.candidateBytes,
    0,
  );
  const providerNames = inventory.rows
    .filter((inventoryRow) => inventoryRow.coldSessions > 0)
    .map((inventoryRow) => inventoryRow.provider)
    .join(', ');

  return [
    'Apply pack now?',
    '',
    `This will archive ${candidateSessions} cold sessions from ${providerNames || 'no providers'} into:`,
    resolveDefaultVaultPath(home),
    '',
    `Candidate size: ${formatBytes(candidateBytes)}`,
    'Original files are removed only after archive write, restore verification, and manifest write.',
  ].join('\n');
};
