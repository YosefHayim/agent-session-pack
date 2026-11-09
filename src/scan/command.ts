import { defineCommand } from 'citty';
import type { CommandOutcome } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { selectProviders } from '@/providers/flag.js';
import type { SessionStore } from '@/session-model.js';
import { writeHumanScan, writeJsonScan } from './output.js';
import { scanStores } from './stores.js';

/**
 * Arguments for the scan command.
 */
export interface ScanArgs {
  readonly provider?: string;
  readonly json?: boolean;
}

/**
 * Scans provider stores and writes the sessions found for humans or agents.
 */
export const runScanCommand = async (args: ScanArgs): Promise<CommandOutcome> => {
  const home = requireHome();

  const isHomeMissing = home == null;

  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const { providers, isProviderUnknown } = selectProviders(args.provider);
  const providerExitCode = isProviderUnknown ? 2 : 0;
  const stores = providers.flatMap((provider) =>
    provider.defaultRoots(home).map((path): SessionStore => ({ provider: provider.id, path })),
  );
  const report = await scanStores({
    providers,
    stores,
  });

  const isJsonRequested = args.json === true;

  if (isJsonRequested) {
    writeJsonScan(report);
    return { exitCode: providerExitCode };
  }

  writeHumanScan(report);
  return { exitCode: providerExitCode };
};

/**
 * Citty command that scans provider stores and estimates sessions.
 */
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
