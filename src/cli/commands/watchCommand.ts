import { spawn } from 'node:child_process';
import { defineCommand } from 'citty';
import { Effect, Schema } from 'effect';
import { createZstdCompression } from '../../core/archiveReader.js';
import type {
  ArchiveFileSystemError,
  ArchiveVerificationError,
  CompressionAdapter,
} from '../../core/archiveWriter.js';
import type { ManifestStoreError } from '../../core/manifestStore.js';
import { resolveDefaultVaultPath } from '../../core/sessionArchive.js';
import { type ProviderId, ProviderIdSchema } from '../../core/sessionStore.js';
import {
  type SessionWatchError,
  type SessionWatchEvent,
  watchSessionStubs,
} from '../../core/sessionWatch.js';
import {
  isRestoreOnLaunchEnabled,
  readSetupConfig,
  type SetupConfigFileError,
} from '../../core/setupConfig.js';
import { HOME_NOT_SET_STDERR_MESSAGE } from '../homeEnv.js';

/**
 * Citty command that watches archived stubs and restores sessions when opened.
 */
export const watchCommand = defineCommand({
  meta: {
    name: 'watch',
    description:
      'Watch archived session stubs and auto-restore when a provider opens them (GUI-friendly).',
  },
  args: {
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
    },
    json: {
      type: 'boolean',
      description: 'Write JSON lines for restore events.',
    },
    'poll-ms': {
      type: 'string',
      description: 'Poll interval in milliseconds (default 750).',
    },
  },
  run: async ({ args, rawArgs }) => {
    const execArgs = extractExecArgs(rawArgs);
    await Effect.runPromise(
      runWatchCommand({
        provider: args.provider,
        json: args.json,
        pollMs: args['poll-ms'],
        execArgv: execArgs,
      }),
    );
  },
});

/**
 * Decoded arguments for watch.
 */
export type WatchArgs = {
  readonly provider: string | undefined;
  readonly json: boolean | undefined;
  readonly pollMs: string | undefined;
  readonly execArgv: ReadonlyArray<string>;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly vaultPath?: string | undefined;
};

/**
 * Runs session stub watch, optionally following a child provider process.
 *
 * @param args - Provider filter, poll interval, and optional exec argv.
 * @returns Effect that completes when watch stops (child exit or signal).
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { runWatchCommand } from './watchCommand.js';
 *
 * await Effect.runPromise(
 *   runWatchCommand({
 *     provider: 'grok',
 *     json: true,
 *     pollMs: '500',
 *     execArgv: [],
 *   }),
 * );
 * ```
 */
export const runWatchCommand = (
  args: WatchArgs,
): Effect.Effect<
  void,
  | ArchiveFileSystemError
  | ArchiveVerificationError
  | ManifestStoreError
  | SessionWatchError
  | SetupConfigFileError
> =>
  Effect.gen(function* () {
    const home = args.home ?? process.env.HOME;

    if (home === undefined) {
      process.stderr.write(HOME_NOT_SET_STDERR_MESSAGE);
      process.exitCode = 1;
      return;
    }

    const provider = parseOptionalProvider(args.provider);
    if (args.provider !== undefined && provider === undefined) {
      process.stderr.write(`Unknown provider: ${args.provider}\n`);
      process.exitCode = 2;
      return;
    }

    const setupConfig = yield* readSetupConfig(home);
    if (!isRestoreOnLaunchEnabled(setupConfig) && args.execArgv.length === 0) {
      // Allow explicit watch even if disabled when following a child; wrappers enable lifecycle first.
    }

    const vaultPath = args.vaultPath ?? setupConfig?.vaultPath ?? resolveDefaultVaultPath(home);
    const pollIntervalMs = parsePollMs(args.pollMs);
    const compression = args.compression ?? createZstdCompression();
    const json = args.json === true;

    let childExitCode: number | undefined;
    let stop = false;

    if (args.execArgv.length > 0) {
      const [command, ...commandArgs] = args.execArgv;
      if (command === undefined) {
        process.stderr.write('Missing command after -- for watch --exec.\n');
        process.exitCode = 2;
        return;
      }

      const child = spawn(command, commandArgs, {
        stdio: 'inherit',
        env: process.env,
      });

      child.on('exit', (code) => {
        childExitCode = code ?? 0;
        stop = true;
      });
    } else {
      const onSignal = (): void => {
        stop = true;
      };
      process.once('SIGINT', onSignal);
      process.once('SIGTERM', onSignal);
    }

    const onEvent = (event: SessionWatchEvent): void => {
      if (json) {
        process.stdout.write(`${JSON.stringify({ command: 'watch', ...event })}\n`);
        return;
      }

      process.stderr.write(`watch: ${event.provider}/${event.sessionId} → ${event.status}\n`);
    };

    if (!json && args.execArgv.length === 0) {
      process.stderr.write(
        `watch: monitoring stubs under vault ${vaultPath}${provider === undefined ? '' : ` for ${provider}`} (Ctrl+C to stop)\n`,
      );
    }

    yield* watchSessionStubs({
      vaultPath,
      provider,
      compression,
      pollIntervalMs,
      shouldStop: () => stop,
      onEvent,
    });

    if (childExitCode !== undefined) {
      process.exitCode = childExitCode === 0 ? undefined : childExitCode;
    }
  });

const extractExecArgs = (rawArgs: ReadonlyArray<string>): ReadonlyArray<string> => {
  const separator = rawArgs.indexOf('--');
  if (separator === -1) {
    return [];
  }

  return rawArgs.slice(separator + 1);
};

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

const parsePollMs = (value: string | undefined): number => {
  if (value === undefined) {
    return 750;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 100) {
    return 750;
  }

  return Math.floor(parsed);
};
