import { defineCommand } from 'citty';
import { Effect, Schema } from 'effect';
import {
  type ArchiveWriteError,
  type ProviderAdapter,
  type ProviderDiscoveryError,
  type ProviderId,
  resolveEvidenceWorkRoot,
  runLocalEvidence,
} from '../../core/index.js';
import { formatHumanEvidenceReport, formatJsonEvidenceReport } from '../../output/index.js';
import { allProviders, ProviderIdSchema } from '../../providers/index.js';

export const SavingsArgsSchema = Schema.Struct({
  provider: Schema.optional(Schema.String),
  json: Schema.optional(Schema.Boolean),
});

export type SavingsArgs = typeof SavingsArgsSchema.Type;

/**
 * Runs copy-only local savings proof against provider sessions.
 *
 * @param args - Decoded command-line arguments.
 * @returns Effect that writes savings output.
 */
export const runSavingsCommand = (
  args: SavingsArgs,
): Effect.Effect<void, ArchiveWriteError | ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const home = process.env.HOME;

    if (home === undefined) {
      process.stderr.write('HOME is not set.\n');
      process.exitCode = 1;
      return;
    }

    const providers = normalizeProviders(args.provider);
    const report = yield* runLocalEvidence({
      home,
      workRoot: resolveEvidenceWorkRoot(process.cwd(), String(process.pid)),
      providers,
    });

    if (args.json === true) {
      process.stdout.write(formatJsonEvidenceReport(report));
      return;
    }

    process.stdout.write(`${formatHumanEvidenceReport(report)}\n`);
  });

export const savingsCommand = defineCommand({
  meta: {
    name: 'savings',
    description: 'Show copy-only local before/after compression proof.',
  },
  args: {
    provider: {
      type: 'string',
      description: 'Provider id: codex, claude, kiro, cursor, or devin.',
      valueHint: 'provider',
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    await Effect.runPromise(
      runSavingsCommand({
        provider: args.provider,
        json: args.json,
      }),
    );
  },
});

const normalizeProviders = (provider: string | undefined): ReadonlyArray<ProviderAdapter> => {
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
