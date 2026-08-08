import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { resolveDefaultVaultPath } from '../../core/sessionArchive.js';
import {
  isRestoreOnLaunchEnabled,
  readSetupConfig,
  type SetupConfig,
  type SetupConfigFileError,
  writeSetupConfig,
} from '../../core/setupConfig.js';
import { HOME_NOT_SET_STDERR_MESSAGE } from '../homeEnv.js';

/**
 * Citty command that enables, disables, or shows restore-on-launch lifecycle settings.
 */
export const lifecycleCommand = defineCommand({
  meta: {
    name: 'lifecycle',
    description: 'Enable, disable, or show restore-on-launch lifecycle settings.',
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
    await Effect.runPromise(
      runLifecycleCommand({
        action: args.action,
        json: args.json,
      }),
    );
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
};

/**
 * Runs lifecycle enable/disable/status for human and agent callers.
 *
 * @param args - Decoded command-line arguments.
 * @returns Effect that writes lifecycle output and may persist setup config.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { runLifecycleCommand } from './lifecycleCommand.js';
 *
 * await Effect.runPromise(runLifecycleCommand({ action: 'status', json: true }));
 * ```
 */
export const runLifecycleCommand = (
  args: LifecycleArgs,
): Effect.Effect<void, SetupConfigFileError> =>
  Effect.gen(function* () {
    const home = args.home ?? process.env.HOME;

    if (home === undefined) {
      process.stderr.write(HOME_NOT_SET_STDERR_MESSAGE);
      process.exitCode = 1;
      return;
    }

    const action = args.action?.trim().toLowerCase();

    if (action !== 'enable' && action !== 'disable' && action !== 'status') {
      process.stderr.write('Unknown lifecycle action. Use enable, disable, or status.\n');
      process.exitCode = 2;
      return;
    }

    const existingConfig = yield* readSetupConfig(home);
    const now = args.now ?? new Date();

    if (action === 'status') {
      writeLifecycleStatus(
        {
          restoreOnLaunch: isRestoreOnLaunchEnabled(existingConfig),
          restoreCacheAfter: existingConfig?.restoreCacheAfter,
          vaultPath: existingConfig?.vaultPath ?? resolveDefaultVaultPath(home),
          configPresent: existingConfig !== undefined,
        },
        args.json === true,
      );
      return;
    }

    const nextConfig = buildLifecycleConfig({
      existingConfig,
      home,
      now,
      restoreOnLaunch: action === 'enable',
    });

    yield* writeSetupConfig({
      home,
      config: nextConfig,
    });

    writeLifecycleStatus(
      {
        restoreOnLaunch: nextConfig.restoreOnLaunch === true,
        restoreCacheAfter: nextConfig.restoreCacheAfter,
        vaultPath: nextConfig.vaultPath,
        configPresent: true,
        action,
      },
      args.json === true,
    );
  });

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
      providers: ['codex'],
      vaultPath,
      coldAfter: '7d',
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

const writeLifecycleStatus = (
  status: {
    readonly restoreOnLaunch: boolean;
    readonly restoreCacheAfter: string | undefined;
    readonly vaultPath: string;
    readonly configPresent: boolean;
    readonly action?: string;
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
    `vaultPath: ${status.vaultPath}`,
    `configPresent: ${String(status.configPresent)}`,
  ].filter((line): line is string => line !== undefined);

  process.stdout.write(`${lines.join('\n')}\n`);
};
