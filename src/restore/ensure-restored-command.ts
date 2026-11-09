import { defineCommand } from 'citty';
import { resolveDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandOutcome } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { parseOptionalProvider } from '@/providers/flag.js';
import { isRestoreOnLaunchEnabled, readSetupConfig } from '@/setup/config.js';
import { type EnsureRestoredReport, ensureSessionRestored } from './ensure-restored.js';

/**
 * Citty command that restores one archived session when restore-on-launch is enabled.
 */
export const ensureRestoredCommand = defineCommand({
  meta: {
    name: 'ensure-restored',
    description:
      'Restore one archived session before provider resume when restore-on-launch is enabled.',
  },
  args: {
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
    },
    session: {
      type: 'positional',
      description: 'Session id, slug, title, or provider-prefixed selector (e.g. codex:cold).',
      required: true,
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    return runEnsureRestoredCommand({
      json: args.json,
      provider: args.provider,
      session: args.session,
    });
  },
});

/**
 * Decoded arguments for ensure-restored.
 */
export type EnsureRestoredArgs = {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly session: string | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly vaultPath?: string | undefined;
};

/**
 * Runs ensure-restored for human and agent callers.
 *
 * @param args - Decoded command-line arguments.
 */
export const runEnsureRestoredCommand = async (
  args: EnsureRestoredArgs,
): Promise<CommandOutcome> => {
  const home = requireHome(args.home);

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const sessionSelector = args.session?.trim() ?? '';

  const isSessionSelectorEmpty = sessionSelector.length === 0;
  if (isSessionSelectorEmpty) {
    process.stderr.write(
      'Missing session selector. Use agent-session-pack ensure-restored [--provider codex] <session>.\n',
    );
    return { exitCode: 2 };
  }

  const provider = parseOptionalProvider(args.provider);

  const isProviderPresentAndProviderMissing = args.provider != null && provider === undefined;
  if (isProviderPresentAndProviderMissing) {
    process.stderr.write(`Unknown provider: ${args.provider}\n`);
    return { exitCode: 2 };
  }

  const setupConfig = await readSetupConfig(home);
  const vaultPath = args.vaultPath ?? setupConfig?.vaultPath ?? resolveDefaultVaultPath(home);
  const restoreOnLaunchEnabled = isRestoreOnLaunchEnabled(setupConfig);
  const compression = args.compression ?? createZstdCompression();

  const report = await ensureSessionRestored({
    command: 'ensure-restored',
    vaultPath,
    selector: sessionSelector,
    selectorMatch: 'exact',
    provider,
    compression,
    restoreOnLaunchEnabled,
    requireLifecycleEnabled: true,
  });

  writeEnsureRestoredOutput(report, args.json === true);
  return { exitCode: ensureRestoredExitCode(report) };
};

const writeEnsureRestoredOutput = (report: EnsureRestoredReport, json: boolean): void => {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const isReportProviderMissing = report.provider === undefined;
  const isReportSessionIdMissing = report.sessionId == null;
  const isReportOriginalPathMissing = report.originalPath == null;
  const isReportReasonMissing = report.reason == null;
  const lines = [
    `ensure-restored: ${report.status}`,
    isReportProviderMissing ? undefined : `provider: ${report.provider}`,
    isReportSessionIdMissing ? undefined : `session: ${report.sessionId}`,
    isReportOriginalPathMissing ? undefined : `originalPath: ${report.originalPath}`,
    isReportReasonMissing ? undefined : `reason: ${report.reason}`,
    `restoreOnLaunchEnabled: ${String(report.restoreOnLaunchEnabled)}`,
  ].filter((line): line is string => line != null);

  process.stdout.write(`${lines.join('\n')}\n`);
};

const ensureRestoredExitCode = (report: EnsureRestoredReport): number => {
  const isReportStatusRestoredOrAlreadyPresent =
    report.status === 'restored' || report.status === 'already-present';
  if (isReportStatusRestoredOrAlreadyPresent) {
    return 0;
  }

  const isReportStatusLifecycleDisabled = report.status === 'lifecycle-disabled';
  if (isReportStatusLifecycleDisabled) {
    return 1;
  }

  const isRestoreBlocked =
    report.status === 'conflict' ||
    report.status === 'missing-archive' ||
    report.status === 'ambiguous-selector';
  if (isRestoreBlocked) {
    return 2;
  }

  const isReportStatusBackupOnly = report.status === 'backup-only';
  if (isReportStatusBackupOnly) {
    return 2;
  }

  return 1;
};
