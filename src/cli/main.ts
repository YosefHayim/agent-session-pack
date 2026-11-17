import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type CommandDef, defineCommand, runCommand, type SubCommandsDef, showUsage } from 'citty';
import type { CommandExit } from '@/command-outcome.js';
import { doctorCommand } from '@/doctor/command.js';
import { checkCommand, savingsCommand } from '@/evidence/savings-command.js';
import { guideCommand } from '@/guide/command.js';
import { lifecycleCommand } from '@/lifecycle/command.js';
import { maintainCommand } from '@/lifecycle/maintain-command.js';
import { preflightCommand } from '@/lifecycle/preflight-command.js';
import { watchCommand } from '@/lifecycle/watch-command.js';
import { packCommand } from '@/pack/command.js';
import { restoreCommand } from '@/restore/command.js';
import { ensureRestoredCommand } from '@/restore/ensure-restored-command.js';
import { openCommand } from '@/restore/open-command.js';
import { unpackCommand } from '@/restore/unpack-command.js';
import { listCommand, scanCommand } from '@/scan/command.js';
import { initCommand } from '@/setup/init-command.js';
import packageJson from '../../package.json' with { type: 'json' };
import { canRunInteractiveCli, runInteractiveCli } from './interactive-cli.js';
import { rewriteCommandFlagAliases } from './main-args.js';

const subCommands: SubCommandsDef = {
  check: checkCommand,
  guide: guideCommand,
  init: initCommand,
  scan: scanCommand,
  pack: packCommand,
  unpack: unpackCommand,
  list: listCommand,
  restore: restoreCommand,
  open: openCommand,
  preflight: preflightCommand,
  watch: watchCommand,
  maintain: maintainCommand,
  'ensure-restored': ensureRestoredCommand,
  lifecycle: lifecycleCommand,
  savings: savingsCommand,
  doctor: doctorCommand,
};

const DEFAULT_SUB_COMMAND_NAME = 'scan';
const VERSION_FLAGS: ReadonlyArray<string> = ['--version', '-v'];
const USAGE_ERROR_EXIT_CODE = 2;
const NODE_AND_ENTRYPOINT_ARGUMENT_COUNT = 2;

export const mainCommand = defineCommand({
  meta: {
    name: 'agent-session-pack',
    version: packageJson.version,
    description:
      'Pack cold local AI coding-agent sessions with byte-exact restore. Run guide for agent-safe commands.',
  },
  subCommands,
  default: DEFAULT_SUB_COMMAND_NAME,
});

// citty 0.2.2 drops a subcommand's run result, so the named subcommand is run here.
function pickPlainSubCommand(subCommandName: string): CommandDef {
  const subCommandReply = subCommands[subCommandName];

  const isNotObject = typeof subCommandReply !== 'object';
  if (isNotObject) {
    throw new Error(`Subcommand ${subCommandName} is not a command object.`);
  }

  const isPromise = subCommandReply instanceof Promise;
  if (isPromise) {
    throw new Error(`Subcommand ${subCommandName} is not a command object.`);
  }

  return subCommandReply;
}

interface UsageTarget {
  readonly command: CommandDef;
  readonly parent: CommandDef | undefined;
}

function isSubCommandName(argument: string): boolean {
  return Object.hasOwn(subCommands, argument);
}

function pickUsageTarget(argumentList: string[]): UsageTarget {
  const subCommandName = argumentList.find(isSubCommandName);

  const isThereNoSubCommandName = subCommandName == null;

  if (isThereNoSubCommandName) {
    return { command: mainCommand, parent: undefined };
  }

  const subCommandDefinition = pickPlainSubCommand(subCommandName);

  return { command: subCommandDefinition, parent: mainCommand };
}

function isCommandExit(candidate: unknown): candidate is CommandExit {
  const isNotObject = typeof candidate !== 'object';
  if (isNotObject) {
    return false;
  }

  const isNull = candidate === null;
  if (isNull) {
    return false;
  }

  return 'exitCode' in candidate;
}

interface SubCommandInvocation {
  readonly name: string;
  readonly rawArgs: string[];
}

function isNotFlag(argument: string): boolean {
  return !argument.startsWith('-');
}

