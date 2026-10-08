import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { requireHome } from '../../shared/homeEnv.js';
import { parseOptionalProvider } from '../../shared/providerFlag.js';
import type { ArchiveFileSystemError } from '../archive/archiveFileSystem.js';
import type { ArchiveVerificationError, CompressionAdapter } from '../archive/archiveWriter.js';
import type { ManifestStoreError } from '../archive/manifestStore.js';
import { resolveDefaultVaultPath } from '../archive/vaultPaths.js';
import { createZstdCompression } from '../archive/zstdCompression.js';
import { readSetupConfig, type SetupConfigFileError } from '../setup/setupConfig.js';
import { type EnsureRestoredReport, ensureSessionRestored } from './ensureRestored.js';

/**
 * Citty command that restores a packed session by id, name, slug, or picker.
 */
export const restoreCommand = defineCommand({
  meta: {
    name: 'restore',
    description: 'Restore a packed session by id, name, slug, or provider-prefixed selector.',
  },
  args: {
    selector: {
      type: 'positional',
      description: 'Session id, exact name, slug, fuzzy query, or provider-prefixed selector.',
    },
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
    },
    to: {
      type: 'string',
      description: 'Restore destination: original (default). Custom paths are not supported yet.',
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    await Effect.runPromise(
      runRestoreCommand({
        json: args.json,
        provider: args.provider,
        selector: args.selector,
        to: args.to,
      }),
    );
  },
});

/**
 * Decoded arguments for the restore command.
 */
export type RestoreArgs = {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly selector: string | undefined;
  readonly to: string | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly vaultPath?: string | undefined;
};

/**
 * Runs the restore command for human and agent callers.
 *
 * @param args - Decoded command-line arguments.
 * @returns Effect that writes restore output and sets exit codes.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { runRestoreCommand } from './restoreCommand.js';
 *
 * await Effect.runPromise(
 *   runRestoreCommand({
 *     json: true,
 *     provider: 'codex',
 *     selector: 'cold',
 *     to: 'original',
 *   }),
 * );
 * ```
 */
export const runRestoreCommand = (
  args: RestoreArgs,
): Effect.Effect<
  void,
  ArchiveFileSystemError | ArchiveVerificationError | ManifestStoreError | SetupConfigFileError
> =>
  Effect.gen(function* () {
    const home = requireHome(args.home);

    if (home === undefined) {
      return;
    }

    const selector = args.selector?.trim() ?? '';

    if (selector.length === 0) {
      process.stderr.write('Missing selector. Use agent-session-pack restore <selector>.\n');
      process.exitCode = 2;
      return;
    }

    if (args.to !== undefined && args.to !== 'original') {
      process.stderr.write(
        'Only --to original is supported. Custom restore destinations are not available yet.\n',
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
    const compression = args.compression ?? createZstdCompression();

    const report = yield* ensureSessionRestored({
      command: 'restore',
      vaultPath,
      selector,
      provider,
      compression,
      restoreOnLaunchEnabled: setupConfig?.restoreOnLaunch === true,
      requireLifecycleEnabled: false,
    });

    writeRestoreOutput(report, args.json === true);
    process.exitCode = restoreExitCode(report);
  });

const writeRestoreOutput = (report: EnsureRestoredReport, json: boolean): void => {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines = [
    `restore: ${report.status}`,
    report.provider === undefined ? undefined : `provider: ${report.provider}`,
    report.sessionId === undefined ? undefined : `session: ${report.sessionId}`,
    report.originalPath === undefined ? undefined : `originalPath: ${report.originalPath}`,
    report.reason === undefined ? undefined : `reason: ${report.reason}`,
  ].filter((line): line is string => line !== undefined);

  process.stdout.write(`${lines.join('\n')}\n`);
};

const restoreExitCode = (report: EnsureRestoredReport): number | undefined => {
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
