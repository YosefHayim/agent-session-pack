import { defineCommand } from 'citty';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { type EnsureRestoredReport, ensureSessionRestored } from '@/restore/ensure-restored.js';
import { type ProviderId, ProviderIdSchema } from '@/session-model.js';
import { isRestoreOnLaunchEnabled, readSetupSettings } from '@/setup/config.js';
import { extractSessionIdsFromArgv, saveSessionAccess } from './session-access.js';

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

export type PreflightFlags = {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly passthroughArgv: ReadonlyArray<string>;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly vaultPath?: string | undefined;
};

export const runPreflightCommand = async (flags: PreflightFlags): Promise<CommandExit> => {
  const home = requireHome(flags.home);

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const provider = parseProvider(flags.provider);

  const isProviderMissing = provider == null;
  if (isProviderMissing) {
    process.stderr.write(`Unknown or missing provider: ${flags.provider ?? ''}\n`);
    return { exitCode: 2 };
  }

  const setupSettings = await readSetupSettings(home);
  const restoreOnLaunchEnabled = isRestoreOnLaunchEnabled(setupSettings);
  const vaultPath = flags.vaultPath ?? setupSettings?.vaultPath ?? createDefaultVaultPath(home);
  const compression = flags.compression ?? createZstdCompression();
  const now = flags.now ?? new Date();
  const sessionIds = extractSessionIdsFromArgv(flags.passthroughArgv);
  const isStructuredRequested = flags.json === true;

  const isRestoreOnLaunchDisabled = !restoreOnLaunchEnabled;
  if (isRestoreOnLaunchDisabled) {
    writePreflightPrintout(
      {
        command: 'preflight',
        provider,
        restoreOnLaunchEnabled: false,
        sessionIds,
        restores: [],
        reason: 'lifecycle disabled; no auto-restore',
      },
      isStructuredRequested,
    );
    return { exitCode: 0 };
  }

  const isSessionIdsEmpty = sessionIds.length === 0;
  if (isSessionIdsEmpty) {
    writePreflightPrintout(
      {
        command: 'preflight',
        provider,
        restoreOnLaunchEnabled: true,
        sessionIds: [],
        restores: [],
        reason: 'no session ids found in argv',
      },
      isStructuredRequested,
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
      await saveSessionAccess({
        vaultPath,
        provider,
        sessionId: report.sessionId,
        accessedAt: now,
      });
    }
  }

  writePreflightPrintout(
    {
      command: 'preflight',
      provider,
      restoreOnLaunchEnabled: true,
      sessionIds,
      restores,
      reason: undefined,
    },
    isStructuredRequested,
  );
  return { exitCode: 0 };
};

const extractPassthroughArgv = (argumentList: ReadonlyArray<string>): ReadonlyArray<string> => {
  const separatorIndex = argumentList.indexOf('--');

  const isSeparatorNotFound = separatorIndex === -1;
  if (isSeparatorNotFound) {
    return argumentList.filter(
      (arg, index, all) =>
        arg !== 'preflight' &&
        arg !== '--json' &&
        arg !== '--provider' &&
        all[index - 1] !== '--provider' &&
        !arg.startsWith('--provider='),
    );
  }

  return argumentList.slice(separatorIndex + 1);
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

const writePreflightPrintout = (
  payload: {
    readonly command: 'preflight';
    readonly provider: ProviderId;
    readonly restoreOnLaunchEnabled: boolean;
    readonly sessionIds: ReadonlyArray<string>;
    readonly restores: ReadonlyArray<EnsureRestoredReport>;
    readonly reason: string | undefined;
  },
  isStructuredRequested: boolean,
): void => {
  if (isStructuredRequested) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const isReasonMissing = payload.reason == null;
  const lines = [
    `preflight: ${payload.provider}`,
    `restoreOnLaunchEnabled: ${String(payload.restoreOnLaunchEnabled)}`,
    `sessionIds: ${payload.sessionIds.join(', ') || '(none)'}`,
    isReasonMissing ? null : `reason: ${payload.reason}`,
    ...payload.restores.map((report) => {
      const isReportReasonMissing = report.reason == null;
      return `- ${report.sessionId ?? '?'}: ${report.status}${isReportReasonMissing ? '' : ` (${report.reason})`}`;
    }),
  ].filter((line): line is string => line != null);

  process.stdout.write(`${lines.join('\n')}\n`);
};
