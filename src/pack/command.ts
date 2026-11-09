import { defineCommand } from 'citty';
import { askApplyConfirmation } from '@/apply-confirmation.js';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandOutcome } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { selectProviders } from '@/providers/flag.js';
import { scanStores } from '@/scan/stores.js';
import type { ProviderAdapter, SessionStore } from '@/session-model.js';
import {
  createHumanPackPlan,
  createHumanPackReport,
  createJsonPackPlan,
  createJsonPackReport,
} from './output.js';
import { createPackPlan, DEFAULT_COLD_AFTER, parseDurationMs } from './plan.js';
import { type PackSessionsReport, packProviderSessions } from './sessions.js';

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
      : await askApplyConfirmation({
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

  const isMaxRequested = args.max === true;
  const olderThan = isMaxRequested ? '0h' : (args.olderThan ?? DEFAULT_COLD_AFTER);
  const olderThanMs = parseDurationMs(olderThan);
  const { providers, isProviderUnknown } = selectProviders(args.provider, args.providers);
  const providerExitCode = isProviderUnknown ? 2 : 0;

  if (canUseArchiveWorkflow(args)) {
    const report = await packProviderSessions({
      home,
      vaultPath: args.vaultPath ?? createDefaultVaultPath(home),
      providers,
      olderThan,
      olderThanMs,
      now: args.now ?? new Date(),
      apply: args.apply === true,
      compression: args.compression ?? createZstdCompression(),
    });

    writeArchiveReport({ report, olderThan, isJsonOutput });
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
    process.stdout.write(createJsonPackPlan(plan));
    return { exitCode: providerExitCode };
  }

  process.stdout.write(`${createHumanPackPlan(plan, { olderThan })}\n`);
  return { exitCode: providerExitCode };
};

type ArchiveReportDetails = {
  readonly report: PackSessionsReport;
  readonly olderThan: string;
  readonly isJsonOutput: boolean;
};

const writeArchiveReport = (details: ArchiveReportDetails): void => {
  const isJsonRequested = details.isJsonOutput;
  if (isJsonRequested) {
    process.stdout.write(createJsonPackReport(details.report));
    return;
  }

  process.stdout.write(
    `${createHumanPackReport(details.report, { olderThan: details.olderThan })}\n`,
  );
};

const canUseArchiveWorkflow = (args: PackArgs): boolean => {
  const isApplyRequested = args.apply === true;
  if (isApplyRequested) {
    return true;
  }

  const isAllProvidersRequested = args.allProviders === true;
  if (isAllProvidersRequested) {
    return true;
  }

  const isMaxRequested = args.max === true;
  if (isMaxRequested) {
    return true;
  }

  return false;
};
