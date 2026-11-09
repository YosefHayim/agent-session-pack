import { defineCommand } from 'citty';
import { resolveApplyConfirmation } from '@/apply-confirmation.js';
import { resolveDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandOutcome } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { selectProviders } from '@/providers/flag.js';
import { scanStores } from '@/scan/stores.js';
import type { ProviderAdapter, SessionStore } from '@/session-model.js';
import {
  formatHumanPackPlan,
  formatHumanPackReport,
  formatJsonPackPlan,
  formatJsonPackReport,
} from './output.js';
import { createPackPlan, DEFAULT_COLD_AFTER, parseDurationMs } from './plan.js';
import { packProviderSessions } from './sessions.js';

/**
 * Citty command that packs cold sessions after verified archive restore.
 */
export const packCommand = defineCommand({
  meta: {
    name: 'pack',
    description: 'Pack cold sessions after verified archive restore.',
  },
  args: {
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
    },
    'older-than': {
      type: 'string',
      description: 'Cold threshold such as 7d, 2w, 30d, or 12h.',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Preview changes without removing originals.',
    },
    'all-providers': {
      type: 'boolean',
      description: 'Discover every supported provider store on this machine.',
    },
    max: {
      type: 'boolean',
      description: 'Preview every archive-mode session candidate. Dry-run only.',
    },
    apply: {
      type: 'boolean',
      description: 'Apply archive/remove workflow after verification.',
    },
    yes: {
      type: 'boolean',
      description: 'Confirm apply mode without an interactive prompt.',
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    const isMaxApplyRequested = args.max === true && args.apply === true;
    const confirmed = isMaxApplyRequested
      ? false
      : await resolveApplyConfirmation({
          action: 'Pack cold sessions for the selected providers',
          apply: args.apply,
          json: args.json,
          yes: args.yes,
        });

    return runPackCommand({
      allProviders: args['all-providers'],
      provider: args.provider,
      max: args.max,
      olderThan: args['older-than'],
      dryRun: args['dry-run'],
      apply: args.apply,
      json: args.json,
      yes: args.yes,
      confirmed,
    });
  },
});

/**
 * Arguments for the pack command, after citty has parsed the flags.
 */
export type PackArgs = {
  readonly allProviders: boolean | undefined;
  readonly provider: string | undefined;
  readonly max?: boolean | undefined;
  readonly olderThan: string | undefined;
  readonly dryRun: boolean | undefined;
  readonly apply: boolean | undefined;
  readonly json: boolean | undefined;
  readonly yes: boolean | undefined;
  readonly confirmed?: boolean | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly providers?: ReadonlyArray<ProviderAdapter> | undefined;
  readonly vaultPath?: string | undefined;
};

/**
 * Runs the pack command: a dry-run plan, or an archive run when applying.
 */
export const runPackCommand = async (args: PackArgs): Promise<CommandOutcome> => {
  const isJsonOutput = args.json === true;

  const isMaxApplyRequested = args.max === true && args.apply === true;

  if (isMaxApplyRequested) {
    process.stderr.write('Refusing --max with --apply. Use --max as a dry-run preview only.\n');
    process.stderr.write('\n');
    return { exitCode: 2 };
  }

  const home = requireHome(args.home);

  const isHomeMissing = home == null;

  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const isApplyUnconfirmed = args.apply === true && args.confirmed !== true;

  if (isApplyUnconfirmed) {
    process.stderr.write('Cancelled. Re-run with --apply and confirm with y to pack sessions.\n');
    process.stderr.write('\n');
    return { exitCode: 2 };
  }

  const isMaxTrue = args.max === true;
  const olderThan = isMaxTrue ? '0h' : (args.olderThan ?? DEFAULT_COLD_AFTER);
  const olderThanMs = parseDurationMs(olderThan);
  const { providers, isProviderUnknown } = selectProviders(args.provider, args.providers);
  const providerExitCode = isProviderUnknown ? 2 : 0;

  if (shouldUseArchiveWorkflow(args)) {
    const report = await packProviderSessions({
      home,
      vaultPath: args.vaultPath ?? resolveDefaultVaultPath(home),
      providers,
      olderThan,
      olderThanMs,
      now: args.now ?? new Date(),
      apply: args.apply === true,
      compression: args.compression ?? createZstdCompression(),
    });

    if (isJsonOutput) {
      process.stdout.write(formatJsonPackReport(report));
      return { exitCode: providerExitCode };
    }

    process.stdout.write(`${formatHumanPackReport(report, { olderThan })}\n`);
    return { exitCode: providerExitCode };
  }

  const stores = providers.flatMap((provider) =>
    provider.defaultRoots(home).map((path): SessionStore => ({ provider: provider.id, path })),
  );
  const report = await scanStores({
    providers,
    stores,
  });
  const plan = createPackPlan({
    now: new Date(),
    olderThan,
    olderThanMs,
    sessions: report.sessions,
    providers: providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      mode: provider.mode,
    })),
  });

  if (isJsonOutput) {
    process.stdout.write(formatJsonPackPlan(plan));
    return { exitCode: providerExitCode };
  }

  process.stdout.write(`${formatHumanPackPlan(plan, { olderThan })}\n`);
  return { exitCode: providerExitCode };
};

const shouldUseArchiveWorkflow = (args: PackArgs): boolean => {
  const isApplyTrue = args.apply === true;
  if (isApplyTrue) {
    return true;
  }

  const isAllProvidersTrue = args.allProviders === true;
  if (isAllProvidersTrue) {
    return true;
  }

  const isMaxTrue = args.max === true;
  if (isMaxTrue) {
    return true;
  }

  return false;
};
