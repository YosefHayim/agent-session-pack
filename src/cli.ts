#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import type { CommandExit } from './archive.js';
import {
  runLifecycleCommand,
  runMaintainCommand,
  runPreflightCommand,
  runWatchCommand,
} from './lifecycle.js';
import { runPackCommand, runPackFlow } from './pack.js';
import {
  askApplyConfirmation,
  type InteractiveCliRequest,
  type PromptAdapter,
  type PromptOption,
  runWithSpinner,
  terminalPromptAdapter,
} from './prompts.js';
import {
  runEnsureRestoredCommand,
  runOpenCommand,
  runRestoreCommand,
  runRestoreFlow,
  runUnpackCommand,
} from './restore.js';
import { runListCommand, runReviewSessions, runSavingsCommand, runScanCommand } from './scan.js';
import { runFirstSetup, runInitCommand } from './setup.js';

export function readPackageVersion(): string {
  const packageFilePath = fileURLToPath(new URL('../package.json', import.meta.url));

  let packageFileText: string;

  try {
    packageFileText = readFileSync(packageFilePath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read package.json at ${packageFilePath}`, { cause: error });
  }

  return readVersion(packageFileText);
}

function readVersion(packageFileText: string): string {
  let packageFile: unknown;

  try {
    packageFile = JSON.parse(packageFileText);
  } catch (error) {
    throw new Error('Could not parse package.json', { cause: error });
  }

  return readVersionField(packageFile);
}

function readVersionField(packageFile: unknown): string {
  if (typeof packageFile != 'object') {
    throw new Error('package.json version is missing');
  }

  if (packageFile == null) {
    throw new Error('package.json version is missing');
  }

  const hasVersion = 'version' in packageFile;

  if (!hasVersion) {
    throw new Error('package.json version is missing');
  }

  const version = packageFile.version;
  if (typeof version != 'string') {
    throw new Error('package.json version is missing');
  }

  return version;
}

export const COMMAND_NAMES = [
  'scan',
  'pack',
  'restore',
  'guide',
  'list',
  'unpack',
  'open',
  'lifecycle',
  'doctor',
  'savings',
  'check',
  'init',
  'maintain',
  'preflight',
  'watch',
  'ensure-restored',
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

export interface CliInvocation {
  readonly commandName: CommandName;
  readonly apply: boolean;
  readonly yes: boolean;
  readonly json: boolean;
  readonly dryRun: boolean;
  readonly allProviders: boolean;
  readonly max: boolean;
  readonly provider: string | undefined;
  readonly olderThan: string | undefined;
  readonly to: string | undefined;
  readonly pollMs: string | undefined;
  readonly positionals: ReadonlyArray<string>;
  readonly execArgv: ReadonlyArray<string>;
}

export type CliRead =
  | { readonly status: 'ok'; readonly invocation: CliInvocation }
  | { readonly status: 'help'; readonly commandName: CommandName | null }
  | { readonly status: 'version' }
  | { readonly status: 'unknown-command'; readonly commandName: string }
  | { readonly status: 'bad-usage'; readonly message: string };

export function readCliInvocation(argumentList: ReadonlyArray<string>): CliRead {
  if (isVersionRequest(argumentList)) {
    return { status: 'version' };
  }

  const splitArguments = splitExecArgv(argumentList);
  const commandWordRead = readCommandWord(splitArguments.head);
  const isHelp = hasHelpFlag(splitArguments.head);

  if (isHelp) {
    return {
      status: 'help',
      commandName: readKnownCommandName(commandWordRead.commandWord),
    };
  }

  if (isUnknownCommandWord(commandWordRead.commandWord)) {
    return {
      status: 'unknown-command',
      commandName: commandWordRead.commandWord ?? '',
    };
  }

  const parsedArguments = readParsedArguments(commandWordRead.remainingArguments);

  if (parsedArguments.status == 'bad-usage') {
    return parsedArguments;
  }

  return {
    status: 'ok',
    invocation: {
      commandName: readCommandName(commandWordRead.commandWord),
      apply: parsedArguments.parsed.values.apply == true,
      yes: parsedArguments.parsed.values.yes == true,
      json: parsedArguments.parsed.values.json == true,
      dryRun: parsedArguments.parsed.values['dry-run'] == true,
      allProviders: parsedArguments.parsed.values['all-providers'] == true,
      max: parsedArguments.parsed.values.max == true,
      provider: parsedArguments.parsed.values.provider,
      olderThan: parsedArguments.parsed.values['older-than'],
      to: parsedArguments.parsed.values.to,
      pollMs: parsedArguments.parsed.values['poll-ms'],
      positionals: parsedArguments.parsed.positionals,
      execArgv: splitArguments.execArgv,
    },
  };
}

function isVersionRequest(argumentList: ReadonlyArray<string>): boolean {
  if (argumentList.length != 1) {
    return false;
  }

  const argument = argumentList[0];
  if (argument == '--version') {
    return true;
  }

  return argument == '-v';
}

function splitExecArgv(argumentList: ReadonlyArray<string>): {
  readonly head: ReadonlyArray<string>;
  readonly execArgv: ReadonlyArray<string>;
} {
  const separatorIndex = argumentList.indexOf('--');
  if (separatorIndex == -1) {
    return { head: argumentList, execArgv: [] };
  }

  return {
    head: argumentList.slice(0, separatorIndex),
    execArgv: argumentList.slice(separatorIndex + 1),
  };
}

function isNotFlag(argument: string): boolean {
  const isFlag = argument.startsWith('-');
  return isFlag == false;
}

function readCommandWord(head: ReadonlyArray<string>): {
  readonly commandWord: string | null;
  readonly remainingArguments: ReadonlyArray<string>;
} {
  const wordIndex = head.findIndex(isNotFlag);
  const isWordMissing = wordIndex == -1;

  if (isWordMissing) {
    return { commandWord: null, remainingArguments: head };
  }

  const commandWord = head[wordIndex] ?? null;
  const remainingArguments = [...head.slice(0, wordIndex), ...head.slice(wordIndex + 1)];
  return { commandWord, remainingArguments };
}

function isHelpFlag(argument: string): boolean {
  if (argument == '--help') {
    return true;
  }

  return argument == '-h';
}

function hasHelpFlag(argumentList: ReadonlyArray<string>): boolean {
  for (const argument of argumentList) {
    const isHelp = isHelpFlag(argument);

    if (isHelp) {
      return true;
    }
  }

  return false;
}

function readKnownCommandName(commandWord: string | null): CommandName | null {
  const isWordMissing = commandWord == null;

  if (isWordMissing) {
    return null;
  }

  for (const commandName of COMMAND_NAMES) {
    if (commandName == commandWord) {
      return commandName;
    }
  }

  return null;
}

function isUnknownCommandWord(commandWord: string | null): boolean {
  const isWordMissing = commandWord == null;

  if (isWordMissing) {
    return false;
  }

  return readKnownCommandName(commandWord) == null;
}

function readCommandName(commandWord: string | null): CommandName {
  const knownCommandName = readKnownCommandName(commandWord);
  if (knownCommandName == null) {
    return 'scan';
  }

  return knownCommandName;
}

interface ParsedArgumentsOk {
  readonly status: 'ok';
  readonly parsed: ReturnType<typeof parseCliArgs>;
}

type ParsedArguments =
  | ParsedArgumentsOk
  | { readonly status: 'bad-usage'; readonly message: string };

function readParsedArguments(argumentList: ReadonlyArray<string>): ParsedArguments {
  try {
    const parsed = parseCliArgs(argumentList);
    return { status: 'ok', parsed };
  } catch (error) {
    return { status: 'bad-usage', message: readThrownMessage(error) };
  }
}

function parseCliArgs(argumentList: ReadonlyArray<string>) {
  return parseArgs({
    args: [...argumentList],
    strict: true,
    allowPositionals: true,
    options: {
      apply: { type: 'boolean' },
      yes: { type: 'boolean' },
      json: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'all-providers': { type: 'boolean' },
      max: { type: 'boolean' },
      provider: { type: 'string' },
      'older-than': { type: 'string' },
      to: { type: 'string' },
      'poll-ms': { type: 'string' },
    },
  });
}

function readThrownMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Bad usage.';
}

const JSON_FLAG_LINE = '--json              Write stable JSON output.';
const PROVIDER_FLAG_LINE =
  '--provider <id>      Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.';
const APPLY_FLAG_LINE = '--apply              Apply after verification.';
const YES_FLAG_LINE = '--yes                Confirm apply without a prompt.';

const EVERYDAY_COMMAND_NAMES = [
  'scan',
  'pack',
  'restore',
  'guide',
] as const satisfies ReadonlyArray<CommandName>;

interface CommandHelp {
  readonly description: string;
  readonly flags: ReadonlyArray<string>;
}

const COMMAND_HELP = {
  scan: {
    description: 'Scan provider stores and estimate sessions.',
    flags: [PROVIDER_FLAG_LINE, JSON_FLAG_LINE],
  },
  pack: {
    description: 'Pack cold sessions after verified archive restore.',
    flags: [
      PROVIDER_FLAG_LINE,
      '--older-than <age>  Cold threshold such as 7d, 2w, 30d, or 12h.',
      '--dry-run            Preview changes without removing originals.',
      '--all-providers      Discover every supported provider store on this machine.',
      '--max                Preview every archive-mode session candidate. Dry-run only.',
      APPLY_FLAG_LINE,
      YES_FLAG_LINE,
      JSON_FLAG_LINE,
    ],
  },
  restore: {
    description:
      'Restore a packed session by id, id prefix, name, slug, fuzzy words, or provider-prefixed selector.',
    flags: [
      '<selector>           Session id, name, slug, or provider-prefixed selector.',
      PROVIDER_FLAG_LINE,
      '--to <destination>   Restore destination: original (default).',
      JSON_FLAG_LINE,
    ],
  },
  guide: {
    description: 'Show safe commands for agents and automation.',
    flags: [JSON_FLAG_LINE],
  },
  list: {
    description: 'List indexed sessions with date, status, and path.',
    flags: [PROVIDER_FLAG_LINE, JSON_FLAG_LINE],
  },
  unpack: {
    description: 'Restore archived sessions from the vault.',
    flags: [
      PROVIDER_FLAG_LINE,
      '--all-providers      Restore archived sessions for every supported provider.',
      APPLY_FLAG_LINE,
      YES_FLAG_LINE,
      JSON_FLAG_LINE,
    ],
  },
  open: {
    description: 'Look up a session and auto-restore it from the vault when lifecycle is enabled.',
    flags: [
      PROVIDER_FLAG_LINE,
      '<session>            Session id, slug, title, or provider-prefixed selector.',
      JSON_FLAG_LINE,
    ],
  },
  lifecycle: {
    description:
      'Enable, disable, or show continuous restore-on-open + cold-pack lifecycle (installs provider wrappers).',
    flags: ['<action>             enable, disable, or status.', JSON_FLAG_LINE],
  },
  doctor: {
    description: 'Check local prerequisites.',
    flags: [JSON_FLAG_LINE],
  },
  savings: {
    description: 'Show copy-only local before/after compression proof.',
    flags: [PROVIDER_FLAG_LINE, JSON_FLAG_LINE],
  },
  check: {
    description: 'Run the no-install local savings proof.',
    flags: [PROVIDER_FLAG_LINE, JSON_FLAG_LINE],
  },
  init: {
    description: 'Show default vault policy and dry-run setup.',
    flags: ['--apply              Write config after review.', JSON_FLAG_LINE],
  },
  maintain: {
    description:
      'Pack cold live sessions again (continuous storage). Uses setup coldAfter when lifecycle is enabled.',
    flags: [
      APPLY_FLAG_LINE,
      YES_FLAG_LINE,
      '--dry-run            Preview cold candidates without packing.',
      JSON_FLAG_LINE,
    ],
  },
  preflight: {
    description:
      'Auto-restore packed sessions found in provider argv when lifecycle is enabled (wrapper hook).',
    flags: [PROVIDER_FLAG_LINE, JSON_FLAG_LINE],
  },
  watch: {
    description:
      'Watch archived session stubs and auto-restore when a provider opens them (GUI-friendly).',
    flags: [
      PROVIDER_FLAG_LINE,
      JSON_FLAG_LINE,
      '--poll-ms <ms>       Poll interval in milliseconds (default 750).',
    ],
  },
  'ensure-restored': {
    description:
      'Restore one archived session before provider resume when restore-on-launch is enabled.',
    flags: [
      PROVIDER_FLAG_LINE,
      '<session>            Session id, slug, title, or provider-prefixed selector.',
      JSON_FLAG_LINE,
    ],
  },
} as const satisfies Record<CommandName, CommandHelp>;

export function createCommandUsage(commandName: CommandName | null): string {
  const header = [
    `agent-session-pack ${readPackageVersion()}`,
    'Pack cold local AI coding-agent sessions with byte-exact restore.',
    '',
  ];

  if (commandName == null) {
    const commandLines = listHelpOrder().map(createCommandLine);
    return [...header, 'Commands:', ...commandLines, ''].join('\n');
  }

  const commandHelp = COMMAND_HELP[commandName];
  return [
    ...header,
    createCommandLine(commandName),
    '',
    'Flags:',
    ...commandHelp.flags.map(indentFlag),
    '',
  ].join('\n');
}

function listHelpOrder(): CommandName[] {
  const laterNames = COMMAND_NAMES.filter(isLaterCommand);
  return [...EVERYDAY_COMMAND_NAMES, ...laterNames];
}

function isLaterCommand(commandName: CommandName): boolean {
  for (const everydayName of EVERYDAY_COMMAND_NAMES) {
    if (everydayName == commandName) {
      return false;
    }
  }

  return true;
}

function createCommandLine(commandName: CommandName): string {
  const description = COMMAND_HELP[commandName].description;
  return `  ${commandName.padEnd(16)} ${description}`;
}

function indentFlag(flagLine: string): string {
  return `  ${flagLine}`;
}

const commandFlagAliases: Readonly<Record<string, string>> = {
  '--check': 'check',
  '--doctor': 'doctor',
  '--guide': 'guide',
  '--init': 'init',
  '--list': 'list',
  '--lifecycle': 'lifecycle',
  '--maintain': 'maintain',
  '--open': 'open',
  '--pack': 'pack',
  '--preflight': 'preflight',
  '--restore': 'restore',
  '--watch': 'watch',
  '--savings': 'savings',
  '--scan': 'scan',
  '--unpack': 'unpack',
};

export function rewriteCommandFlagAliases(argv: ReadonlyArray<string>): ReadonlyArray<string> {
  const [runtimePath, entrypointPath, firstArg, ...remainingArgumentList] = argv;

  if (runtimePath == null || entrypointPath == null || firstArg == null) {
    return argv;
  }

  if (firstArg == '--') {
    return [runtimePath, entrypointPath, ...remainingArgumentList];
  }

  const aliasedCommand = commandFlagAliases[firstArg];

  if (aliasedCommand == null) {
    return argv;
  }

  return [runtimePath, entrypointPath, aliasedCommand, ...remainingArgumentList];
}

const execFileAsync = promisify(execFile);
const VERSION_ARGUMENT_LIST: ReadonlyArray<string> = ['--version'];

interface CommandCheck {
  readonly available: boolean;
  readonly version?: string;
}

export interface DoctorFlags {
  readonly json?: boolean | undefined;
}

export async function runDoctorCommand(flags: DoctorFlags): Promise<CommandExit> {
  const zstd = await checkCommand('zstd', VERSION_ARGUMENT_LIST);
  const sqlite3 = await checkCommand('sqlite3', VERSION_ARGUMENT_LIST);

  if (flags.json == true) {
    process.stdout.write(`${JSON.stringify({ sqlite3, zstd })}\n`);
    return { exitCode: 0 };
  }

  process.stdout.write(`zstd: ${describeCommandVersion(zstd)}\n`);
  process.stdout.write(`sqlite3: ${describeCommandVersion(sqlite3)}\n`);
  return { exitCode: 0 };
}

function describeCommandVersion(commandCheck: CommandCheck): string | undefined {
  if (!commandCheck.available) {
    return 'missing';
  }

  return commandCheck.version;
}

async function checkCommand(
  command: string,
  versionArgumentList: ReadonlyArray<string>,
): Promise<CommandCheck> {
  try {
    const printout = await execFileAsync(command, [...versionArgumentList]);

    return {
      available: true,
      version: printout.stdout.trim(),
    };
  } catch {
    return {
      available: false,
    };
  }
}

export interface GuideFlags {
  readonly json?: boolean;
}

export async function runGuideCommand(flags: GuideFlags): Promise<CommandExit> {
  if (flags.json == true) {
    process.stdout.write(createStructuredAgentGuide());
    return { exitCode: 0 };
  }

  process.stdout.write(`${createHumanAgentGuide()}\n`);
  return { exitCode: 0 };
}

const ONE_OFF_PREFIX = 'npx --yes agent-session-pack';

interface AgentGuideStep {
  readonly id: string;
  readonly purpose: string;
  readonly command: string;
}

interface AgentGuide {
  readonly name: 'agent-session-pack';
  readonly mode: 'agent-guide';
  readonly summary: string;
  readonly safety: {
    readonly bareCommand: 'human-tty-only';
    readonly defaultMutation: 'none';
    readonly machineOutput: '--json';
    readonly applyConfirmation: '--apply --yes';
  };
  readonly recommendedFlow: ReadonlyArray<AgentGuideStep>;
  readonly commands: {
    readonly humanSetup: string;
    readonly doctor: string;
    readonly scan: string;
    readonly check: string;
    readonly dryRunPack: string;
    readonly maxPreview: string;
    readonly applyPack: string;
    readonly applyUnpack: string;
    readonly restoreOne: string;
    readonly openSession: string;
    readonly ensureRestored: string;
    readonly maintain: string;
    readonly lifecycleEnable: string;
    readonly lifecycleStatus: string;
  };
  readonly providers: ReadonlyArray<string>;
  readonly notes: ReadonlyArray<string>;
}

const RECOMMENDED_FLOW: ReadonlyArray<AgentGuideStep> = [
  {
    id: 'proof',
    purpose: 'Copy-only proof. Shows local before/after savings without touching originals.',
    command: `${ONE_OFF_PREFIX} check --json`,
  },
  {
    id: 'dry-run-pack',
    purpose: 'Plan cold-session packing across discovered providers without removing originals.',
    command: `${ONE_OFF_PREFIX} pack --all-providers --older-than 7d --dry-run --json`,
  },
  {
    id: 'apply-pack',
    purpose: 'Archive and remove only after byte-exact restore verification and manifest writes.',
    command: `${ONE_OFF_PREFIX} pack --all-providers --older-than 7d --apply --yes --json`,
  },
  {
    id: 'restore',
    purpose: 'Restore archived sessions back to original provider paths when needed.',
    command: `${ONE_OFF_PREFIX} unpack --all-providers --apply --yes --json`,
  },
  {
    id: 'lifecycle',
    purpose:
      'Enable continuous lifecycle: provider wrappers auto-restore packed sessions; maintain re-packs cold ones.',
    command: `${ONE_OFF_PREFIX} lifecycle enable --json`,
  },
  {
    id: 'open',
    purpose:
      'Look up a session and auto-uncompress it if packed (safe conflict skip if live differs).',
    command: `${ONE_OFF_PREFIX} open --provider codex <session-id> --json`,
  },
  {
    id: 'maintain',
    purpose: 'Re-pack cold sessions so storage stays low after restores.',
    command: `${ONE_OFF_PREFIX} maintain --apply --yes --json`,
  },
];

const agentGuide: AgentGuide = {
  name: 'agent-session-pack',
  mode: 'agent-guide',
  summary: 'Agent-safe command map for local AI coding-agent session cold storage.',
  safety: {
    bareCommand: 'human-tty-only',
    defaultMutation: 'none',
    machineOutput: '--json',
    applyConfirmation: '--apply --yes',
  },
  recommendedFlow: RECOMMENDED_FLOW,
  commands: {
    humanSetup: `${ONE_OFF_PREFIX}`,
    doctor: `${ONE_OFF_PREFIX} doctor --json`,
    scan: `${ONE_OFF_PREFIX} scan --json`,
    check: `${ONE_OFF_PREFIX} check --json`,
    dryRunPack: `${ONE_OFF_PREFIX} pack --all-providers --older-than 7d --dry-run --json`,
    maxPreview: `${ONE_OFF_PREFIX} pack --max --dry-run --json`,
    applyPack: `${ONE_OFF_PREFIX} pack --all-providers --older-than 7d --apply --yes --json`,
    applyUnpack: `${ONE_OFF_PREFIX} unpack --all-providers --apply --yes --json`,
    restoreOne: `${ONE_OFF_PREFIX} restore <selector> --json`,
    openSession: `${ONE_OFF_PREFIX} open --provider codex <session-id> --json`,
    ensureRestored: `${ONE_OFF_PREFIX} ensure-restored --provider codex <session-id> --json`,
    maintain: `${ONE_OFF_PREFIX} maintain --apply --yes --json`,
    lifecycleEnable: `${ONE_OFF_PREFIX} lifecycle enable --json`,
    lifecycleStatus: `${ONE_OFF_PREFIX} lifecycle status --json`,
  },
  providers: ['codex', 'claude', 'kiro', 'grok', 'kimi', 'opencode', 'gemini', 'cursor', 'devin'],
  notes: [
    'Prefer explicit subcommands with --json.',
    'Bare agent-session-pack is for human TTY setup.',
    'Use --dry-run before any --apply command.',
    'Use --max --dry-run to preview every archive-mode session without touching files.',
    'Use --older-than 1d to skip recent sessions from roughly the last 24 hours.',
    'lifecycle enable installs provider wrappers + PATH hint; open/preflight auto-restore packed sessions.',
    'Run maintain periodically (or after heavy restore) to re-pack cold sessions and keep savings.',
  ],
};

function describeFlowStep(step: AgentGuideStep, index: number): string {
  return [`${index + 1}. ${step.purpose}`, `   ${step.command}`].join('\n');
}

export function createHumanAgentGuide(): string {
  return [
    'Agent-first quickstart',
    '',
    'Rules',
    '- Prefer explicit subcommands with --json.',
    '- Bare agent-session-pack is for human TTY setup.',
    '- Nothing mutates provider sessions until --apply is present.',
    '- Use --dry-run before --apply, then use --yes only for non-interactive execution.',
    '',
    'Safe flow',
    ...RECOMMENDED_FLOW.map(describeFlowStep),
    '',
    'Curiosity preview',
    `${ONE_OFF_PREFIX} pack --max --dry-run --json`,
    '',
    'Continuous storage lifecycle (opt-in)',
    `${ONE_OFF_PREFIX} lifecycle enable --json`,
    '# put wrappers first: export PATH="$HOME/.agent-session-pack/bin:$PATH"',
    `${ONE_OFF_PREFIX} open --provider codex <session-id> --json`,
    `${ONE_OFF_PREFIX} maintain --apply --yes --json`,
    '',
    'Provider ids',
    'codex, claude, kiro, grok, kimi, opencode, gemini, cursor, devin',
    '',
    'More help',
    'agent-session-pack <command> --help',
    'agent-session-pack guide --json',
  ].join('\n');
}

export function createStructuredAgentGuide(): string {
  const jsonIndentSpaces = 2;

  return `${JSON.stringify(agentGuide, null, jsonIndentSpaces)}\n`;
}

export async function runNamedCommand(invocation: CliInvocation): Promise<CommandExit> {
  switch (invocation.commandName) {
    case 'scan':
      return runScanCommand({
        provider: invocation.provider,
        json: invocation.json,
      });
    case 'list':
      return runListCommand();
    case 'pack':
      return runPackFromInvocation(invocation);
    case 'unpack':
      return runUnpackFromInvocation(invocation);
    case 'restore':
      return runRestoreCommand({
        json: invocation.json,
        provider: invocation.provider,
        selector: readFirstPositional(invocation),
        to: invocation.to,
      });
    case 'open':
      return runOpenCommand({
        json: invocation.json,
        provider: invocation.provider,
        session: readFirstPositional(invocation),
      });
    case 'ensure-restored':
      return runEnsureRestoredCommand({
        json: invocation.json,
        provider: invocation.provider,
        session: readFirstPositional(invocation),
      });
    case 'guide':
      return runGuideCommand({ json: invocation.json });
    case 'doctor':
      return runDoctorCommand({ json: invocation.json });
    case 'savings':
      return runSavingsCommand({
        provider: invocation.provider,
        json: invocation.json,
      });
    case 'check':
      return runSavingsCommand({
        provider: invocation.provider,
        json: invocation.json,
      });
    case 'init':
      return runInitCommand({
        apply: invocation.apply,
        json: invocation.json,
      });
    case 'lifecycle':
      return runLifecycleCommand({
        action: readFirstPositional(invocation),
        json: invocation.json,
      });
    case 'maintain':
      return runMaintainFromInvocation(invocation);
    case 'preflight':
      return runPreflightCommand({
        json: invocation.json,
        provider: invocation.provider,
        passthroughArgv: readPreflightPassthrough(invocation),
      });
    case 'watch':
      return runWatchCommand({
        provider: invocation.provider,
        json: invocation.json,
        pollMs: invocation.pollMs,
        execArgv: invocation.execArgv,
      });
  }
}

function readFirstPositional(invocation: CliInvocation): string | undefined {
  return invocation.positionals[0];
}

function readPreflightPassthrough(invocation: CliInvocation): ReadonlyArray<string> {
  if (invocation.execArgv.length > 0) {
    return invocation.execArgv;
  }

  return invocation.positionals;
}

function isMaxAndApply(invocation: CliInvocation): boolean {
  if (invocation.max != true) {
    return false;
  }

  return invocation.apply == true;
}

async function runPackFromInvocation(invocation: CliInvocation): Promise<CommandExit> {
  const isMaxApply = isMaxAndApply(invocation);
  const confirmed = await readPackConfirmation(invocation, isMaxApply);

  return runPackCommand({
    allProviders: invocation.allProviders,
    provider: invocation.provider,
    max: invocation.max,
    olderThan: invocation.olderThan,
    dryRun: invocation.dryRun,
    apply: invocation.apply,
    json: invocation.json,
    yes: invocation.yes,
    confirmed,
  });
}

async function readPackConfirmation(
  invocation: CliInvocation,
  isMaxApply: boolean,
): Promise<boolean | undefined> {
  if (isMaxApply) {
    return false;
  }

  return askApplyConfirmation({
    action: 'Pack cold sessions for the selected providers',
    apply: invocation.apply,
    json: invocation.json,
    yes: invocation.yes,
  });
}

async function runUnpackFromInvocation(invocation: CliInvocation): Promise<CommandExit> {
  const confirmed = await askApplyConfirmation({
    action: 'Restore archived sessions for the selected providers',
    apply: invocation.apply,
    json: invocation.json,
    yes: invocation.yes,
  });

  return runUnpackCommand({
    allProviders: invocation.allProviders,
    apply: invocation.apply,
    confirmed,
    json: invocation.json,
    provider: invocation.provider,
    yes: invocation.yes,
  });
}

async function runMaintainFromInvocation(invocation: CliInvocation): Promise<CommandExit> {
  const confirmed = await askApplyConfirmation({
    action: 'Pack cold sessions for continuous storage maintenance',
    apply: invocation.apply,
    json: invocation.json,
    yes: invocation.yes,
  });

  return runMaintainCommand({
    apply: invocation.apply,
    confirmed,
    dryRun: invocation.dryRun,
    json: invocation.json,
    yes: invocation.yes,
  });
}

type MainMenuAction = 'doctor' | 'exit' | 'pack' | 'restore' | 'review' | 'savings' | 'setup';

export interface InteractiveCliDetectionRequest {
  readonly argv: ReadonlyArray<string>;
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
}

export function canRunInteractiveCli(request: InteractiveCliDetectionRequest): boolean {
  if (!request.stdinIsTty) {
    return false;
  }

  if (!request.stdoutIsTty) {
    return false;
  }

  const maxArgvLength = 2;

  return request.argv.length <= maxArgvLength;
}

export function createMainMenuChoices(): ReadonlyArray<PromptOption<MainMenuAction>> {
  return [
    {
      value: 'setup',
      label: 'First setup',
      hint: 'choose providers, vault path, cold threshold, and safety defaults',
    },
    {
      value: 'savings',
      label: 'Check savings',
      hint: 'copy-only proof; shows what you could save without touching sessions',
    },
    {
      value: 'review',
      label: 'Review sessions',
      hint: 'scan all providers; show dates, paths, size, cold/active status',
    },
    {
      value: 'pack',
      label: 'Pack cold sessions',
      hint: 'dry-run first; apply only after verified archive + confirmation',
    },
    {
      value: 'restore',
      label: 'Restore sessions',
      hint: 'unpack archived sessions back to native provider paths',
    },
    {
      value: 'doctor',
      label: 'Doctor',
      hint: 'check zstd, sqlite, provider roots, vault health, and config',
    },
    {
      value: 'exit',
      label: 'Exit',
      hint: 'leave without changing files',
    },
  ];
}

export async function runInteractiveCli(request: InteractiveCliRequest = {}): Promise<CommandExit> {
  const prompts = request.prompts ?? terminalPromptAdapter;
  prompts.intro('Agent Session Pack');
  prompts.note(readFirstScreenCopy());

  const action = await prompts.select({
    message: 'What do you want to do?',
    options: createMainMenuChoices(),
  });

  if (prompts.isCancel(action)) {
    prompts.outro('No files changed.');
    return { exitCode: 0 };
  }

  if (action == 'exit') {
    prompts.outro('No files changed.');
    return { exitCode: 0 };
  }

  return runInteractiveAction({
    ...request,
    action,
    prompts,
  });
}

async function runInteractiveAction(
  request: InteractiveCliRequest & {
    readonly action: MainMenuAction;
    readonly prompts: PromptAdapter;
  },
): Promise<CommandExit> {
  if (request.action == 'setup') {
    await runFirstSetup({
      ...request,
      showIntro: false,
    });
    return { exitCode: 0 };
  }

  if (request.action == 'savings') {
    function checkSavings(): Promise<CommandExit> {
      return runSavingsCommand({});
    }

    const savingsExit = await runWithSpinner({
      prompts: request.prompts,
      startMessage: 'Checking savings...',
      stopMessage: 'Savings check complete.',
      task: checkSavings,
    });
    request.prompts.outro('Original sessions touched: no');
    return savingsExit;
  }

  if (request.action == 'review') {
    return runReviewSessions(request);
  }

  if (request.action == 'pack') {
    return runPackFlow(request);
  }

  if (request.action == 'restore') {
    return runRestoreFlow(request);
  }

  return runDoctorCommand({});
}

function readFirstScreenCopy(): string {
  return [
    'Compress old local AI-agent sessions without breaking resume.',
    '',
    'How it works:',
    '  1. Scans provider stores read-only',
    '  2. Proves savings on copied files first',
    '  3. Packs only cold sessions into ~/.agent-session-pack',
    '  4. Verifies byte-exact restore',
    '  5. Removes originals only after verification',
    '',
    'No daemon. No background deletion. Cursor and Devin stay backup-only for now. Grok/Kimi pack whole session directories.',
  ].join('\n');
}

const USAGE_ERROR_EXIT_CODE = 2;

export async function runCliArguments(argumentList: ReadonlyArray<string>): Promise<CommandExit> {
  try {
    return await runEntrypoint(argumentList);
  } catch (error) {
    console.error(error);
    return { exitCode: 1 };
  }
}

async function runEntrypoint(argumentList: ReadonlyArray<string>): Promise<CommandExit> {
  const isInteractiveRun = canRunInteractiveCli({
    argv: process.argv,
    stdinIsTty: process.stdin.isTTY == true,
    stdoutIsTty: process.stdout.isTTY == true,
  });

  if (isInteractiveRun) {
    return runInteractiveCli();
  }

  return finishCliRead(readCliInvocation(argumentList));
}

async function finishCliRead(cliRead: CliRead): Promise<CommandExit> {
  if (cliRead.status == 'help') {
    process.stdout.write(createCommandUsage(cliRead.commandName));
    return { exitCode: 0 };
  }

  if (cliRead.status == 'version') {
    console.log(readPackageVersion());
    return { exitCode: 0 };
  }

  if (cliRead.status == 'unknown-command') {
    process.stdout.write(createCommandUsage(null));
    process.stderr.write(`Unknown command: ${cliRead.commandName}\n`);
    return { exitCode: USAGE_ERROR_EXIT_CODE };
  }

  if (cliRead.status == 'bad-usage') {
    process.stdout.write(createCommandUsage(null));
    process.stderr.write(`${cliRead.message}\n`);
    return { exitCode: USAGE_ERROR_EXIT_CODE };
  }

  return runNamedCommand(cliRead.invocation);
}

const entrypointPath = process.argv[1];

const modulePath = fileURLToPath(import.meta.url);

if (isCliEntrypoint(entrypointPath, modulePath)) {
  process.argv.splice(0, process.argv.length, ...rewriteCommandFlagAliases(process.argv));

  const commandExit = await runCliArguments(process.argv.slice(2));
  process.exitCode = commandExit.exitCode;
}

export function isCliEntrypoint(
  entrypointPath: string | undefined,
  modulePath: string,
  realpath: (filePath: string) => string = realpathSync,
): boolean {
  if (entrypointPath == null) {
    return false;
  }

  const resolvedEntrypointPath = realpath(entrypointPath);
  const resolvedModulePath = realpath(modulePath);
  return resolvedEntrypointPath == resolvedModulePath;
}
