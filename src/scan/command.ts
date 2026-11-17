import { defineCommand } from 'citty';
import type { CommandExit } from '@/command-outcome.js';
import { HOME_NOT_SET_CANCEL_MESSAGE, readHomeFolder, requireHome } from '@/environment.js';
import type { InteractiveCliRequest } from '@/interactive-cli-request.js';
import { DEFAULT_COLD_AFTER_MS } from '@/pack/plan.js';
import type { PromptAdapter } from '@/prompt-adapter.js';
import { allProviders } from '@/providers/all-providers.js';
import { selectProviders } from '@/providers/flag.js';
import type { ProviderAdapter, SessionStore } from '@/session-model.js';
import { createProviderInventoryTable, loadInventoryWithSpinner } from './inventory-prompt.js';
import { writeHumanScan, writeStructuredScan } from './output.js';
import { scanStores } from './stores.js';

const HOME_MISSING_EXIT_CODE = 1;
const UNKNOWN_PROVIDER_EXIT_CODE = 2;

export interface ScanFlags {
  readonly provider?: string;
  readonly json?: boolean;
}

export async function runScanCommand(flags: ScanFlags): Promise<CommandExit> {
  const home = requireHome();

  const isHomeMissing = home == null;

  if (isHomeMissing) {
    return { exitCode: HOME_MISSING_EXIT_CODE };
  }

  const { providers, isProviderUnknown } = selectProviders(flags.provider);
  const providerExitCode = isProviderUnknown ? UNKNOWN_PROVIDER_EXIT_CODE : 0;

  function listProviderStores(provider: ProviderAdapter): SessionStore[] {
    function createStore(path: string): SessionStore {
      return { provider: provider.id, path };
    }

    return provider.defaultRoots(home).map(createStore);
  }

  const stores = providers.flatMap(listProviderStores);
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
}

function runScanFromArgs({
  args,
}: {
  readonly args: { readonly provider?: string; readonly json?: boolean };
}): Promise<CommandExit> {
  return runScanCommand({
    provider: args.provider,
    json: args.json,
  });
}

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
  run: runScanFromArgs,
});

function writeNoIndexedSessions(): CommandExit {
  process.stdout.write('No indexed sessions yet. Run agent-session-pack scan first.\n');
  return { exitCode: 0 };
}

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
  run: writeNoIndexedSessions,
});

export async function runReviewSessions(
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

  request.prompts.note(createProviderInventoryTable(inventory), 'Provider sessions');
  return runScanCommand({});
}
