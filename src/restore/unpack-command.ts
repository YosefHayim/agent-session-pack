import { defineCommand } from 'citty';
import { askApplyConfirmation } from '@/apply-confirmation.js';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandOutcome } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { selectProviders } from '@/providers/flag.js';
import type { ProviderAdapter } from '@/session-model.js';
import { createHumanUnpackReport } from './unpack-output.js';
import { unpackProviderSessions } from './unpack-sessions.js';

/**
 * Citty command that restores archived sessions from the vault.
 */
export const unpackCommand = defineCommand({
  meta: {
    name: 'unpack',
    description: 'Restore archived sessions from the vault.',
  },
  args: {
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
    },
    'all-providers': {
      type: 'boolean',
      description: 'Restore archived sessions for every supported provider.',
    },
    apply: {
      type: 'boolean',
      description: 'Restore archived sessions back to original provider paths.',
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
    const confirmed = await askApplyConfirmation({
      action: 'Restore archived sessions for the selected providers',
      apply: args.apply,
      json: args.json,
      yes: args.yes,
    });

    return runUnpackCommand({
      allProviders: args['all-providers'],
      apply: args.apply,
      confirmed,
      json: args.json,
      provider: args.provider,
      yes: args.yes,
    });
  },
});

/**
 * Decoded arguments for the unpack command.
 */
export type UnpackArgs = {
  readonly allProviders: boolean | undefined;
  readonly apply: boolean | undefined;
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly yes: boolean | undefined;
  readonly confirmed?: boolean | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly providers?: ReadonlyArray<ProviderAdapter> | undefined;
  readonly vaultPath?: string | undefined;
};

/**
 * Runs the unpack command for human and agent callers.
 *
 * @param args - Decoded command-line arguments.
 */
export const runUnpackCommand = async (args: UnpackArgs): Promise<CommandOutcome> => {
  const home = requireHome(args.home);

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const isApplyUnconfirmed = args.apply === true && args.confirmed !== true;
  if (isApplyUnconfirmed) {
    process.stderr.write('Cancelled. Re-run with --apply and confirm with y to unpack sessions.\n');
    process.stderr.write('\n');
    return { exitCode: 2 };
  }

  const { providers, isProviderUnknown } = selectProviders(args.provider, args.providers);
  const providerExitCode = isProviderUnknown ? 2 : 0;
  const report = await unpackProviderSessions({
    vaultPath: args.vaultPath ?? createDefaultVaultPath(home),
    providers,
    apply: args.apply === true,
    compression: args.compression ?? createZstdCompression(),
  });

  const isJsonOutput = args.json === true;
  if (isJsonOutput) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return { exitCode: providerExitCode };
  }

  process.stdout.write(`${createHumanUnpackReport(report)}\n`);
  return { exitCode: providerExitCode };
};
