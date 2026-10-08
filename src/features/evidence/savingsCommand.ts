import { defineCommand } from 'citty';
import { Effect, Schema } from 'effect';
import { selectProviders } from '../../providers/providerFlag.js';
import { requireHome } from '../../shared/homeEnv.js';
import type { ProviderDiscoveryError } from '../../shared/sessionModel.js';
import type { ArchiveWriteError } from '../archive/archiveWriter.js';
import { formatHumanEvidenceReport, formatJsonEvidenceReport } from './evidenceOutput.js';
import { resolveEvidenceWorkRoot } from './evidenceWorkRoot.js';
import { runLocalEvidence } from './localEvidence.js';

/**
 * Schema describing the savings command arguments.
 */
export const SavingsArgsSchema = Schema.Struct({
  provider: Schema.optional(Schema.String),
  json: Schema.optional(Schema.Boolean),
});

/**
 * Decoded arguments for the savings command.
 */
export type SavingsArgs = typeof SavingsArgsSchema.Type;

/**
 * Runs copy-only local savings proof against provider sessions.
 *
 * @param args - Decoded command-line arguments.
 * @returns Effect that writes savings output.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { runSavingsCommand } from './savingsCommand.js';
 *
 * await Effect.runPromise(runSavingsCommand({ json: true }));
 * ```
 */
export const runSavingsCommand = (
  args: SavingsArgs,
): Effect.Effect<void, ArchiveWriteError | ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const home = requireHome();

    if (home === undefined) {
      return;
    }

    const providers = selectProviders(args.provider);
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

/**
 * Citty command that shows copy-only local before/after compression proof.
 */
export const savingsCommand = defineCommand({
  meta: {
    name: 'savings',
    description: 'Show copy-only local before/after compression proof.',
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
      runSavingsCommand({
        provider: args.provider,
        json: args.json,
      }),
    );
  },
});

/**
 * Citty command that runs the no-install local savings proof.
 */
export const checkCommand = defineCommand({
  meta: {
    name: 'check',
    description: 'Run the no-install local savings proof.',
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
      runSavingsCommand({
        provider: args.provider,
        json: args.json,
      }),
    );
  },
});
