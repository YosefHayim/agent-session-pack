import { describeBytes } from '@/byte-format.js';
import type { PromptAdapter } from '@/prompt-adapter.js';
import type { ProviderAdapter } from '@/session-model.js';
import { runWithSpinner } from '@/spinner-task.js';
import { inspectProviderInventory, type ProviderInventoryReport } from './provider-inventory.js';

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
 * import { loadInventoryWithSpinner } from './inventory-prompt.js';
 * import { clackPromptAdapter } from '@/prompt-adapter.js';
 * import { allProviders } from '@/providers/all-providers.js';
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
      inspectProviderInventory({
        home: request.home,
        providers: request.providers,
        olderThanMs: request.olderThanMs,
        now: request.now,
      }),
  });

/**
 * Formats a provider inventory report as a fixed-width table for Clack notes.
 *
 * @param report - Inventory rows from provider discovery.
 * @returns Multi-line table string, or a empty-store message.
 * @example
 * ```ts
 * import { createProviderInventoryTable } from './inventory-prompt.js';
 *
 * const table = createProviderInventoryTable({ rows: [] });
 * ```
 */
export const createProviderInventoryTable = (report: ProviderInventoryReport): string => {
  const isReportRowsEmpty = report.rows.length === 0;
  if (isReportRowsEmpty) {
    return 'No provider stores found.';
  }

  return [
    'Provider   Mode         Sessions   Cold   Guarded recent   Size       Path',
    ...report.rows.map(createProviderInventoryRow),
  ].join('\n');
};

const createProviderInventoryRow = (
  inventoryRow: ProviderInventoryReport['rows'][number],
): string => {
  const provider = inventoryRow.provider.padEnd(10);
  const mode = inventoryRow.mode.padEnd(12);
  const sessions = String(inventoryRow.sessions).padStart(8);
  const cold = String(inventoryRow.coldSessions).padStart(6);
  const guarded = String(inventoryRow.guardedRecentSessions).padStart(16);
  const size = describeBytes(inventoryRow.candidateBytes).padEnd(10);
  const path = inventoryRow.paths.join(', ');

  return `${provider} ${mode} ${sessions}   ${cold}   ${guarded}   ${size} ${path}`;
};
