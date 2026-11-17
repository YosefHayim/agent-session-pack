import { defineCommand } from 'citty';
import { askApplyConfirmation } from '@/apply-confirmation.js';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/environment.js';
import { listDefaultSessionStores } from '@/providers/all-providers.js';
import { selectProviders } from '@/providers/flag.js';
import { scanStores } from '@/scan/stores.js';
import type { ProviderAdapter } from '@/session-model.js';
import {
  createHumanPackPlan,
  createHumanPackReport,
  createStructuredPackPlan,
  createStructuredPackReport,
} from './output.js';
import {
  createPackPlan,
  DEFAULT_COLD_AFTER,
  type PackPlanRequest,
  parseDurationMs,
} from './plan.js';
import { type PackSessionsReport, packProviderSessions } from './sessions.js';

const LINE_BREAK = '\n';
const USAGE_EXIT_CODE = 2;

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

export interface PackFlags {
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
}

export async function runPackCommand(flags: PackFlags): Promise<CommandExit> {
  const isMachineOutputRequested = flags.json === true;

  const isMaxApplyRequested = flags.max === true && flags.apply === true;

  if (isMaxApplyRequested) {
    process.stderr.write('Refusing --max with --apply. Use --max as a dry-run preview only.\n');
    process.stderr.write(LINE_BREAK);
    return { exitCode: USAGE_EXIT_CODE };
  }

  const home = requireHome(flags.home);

  const isHomeMissing = home == null;

  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const isApplyUnconfirmed = flags.apply === true && flags.confirmed !== true;

  if (isApplyUnconfirmed) {
    process.stderr.write('Cancelled. Re-run with --apply and confirm with y to pack sessions.\n');
    process.stderr.write(LINE_BREAK);
    return { exitCode: USAGE_EXIT_CODE };
  }

  const isMaxRequested = flags.max === true;
  const olderThan = isMaxRequested ? '0h' : (flags.olderThan ?? DEFAULT_COLD_AFTER);
  const olderThanMs = parseDurationMs(olderThan);
  const { providers, isProviderUnknown } = selectProviders(flags.provider, flags.providers);
  const providerExitCode = isProviderUnknown ? USAGE_EXIT_CODE : 0;

  const isArchiveWorkflowUsable = canUseArchiveWorkflow(flags);

  if (isArchiveWorkflowUsable) {
    const report = await packProviderSessions({
      home,
      vaultPath: flags.vaultPath ?? createDefaultVaultPath(home),
      providers,
      olderThan,
      olderThanMs,
      now: flags.now ?? new Date(),
      apply: flags.apply === true,
      compression: flags.compression ?? createZstdCompression(),
    });

    writeArchiveReport({ report, olderThan, isMachineOutputRequested });
    return { exitCode: providerExitCode };
  }

  const stores = listDefaultSessionStores(providers, home);
  const report = await scanStores({
    providers,
    stores,
  });
  const plan = createPackPlan({
    now: new Date(),
    olderThan,
    olderThanMs,
    sessions: report.sessions,
    providers: providers.map(describePlanProvider),
  });

  if (isMachineOutputRequested) {
    process.stdout.write(createStructuredPackPlan(plan));
    return { exitCode: providerExitCode };
  }

  process.stdout.write(`${createHumanPackPlan(plan, { olderThan })}\n`);
  return { exitCode: providerExitCode };
}

function describePlanProvider(provider: ProviderAdapter): PackPlanRequest['providers'][number] {
  return {
    id: provider.id,
    label: provider.label,
    mode: provider.mode,
  };
}

interface ArchiveReportDetails {
  readonly report: PackSessionsReport;
  readonly olderThan: string;
  readonly isMachineOutputRequested: boolean;
}

function writeArchiveReport(details: ArchiveReportDetails): void {
  const isMachineOutputRequested = details.isMachineOutputRequested;
  if (isMachineOutputRequested) {
    process.stdout.write(createStructuredPackReport(details.report));
    return;
  }

  process.stdout.write(
    `${createHumanPackReport(details.report, { olderThan: details.olderThan })}\n`,
  );
}

function canUseArchiveWorkflow(flags: PackFlags): boolean {
  const isApplyRequested = flags.apply === true;
  if (isApplyRequested) {
    return true;
  }

  const isAllProvidersRequested = flags.allProviders === true;
  if (isAllProvidersRequested) {
    return true;
  }

  const isMaxRequested = flags.max === true;
  if (isMaxRequested) {
    return true;
  }

  return false;
}
