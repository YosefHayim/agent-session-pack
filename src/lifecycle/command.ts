import { defineCommand } from 'citty';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CommandOutcome } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { DEFAULT_COLD_AFTER } from '@/pack/plan.js';
import {
  isRestoreOnLaunchEnabled,
  readSetupConfig,
  type SetupConfig,
  writeSetupConfig,
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
export type LifecycleArgs = {
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
 * @param args - Decoded command-line arguments.
 */
export const runLifecycleCommand = async (args: LifecycleArgs): Promise<CommandOutcome> => {
  const home = requireHome(args.home);

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const action = args.action?.trim().toLowerCase();

  const isActionUnknown = action !== 'enable' && action !== 'disable' && action !== 'status';
  if (isActionUnknown) {
    process.stderr.write('Unknown lifecycle action. Use enable, disable, or status.\n');
    return { exitCode: 2 };
  }

  const existingConfig = await readSetupConfig(home);
  const now = args.now ?? new Date();
  const vaultPath = existingConfig?.vaultPath ?? createDefaultVaultPath(home);
  const wrappersBin = createWrappersBinPath(vaultPath);
  const cliEntrypoint = args.cliEntrypoint ?? pickCliEntrypoint();
  const isJsonOutput = args.json === true;

  const isActionStatus = action === 'status';
  if (isActionStatus) {
    writeLifecycleStatus(
      {
        restoreOnLaunch: isRestoreOnLaunchEnabled(existingConfig),
        restoreCacheAfter: existingConfig?.restoreCacheAfter,
        coldAfter: existingConfig?.coldAfter,
        vaultPath,
        wrappersBin,
        pathHint: `export PATH="${wrappersBin}:$PATH"`,
        configPresent: existingConfig !== undefined,
        openCommand: 'agent-session-pack open --provider <id> <session> --json',
        maintainCommand: 'agent-session-pack maintain --dry-run --json',
      },
      isJsonOutput,
    );
    return { exitCode: 0 };
  }

  const nextConfig = createLifecycleConfig({
    existingConfig,
    home,
    now,
    restoreOnLaunch: action === 'enable',
  });

  await writeSetupConfig({
    home,
    config: nextConfig,
  });

  const isActionEnable = action === 'enable';
  if (isActionEnable) {
    await installLifecycleWrappers({
      vaultPath: nextConfig.vaultPath,
      cliEntrypoint,
    });
  } else {
    await uninstallLifecycleWrappers(nextConfig.vaultPath);
  }

  writeLifecycleStatus(
    {
      restoreOnLaunch: nextConfig.restoreOnLaunch === true,
      restoreCacheAfter: nextConfig.restoreCacheAfter,
      coldAfter: nextConfig.coldAfter,
      vaultPath: nextConfig.vaultPath,
      wrappersBin: createWrappersBinPath(nextConfig.vaultPath),
      pathHint: `export PATH="${createWrappersBinPath(nextConfig.vaultPath)}:$PATH"`,
      configPresent: true,
      action,
      openCommand: 'agent-session-pack open --provider <id> <session> --json',
      maintainCommand: 'agent-session-pack maintain --apply --yes --json',
    },
    isJsonOutput,
  );
  return { exitCode: 0 };
};

const createLifecycleConfig = (request: {
  readonly existingConfig: SetupConfig | undefined;
  readonly home: string;
  readonly now: Date;
  readonly restoreOnLaunch: boolean;
}): SetupConfig => {
  const timestamp = request.now.toISOString();
  const vaultPath = request.existingConfig?.vaultPath ?? createDefaultVaultPath(request.home);

  const isExistingConfigMissing = request.existingConfig === undefined;
  if (isExistingConfigMissing) {
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
  json: boolean,
): void => {
  if (json) {
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
    isRestoreCacheAfterMissing ? undefined : `restoreCacheAfter: ${status.restoreCacheAfter}`,
    isStatusColdAfterMissing ? undefined : `coldAfter: ${status.coldAfter}`,
    `vaultPath: ${status.vaultPath}`,
    `wrappersBin: ${status.wrappersBin}`,
    `pathHint: ${status.pathHint}`,
    isStatusOpenCommandMissing ? undefined : `open: ${status.openCommand}`,
    isStatusMaintainCommandMissing ? undefined : `maintain: ${status.maintainCommand}`,
    `configPresent: ${String(status.configPresent)}`,
  ].filter((line): line is string => line != null);

  process.stdout.write(`${lines.join('\n')}\n`);
};
