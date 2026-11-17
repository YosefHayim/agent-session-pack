import { defineCommand } from 'citty';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/environment.js';
import { DEFAULT_COLD_AFTER } from '@/pack/plan.js';
import {
  isRestoreOnLaunchEnabled,
  readSetupSettings,
  type SetupSettings,
  writeSetupSettings,
} from '@/setup/config.js';
import { createWrappersBinPath } from './session-access.js';
import { installLifecycleWrappers, uninstallLifecycleWrappers } from './wrappers.js';

const USAGE_ERROR_EXIT_CODE = 2;
const JSON_INDENT_SPACES = 2;
const ENABLE_ACTION = 'enable';
const DEFAULT_RESTORE_CACHE_AFTER = '7d';
const OPEN_COMMAND_HINT = 'agent-session-pack open --provider <id> <session> --json';
const SETTINGS_VERSION = 1;

export const lifecycleCommand = defineCommand({
  meta: {
    name: 'lifecycle',
    description:
      'Enable, disable, or show continuous restore-on-open + cold-pack lifecycle (installs provider wrappers).',
  },
  args: {
    action: {
      type: 'positional',
      description: 'Action: enable | disable | status.',
      required: true,
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    return runLifecycleCommand({
      action: args.action,
      json: args.json,
    });
  },
});

export interface LifecycleFlags {
  readonly action: string | undefined;
  readonly json: boolean | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly cliEntrypoint?: string | undefined;
}

export async function runLifecycleCommand(flags: LifecycleFlags): Promise<CommandExit> {
  const home = requireHome(flags.home);

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const action = flags.action?.trim().toLowerCase();

  const isActionKnown = action === ENABLE_ACTION || action === 'disable' || action === 'status';

  const isActionUnknown = !isActionKnown;
  if (isActionUnknown) {
    process.stderr.write('Unknown lifecycle action. Use enable, disable, or status.\n');
    return { exitCode: USAGE_ERROR_EXIT_CODE };
  }

  const existingSettings = await readSetupSettings(home);
  const now = flags.now ?? new Date();
  const vaultPath = existingSettings?.vaultPath ?? createDefaultVaultPath(home);
  const wrappersBin = createWrappersBinPath(vaultPath);
  const cliEntrypoint = flags.cliEntrypoint ?? pickCliEntrypoint();
  const isMachineReadableRequested = flags.json === true;

  const isActionStatus = action === 'status';
  if (isActionStatus) {
    writeLifecycleStatus(
      {
        restoreOnLaunch: isRestoreOnLaunchEnabled(existingSettings),
        restoreCacheAfter: existingSettings?.restoreCacheAfter,
        coldAfter: existingSettings?.coldAfter,
        vaultPath,
        wrappersBin,
        pathHint: `export PATH="${wrappersBin}:$PATH"`,
        configPresent: existingSettings != null,
        openCommand: OPEN_COMMAND_HINT,
        maintainCommand: 'agent-session-pack maintain --dry-run --json',
      },
      isMachineReadableRequested,
    );
    return { exitCode: 0 };
  }

  const nextSettings = createLifecycleSettings({
    existingConfig: existingSettings,
    home,
    now,
    restoreOnLaunch: action === ENABLE_ACTION,
  });

  await writeSetupSettings({
    home,
    config: nextSettings,
  });

  const isActionEnable = action === ENABLE_ACTION;
  if (isActionEnable) {
    await installLifecycleWrappers({
      vaultPath: nextSettings.vaultPath,
      cliEntrypoint,
    });
  } else {
    await uninstallLifecycleWrappers(nextSettings.vaultPath);
  }

  writeLifecycleStatus(
    {
      restoreOnLaunch: nextSettings.restoreOnLaunch === true,
      restoreCacheAfter: nextSettings.restoreCacheAfter,
      coldAfter: nextSettings.coldAfter,
      vaultPath: nextSettings.vaultPath,
      wrappersBin: createWrappersBinPath(nextSettings.vaultPath),
      pathHint: `export PATH="${createWrappersBinPath(nextSettings.vaultPath)}:$PATH"`,
      configPresent: true,
      action,
      openCommand: OPEN_COMMAND_HINT,
      maintainCommand: 'agent-session-pack maintain --apply --yes --json',
    },
    isMachineReadableRequested,
  );
  return { exitCode: 0 };
}

function createLifecycleSettings(request: {
  readonly existingConfig: SetupSettings | null;
  readonly home: string;
  readonly now: Date;
  readonly restoreOnLaunch: boolean;
}): SetupSettings {
  const timestamp = request.now.toISOString();
  const vaultPath = request.existingConfig?.vaultPath ?? createDefaultVaultPath(request.home);

  const isExistingSettingsMissing = request.existingConfig == null;
  if (isExistingSettingsMissing) {
    return {
      version: SETTINGS_VERSION,
      providers: ['codex', 'claude', 'grok', 'gemini'],
      vaultPath,
      coldAfter: DEFAULT_COLD_AFTER,
      createdAt: timestamp,
      updatedAt: timestamp,
      restoreOnLaunch: request.restoreOnLaunch,
      restoreCacheAfter: DEFAULT_RESTORE_CACHE_AFTER,
    };
  }

  return {
    ...request.existingConfig,
    updatedAt: timestamp,
    restoreOnLaunch: request.restoreOnLaunch,
    restoreCacheAfter: request.existingConfig.restoreCacheAfter ?? DEFAULT_RESTORE_CACHE_AFTER,
  };
}

// The wrappers must run the script that is running now. In the build this module is bundled into dist/cli/main.js.
function pickCliEntrypoint(): string {
  const runningScriptPath = process.argv[1];

  const isThereNoRunningScript = runningScriptPath == null;

  if (isThereNoRunningScript) {
    return 'agent-session-pack';
  }

  return runningScriptPath;
}

function isPresentLine(line: string | null): line is string {
  return line != null;
}

function writeLifecycleStatus(
  status: {
    readonly restoreOnLaunch: boolean;
    readonly restoreCacheAfter: string | undefined;
    readonly coldAfter?: string | undefined;
    readonly vaultPath: string;
    readonly wrappersBin: string;
    readonly pathHint: string;
    readonly configPresent: boolean;
    readonly action?: string;
    readonly openCommand?: string;
    readonly maintainCommand?: string;
  },
  isMachineReadableRequested: boolean,
): void {
  if (isMachineReadableRequested) {
    process.stdout.write(
      `${JSON.stringify(
        {
          command: 'lifecycle',
          ...status,
        },
        null,
        JSON_INDENT_SPACES,
      )}\n`,
    );
    return;
  }

  const isStatusActionMissing = status.action == null;
  const isRestoreCacheAfterMissing = status.restoreCacheAfter == null;
  const isStatusColdAfterMissing = status.coldAfter == null;
  const isStatusOpenCommandMissing = status.openCommand == null;
  const isStatusMaintainCommandMissing = status.maintainCommand == null;
  const lines = [
    isStatusActionMissing ? 'lifecycle status' : `lifecycle ${status.action}`,
    `restoreOnLaunch: ${String(status.restoreOnLaunch)}`,
    isRestoreCacheAfterMissing ? null : `restoreCacheAfter: ${status.restoreCacheAfter}`,
    isStatusColdAfterMissing ? null : `coldAfter: ${status.coldAfter}`,
    `vaultPath: ${status.vaultPath}`,
    `wrappersBin: ${status.wrappersBin}`,
    `pathHint: ${status.pathHint}`,
    isStatusOpenCommandMissing ? null : `open: ${status.openCommand}`,
    isStatusMaintainCommandMissing ? null : `maintain: ${status.maintainCommand}`,
    `configPresent: ${String(status.configPresent)}`,
  ].filter(isPresentLine);

  process.stdout.write(`${lines.join('\n')}\n`);
}
