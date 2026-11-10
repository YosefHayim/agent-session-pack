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
import { scanCommand } from '@/scan/command.js';
import { listCommand } from '@/scan/list-command.js';
import { initCommand } from '@/setup/init-command.js';
import packageJson from '../../package.json' with { type: 'json' };
import { canRunInteractiveCli, runInteractiveCli } from './interactive-cli.js';
import { rewriteCommandFlagAliases } from './main-args.js';
import { isCliEntrypoint } from './main-entrypoint.js';

/**
 * Subcommands of the root command, keyed by the name typed on the command line.
 */
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

/**
 * Root citty command that wires all Agent Session Pack subcommands.
 */
export const mainCommand = defineCommand({
  meta: {
    name: 'agent-session-pack',
    version: packageJson.version,
    description:
      'Pack cold local AI coding-agent sessions with byte-exact restore. Run guide for agent-safe commands.',
  },
  subCommands,
  default: 'scan',
});

/**
 * The command whose usage text is shown, and the root it is shown under.
 */
interface UsageTarget {
  readonly command: CommandDef;
  readonly parent: CommandDef | undefined;
}

const pickUsageTarget = (argumentList: string[]): UsageTarget => {
  const subCommandName = argumentList.find((arg) => Object.hasOwn(subCommands, arg));

  const isThereNoSubCommandName = subCommandName == null;

  if (isThereNoSubCommandName) {
    return { command: mainCommand, parent: undefined };
  }

  const subCommandReply = subCommands[subCommandName];

  const isNotPlainCommand =
    typeof subCommandReply !== 'object' || subCommandReply instanceof Promise;

  if (isNotPlainCommand) {
    throw new Error(`Subcommand ${subCommandName} is not a command object.`);
  }

  return { command: subCommandReply, parent: mainCommand };
};

const isCommandExit = (candidate: unknown): candidate is CommandExit =>
  typeof candidate === 'object' && candidate !== null && 'exitCode' in candidate;

const runCli = async (argumentList: string[]): Promise<CommandExit> => {
  const isHelpRequest = argumentList.includes('--help') || argumentList.includes('-h');
  const isVersionRequest =
    argumentList.length === 1 && (argumentList[0] === '--version' || argumentList[0] === '-v');

  if (isHelpRequest) {
    const usageTarget = pickUsageTarget(argumentList);
    await showUsage(usageTarget.command, usageTarget.parent);
    return { exitCode: 0 };
  }

  if (isVersionRequest) {
    console.log(packageJson.version);
    return { exitCode: 0 };
  }

  const commandRun = await runCommand(mainCommand, { rawArgs: argumentList });
  const commandReport = commandRun.result;

  const isNotExitReply = !isCommandExit(commandReport);

  if (isNotExitReply) {
    throw new Error('Command finished without an exit code.');
  }

  return commandReport;
};

const runEntrypoint = async (argumentList: string[]): Promise<CommandExit> => {
  const isInteractiveRun = canRunInteractiveCli({
    argv: process.argv,
    stdinIsTty: process.stdin.isTTY === true,
    stdoutIsTty: process.stdout.isTTY === true,
  });

  if (isInteractiveRun) {
    return runInteractiveCli();
  }

  return runCli(argumentList);
};

const reportCliError = async (error: unknown, argumentList: string[]): Promise<CommandExit> => {
  const isUsageError = error instanceof Error && error.name === 'CLIError';

  if (isUsageError) {
    const usageTarget = pickUsageTarget(argumentList);
    await showUsage(usageTarget.command, usageTarget.parent);
    console.error(error.message);
    return { exitCode: 2 };
  }

  console.error(error, '\n');
  return { exitCode: 1 };
};

const runEntrypointReportingErrors = async (argumentList: string[]): Promise<CommandExit> => {
  try {
    return await runEntrypoint(argumentList);
  } catch (error) {
    return reportCliError(error, argumentList);
  }
};

const entrypointPath = process.argv[1];

const modulePath = fileURLToPath(import.meta.url);

if (isCliEntrypoint(entrypointPath, modulePath)) {
  process.argv.splice(0, process.argv.length, ...rewriteCommandFlagAliases(process.argv));

  const commandExit = await runEntrypointReportingErrors(process.argv.slice(2));
  process.exitCode = commandExit.exitCode;
}
