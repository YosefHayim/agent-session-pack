import { spawn } from 'node:child_process';
import { defineCommand } from 'citty';
import { resolveDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandOutcome } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { parseOptionalProvider } from '@/providers/flag.js';
import { isRestoreOnLaunchEnabled, readSetupConfig } from '@/setup/config.js';
import { type SessionWatchEvent, watchSessionStubs } from './session-watch.js';

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
    return runWatchCommand({
      provider: args.provider,
      json: args.json,
      pollMs: args['poll-ms'],
      execArgv: execArgs,
    });
  },
});

/**
 * Decoded arguments for watch.
 */
type WatchArgs = {
  readonly provider: string | undefined;
  readonly json: boolean | undefined;
  readonly pollMs: string | undefined;
  readonly execArgv: ReadonlyArray<string>;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly vaultPath?: string | undefined;
};

const runWatchCommand = async (args: WatchArgs): Promise<CommandOutcome> => {
  const home = requireHome(args.home);

  if (home === undefined) {
    return { exitCode: 1 };
  }

  const provider = parseOptionalProvider(args.provider);
  if (args.provider !== undefined && provider === undefined) {
    process.stderr.write(`Unknown provider: ${args.provider}\n`);
    return { exitCode: 2 };
  }

  const setupConfig = await readSetupConfig(home);
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
      return { exitCode: 2 };
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

  await watchSessionStubs({
    vaultPath,
    provider,
    compression,
    pollIntervalMs,
    shouldStop: () => stop,
    onEvent,
  });

  return { exitCode: childExitCode ?? 0 };
};

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
