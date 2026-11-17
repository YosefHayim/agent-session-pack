import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import { describeBytes } from '@/byte-format.js';
import type { CommandExit } from '@/command-outcome.js';
import { HOME_NOT_SET_CANCEL_MESSAGE, readHomeFolder } from '@/environment.js';
import type { InteractiveCliRequest } from '@/interactive-cli-request.js';
import type { PromptAdapter } from '@/prompt-adapter.js';
import { allProviders } from '@/providers/all-providers.js';
import { createProviderInventoryTable, loadInventoryWithSpinner } from '@/scan/inventory-prompt.js';
import type { ProviderInventoryReport } from '@/scan/provider-inventory.js';
import { runPackCommand } from './command.js';
import { DEFAULT_COLD_AFTER, DEFAULT_COLD_AFTER_MS } from './plan.js';

const NO_FILES_CHANGED_MESSAGE = 'No files changed.';

type InventoryRow = ProviderInventoryReport['rows'][number];

export async function runPackFlow(
  request: InteractiveCliRequest & { readonly prompts: PromptAdapter },
): Promise<CommandExit> {
  const home = request.home ?? readHomeFolder();

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

  const isPreviewCancelled = request.prompts.isCancel(shouldPreview);
  if (isPreviewCancelled) {
    request.prompts.cancel(NO_FILES_CHANGED_MESSAGE);
    return { exitCode: 0 };
  }

  const isPreviewDeclined = shouldPreview !== true;
  if (isPreviewDeclined) {
    request.prompts.cancel(NO_FILES_CHANGED_MESSAGE);
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

  const isApplyCancelled = request.prompts.isCancel(shouldApply);
  if (isApplyCancelled) {
    request.prompts.outro(NO_FILES_CHANGED_MESSAGE);
    return previewExit;
  }

  const isApplyDeclined = shouldApply !== true;
  if (isApplyDeclined) {
    request.prompts.outro(NO_FILES_CHANGED_MESSAGE);
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
}

function createPackApplyQuestion(inventory: ProviderInventoryReport, home: string): string {
  function addColdSessions(totalSessions: number, inventorySummary: InventoryRow): number {
    return totalSessions + inventorySummary.coldSessions;
  }

  function addCandidateBytes(totalBytes: number, inventorySummary: InventoryRow): number {
    return totalBytes + inventorySummary.candidateBytes;
  }

  function hasColdSessions(inventorySummary: InventoryRow): boolean {
    return inventorySummary.coldSessions > 0;
  }

  function readProviderId(inventorySummary: InventoryRow): string {
    return inventorySummary.provider;
  }

  const candidateSessions = inventory.rows.reduce(addColdSessions, 0);
  const candidateBytes = inventory.rows.reduce(addCandidateBytes, 0);
  const providerNames = inventory.rows.filter(hasColdSessions).map(readProviderId).join(', ');

  return [
    'Apply pack now?',
    '',
    `This will archive ${candidateSessions} cold sessions from ${providerNames || 'no providers'} into:`,
    createDefaultVaultPath(home),
    '',
    `Candidate size: ${describeBytes(candidateBytes)}`,
    'Original files are removed only after archive write, restore verification, and manifest write.',
  ].join('\n');
}
