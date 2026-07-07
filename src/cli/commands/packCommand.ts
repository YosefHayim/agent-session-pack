import { defineCommand } from 'citty';
import { Effect, Schema } from 'effect';
import {
  type ArchiveWriteError,
  type CompressionAdapter,
  createPackPlan,
  createZstdCompression,
  type ManifestStoreError,
  type ProviderAdapter,
  type ProviderDiscoveryError,
  type ProviderId,
  packProviderSessions,
  resolveDefaultVaultPath,
  type SessionStore,
  scanStores,
} from '../../core/index.js';
import {
  formatHumanPackPlan,
  formatHumanPackReport,
  formatJsonArchiveReport,
  formatJsonPackPlan,
} from '../../output/index.js';
import { allProviders, ProviderIdSchema } from '../../providers/index.js';
import { resolveApplyConfirmation } from '../applyConfirmation.js';

const defaultOlderThan = '7d';

export const packCommand = defineCommand({
  meta: {
    name: 'pack',
    description: 'Pack cold sessions after verified archive restore.',
  },
  args: {
    provider: {
      type: 'string',
      description: 'Provider id: codex, claude, kiro, cursor, or devin.',
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

    const home = normalizeHome(args.home);

    if (home === undefined) {
      process.stderr.write('HOME is not set.\n');
      process.exitCode = 1;
      return;
    }

    if (args.apply === true && args.confirmed !== true) {
      process.stderr.write('Cancelled. Re-run with --apply and confirm with y to pack sessions.\n');
      process.stderr.write('\n');
      process.exitCode = 2;
      return;
    }

    const olderThan = normalizeOlderThan({
      max: args.max,
      olderThan: args.olderThan,
    });
    const olderThanMs = parseDurationMs(olderThan);
    const providers = normalizeProviders({
      provider: args.provider,
      providers: args.providers,
    });

    if (shouldUseArchiveWorkflow(args)) {
      const report = yield* packProviderSessions({
        home,
        vaultPath: normalizeVaultPath(args.vaultPath, home),
        providers,
        olderThan,
        olderThanMs,
        now: normalizeNow(args.now),
        apply: args.apply === true,
        compression: normalizeCompression(args.compression),
      });

      if (args.json === true) {
        process.stdout.write(formatJsonArchiveReport(report));
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

const normalizeOlderThan = (args: {
  readonly max: boolean | undefined;
  readonly olderThan: string | undefined;
}): string => {
  if (args.max === true) {
    return '0h';
  }

  if (args.olderThan === undefined) {
    return defaultOlderThan;
  }

  return args.olderThan;
};

const parseDurationMs = (duration: string): number => {
  const match = duration.match(/^(\d+)(h|d|w)$/);

  if (match === null) {
    return 7 * 24 * 60 * 60 * 1000;
  }

  const value = Number(match[1]);
  const unit = match[2];

  if (unit === 'h') {
    return value * 60 * 60 * 1000;
  }

  if (unit === 'w') {
    return value * 7 * 24 * 60 * 60 * 1000;
  }

  return value * 24 * 60 * 60 * 1000;
};

const normalizeProviders = (args: {
  readonly provider: string | undefined;
  readonly providers: ReadonlyArray<ProviderAdapter> | undefined;
}): ReadonlyArray<ProviderAdapter> => {
  if (args.providers !== undefined) {
    return args.providers;
  }

  if (args.provider === undefined) {
    return allProviders;
  }

  const decoded = Schema.decodeUnknownEither(ProviderIdSchema)(args.provider);

  if (decoded._tag === 'Left') {
    process.stderr.write(`Unknown provider: ${args.provider}\n`);
    process.exitCode = 2;
    return [];
  }

  return allProviders.filter((adapter) => adapter.id === (args.provider as ProviderId));
};

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

const normalizeHome = (home: string | undefined): string | undefined => {
  if (home !== undefined) {
    return home;
  }

  return process.env.HOME;
};

const normalizeVaultPath = (vaultPath: string | undefined, home: string): string => {
  if (vaultPath !== undefined) {
    return vaultPath;
  }

  return resolveDefaultVaultPath(home);
};

const normalizeCompression = (compression: CompressionAdapter | undefined): CompressionAdapter => {
  if (compression !== undefined) {
    return compression;
  }

  return createZstdCompression();
};

const normalizeNow = (now: Date | undefined): Date => {
  if (now !== undefined) {
    return now;
  }

  return new Date();
};
