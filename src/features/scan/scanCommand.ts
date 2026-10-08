import { defineCommand } from 'citty';
import { Effect, Schema } from 'effect';
import { selectProviders } from '../../providers/providerFlag.js';
import { requireHome } from '../../shared/homeEnv.js';
import type { ProviderDiscoveryError, SessionStore } from '../../shared/sessionModel.js';
import { renderHumanScan, renderJsonScan } from './scanOutput.js';
import { scanStores } from './scanStores.js';

/**
 * Schema describing the scan command arguments.
 */
export const ScanArgsSchema = Schema.Struct({
  provider: Schema.optional(Schema.String),
  json: Schema.optional(Schema.Boolean),
});

/**
 * Decoded arguments for the scan command.
 */
export type ScanArgs = typeof ScanArgsSchema.Type;

/**
 * Runs the scan command for human and agent callers.
 *
 * @param args - Decoded command-line arguments.
 * @returns Effect that writes scan output.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { runScanCommand } from './scanCommand.js';
 *
 * await Effect.runPromise(runScanCommand({ json: true }));
 * ```
 */
export const runScanCommand = (args: ScanArgs): Effect.Effect<void, ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const home = requireHome();

    if (home === undefined) {
      return;
    }

    const providers = selectProviders(args.provider);
    const stores = providers.flatMap((provider) =>
      provider.defaultRoots(home).map((path): SessionStore => ({ provider: provider.id, path })),
    );
    const report = yield* scanStores({
      providers,
      stores,
    });

    if (args.json === true) {
      return yield* renderJsonScan(report);
    }

    return yield* renderHumanScan(report);
  });

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
    await Effect.runPromise(
      runScanCommand({
        provider: args.provider,
        json: args.json,
      }),
    );
  },
});
