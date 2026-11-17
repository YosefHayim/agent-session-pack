import { spawn } from 'node:child_process';
import { defineCommand } from 'citty';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/environment.js';
import { parseOptionalProvider } from '@/providers/flag.js';
import { readSetupSettings } from '@/setup/config.js';
import {
  DEFAULT_POLL_INTERVAL_MS,
  type SessionWatchEvent,
  watchSessionStubs,
} from './session-watch.js';

const USAGE_ERROR_EXIT_CODE = 2;

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
    const execArgumentList = extractExecArgumentList(rawArgs);
    return runWatchCommand({
      provider: args.provider,
      json: args.json,
      pollMs: args['poll-ms'],
      execArgv: execArgumentList,
    });
  },
});

interface WatchFlags {
  readonly provider: string | undefined;
  readonly json: boolean | undefined;
  readonly pollMs: string | undefined;
  readonly execArgv: ReadonlyArray<string>;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly vaultPath?: string | undefined;
}

async function runWatchCommand(flags: WatchFlags): Promise<CommandExit> {
  const home = requireHome(flags.home);

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const provider = parseOptionalProvider(flags.provider);

  const isProviderFlagGiven = flags.provider != null;
  const isProviderUnparsed = provider == null;

  const isProviderNotFound = isProviderFlagGiven && isProviderUnparsed;
  if (isProviderNotFound) {
    process.stderr.write(`Unknown provider: ${flags.provider}\n`);
    return { exitCode: USAGE_ERROR_EXIT_CODE };
  }

  const setupSettings = await readSetupSettings(home);

  const vaultPath = flags.vaultPath ?? setupSettings?.vaultPath ?? createDefaultVaultPath(home);
  const pollIntervalMs = parsePollMs(flags.pollMs);
  const compression = flags.compression ?? createZstdCompression();
  const isMachineOutputRequested = flags.json === true;

  let childExitCode: number | null = null;
  let stop = false;

  // Watch runs even when restore on launch is off; wrappers enable lifecycle first.
  const hasExecCommand = flags.execArgv.length > 0;
  const [command, ...commandArgumentList] = flags.execArgv;

  const isExecCommandMissing = hasExecCommand && command == null;
  if (isExecCommandMissing) {
    process.stderr.write('Missing command after -- for watch --exec.\n');
    return { exitCode: USAGE_ERROR_EXIT_CODE };
  }

  if (hasExecCommand) {
    const child = spawn(command, commandArgumentList, {
      stdio: 'inherit',
      env: process.env,
    });

    function recordChildExit(code: number | null): void {
      childExitCode = code ?? 0;
      stop = true;
    }

    child.on('exit', recordChildExit);
  } else {
    function requestWatchStop(): void {
      stop = true;
    }
    process.once('SIGINT', requestWatchStop);
    process.once('SIGTERM', requestWatchStop);
  }

  function writeWatchEvent(event: SessionWatchEvent): void {
    if (isMachineOutputRequested) {
      process.stdout.write(`${JSON.stringify({ command: 'watch', ...event })}\n`);
      return;
    }

    process.stderr.write(`watch: ${event.provider}/${event.sessionId} → ${event.status}\n`);
  }

  const isHumanOutput = !isMachineOutputRequested;
  const isExecCommandAbsent = !hasExecCommand;

  const isHumanWatchWithoutExec = isHumanOutput && isExecCommandAbsent;
  if (isHumanWatchWithoutExec) {
    const isProviderMissing = provider == null;
    process.stderr.write(
      `watch: monitoring stubs under vault ${vaultPath}${isProviderMissing ? '' : ` for ${provider}`} (Ctrl+C to stop)\n`,
    );
  }

  function isWatchStopped(): boolean {
    return stop;
  }

  await watchSessionStubs({
    vaultPath,
    provider,
    compression,
    pollIntervalMs,
    shouldStop: isWatchStopped,
    onEvent: writeWatchEvent,
  });

  return { exitCode: childExitCode ?? 0 };
}

function extractExecArgumentList(argumentList: ReadonlyArray<string>): ReadonlyArray<string> {
  const separator = argumentList.indexOf('--');

  const isSeparatorNotFound = separator === -1;
  if (isSeparatorNotFound) {
    return [];
  }

  return argumentList.slice(separator + 1);
}

function parsePollMs(millisecondsString: string | undefined): number {
  const isMillisecondsStringMissing = millisecondsString == null;
  if (isMillisecondsStringMissing) {
    return DEFAULT_POLL_INTERVAL_MS;
  }

  const parsedMilliseconds = Number(millisecondsString);

  const minimumPollIntervalMilliseconds = 100;

  const isPollIntervalNotFinite = !Number.isFinite(parsedMilliseconds);
  const isPollIntervalTooShort = parsedMilliseconds < minimumPollIntervalMilliseconds;

  const isPollIntervalInvalid = isPollIntervalNotFinite || isPollIntervalTooShort;
  if (isPollIntervalInvalid) {
    return DEFAULT_POLL_INTERVAL_MS;
  }

  return Math.floor(parsedMilliseconds);
}
