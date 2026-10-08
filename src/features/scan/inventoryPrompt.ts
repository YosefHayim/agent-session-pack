import { Effect } from 'effect';
import { formatBytes } from '../../shared/byteFormat.js';
import type { PromptAdapter } from '../../shared/promptAdapter.js';
import type { ProviderAdapter } from '../../shared/sessionModel.js';
import { runWithSpinner } from '../../shared/spinnerTask.js';
import { inspectProviderInventory, type ProviderInventoryReport } from './providerInventory.js';

/**
 * Inputs for spinner-backed provider inventory discovery.
 */
export type InventorySpinnerRequest = {
  readonly home: string;
  readonly now: Date;
  readonly olderThanMs: number;
  readonly prompts: PromptAdapter;
  readonly providers: ReadonlyArray<ProviderAdapter>;
  readonly startMessage: string;
  readonly stopMessage: string;
};

/**
 * Loads provider inventory under a spinner for interactive setup and pack flows.
 *
 * @param request - Home, clock, threshold, providers, prompts, and spinner copy.
 * @returns Provider inventory report used by subsequent prompts.
 * @example
 * ```ts
 * import { loadInventoryWithSpinner } from './inventoryPrompt.js';
 * import { clackPromptAdapter } from '../../shared/promptAdapter.js';
 * import { allProviders } from '../../providers/allProviders.js';
 *
 * const inventory = await loadInventoryWithSpinner({
 *   home: process.env.HOME!,
 *   now: new Date(),
 *   olderThanMs: 7 * 24 * 60 * 60 * 1000,
 *   prompts: clackPromptAdapter,
 *   providers: allProviders,
 *   startMessage: 'Scanning provider stores...',
 *   stopMessage: 'Scanned provider stores.',
 * });
 * ```
 */
export const loadInventoryWithSpinner = (
  request: InventorySpinnerRequest,
): Promise<ProviderInventoryReport> =>
  runWithSpinner({
    prompts: request.prompts,
    startMessage: request.startMessage,
    stopMessage: request.stopMessage,
    task: () =>
      Effect.runPromise(
        inspectProviderInventory({
          home: request.home,
          providers: request.providers,
          olderThanMs: request.olderThanMs,
          now: request.now,
        }),
      ),
  });

/**
 * Formats a provider inventory report as a fixed-width table for Clack notes.
 *
 * @param report - Inventory rows from provider discovery.
 * @returns Multi-line table string, or a empty-store message.
 * @example
 * ```ts
 * import { formatProviderInventoryTable } from './inventoryPrompt.js';
 *
 * const table = formatProviderInventoryTable({ rows: [] });
 * ```
 */
export const formatProviderInventoryTable = (report: ProviderInventoryReport): string => {
  if (report.rows.length === 0) {
    return 'No provider stores found.';
  }

  return [
    'Provider   Mode         Sessions   Cold   Guarded recent   Size       Path',
    ...report.rows.map(formatProviderInventoryRow),
  ].join('\n');
};

const formatProviderInventoryRow = (
  inventoryRow: ProviderInventoryReport['rows'][number],
): string => {
  const provider = inventoryRow.provider.padEnd(10);
  const mode = inventoryRow.mode.padEnd(12);
  const sessions = String(inventoryRow.sessions).padStart(8);
  const cold = String(inventoryRow.coldSessions).padStart(6);
  const guarded = String(inventoryRow.guardedRecentSessions).padStart(16);
  const size = formatBytes(inventoryRow.candidateBytes).padEnd(10);
  const path = inventoryRow.paths.join(', ');

  return `${provider} ${mode} ${sessions}   ${cold}   ${guarded}   ${size} ${path}`;
};
