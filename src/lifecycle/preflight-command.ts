import { defineCommand } from 'citty';
import { resolveDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandOutcome } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { type EnsureRestoredReport, ensureSessionRestored } from '@/restore/ensure-restored.js';
import { type ProviderId, ProviderIdSchema } from '@/session-model.js';
import { isRestoreOnLaunchEnabled, readSetupConfig } from '@/setup/config.js';
import { extractSessionIdsFromArgv, recordSessionAccess } from './session-access.js';

/**
 * Citty command used by provider wrappers to auto-restore sessions before launch.
 */
export const preflightCommand = defineCommand({
  meta: {
    name: 'preflight',
    description:
      'Auto-restore packed sessions found in provider argv when lifecycle is enabled (wrapper hook).',
  },
  args: {
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
      required: true,
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args, rawArgs }) => {
    const passthrough = extractPassthroughArgv(rawArgs);
    return runPreflightCommand({
      json: args.json,
      provider: args.provider,
      passthroughArgv: passthrough,
    });
  },
});

/**
 * Decoded arguments for preflight.
 */
export type PreflightArgs = {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly passthroughArgv: ReadonlyArray<string>;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly vaultPath?: string | undefined;
};

/**
 * Runs preflight restore for session ids discovered in provider argv.
 *
 * Writes preflight JSON or human output. Always exits 0 on soft failures.
 *
 * @param args - Provider, passthrough argv, and output flags.
 */
export const runPreflightCommand = async (args: PreflightArgs): Promise<CommandOutcome> => {
  const home = requireHome(args.home);

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const provider = parseProvider(args.provider);

  const isProviderMissing = provider === undefined;
  if (isProviderMissing) {
    process.stderr.write(`Unknown or missing provider: ${args.provider ?? ''}\n`);
    return { exitCode: 2 };
  }

  const setupConfig = await readSetupConfig(home);
  const restoreOnLaunchEnabled = isRestoreOnLaunchEnabled(setupConfig);
  const vaultPath = args.vaultPath ?? setupConfig?.vaultPath ?? resolveDefaultVaultPath(home);
  const compression = args.compression ?? createZstdCompression();
  const now = args.now ?? new Date();
  const sessionIds = extractSessionIdsFromArgv(args.passthroughArgv);
  const isJsonOutput = args.json === true;

  const isRestoreOnLaunchDisabled = !restoreOnLaunchEnabled;
  if (isRestoreOnLaunchDisabled) {
    writePreflightOutput(
      {
        command: 'preflight',
        provider,
        restoreOnLaunchEnabled: false,
        sessionIds,
        restores: [],
        reason: 'lifecycle disabled; no auto-restore',
      },
      isJsonOutput,
    );
    return { exitCode: 0 };
  }

  const isSessionIdsEmpty = sessionIds.length === 0;
  if (isSessionIdsEmpty) {
    writePreflightOutput(
      {
        command: 'preflight',
        provider,
        restoreOnLaunchEnabled: true,
        sessionIds: [],
        restores: [],
        reason: 'no session ids found in argv',
      },
      isJsonOutput,
    );
    return { exitCode: 0 };
  }

  const restores: EnsureRestoredReport[] = [];

  for (const sessionId of sessionIds) {
    const report = await ensureSessionRestored({
      command: 'ensure-restored',
      vaultPath,
      selector: sessionId,
      selectorMatch: 'exact',
      provider,
      compression,
      restoreOnLaunchEnabled: true,
      requireLifecycleEnabled: true,
    });
    restores.push(report);

    const isReportUsable = report.status === 'restored' || report.status === 'already-present';
    const hasReportSessionId = report.sessionId != null;

    const isSessionReportUsable = isReportUsable && hasReportSessionId;
    if (isSessionReportUsable) {
      await recordSessionAccess({
        vaultPath,
        provider,
        sessionId: report.sessionId,
        accessedAt: now,
      });
    }
  }

  writePreflightOutput(
    {
      command: 'preflight',
      provider,
      restoreOnLaunchEnabled: true,
      sessionIds,
      restores,
      reason: undefined,
    },
    isJsonOutput,
  );
  return { exitCode: 0 };
};

const extractPassthroughArgv = (rawArgs: ReadonlyArray<string>): ReadonlyArray<string> => {
  const separatorIndex = rawArgs.indexOf('--');

  const isSeparatorIndexEqualsMinus1 = separatorIndex === -1;
  if (isSeparatorIndexEqualsMinus1) {
    // Everything after subcommand name flags; drop known flags.
    return rawArgs.filter(
      (arg, index, all) =>
        arg !== 'preflight' &&
        arg !== '--json' &&
        arg !== '--provider' &&
        all[index - 1] !== '--provider' &&
        !arg.startsWith('--provider='),
    );
  }

  return rawArgs.slice(separatorIndex + 1);
};

const parseProvider = (provider: string | undefined): ProviderId | undefined => {
  const isProviderMissing = provider == null;
  if (isProviderMissing) {
    return undefined;
  }

  const providerReply = ProviderIdSchema.safeParse(provider);

  const isProviderReplyFailed = !providerReply.success;
  if (isProviderReplyFailed) {
    return undefined;
  }

  return providerReply.data;
};

const writePreflightOutput = (
  payload: {
    readonly command: 'preflight';
    readonly provider: ProviderId;
    readonly restoreOnLaunchEnabled: boolean;
    readonly sessionIds: ReadonlyArray<string>;
    readonly restores: ReadonlyArray<EnsureRestoredReport>;
    readonly reason: string | undefined;
  },
  json: boolean,
): void => {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const isReasonMissing = payload.reason == null;
  const lines = [
    `preflight: ${payload.provider}`,
    `restoreOnLaunchEnabled: ${String(payload.restoreOnLaunchEnabled)}`,
    `sessionIds: ${payload.sessionIds.join(', ') || '(none)'}`,
    isReasonMissing ? undefined : `reason: ${payload.reason}`,
    ...payload.restores.map((report) => {
      const isReportReasonMissing = report.reason == null;
      return `- ${report.sessionId ?? '?'}: ${report.status}${isReportReasonMissing ? '' : ` (${report.reason})`}`;
    }),
  ].filter((line): line is string => line != null);

  process.stdout.write(`${lines.join('\n')}\n`);
};
