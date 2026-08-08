import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { createZstdCompression } from '../../core/archiveReader.js';
import type { ArchiveWriteError, CompressionAdapter } from '../../core/archiveWriter.js';
import type { ManifestStoreError } from '../../core/manifestStore.js';
import { packProviderSessions, resolveDefaultVaultPath } from '../../core/sessionArchive.js';
import type { ProviderDiscoveryError } from '../../core/sessionStore.js';
import {
  isRestoreOnLaunchEnabled,
  readSetupConfig,
  type SetupConfigFileError,
} from '../../core/setupConfig.js';
import { formatHumanPackReport } from '../../output/packOutput.js';
import { allProviders } from '../../providers/allProviders.js';
import { resolveApplyConfirmation } from '../applyConfirmation.js';
import { HOME_NOT_SET_STDERR_MESSAGE } from '../homeEnv.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Citty command that re-packs cold sessions so storage stays low over time.
 */
export const maintainCommand = defineCommand({
  meta: {
    name: 'maintain',
    description:
      'Pack cold live sessions again (continuous storage). Uses setup coldAfter when lifecycle is enabled.',
  },
  args: {
    apply: {
      type: 'boolean',
      description: 'Apply packing after verified archive restore.',
    },
    yes: {
      type: 'boolean',
      description: 'Confirm apply mode without an interactive prompt.',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Preview cold candidates without packing.',
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    const confirmed = await resolveApplyConfirmation({
      action: 'Pack cold sessions for continuous storage maintenance',
      apply: args.apply,
      json: args.json,
      yes: args.yes,
    });

    await Effect.runPromise(
      runMaintainCommand({
        apply: args.apply,
        confirmed,
        dryRun: args['dry-run'],
        json: args.json,
        yes: args.yes,
      }),
    );
  },
});

/**
 * Decoded arguments for maintain.
 */
export type MaintainArgs = {
  readonly apply: boolean | undefined;
  readonly confirmed?: boolean | undefined;
  readonly dryRun: boolean | undefined;
  readonly json: boolean | undefined;
  readonly yes: boolean | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly vaultPath?: string | undefined;
};

/**
 * Runs continuous storage maintenance (cold pack) when lifecycle is enabled.
 *
 * @param args - Apply/dry-run flags and optional overrides.
 * @returns Effect that writes maintain/pack output.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { runMaintainCommand } from './maintainCommand.js';
 *
 * await Effect.runPromise(
 *   runMaintainCommand({
 *     apply: false,
 *     dryRun: true,
 *     json: true,
 *     yes: false,
 *   }),
 * );
 * ```
 */
export const runMaintainCommand = (
  args: MaintainArgs,
): Effect.Effect<
  void,
  ArchiveWriteError | ManifestStoreError | ProviderDiscoveryError | SetupConfigFileError
> =>
  Effect.gen(function* () {
    const home = args.home ?? process.env.HOME;

    if (home === undefined) {
      process.stderr.write(HOME_NOT_SET_STDERR_MESSAGE);
      process.exitCode = 1;
      return;
    }

    const setupConfig = yield* readSetupConfig(home);

    if (!isRestoreOnLaunchEnabled(setupConfig)) {
      process.stderr.write(
        'Lifecycle is disabled. Run `agent-session-pack lifecycle enable` for continuous maintain, or use `pack` directly.\n',
      );
      process.exitCode = 3;
      return;
    }

    if (args.apply === true && args.confirmed !== true) {
      process.stderr.write(
        'Cancelled. Re-run with --apply and confirm with y (or --yes) to pack cold sessions.\n',
      );
      process.exitCode = 2;
      return;
    }

    const olderThan = setupConfig?.coldAfter ?? '7d';
    const olderThanMs = parseDurationMs(olderThan);
    const vaultPath = args.vaultPath ?? setupConfig?.vaultPath ?? resolveDefaultVaultPath(home);
    const apply = args.apply === true;
    const archiveProviders = allProviders.filter((provider) => provider.mode === 'archive');

    const report = yield* packProviderSessions({
      home,
      vaultPath,
      providers: archiveProviders,
      olderThan,
      olderThanMs,
      now: args.now ?? new Date(),
      apply,
      compression: args.compression ?? createZstdCompression(),
    });

    if (args.json === true) {
      process.stdout.write(
        `${JSON.stringify(
          {
            command: 'maintain',
            lifecycleEnabled: true,
            olderThan,
            pack: report,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    process.stdout.write(
      [
        `maintain: cold pack (${apply ? 'apply' : 'dry-run'}) olderThan=${olderThan}`,
        formatHumanPackReport(report, { olderThan }),
      ].join('\n'),
    );
  });

const parseDurationMs = (duration: string): number => {
  const match = duration.trim().match(/^(\d+)(h|d|w)$/i);
  if (match === null) {
    return 7 * DAY_MS;
  }

  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();

  if (unit === 'h') {
    return amount * 60 * 60 * 1000;
  }

  if (unit === 'w') {
    return amount * 7 * DAY_MS;
  }

  return amount * DAY_MS;
};
