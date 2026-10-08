import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { parseOptionalProvider } from '../../providers/providerFlag.js';
import { requireHome } from '../../shared/homeEnv.js';
import type { ArchiveFileSystemError } from '../archive/archiveFileSystem.js';
import type { ArchiveVerificationError, CompressionAdapter } from '../archive/archiveWriter.js';
import type { ManifestStoreError } from '../archive/manifestStore.js';
import { resolveDefaultVaultPath } from '../archive/vaultPaths.js';
import { createZstdCompression } from '../archive/zstdCompression.js';
import {
  isRestoreOnLaunchEnabled,
  readSetupConfig,
  type SetupConfigFileError,
} from '../setup/setupConfig.js';
import { type EnsureRestoredReport, ensureSessionRestored } from './ensureRestored.js';

/**
 * Citty command that restores one archived session when restore-on-launch is enabled.
 */
export const ensureRestoredCommand = defineCommand({
  meta: {
    name: 'ensure-restored',
    description:
      'Restore one archived session before provider resume when restore-on-launch is enabled.',
  },
  args: {
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
    },
    session: {
      type: 'positional',
      description: 'Session id, slug, title, or provider-prefixed selector (e.g. codex:cold).',
      required: true,
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    await Effect.runPromise(
      runEnsureRestoredCommand({
        json: args.json,
        provider: args.provider,
        session: args.session,
      }),
    );
  },
});

/**
 * Decoded arguments for ensure-restored.
 */
export type EnsureRestoredArgs = {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly session: string | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly vaultPath?: string | undefined;
};

/**
 * Runs ensure-restored for human and agent callers.
 *
 * @param args - Decoded command-line arguments.
 * @returns Effect that writes ensure-restored output and sets exit codes.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { runEnsureRestoredCommand } from './ensureRestoredCommand.js';
 *
 * await Effect.runPromise(
 *   runEnsureRestoredCommand({
 *     json: true,
 *     provider: 'codex',
 *     session: 'cold',
 *   }),
 * );
 * ```
 */
export const runEnsureRestoredCommand = (
  args: EnsureRestoredArgs,
): Effect.Effect<
  void,
  ArchiveFileSystemError | ArchiveVerificationError | ManifestStoreError | SetupConfigFileError
> =>
  Effect.gen(function* () {
    const home = requireHome(args.home);

    if (home === undefined) {
      return;
    }

    const sessionSelector = args.session?.trim() ?? '';

    if (sessionSelector.length === 0) {
      process.stderr.write(
        'Missing session selector. Use agent-session-pack ensure-restored [--provider codex] <session>.\n',
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
    const vaultPath = args.vaultPath ?? setupConfig?.vaultPath ?? resolveDefaultVaultPath(home);
    const restoreOnLaunchEnabled = isRestoreOnLaunchEnabled(setupConfig);
    const compression = args.compression ?? createZstdCompression();

    const report = yield* ensureSessionRestored({
      command: 'ensure-restored',
      vaultPath,
      selector: sessionSelector,
      provider,
      compression,
      restoreOnLaunchEnabled,
      requireLifecycleEnabled: true,
    });

    writeEnsureRestoredOutput(report, args.json === true);
    process.exitCode = ensureRestoredExitCode(report);
  });

const writeEnsureRestoredOutput = (report: EnsureRestoredReport, json: boolean): void => {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines = [
    `ensure-restored: ${report.status}`,
    report.provider === undefined ? undefined : `provider: ${report.provider}`,
    report.sessionId === undefined ? undefined : `session: ${report.sessionId}`,
    report.originalPath === undefined ? undefined : `originalPath: ${report.originalPath}`,
    report.reason === undefined ? undefined : `reason: ${report.reason}`,
    `restoreOnLaunchEnabled: ${String(report.restoreOnLaunchEnabled)}`,
  ].filter((line): line is string => line !== undefined);

  process.stdout.write(`${lines.join('\n')}\n`);
};

const ensureRestoredExitCode = (report: EnsureRestoredReport): number | undefined => {
  if (report.status === 'restored' || report.status === 'already-present') {
    return undefined;
  }

  if (report.status === 'lifecycle-disabled') {
    return 3;
  }

  if (report.status === 'conflict' || report.status === 'missing-archive') {
    return 2;
  }

  if (report.status === 'backup-only') {
    return 2;
  }

  return 1;
};
