import { defineCommand } from 'citty';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { parseOptionalProvider } from '@/providers/flag.js';
import { isRestoreOnLaunchEnabled, readSetupSettings } from '@/setup/config.js';
import { type EnsureRestoredReport, ensureSessionRestored } from './ensure-restored.js';

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

export type EnsureRestoredFlags = {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly session: string | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly vaultPath?: string | undefined;
};

export const runEnsureRestoredCommand = async (
  flags: EnsureRestoredFlags,
): Promise<CommandExit> => {
  const home = requireHome(flags.home);

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const sessionSelector = flags.session?.trim() ?? '';

  const isSessionSelectorEmpty = sessionSelector.length === 0;
  if (isSessionSelectorEmpty) {
    process.stderr.write(
      'Missing session selector. Use agent-session-pack ensure-restored [--provider codex] <session>.\n',
    );
    return { exitCode: 2 };
  }

  const provider = parseOptionalProvider(flags.provider);

  const isUnknownProviderGiven = flags.provider != null && provider == null;
  if (isUnknownProviderGiven) {
    process.stderr.write(`Unknown provider: ${flags.provider}\n`);
    return { exitCode: 2 };
  }

  const setupSettings = await readSetupSettings(home);
  const vaultPath = flags.vaultPath ?? setupSettings?.vaultPath ?? createDefaultVaultPath(home);
  const restoreOnLaunchEnabled = isRestoreOnLaunchEnabled(setupSettings);
  const compression = flags.compression ?? createZstdCompression();

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

  writeEnsureRestoredPrintout(report, flags.json === true);
  return { exitCode: ensureRestoredExitCode(report) };
};

const writeEnsureRestoredPrintout = (
  report: EnsureRestoredReport,
  isStructuredRequested: boolean,
): void => {
  if (isStructuredRequested) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const isReportProviderMissing = report.provider == null;
  const isReportSessionIdMissing = report.sessionId == null;
  const isReportOriginalPathMissing = report.originalPath == null;
  const isReportReasonMissing = report.reason == null;
  const lines = [
    `ensure-restored: ${report.status}`,
    isReportProviderMissing ? null : `provider: ${report.provider}`,
    isReportSessionIdMissing ? null : `session: ${report.sessionId}`,
    isReportOriginalPathMissing ? null : `originalPath: ${report.originalPath}`,
    isReportReasonMissing ? null : `reason: ${report.reason}`,
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
