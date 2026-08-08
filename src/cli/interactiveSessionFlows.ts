import { Effect } from 'effect';
import { type ProviderInventoryReport, resolveDefaultVaultPath } from '../core/index.js';
import { formatBytes } from '../output/index.js';
import { runPackCommand } from './commands/packCommand.js';
import { runScanCommand } from './commands/scanCommand.js';
import { runUnpackCommand } from './commands/unpackCommand.js';
import { homeNotSetCancelMessage } from './homeEnv.js';
import {
  defaultColdAfter,
  formatProviderInventoryTable,
  type InteractiveCliRequest,
  loadInventoryWithSpinner,
  normalizeHome,
  normalizeNow,
  normalizeOlderThanMs,
  normalizeProviders,
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
  const home = normalizeHome(request.home);

  if (home === undefined) {
    request.prompts.cancel(homeNotSetCancelMessage);
    return;
  }

  const inventory = await loadInventoryWithSpinner({
    home,
    now: normalizeNow(request.now),
    olderThanMs: normalizeOlderThanMs(request.olderThanMs),
    prompts: request.prompts,
    providers: normalizeProviders(request.providers),
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
  const home = normalizeHome(request.home);

  if (home === undefined) {
    request.prompts.cancel(homeNotSetCancelMessage);
    return;
  }

  const inventory = await loadInventoryWithSpinner({
    home,
    now: normalizeNow(request.now),
    olderThanMs: normalizeOlderThanMs(request.olderThanMs),
    prompts: request.prompts,
    providers: normalizeProviders(request.providers),
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
      olderThan: defaultColdAfter,
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
      olderThan: defaultColdAfter,
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
    (totalSessions, row) => totalSessions + row.coldSessions,
    0,
  );
  const candidateBytes = inventory.rows.reduce(
    (totalBytes, row) => totalBytes + row.candidateBytes,
    0,
  );
  const providerNames = inventory.rows
    .filter((row) => row.coldSessions > 0)
    .map((row) => row.provider)
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
