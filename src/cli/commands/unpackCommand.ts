import { defineCommand } from 'citty';
import { Effect, Schema } from 'effect';
import {
  type ArchiveFileSystemError,
  type ArchiveVerificationError,
  type CompressionAdapter,
  createZstdCompression,
  type ManifestStoreError,
  type ProviderAdapter,
  type ProviderId,
  resolveDefaultVaultPath,
  unpackProviderSessions,
} from '../../core/index.js';
import { formatHumanUnpackReport, formatJsonArchiveReport } from '../../output/index.js';
import { allProviders, ProviderIdSchema } from '../../providers/index.js';
import { resolveApplyConfirmation } from '../applyConfirmation.js';

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
      description: 'Provider id: codex, claude, kiro, cursor, or devin.',
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
 * import { runUnpackCommand } from './commands/unpackCommand.js';
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
    const home = normalizeHome(args.home);

    if (home === undefined) {
      process.stderr.write('HOME is not set.\n');
      process.exitCode = 1;
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
      vaultPath: normalizeVaultPath(args.vaultPath, home),
      providers: normalizeProviders({
        provider: args.provider,
        providers: args.providers,
      }),
      apply: args.apply === true,
      compression: normalizeCompression(args.compression),
    });

    if (args.json === true) {
      process.stdout.write(formatJsonArchiveReport(report));
      return;
    }

    process.stdout.write(`${formatHumanUnpackReport(report)}\n`);
  });

const normalizeProviders = (args: {
  readonly provider: string | undefined;
  readonly providers: ReadonlyArray<ProviderAdapter> | undefined;
}): ReadonlyArray<ProviderAdapter> => {
  if (args.providers !== undefined) {
    return args.providers;
  }

  if (args.provider === undefined) {
    return allProviders;
  }

  const decoded = Schema.decodeUnknownEither(ProviderIdSchema)(args.provider);

  if (decoded._tag === 'Left') {
    process.stderr.write(`Unknown provider: ${args.provider}\n`);
    process.exitCode = 2;
    return [];
  }

  return allProviders.filter((adapter) => adapter.id === (args.provider as ProviderId));
};

const normalizeHome = (home: string | undefined): string | undefined => {
  if (home !== undefined) {
    return home;
  }

  return process.env.HOME;
};

const normalizeVaultPath = (vaultPath: string | undefined, home: string): string => {
  if (vaultPath !== undefined) {
    return vaultPath;
  }

  return resolveDefaultVaultPath(home);
};

const normalizeCompression = (compression: CompressionAdapter | undefined): CompressionAdapter => {
  if (compression !== undefined) {
    return compression;
  }

  return createZstdCompression();
};
