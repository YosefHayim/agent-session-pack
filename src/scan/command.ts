import { defineCommand } from 'citty';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { selectProviders } from '@/providers/flag.js';
import type { SessionStore } from '@/session-model.js';
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

  const isStructuredRequested = flags.json === true;

  if (isStructuredRequested) {
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
