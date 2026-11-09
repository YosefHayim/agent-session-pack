import { defineCommand } from 'citty';
import { requireHome } from '@/home-env.js';
import { selectProviders } from '@/providers/flag.js';
import type { SessionStore } from '@/session-model.js';
import { renderHumanScan, renderJsonScan } from './output.js';
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
export const runScanCommand = async (args: ScanArgs): Promise<void> => {
  const home = requireHome();
  const isHomeMissing = home === undefined;

  if (isHomeMissing) {
    return;
  }

  const providers = selectProviders(args.provider);
  const stores = providers.flatMap((provider) =>
    provider.defaultRoots(home).map((path): SessionStore => ({ provider: provider.id, path })),
  );
  const report = await scanStores({
    providers,
    stores,
  });
  const isJsonRequested = args.json === true;

  if (isJsonRequested) {
    renderJsonScan(report);
    return;
  }

  renderHumanScan(report);
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
    await runScanCommand({
      provider: args.provider,
      json: args.json,
    });
  },
});
