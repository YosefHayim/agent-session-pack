import { Effect } from 'effect';
import type { ProviderInventoryReport } from '../core/providerInventory.js';
import { resolveDefaultVaultPath } from '../core/sessionArchive.js';
import { formatBytes } from '../output/byteFormat.js';
import { allProviders } from '../providers/allProviders.js';
import { runPackCommand } from './commands/packCommand.js';
import { runScanCommand } from './commands/scanCommand.js';
import { runUnpackCommand } from './commands/unpackCommand.js';
import { HOME_NOT_SET_CANCEL_MESSAGE } from './homeEnv.js';
import {
  DEFAULT_COLD_AFTER,
  DEFAULT_OLDER_THAN_MS,
  formatProviderInventoryTable,
  type InteractiveCliRequest,
  loadInventoryWithSpinner,
  runWithSpinner,
} from './interactiveCliContext.js';
import type { PromptAdapter } from './promptAdapter.js';

/**
 * Reviews provider sessions with a spinner-backed inventory scan and scan command.
 *
 * @param request - Interactive request plus resolved prompt adapter.
 * @returns Promise that resolves after review output is shown.
 * @example
 * ```ts
 * import { runReviewSessions } from './interactiveSessionFlows.js';
 * import { clackPromptAdapter } from './promptAdapter.js';
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
    olderThanMs: request.olderThanMs ?? DEFAULT_OLDER_THAN_MS,
    prompts: request.prompts,
    providers: request.providers ?? allProviders,
    startMessage: 'Scanning provider stores...',
    stopMessage: 'Scanned provider stores.',
  });

  request.prompts.note(formatProviderInventoryTable(inventory), 'Provider sessions');
  await Effect.runPromise(runScanCommand({}));
};

/**
 * Runs the interactive pack flow: inventory, dry-run preview, then confirmed apply.
 *
 * @param request - Interactive request plus resolved prompt adapter.
 * @returns Promise that resolves after pack preview or apply completes.
 * @example
 * ```ts
 * import { runPackFlow } from './interactiveSessionFlows.js';
 * import { clackPromptAdapter } from './promptAdapter.js';
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
    olderThanMs: request.olderThanMs ?? DEFAULT_OLDER_THAN_MS,
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

/**
 * Runs the interactive restore flow: vault preview, then confirmed unpack apply.
 *
 * @param request - Interactive request plus resolved prompt adapter.
 * @returns Promise that resolves after restore preview or apply completes.
 * @example
 * ```ts
 * import { runRestoreFlow } from './interactiveSessionFlows.js';
 * import { clackPromptAdapter } from './promptAdapter.js';
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
