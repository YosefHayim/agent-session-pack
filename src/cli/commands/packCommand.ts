import { defineCommand } from 'citty';
import { Effect, Schema } from 'effect';
import {
  createPackPlan,
  type ProviderAdapter,
  type ProviderDiscoveryError,
  type ProviderId,
  type SessionStore,
  scanStores,
} from '../../core/index.js';
import { formatHumanPackPlan, formatJsonPackPlan } from '../../output/index.js';
import { allProviders, ProviderIdSchema } from '../../providers/index.js';

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
    apply: {
      type: 'boolean',
      description: 'Apply archive/remove workflow after verification.',
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    await Effect.runPromise(
      runPackCommand({
        provider: args.provider,
        olderThan: args['older-than'],
        dryRun: args['dry-run'],
        apply: args.apply,
        json: args.json,
      }),
    );
  },
});

export type PackArgs = {
  readonly provider: string | undefined;
  readonly olderThan: string | undefined;
  readonly dryRun: boolean | undefined;
  readonly apply: boolean | undefined;
  readonly json: boolean | undefined;
};

/**
 * Runs a non-destructive pack planning command.
 *
 * @param args - Decoded command-line arguments.
 * @returns Effect that writes the pack plan.
 */
export const runPackCommand = (args: PackArgs): Effect.Effect<void, ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const home = process.env.HOME;

    if (home === undefined) {
      process.stderr.write('HOME is not set.\n');
      process.exitCode = 1;
      return;
    }

    if (args.apply === true) {
      process.stderr.write(
        [
          'pack --apply is not enabled in this CLI build.',
          'Reason: restore/list indexing must land before real provider files are removed.',
          'Run pack --dry-run or pnpm evidence:local for safe before/after proof.',
        ].join('\n'),
      );
      process.stderr.write('\n');
      process.exitCode = 2;
      return;
    }

    const olderThan = normalizeOlderThan(args.olderThan);
    const olderThanMs = parseDurationMs(olderThan);
    const providers = normalizeProviders(args.provider);
    const stores = providers.flatMap((provider) =>
      provider.defaultRoots(home).map((path): SessionStore => ({ provider: provider.id, path })),
    );
    const report = yield* scanStores({
      providers,
      stores,
    });
    const plan = createPackPlan({
      now: new Date(),
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

const normalizeOlderThan = (olderThan: string | undefined): string => {
  if (olderThan === undefined) {
    return defaultOlderThan;
  }

  return olderThan;
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

const normalizeProviders = (provider: string | undefined): ReadonlyArray<ProviderAdapter> => {
  if (provider === undefined) {
    return allProviders;
  }

  const decoded = Schema.decodeUnknownEither(ProviderIdSchema)(provider);

  if (decoded._tag === 'Left') {
    process.stderr.write(`Unknown provider: ${provider}\n`);
    process.exitCode = 2;
    return [];
  }

  return allProviders.filter((adapter) => adapter.id === (provider as ProviderId));
};
