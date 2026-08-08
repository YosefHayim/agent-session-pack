import { defineCommand } from 'citty';
import { Effect, Schema } from 'effect';
import {
  type ProviderAdapter,
  type ProviderDiscoveryError,
  type ProviderId,
  ProviderIdSchema,
  type SessionStore,
  scanStores,
} from '../../core/sessionStore.js';
import { renderHumanScan } from '../../output/humanOutput.js';
import { renderJsonScan } from '../../output/jsonOutput.js';
import { allProviders } from '../../providers/allProviders.js';
import { HOME_NOT_SET_STDERR_MESSAGE } from '../homeEnv.js';

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
 * import { runScanCommand } from './commands/scanCommand.js';
 *
 * await Effect.runPromise(runScanCommand({ json: true }));
 * ```
 */
export const runScanCommand = (args: ScanArgs): Effect.Effect<void, ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const home = process.env.HOME;

    if (home === undefined) {
      process.stderr.write(HOME_NOT_SET_STDERR_MESSAGE);
      process.exitCode = 1;
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

const selectProviders = (provider: string | undefined): ReadonlyArray<ProviderAdapter> => {
  if (provider === undefined) {
    return allProviders;
  }

  const decoded = Schema.decodeUnknownEither(ProviderIdSchema)(provider);

  if (decoded._tag === 'Left') {
    process.stderr.write(`Unknown provider: ${provider}\n`);
    process.exitCode = 2;
    return [];
  }

  return allProviders.filter((adapter) => adapter.id === (provider as ProviderId));
};
