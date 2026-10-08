import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { resolveApplyConfirmation } from '../../shared/applyConfirmation.js';
import { requireHome } from '../../shared/homeEnv.js';
import { selectProviders } from '../../shared/providerFlag.js';
import type { ProviderAdapter } from '../../shared/sessionModel.js';
import type { ArchiveFileSystemError } from '../archive/archiveFileSystem.js';
import type { ArchiveVerificationError, CompressionAdapter } from '../archive/archiveWriter.js';
import type { ManifestStoreError } from '../archive/manifestStore.js';
import { resolveDefaultVaultPath } from '../archive/vaultPaths.js';
import { createZstdCompression } from '../archive/zstdCompression.js';
import { formatHumanUnpackReport } from './unpackOutput.js';
import { unpackProviderSessions } from './unpackSessions.js';

/**
 * Citty command that restores archived sessions from the vault.
 */
export const unpackCommand = defineCommand({
  meta: {
    name: 'unpack',
    description: 'Restore archived sessions from the vault.',
  },
  args: {
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
    },
    'all-providers': {
      type: 'boolean',
      description: 'Restore archived sessions for every supported provider.',
    },
    apply: {
      type: 'boolean',
      description: 'Restore archived sessions back to original provider paths.',
    },
    yes: {
      type: 'boolean',
      description: 'Confirm apply mode without an interactive prompt.',
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    const confirmed = await resolveApplyConfirmation({
      action: 'Restore archived sessions for the selected providers',
      apply: args.apply,
      json: args.json,
      yes: args.yes,
    });

    await Effect.runPromise(
      runUnpackCommand({
        allProviders: args['all-providers'],
        apply: args.apply,
        confirmed,
        json: args.json,
        provider: args.provider,
        yes: args.yes,
      }),
    );
  },
});

/**
 * Decoded arguments for the unpack command.
 */
export type UnpackArgs = {
  readonly allProviders: boolean | undefined;
  readonly apply: boolean | undefined;
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly yes: boolean | undefined;
  readonly confirmed?: boolean | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly providers?: ReadonlyArray<ProviderAdapter> | undefined;
  readonly vaultPath?: string | undefined;
};

/**
 * Runs the unpack command for human and agent callers.
 *
 * @param args - Decoded command-line arguments.
 * @returns Effect that writes unpack output.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { runUnpackCommand } from './unpackCommand.js';
 *
 * await Effect.runPromise(
 *   runUnpackCommand({
 *     allProviders: true,
 *     apply: false,
 *     json: false,
 *     provider: undefined,
 *     yes: false,
 *   }),
 * );
 * ```
 */
export const runUnpackCommand = (
  args: UnpackArgs,
): Effect.Effect<void, ArchiveFileSystemError | ArchiveVerificationError | ManifestStoreError> =>
  Effect.gen(function* () {
    const home = requireHome(args.home);

    if (home === undefined) {
      return;
    }

    if (args.apply === true && args.confirmed !== true) {
      process.stderr.write(
        'Cancelled. Re-run with --apply and confirm with y to unpack sessions.\n',
      );
      process.stderr.write('\n');
      process.exitCode = 2;
      return;
    }

    const report = yield* unpackProviderSessions({
      vaultPath: args.vaultPath ?? resolveDefaultVaultPath(home),
      providers: args.providers ?? selectProviders(args.provider),
      apply: args.apply === true,
      compression: args.compression ?? createZstdCompression(),
    });

    if (args.json === true) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    process.stdout.write(`${formatHumanUnpackReport(report)}\n`);
  });
