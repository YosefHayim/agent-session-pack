import { defineCommand } from 'citty';
import { resolveApplyConfirmation } from '@/apply-confirmation.js';
import { resolveDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import { requireHome } from '@/home-env.js';
import { formatHumanPackReport } from '@/pack/output.js';
import { DEFAULT_COLD_AFTER, parseDurationMs } from '@/pack/plan.js';
import { packProviderSessions } from '@/pack/sessions.js';
import { allProviders } from '@/providers/all-providers.js';
import { isRestoreOnLaunchEnabled, readSetupConfig } from '@/setup/config.js';

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

    await runMaintainCommand({
      apply: args.apply,
      confirmed,
      dryRun: args['dry-run'],
      json: args.json,
      yes: args.yes,
    });
  },
});

/**
 * Decoded arguments for maintain.
 */
type MaintainArgs = {
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

const runMaintainCommand = async (args: MaintainArgs): Promise<void> => {
  const home = requireHome(args.home);

  if (home === undefined) {
    return;
  }

  const setupConfig = await readSetupConfig(home);

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

  const olderThan = setupConfig?.coldAfter ?? DEFAULT_COLD_AFTER;
  const coldAfter = olderThan.trim().toLowerCase();
  const olderThanMs = parseDurationMs(coldAfter);
  const vaultPath = args.vaultPath ?? setupConfig?.vaultPath ?? resolveDefaultVaultPath(home);
  const apply = args.apply === true;
  const archiveProviders = allProviders.filter((provider) => provider.mode === 'archive');

  const report = await packProviderSessions({
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
};
