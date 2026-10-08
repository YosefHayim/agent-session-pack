import { spawn } from 'node:child_process';
import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { requireHome } from '../../shared/homeEnv.js';
import { parseOptionalProvider } from '../../shared/providerFlag.js';
import type {
  ArchiveFileSystemError,
  ArchiveVerificationError,
  CompressionAdapter,
} from '../archive/archiveWriter.js';
import type { ManifestStoreError } from '../archive/manifestStore.js';
import { resolveDefaultVaultPath } from '../archive/sessionArchive.js';
import { createZstdCompression } from '../archive/zstdCompression.js';
import {
  isRestoreOnLaunchEnabled,
  readSetupConfig,
  type SetupConfigFileError,
} from '../setup/setupConfig.js';
import {
  type SessionWatchError,
  type SessionWatchEvent,
  watchSessionStubs,
} from './sessionWatch.js';

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

const runWatchCommand = (
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
    const home = requireHome(args.home);

    if (home === undefined) {
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
