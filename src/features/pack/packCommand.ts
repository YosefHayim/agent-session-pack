import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { selectProviders } from '../../providers/providerFlag.js';
import { resolveApplyConfirmation } from '../../shared/applyConfirmation.js';
import { requireHome } from '../../shared/homeEnv.js';
import type {
  ProviderAdapter,
  ProviderDiscoveryError,
  SessionStore,
} from '../../shared/sessionModel.js';
import type { ArchiveWriteError, CompressionAdapter } from '../archive/archiveWriter.js';
import type { ManifestStoreError } from '../archive/manifestStore.js';
import { resolveDefaultVaultPath } from '../archive/vaultPaths.js';
import { createZstdCompression } from '../archive/zstdCompression.js';
import { scanStores } from '../scan/scanStores.js';
import {
  formatHumanPackPlan,
  formatHumanPackReport,
  formatJsonPackPlan,
  formatJsonPackReport,
} from './packOutput.js';
import { createPackPlan, DEFAULT_COLD_AFTER, parseDurationMs } from './packPlan.js';
import { packProviderSessions } from './packSessions.js';

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
    const confirmed =
      args.max === true && args.apply === true
        ? false
        : await resolveApplyConfirmation({
            action: 'Pack cold sessions for the selected providers',
            apply: args.apply,
            json: args.json,
            yes: args.yes,
          });

    await Effect.runPromise(
      runPackCommand({
        allProviders: args['all-providers'],
        provider: args.provider,
        max: args.max,
        olderThan: args['older-than'],
        dryRun: args['dry-run'],
        apply: args.apply,
        json: args.json,
        yes: args.yes,
        confirmed,
      }),
    );
  },
});

/**
 * Decoded arguments for the pack command.
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
 * Runs a non-destructive pack planning command.
 *
 * @param args - Decoded command-line arguments.
 * @returns Effect that writes the pack plan.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { runPackCommand } from './packCommand.js';
 *
 * await Effect.runPromise(
 *   runPackCommand({
 *     allProviders: true,
 *     provider: undefined,
 *     olderThan: '7d',
 *     dryRun: true,
 *     apply: false,
 *     json: false,
 *     yes: false,
 *   }),
 * );
 * ```
 */
export const runPackCommand = (
  args: PackArgs,
): Effect.Effect<void, ArchiveWriteError | ManifestStoreError | ProviderDiscoveryError> =>
  Effect.gen(function* () {
    if (args.max === true && args.apply === true) {
      process.stderr.write('Refusing --max with --apply. Use --max as a dry-run preview only.\n');
      process.stderr.write('\n');
      process.exitCode = 2;
      return;
    }

    const home = requireHome(args.home);

    if (home === undefined) {
      return;
    }

    if (args.apply === true && args.confirmed !== true) {
      process.stderr.write('Cancelled. Re-run with --apply and confirm with y to pack sessions.\n');
      process.stderr.write('\n');
      process.exitCode = 2;
      return;
    }

    const olderThan = args.max === true ? '0h' : (args.olderThan ?? DEFAULT_COLD_AFTER);
    const olderThanMs = parseDurationMs(olderThan);
    const providers = args.providers ?? selectProviders(args.provider);

    if (shouldUseArchiveWorkflow(args)) {
      const report = yield* packProviderSessions({
        home,
        vaultPath: args.vaultPath ?? resolveDefaultVaultPath(home),
        providers,
        olderThan,
        olderThanMs,
        now: args.now ?? new Date(),
        apply: args.apply === true,
        compression: args.compression ?? createZstdCompression(),
      });

      if (args.json === true) {
        process.stdout.write(formatJsonPackReport(report));
        return;
      }

      process.stdout.write(`${formatHumanPackReport(report, { olderThan })}\n`);
      return;
    }

    const stores = providers.flatMap((provider) =>
      provider.defaultRoots(home).map((path): SessionStore => ({ provider: provider.id, path })),
    );
    const report = yield* scanStores({
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

    if (args.json === true) {
      process.stdout.write(formatJsonPackPlan(plan));
      return;
    }

    process.stdout.write(`${formatHumanPackPlan(plan, { olderThan })}\n`);
  });

const shouldUseArchiveWorkflow = (args: PackArgs): boolean => {
  if (args.apply === true) {
    return true;
  }

  if (args.allProviders === true) {
    return true;
  }

  if (args.max === true) {
    return true;
  }

  return false;
};
