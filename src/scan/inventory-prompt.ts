import { describeBytes } from '@/byte-format.js';
import type { PromptAdapter } from '@/prompt-adapter.js';
import type { ProviderAdapter } from '@/session-model.js';
import { runWithSpinner } from '@/spinner-task.js';
import { inspectProviderInventory, type ProviderInventoryReport } from './provider-inventory.js';

export type InventorySpinnerRequest = {
  readonly home: string;
  readonly now: Date;
  readonly olderThanMs: number;
  readonly prompts: PromptAdapter;
  readonly providers: ReadonlyArray<ProviderAdapter>;
  readonly startMessage: string;
  readonly stopMessage: string;
};

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

export const createProviderInventoryTable = (report: ProviderInventoryReport): string => {
  const isReportSummariesEmpty = report.rows.length === 0;
  if (isReportSummariesEmpty) {
    return 'No provider stores found.';
  }

  return [
    'Provider   Mode         Sessions   Cold   Guarded recent   Size       Path',
    ...report.rows.map(createProviderInventorySummary),
  ].join('\n');
};

const createProviderInventorySummary = (
  inventorySummary: ProviderInventoryReport['rows'][number],
): string => {
  const provider = inventorySummary.provider.padEnd(10);
  const mode = inventorySummary.mode.padEnd(12);
  const sessions = String(inventorySummary.sessions).padStart(8);
  const cold = String(inventorySummary.coldSessions).padStart(6);
  const guarded = String(inventorySummary.guardedRecentSessions).padStart(16);
  const size = describeBytes(inventorySummary.candidateBytes).padEnd(10);
  const path = inventorySummary.paths.join(', ');

  return `${provider} ${mode} ${sessions}   ${cold}   ${guarded}   ${size} ${path}`;
};
