import { defineCommand } from 'citty';
import { Effect, Schema } from 'effect';
import { createZstdCompression } from '../../core/archiveReader.js';
import type {
  ArchiveFileSystemError,
  ArchiveVerificationError,
  CompressionAdapter,
} from '../../core/archiveWriter.js';
import type { ManifestStoreError } from '../../core/manifestStore.js';
import { recordSessionAccess, type SessionAccessLogError } from '../../core/sessionAccess.js';
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
 * Citty command that looks up a session and auto-restores it when packed.
 */
export const openCommand = defineCommand({
  meta: {
    name: 'open',
    description: 'Look up a session and auto-restore it from the vault when lifecycle is enabled.',
  },
  args: {
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
    },
    session: {
      type: 'positional',
      description: 'Session id, slug, title, or provider-prefixed selector.',
      required: true,
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    await Effect.runPromise(
      runOpenCommand({
        json: args.json,
        provider: args.provider,
        session: args.session,
      }),
    );
  },
});

/**
 * Decoded arguments for the open command.
 */
export type OpenArgs = {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly session: string | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly vaultPath?: string | undefined;
};

/**
 * Opens (looks up) a session and restores it when lifecycle is enabled.
 *
 * @param args - Decoded command-line arguments.
 * @returns Effect that writes open output and sets exit codes.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { runOpenCommand } from './openCommand.js';
 *
 * await Effect.runPromise(
 *   runOpenCommand({ json: true, provider: 'codex', session: 'cold' }),
 * );
 * ```
 */
export const runOpenCommand = (
  args: OpenArgs,
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

    const sessionSelector = args.session?.trim() ?? '';

    if (sessionSelector.length === 0) {
      process.stderr.write(
        'Missing session. Use agent-session-pack open [--provider codex] <session>.\n',
      );
      process.exitCode = 2;
      return;
    }

    const provider = parseOptionalProvider(args.provider);

    if (args.provider !== undefined && provider === undefined) {
      process.stderr.write(`Unknown provider: ${args.provider}\n`);
      process.exitCode = 2;
      return;
    }

    const setupConfig = yield* readSetupConfig(home);
    const restoreOnLaunchEnabled = isRestoreOnLaunchEnabled(setupConfig);
    const vaultPath = args.vaultPath ?? setupConfig?.vaultPath ?? resolveDefaultVaultPath(home);
    const compression = args.compression ?? createZstdCompression();
    const now = args.now ?? new Date();

    // When lifecycle is off, open still restores (lookup path) so "look for session"
    // always materializes packed history without needing a separate restore step.
    // Lifecycle wrappers use preflight/ensure-restored for the enable gate.
    const report = yield* ensureSessionRestored({
      command: 'restore',
      vaultPath,
      selector: sessionSelector,
      provider,
      compression,
      restoreOnLaunchEnabled,
      requireLifecycleEnabled: false,
    });

    if (
      (report.status === 'restored' || report.status === 'already-present') &&
      report.provider !== undefined &&
      report.sessionId !== undefined
    ) {
      yield* recordSessionAccess({
        vaultPath,
        provider: report.provider,
        sessionId: report.sessionId,
        accessedAt: now,
      });
    }

    writeOpenOutput(report, restoreOnLaunchEnabled, args.json === true);
    process.exitCode = openExitCode(report);
  });

const parseOptionalProvider = (provider: string | undefined): ProviderId | undefined => {
  if (provider === undefined) {
    return undefined;
  }

  const decoded = Schema.decodeUnknownEither(ProviderIdSchema)(provider);

  if (decoded._tag === 'Left') {
    return undefined;
  }

  return decoded.right;
};

const writeOpenOutput = (
  report: EnsureRestoredReport,
  restoreOnLaunchEnabled: boolean,
  json: boolean,
): void => {
  const payload = {
    ...report,
    command: 'open' as const,
    restoreOnLaunchEnabled,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const lines = [
    `open: ${report.status}`,
    report.provider === undefined ? undefined : `provider: ${report.provider}`,
    report.sessionId === undefined ? undefined : `session: ${report.sessionId}`,
    report.originalPath === undefined ? undefined : `originalPath: ${report.originalPath}`,
    report.reason === undefined ? undefined : `reason: ${report.reason}`,
  ].filter((line): line is string => line !== undefined);

  process.stdout.write(`${lines.join('\n')}\n`);
};

const openExitCode = (report: EnsureRestoredReport): number | undefined => {
  if (report.status === 'restored' || report.status === 'already-present') {
    return undefined;
  }

  if (
    report.status === 'conflict' ||
    report.status === 'missing-archive' ||
    report.status === 'backup-only'
  ) {
    return 2;
  }

  return 1;
};
