import { defineCommand } from 'citty';
import type { CommandExit } from '@/command-outcome.js';
import { HOME_NOT_SET_CANCEL_MESSAGE, readHomeFolder, requireHome } from '@/environment.js';
import type { InteractiveCliRequest } from '@/interactive-cli-request.js';
import { DEFAULT_COLD_AFTER_MS } from '@/pack/plan.js';
import type { PromptAdapter } from '@/prompt-adapter.js';
import { allProviders } from '@/providers/all-providers.js';
import { selectProviders } from '@/providers/flag.js';
import type { SessionStore } from '@/session-model.js';
import { createProviderInventoryTable, loadInventoryWithSpinner } from './inventory-prompt.js';
import { writeHumanScan, writeStructuredScan } from './output.js';
import { scanStores } from './stores.js';

export interface ScanFlags {
  readonly provider?: string;
  readonly json?: boolean;
}

export const runScanCommand = async (flags: ScanFlags): Promise<CommandExit> => {
  const home = requireHome();

  const isHomeMissing = home == null;

  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const { providers, isProviderUnknown } = selectProviders(flags.provider);
  const providerExitCode = isProviderUnknown ? 2 : 0;
  const stores = providers.flatMap((provider) =>
    provider.defaultRoots(home).map((path): SessionStore => ({ provider: provider.id, path })),
  );
  const report = await scanStores({
    providers,
    stores,
  });

  const isMachineOutputRequested = flags.json === true;

  if (isMachineOutputRequested) {
    writeStructuredScan(report);
    return { exitCode: providerExitCode };
  }

  writeHumanScan(report);
  return { exitCode: providerExitCode };
};

export const scanCommand = defineCommand({
  meta: {
    name: 'scan',
    description: 'Scan provider stores and estimate sessions.',
  },
  args: {
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
      valueHint: 'provider',
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    return runScanCommand({
      provider: args.provider,
      json: args.json,
    });
  },
});

export const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List indexed sessions with date, status, and path.',
  },
  args: {
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: () => {
    process.stdout.write('No indexed sessions yet. Run agent-session-pack scan first.\n');
    return { exitCode: 0 };
  },
});

export const runReviewSessions = async (
  request: InteractiveCliRequest & { readonly prompts: PromptAdapter },
): Promise<CommandExit> => {
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

  request.prompts.note(createProviderInventoryTable(inventory), 'Provider sessions');
  return runScanCommand({});
};
