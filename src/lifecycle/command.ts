import { defineCommand } from 'citty';
import { resolveDefaultVaultPath } from '@/archive/vault-paths.js';
import { requireHome } from '@/home-env.js';
import { DEFAULT_COLD_AFTER } from '@/pack/plan.js';
import {
  isRestoreOnLaunchEnabled,
  readSetupConfig,
  type SetupConfig,
  writeSetupConfig,
} from '@/setup/config.js';
import { resolveWrappersBinPath } from './session-access.js';
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
    await runLifecycleCommand({
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
export const runLifecycleCommand = async (args: LifecycleArgs): Promise<void> => {
  const home = requireHome(args.home);

  if (home === undefined) {
    return;
  }

  const action = args.action?.trim().toLowerCase();

  if (action !== 'enable' && action !== 'disable' && action !== 'status') {
    process.stderr.write('Unknown lifecycle action. Use enable, disable, or status.\n');
    process.exitCode = 2;
    return;
  }

  const existingConfig = await readSetupConfig(home);
  const now = args.now ?? new Date();
  const vaultPath = existingConfig?.vaultPath ?? resolveDefaultVaultPath(home);
  const wrappersBin = resolveWrappersBinPath(vaultPath);
  const cliEntrypoint = args.cliEntrypoint ?? pickCliEntrypoint();
  const isJsonOutput = args.json === true;

  if (action === 'status') {
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
    return;
  }

  const nextConfig = buildLifecycleConfig({
    existingConfig,
    home,
    now,
    restoreOnLaunch: action === 'enable',
  });

  await writeSetupConfig({
    home,
    config: nextConfig,
  });

  if (action === 'enable') {
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
      wrappersBin: resolveWrappersBinPath(nextConfig.vaultPath),
      pathHint: `export PATH="${resolveWrappersBinPath(nextConfig.vaultPath)}:$PATH"`,
      configPresent: true,
      action,
      openCommand: 'agent-session-pack open --provider <id> <session> --json',
      maintainCommand: 'agent-session-pack maintain --apply --yes --json',
    },
    isJsonOutput,
  );
};

const buildLifecycleConfig = (request: {
  readonly existingConfig: SetupConfig | undefined;
  readonly home: string;
  readonly now: Date;
  readonly restoreOnLaunch: boolean;
}): SetupConfig => {
  const timestamp = request.now.toISOString();
  const vaultPath = request.existingConfig?.vaultPath ?? resolveDefaultVaultPath(request.home);

  if (request.existingConfig === undefined) {
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

  const lines = [
    status.action === undefined ? 'lifecycle status' : `lifecycle ${status.action}`,
    `restoreOnLaunch: ${String(status.restoreOnLaunch)}`,
    status.restoreCacheAfter === undefined
      ? undefined
      : `restoreCacheAfter: ${status.restoreCacheAfter}`,
    status.coldAfter === undefined ? undefined : `coldAfter: ${status.coldAfter}`,
    `vaultPath: ${status.vaultPath}`,
    `wrappersBin: ${status.wrappersBin}`,
    `pathHint: ${status.pathHint}`,
    status.openCommand === undefined ? undefined : `open: ${status.openCommand}`,
    status.maintainCommand === undefined ? undefined : `maintain: ${status.maintainCommand}`,
    `configPresent: ${String(status.configPresent)}`,
  ].filter((line): line is string => line !== undefined);

  process.stdout.write(`${lines.join('\n')}\n`);
};
