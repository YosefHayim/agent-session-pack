import { defineCommand } from 'citty';
import { askApplyConfirmation } from '@/apply-confirmation.js';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { createHumanPackReport } from '@/pack/output.js';
import { DEFAULT_COLD_AFTER, parseDurationMs } from '@/pack/plan.js';
import { packProviderSessions } from '@/pack/sessions.js';
import { allProviders } from '@/providers/all-providers.js';
import { isRestoreOnLaunchEnabled, readSetupSettings } from '@/setup/config.js';

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
    const confirmed = await askApplyConfirmation({
      action: 'Pack cold sessions for continuous storage maintenance',
      apply: args.apply,
      json: args.json,
      yes: args.yes,
    });

    return runMaintainCommand({
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
type MaintainFlags = {
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

const runMaintainCommand = async (flags: MaintainFlags): Promise<CommandExit> => {
  const home = requireHome(flags.home);

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const setupSettings = await readSetupSettings(home);

  const isRestoreOnLaunchOff = !isRestoreOnLaunchEnabled(setupSettings);
  if (isRestoreOnLaunchOff) {
    process.stderr.write(
      'Lifecycle is disabled. Run `agent-session-pack lifecycle enable` for continuous maintain, or use `pack` directly.\n',
    );
    return { exitCode: 1 };
  }

  const isApplyUnconfirmed = flags.apply === true && flags.confirmed !== true;
  if (isApplyUnconfirmed) {
    process.stderr.write(
      'Cancelled. Re-run with --apply and confirm with y (or --yes) to pack cold sessions.\n',
    );
    return { exitCode: 2 };
  }

  const olderThan = setupSettings?.coldAfter ?? DEFAULT_COLD_AFTER;
  const coldAfter = olderThan.trim().toLowerCase();
  const olderThanMs = parseDurationMs(coldAfter);
  const vaultPath = flags.vaultPath ?? setupSettings?.vaultPath ?? createDefaultVaultPath(home);
  const apply = flags.apply === true;
  const archiveProviders = allProviders.filter((provider) => provider.mode === 'archive');

  const report = await packProviderSessions({
    home,
    vaultPath,
    providers: archiveProviders,
    olderThan,
    olderThanMs,
    now: flags.now ?? new Date(),
    apply,
    compression: flags.compression ?? createZstdCompression(),
  });

  const isStructuredRequested = flags.json === true;
  if (isStructuredRequested) {
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
    return { exitCode: 0 };
  }

  process.stdout.write(
    [
      `maintain: cold pack (${apply ? 'apply' : 'dry-run'}) olderThan=${olderThan}`,
      createHumanPackReport(report, { olderThan }),
    ].join('\n'),
  );
  return { exitCode: 0 };
};
