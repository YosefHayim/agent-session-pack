import { Effect } from 'effect';
import {
  inspectProviderInventory,
  type ProviderInventoryReport,
} from '../core/providerInventory.js';
import type { ProviderAdapter } from '../core/sessionStore.js';
import { formatBytes } from '../output/byteFormat.js';
import type { PromptAdapter } from './promptAdapter.js';

/**
 * Default cold-after duration used by interactive pack previews.
 */
export const DEFAULT_COLD_AFTER = '7d';

/**
 * Default cold threshold in milliseconds (7 days).
 */
export const DEFAULT_OLDER_THAN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Optional overrides for the interactive CLI menu.
 */
export type InteractiveCliRequest = {
  readonly home?: string;
  readonly now?: Date;
  readonly olderThanMs?: number;
  readonly prompts?: PromptAdapter;
  readonly providers?: ReadonlyArray<ProviderAdapter>;
};

/**
 * Interactive request options extended with first-setup wizard controls.
 */
export type FirstSetupRequest = InteractiveCliRequest & {
  readonly showIntro?: boolean;
};

/**
 * Inputs used to decide whether the interactive CLI should run.
 */
export type InteractiveCliDetectionRequest = {
  readonly argv: ReadonlyArray<string>;
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
};

/**
 * Inputs for running an async task under a TTY spinner.
 */
export type SpinnerTaskRequest<Value> = {
  readonly prompts: PromptAdapter;
  readonly startMessage: string;
  readonly stopMessage: string;
  readonly task: () => Promise<Value>;
};

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
 * Runs a promise-backed task under a TTY spinner with start/stop/error messages.
 *
 * @param request - Spinner messages, prompt adapter, and async task.
 * @returns Task result after a successful stop message.
 * @example
 * ```ts
 * import { runWithSpinner } from './interactiveCliContext.js';
 * import { clackPromptAdapter } from './promptAdapter.js';
 *
 * const value = await runWithSpinner({
 *   prompts: clackPromptAdapter,
 *   startMessage: 'Working...',
 *   stopMessage: 'Done.',
 *   task: async () => 42,
 * });
 * ```
 */
export const runWithSpinner = async <Value>(request: SpinnerTaskRequest<Value>): Promise<Value> => {
  const scanSpinner = request.prompts.spinner();
  scanSpinner.start(request.startMessage);

  try {
    const value = await request.task();
    scanSpinner.stop(request.stopMessage);
    return value;
  } catch (cause) {
    scanSpinner.error('Operation failed.');
    throw cause;
  }
};

/**
 * Loads provider inventory under a spinner for interactive setup and pack flows.
 *
 * @param request - Home, clock, threshold, providers, prompts, and spinner copy.
 * @returns Provider inventory report used by subsequent prompts.
 * @example
 * ```ts
 * import { loadInventoryWithSpinner } from './interactiveCliContext.js';
 * import { clackPromptAdapter } from './promptAdapter.js';
 * import { allProviders } from '../providers/allProviders.js';
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
 * import { formatProviderInventoryTable } from './interactiveCliContext.js';
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