// The first word that is not a flag names the command; with none, the default command runs.
function readSubCommandInvocation(argumentList: string[]): SubCommandInvocation {
  const firstWordIndex = argumentList.findIndex(isNotFlag);

  const isThereNoWord = firstWordIndex === -1;

  if (isThereNoWord) {
    return { name: DEFAULT_SUB_COMMAND_NAME, rawArgs: argumentList };
  }

  return {
    name: argumentList[firstWordIndex],
    rawArgs: argumentList.slice(firstWordIndex + 1),
  };
}

async function showUsageForArguments(argumentList: string[]): Promise<CommandExit> {
  const usageTarget = pickUsageTarget(argumentList);
  await showUsage(usageTarget.command, usageTarget.parent);
  return { exitCode: 0 };
}

function isVersionArguments(argumentList: string[]): boolean {
  const isNotSingleArgument = argumentList.length !== 1;
  if (isNotSingleArgument) {
    return false;
  }

  return VERSION_FLAGS.includes(argumentList[0]);
}

async function runCli(argumentList: string[]): Promise<CommandExit> {
  const isLongHelpRequest = argumentList.includes('--help');
  if (isLongHelpRequest) {
    return showUsageForArguments(argumentList);
  }

  const isShortHelpRequest = argumentList.includes('-h');
  if (isShortHelpRequest) {
    return showUsageForArguments(argumentList);
  }

  const isVersionRequest = isVersionArguments(argumentList);
  if (isVersionRequest) {
    console.log(packageJson.version);
    return { exitCode: 0 };
  }

  const subCommandInvocation = readSubCommandInvocation(argumentList);

  const isUnknownCommand = !Object.hasOwn(subCommands, subCommandInvocation.name);

  if (isUnknownCommand) {
    // citty raises the usage error (exit 2) for a command name it does not know.
    await runCommand(mainCommand, { rawArgs: argumentList });
  }

  const subCommandDefinition = pickPlainSubCommand(subCommandInvocation.name);
  const commandRun = await runCommand(subCommandDefinition, {
    rawArgs: subCommandInvocation.rawArgs,
  });
  const commandReport = commandRun.result;

  const isNotExitReply = !isCommandExit(commandReport);

  if (isNotExitReply) {
    throw new Error('Command finished without an exit code.');
  }

  return commandReport;
}

async function runEntrypoint(argumentList: string[]): Promise<CommandExit> {
  const isInteractiveRun = canRunInteractiveCli({
    argv: process.argv,
    stdinIsTty: process.stdin.isTTY === true,
    stdoutIsTty: process.stdout.isTTY === true,
  });

  if (isInteractiveRun) {
    return runInteractiveCli();
  }

  return runCli(argumentList);
}

function reportUnexpectedError(error: unknown): CommandExit {
  console.error(error, '\n');
  return { exitCode: 1 };
}

async function reportCliError(error: unknown, argumentList: string[]): Promise<CommandExit> {
  const isNotErrorObject = !(error instanceof Error);
  if (isNotErrorObject) {
    return reportUnexpectedError(error);
  }

  const isNotUsageError = error.name !== 'CLIError';
  if (isNotUsageError) {
    return reportUnexpectedError(error);
  }

  const usageTarget = pickUsageTarget(argumentList);
  await showUsage(usageTarget.command, usageTarget.parent);
  console.error(error.message);
  return { exitCode: USAGE_ERROR_EXIT_CODE };
}

async function runEntrypointReportingErrors(argumentList: string[]): Promise<CommandExit> {
  try {
    return await runEntrypoint(argumentList);
  } catch (error) {
    return reportCliError(error, argumentList);
  }
}

const entrypointPath = process.argv[1];

const modulePath = fileURLToPath(import.meta.url);

if (isCliEntrypoint(entrypointPath, modulePath)) {
  process.argv.splice(0, process.argv.length, ...rewriteCommandFlagAliases(process.argv));

  const commandExit = await runEntrypointReportingErrors(
    process.argv.slice(NODE_AND_ENTRYPOINT_ARGUMENT_COUNT),
  );
  process.exitCode = commandExit.exitCode;
}

export type RealpathFunction = (path: string) => string;

export function isCliEntrypoint(
  entrypointPath: string | undefined,
  modulePath: string,
  realpath: RealpathFunction = realpathSync,
): boolean {
  const isEntrypointPathMissing = entrypointPath == null;
  if (isEntrypointPathMissing) {
    return false;
  }

  return realpath(entrypointPath) === realpath(modulePath);
}
