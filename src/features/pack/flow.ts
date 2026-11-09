import { Effect } from 'effect';
import { resolveDefaultVaultPath } from '@/features/archive/vault-paths.js';
import {
  formatProviderInventoryTable,
  loadInventoryWithSpinner,
} from '@/features/scan/inventory-prompt.js';
import type { ProviderInventoryReport } from '@/features/scan/provider-inventory.js';
import { allProviders } from '@/providers/all-providers.js';
import { formatBytes } from '@/shared/byte-format.js';
import { HOME_NOT_SET_CANCEL_MESSAGE } from '@/shared/home-env.js';
import type { InteractiveCliRequest } from '@/shared/interactive-cli-request.js';
import type { PromptAdapter } from '@/shared/prompt-adapter.js';
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
 * import { clackPromptAdapter } from '@/shared/prompt-adapter.js';
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
