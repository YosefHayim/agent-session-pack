import { defineCommand } from 'citty';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { DEFAULT_COLD_AFTER } from '@/pack/plan.js';
import {
  isRestoreOnLaunchEnabled,
  readSetupSettings,
  type SetupSettings,
  writeSetupSettings,
} from '@/setup/config.js';
import { createWrappersBinPath } from './session-access.js';
import { installLifecycleWrappers, uninstallLifecycleWrappers } from './wrappers.js';

/**
 * Citty command that enables, disables, or shows continuous restore/pack lifecycle.
 */
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

/**
 * Decoded arguments for the lifecycle command.
 */
export type LifecycleFlags = {
  readonly action: string | undefined;
  readonly json: boolean | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly cliEntrypoint?: string | undefined;
};

/**
 * Runs lifecycle enable/disable/status for human and agent callers.
 *
 * Writes lifecycle output and may persist setup config.
 *
 * @param flags - Decoded command-line arguments.
 */
export const runLifecycleCommand = async (flags: LifecycleFlags): Promise<CommandExit> => {
  const home = requireHome(flags.home);

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const action = flags.action?.trim().toLowerCase();

  const isActionUnknown = action !== 'enable' && action !== 'disable' && action !== 'status';
  if (isActionUnknown) {
    process.stderr.write('Unknown lifecycle action. Use enable, disable, or status.\n');
    return { exitCode: 2 };
  }

  const existingSettings = await readSetupSettings(home);
  const now = flags.now ?? new Date();
  const vaultPath = existingSettings?.vaultPath ?? createDefaultVaultPath(home);
  const wrappersBin = createWrappersBinPath(vaultPath);
  const cliEntrypoint = flags.cliEntrypoint ?? pickCliEntrypoint();
  const isStructuredRequested = flags.json === true;

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
        openCommand: 'agent-session-pack open --provider <id> <session> --json',
        maintainCommand: 'agent-session-pack maintain --dry-run --json',
      },
      isStructuredRequested,
    );
    return { exitCode: 0 };
  }

  const nextSettings = createLifecycleSettings({
    existingConfig: existingSettings,
    home,
    now,
    restoreOnLaunch: action === 'enable',
  });

  await writeSetupSettings({
    home,
    config: nextSettings,
  });

  const isActionEnable = action === 'enable';
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
      openCommand: 'agent-session-pack open --provider <id> <session> --json',
      maintainCommand: 'agent-session-pack maintain --apply --yes --json',
    },
    isStructuredRequested,
  );
  return { exitCode: 0 };
};

const createLifecycleSettings = (request: {
  readonly existingConfig: SetupSettings | null;
  readonly home: string;
  readonly now: Date;
  readonly restoreOnLaunch: boolean;
}): SetupSettings => {
  const timestamp = request.now.toISOString();
  const vaultPath = request.existingConfig?.vaultPath ?? createDefaultVaultPath(request.home);

  const isExistingSettingsMissing = request.existingConfig == null;
  if (isExistingSettingsMissing) {
    return {
      version: 1,
      providers: ['codex', 'claude', 'grok', 'gemini'],
      vaultPath,
      coldAfter: DEFAULT_COLD_AFTER,
      createdAt: timestamp,
      updatedAt: timestamp,
      restoreOnLaunch: request.restoreOnLaunch,
      restoreCacheAfter: '7d',
    };
  }

  return {
    ...request.existingConfig,
    updatedAt: timestamp,
    restoreOnLaunch: request.restoreOnLaunch,
    restoreCacheAfter: request.existingConfig.restoreCacheAfter ?? '7d',
  };
};

// The wrappers must run the script that is running now. In the build this module is bundled into dist/cli/main.js.
const pickCliEntrypoint = (): string => {
  const runningScriptPath = process.argv[1];

  const isThereNoRunningScript = runningScriptPath == null;

  if (isThereNoRunningScript) {
    return 'agent-session-pack';
  }

  return runningScriptPath;
};

const writeLifecycleStatus = (
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
  isStructuredRequested: boolean,
): void => {
  if (isStructuredRequested) {
    process.stdout.write(
      `${JSON.stringify(
        {
          command: 'lifecycle',
          ...status,
        },
        null,
        2,
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
  ].filter((line): line is string => line != null);

  process.stdout.write(`${lines.join('\n')}\n`);
};
