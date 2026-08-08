import { defineCommand } from 'citty';
import { Effect, Schema } from 'effect';
import { createZstdCompression } from '../../core/archiveReader.js';
import type {
  ArchiveFileSystemError,
  ArchiveVerificationError,
  CompressionAdapter,
} from '../../core/archiveWriter.js';
import type { ManifestStoreError } from '../../core/manifestStore.js';
import {
  extractSessionIdsFromArgv,
  recordSessionAccess,
  type SessionAccessLogError,
} from '../../core/sessionAccess.js';
import {
  type EnsureRestoredReport,
  ensureSessionRestored,
  resolveDefaultVaultPath,
} from '../../core/sessionArchive.js';
import { type ProviderId, ProviderIdSchema } from '../../core/sessionStore.js';
import {
  isRestoreOnLaunchEnabled,
  readSetupConfig,
  type SetupConfigFileError,
} from '../../core/setupConfig.js';
import { HOME_NOT_SET_STDERR_MESSAGE } from '../homeEnv.js';

/**
 * Citty command used by provider wrappers to auto-restore sessions before launch.
 */
export const preflightCommand = defineCommand({
  meta: {
    name: 'preflight',
    description:
      'Auto-restore packed sessions found in provider argv when lifecycle is enabled (wrapper hook).',
  },
  args: {
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
      required: true,
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args, rawArgs }) => {
    const passthrough = extractPassthroughArgv(rawArgs);
    await Effect.runPromise(
      runPreflightCommand({
        json: args.json,
        provider: args.provider,
        passthroughArgv: passthrough,
      }),
    );
  },
});

/**
 * Decoded arguments for preflight.
 */
export type PreflightArgs = {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly passthroughArgv: ReadonlyArray<string>;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly vaultPath?: string | undefined;
};

/**
 * Runs preflight restore for session ids discovered in provider argv.
 *
 * @param args - Provider, passthrough argv, and output flags.
 * @returns Effect that writes preflight JSON/human output; always exits 0 on soft failures.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { runPreflightCommand } from './preflightCommand.js';
 *
 * await Effect.runPromise(
 *   runPreflightCommand({
 *     json: true,
 *     provider: 'codex',
 *     passthroughArgv: ['resume', 'session-id'],
 *   }),
 * );
 * ```
 */
export const runPreflightCommand = (
  args: PreflightArgs,
): Effect.Effect<
  void,
  | ArchiveFileSystemError
  | ArchiveVerificationError
  | ManifestStoreError
  | SessionAccessLogError
  | SetupConfigFileError
> =>
  Effect.gen(function* () {
    const home = args.home ?? process.env.HOME;

    if (home === undefined) {
      process.stderr.write(HOME_NOT_SET_STDERR_MESSAGE);
      process.exitCode = 1;
      return;
    }

    const provider = parseProvider(args.provider);

    if (provider === undefined) {
      process.stderr.write(`Unknown or missing provider: ${args.provider ?? ''}\n`);
      process.exitCode = 2;
      return;
    }

    const setupConfig = yield* readSetupConfig(home);
    const restoreOnLaunchEnabled = isRestoreOnLaunchEnabled(setupConfig);
    const vaultPath = args.vaultPath ?? setupConfig?.vaultPath ?? resolveDefaultVaultPath(home);
    const compression = args.compression ?? createZstdCompression();
    const now = args.now ?? new Date();
    const sessionIds = extractSessionIdsFromArgv(args.passthroughArgv);

    if (!restoreOnLaunchEnabled) {
      writePreflightOutput(
        {
          command: 'preflight',
          provider,
          restoreOnLaunchEnabled: false,
          sessionIds,
          restores: [],
          reason: 'lifecycle disabled; no auto-restore',
        },
        args.json === true,
      );
      return;
    }

    if (sessionIds.length === 0) {
      writePreflightOutput(
        {
          command: 'preflight',
          provider,
          restoreOnLaunchEnabled: true,
          sessionIds: [],
          restores: [],
          reason: 'no session ids found in argv',
        },
        args.json === true,
      );
      return;
    }

    const restores: EnsureRestoredReport[] = [];

    for (const sessionId of sessionIds) {
      const report = yield* ensureSessionRestored({
        command: 'ensure-restored',
        vaultPath,
        selector: sessionId,
        provider,
        compression,
        restoreOnLaunchEnabled: true,
        requireLifecycleEnabled: true,
      });
      restores.push(report);

      if (
        (report.status === 'restored' || report.status === 'already-present') &&
        report.sessionId !== undefined
      ) {
        yield* recordSessionAccess({
          vaultPath,
          provider,
          sessionId: report.sessionId,
          accessedAt: now,
        });
      }
    }

    writePreflightOutput(
      {
        command: 'preflight',
        provider,
        restoreOnLaunchEnabled: true,
        sessionIds,
        restores,
        reason: undefined,
      },
      args.json === true,
    );
  });

const extractPassthroughArgv = (rawArgs: ReadonlyArray<string>): ReadonlyArray<string> => {
  const separatorIndex = rawArgs.indexOf('--');
  if (separatorIndex === -1) {
    // Everything after subcommand name flags; drop known flags.
    return rawArgs.filter(
      (arg, index, all) =>
        arg !== 'preflight' &&
        arg !== '--json' &&
        arg !== '--provider' &&
        all[index - 1] !== '--provider' &&
        !arg.startsWith('--provider='),
    );
  }

  return rawArgs.slice(separatorIndex + 1);
};

const parseProvider = (provider: string | undefined): ProviderId | undefined => {
  if (provider === undefined) {
    return undefined;
  }

  const decoded = Schema.decodeUnknownEither(ProviderIdSchema)(provider);

  if (decoded._tag === 'Left') {
    return undefined;
  }

  return decoded.right;
};

const writePreflightOutput = (
  payload: {
    readonly command: 'preflight';
    readonly provider: ProviderId;
    readonly restoreOnLaunchEnabled: boolean;
    readonly sessionIds: ReadonlyArray<string>;
    readonly restores: ReadonlyArray<EnsureRestoredReport>;
    readonly reason: string | undefined;
  },
  json: boolean,
): void => {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const lines = [
    `preflight: ${payload.provider}`,
    `restoreOnLaunchEnabled: ${String(payload.restoreOnLaunchEnabled)}`,
    `sessionIds: ${payload.sessionIds.join(', ') || '(none)'}`,
    payload.reason === undefined ? undefined : `reason: ${payload.reason}`,
    ...payload.restores.map(
      (report) =>
        `- ${report.sessionId ?? '?'}: ${report.status}${report.reason === undefined ? '' : ` (${report.reason})`}`,
    ),
  ].filter((line): line is string => line !== undefined);

  process.stdout.write(`${lines.join('\n')}\n`);
};
