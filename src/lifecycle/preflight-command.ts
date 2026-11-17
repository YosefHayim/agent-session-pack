import { defineCommand } from 'citty';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/environment.js';
import { type EnsureRestoredReport, ensureSessionRestored } from '@/restore/ensure-restored.js';
import { type ProviderId, ProviderIdSchema } from '@/session-model.js';
import { isRestoreOnLaunchEnabled, readSetupSettings } from '@/setup/config.js';
import { extractSessionIdsFromArgv, saveSessionAccess } from './session-access.js';

const USAGE_ERROR_EXIT_CODE = 2;
const JSON_INDENT_SPACES = 2;
const PROVIDER_FLAG = '--provider';
const NO_SESSION_IDS_LABEL = '(none)';

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

export interface PreflightFlags {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly passthroughArgv: ReadonlyArray<string>;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly vaultPath?: string | undefined;
}

export async function runPreflightCommand(flags: PreflightFlags): Promise<CommandExit> {
  const home = requireHome(flags.home);

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const provider = parseProvider(flags.provider);

  const isProviderMissing = provider == null;
  if (isProviderMissing) {
    process.stderr.write(`Unknown or missing provider: ${flags.provider ?? ''}\n`);
    return { exitCode: USAGE_ERROR_EXIT_CODE };
  }

  const setupSettings = await readSetupSettings(home);
  const restoreOnLaunchEnabled = isRestoreOnLaunchEnabled(setupSettings);
  const vaultPath = flags.vaultPath ?? setupSettings?.vaultPath ?? createDefaultVaultPath(home);
  const compression = flags.compression ?? createZstdCompression();
  const now = flags.now ?? new Date();
  const sessionIds = extractSessionIdsFromArgv(flags.passthroughArgv);
  const isMachineReadableRequested = flags.json === true;

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
      isMachineReadableRequested,
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
      isMachineReadableRequested,
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

    const reportSessionId = report.sessionId;

    const isReportRestored = report.status === 'restored';
    const isReportAlreadyPresent = report.status === 'already-present';
    const isReportUsable = isReportRestored || isReportAlreadyPresent;

    const isReportUnusable = !isReportUsable;
    if (isReportUnusable) {
      continue;
    }

    const isReportSessionIdMissing = reportSessionId == null;
    if (isReportSessionIdMissing) {
      continue;
    }

    await saveSessionAccess({
      vaultPath,
      provider,
      sessionId: reportSessionId,
      accessedAt: now,
    });
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
    isMachineReadableRequested,
  );
  return { exitCode: 0 };
}

function isPassthroughArgument(
  argument: string,
  index: number,
  argumentList: ReadonlyArray<string>,
): boolean {
  const isOwnFlag = argument === 'preflight' || argument === '--json' || argument === PROVIDER_FLAG;
  const isProviderFlagValue = argumentList[index - 1] === PROVIDER_FLAG;
  const isProviderAssignment = argument.startsWith(`${PROVIDER_FLAG}=`);

  return !isOwnFlag && !isProviderFlagValue && !isProviderAssignment;
}

function extractPassthroughArgv(argumentList: ReadonlyArray<string>): ReadonlyArray<string> {
  const separatorIndex = argumentList.indexOf('--');

  const isSeparatorNotFound = separatorIndex === -1;
  if (isSeparatorNotFound) {
    return argumentList.filter(isPassthroughArgument);
  }

  return argumentList.slice(separatorIndex + 1);
}

function parseProvider(provider: string | undefined): ProviderId | null {
  const isProviderMissing = provider == null;
  if (isProviderMissing) {
    return null;
  }

  const providerReply = ProviderIdSchema.safeParse(provider);

  const isProviderReplyFailed = !providerReply.success;
  if (isProviderReplyFailed) {
    return null;
  }

  return providerReply.data;
}

function describeRestore(report: EnsureRestoredReport): string {
  const isReportReasonMissing = report.reason == null;
  const reasonSuffix = isReportReasonMissing ? '' : ` (${report.reason})`;

  return `- ${report.sessionId ?? '?'}: ${report.status}${reasonSuffix}`;
}

function isPresentLine(line: string | null): line is string {
  return line != null;
}

function writePreflightPrintout(
  payload: {
    readonly command: 'preflight';
    readonly provider: ProviderId;
    readonly restoreOnLaunchEnabled: boolean;
    readonly sessionIds: ReadonlyArray<string>;
    readonly restores: ReadonlyArray<EnsureRestoredReport>;
    readonly reason: string | undefined;
  },
  isMachineReadableRequested: boolean,
): void {
  if (isMachineReadableRequested) {
    process.stdout.write(`${JSON.stringify(payload, null, JSON_INDENT_SPACES)}\n`);
    return;
  }

  const isReasonMissing = payload.reason == null;
  const lines = [
    `preflight: ${payload.provider}`,
    `restoreOnLaunchEnabled: ${String(payload.restoreOnLaunchEnabled)}`,
    `sessionIds: ${payload.sessionIds.join(', ') || NO_SESSION_IDS_LABEL}`,
    isReasonMissing ? null : `reason: ${payload.reason}`,
    ...payload.restores.map(describeRestore),
  ].filter(isPresentLine);

  process.stdout.write(`${lines.join('\n')}\n`);
}
