import { defineCommand } from 'citty';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { saveSessionAccess } from '@/lifecycle/session-access.js';
import { parseOptionalProvider } from '@/providers/flag.js';
import { isRestoreOnLaunchEnabled, readSetupSettings } from '@/setup/config.js';
import { type EnsureRestoredReport, ensureSessionRestored } from './ensure-restored.js';

/**
 * Citty command that looks up a session and auto-restores it when packed.
 */
export const openCommand = defineCommand({
  meta: {
    name: 'open',
    description: 'Look up a session and auto-restore it from the vault when lifecycle is enabled.',
  },
  args: {
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
    },
    session: {
      type: 'positional',
      description:
        'Session id or id prefix, slug, title, fuzzy words, or provider-prefixed selector.',
      required: true,
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    return runOpenCommand({
      json: args.json,
      provider: args.provider,
      session: args.session,
    });
  },
});

/**
 * Decoded arguments for the open command.
 */
export type OpenFlags = {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly session: string | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly vaultPath?: string | undefined;
};

/**
 * Opens (looks up) a session and restores it when lifecycle is enabled.
 *
 * @param flags - Decoded command-line arguments.
 */
export const runOpenCommand = async (flags: OpenFlags): Promise<CommandExit> => {
  const home = requireHome(flags.home);

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const sessionSelector = flags.session?.trim() ?? '';

  const isSessionSelectorEmpty = sessionSelector.length === 0;
  if (isSessionSelectorEmpty) {
    process.stderr.write(
      'Missing session. Use agent-session-pack open [--provider codex] <session>.\n',
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
  const restoreOnLaunchEnabled = isRestoreOnLaunchEnabled(setupSettings);
  const vaultPath = flags.vaultPath ?? setupSettings?.vaultPath ?? createDefaultVaultPath(home);
  const compression = flags.compression ?? createZstdCompression();
  const now = flags.now ?? new Date();

  // When lifecycle is off, open still restores (lookup path) so "look for session"
  // always materializes packed history without needing a separate restore step.
  // Lifecycle wrappers use preflight/ensure-restored for the enable gate.
  const report = await ensureSessionRestored({
    command: 'restore',
    vaultPath,
    selector: sessionSelector,
    selectorMatch: 'fuzzy',
    provider,
    compression,
    restoreOnLaunchEnabled,
    requireLifecycleEnabled: false,
  });

  const isSessionOpenable =
    (report.status === 'restored' || report.status === 'already-present') &&
    report.provider != null &&
    report.sessionId != null;
  if (isSessionOpenable) {
    await saveSessionAccess({
      vaultPath,
      provider: report.provider,
      sessionId: report.sessionId,
      accessedAt: now,
    });
  }

  writeOpenPrintout(report, restoreOnLaunchEnabled, flags.json === true);
  return { exitCode: openExitCode(report) };
};

const writeOpenPrintout = (
  report: EnsureRestoredReport,
  restoreOnLaunchEnabled: boolean,
  isStructuredRequested: boolean,
): void => {
  const openReport = {
    ...report,
    command: 'open' as const,
    restoreOnLaunchEnabled,
  };

  if (isStructuredRequested) {
    process.stdout.write(`${JSON.stringify(openReport, null, 2)}\n`);
    return;
  }

  const isReportProviderMissing = report.provider == null;
  const isReportSessionIdMissing = report.sessionId == null;
  const isReportOriginalPathMissing = report.originalPath == null;
  const isReportReasonMissing = report.reason == null;
  const lines = [
    `open: ${report.status}`,
    isReportProviderMissing ? null : `provider: ${report.provider}`,
    isReportSessionIdMissing ? null : `session: ${report.sessionId}`,
    isReportOriginalPathMissing ? null : `originalPath: ${report.originalPath}`,
    isReportReasonMissing ? null : `reason: ${report.reason}`,
  ].filter((line): line is string => line != null);

  process.stdout.write(`${lines.join('\n')}\n`);
};

const openExitCode = (report: EnsureRestoredReport): number => {
  const isReportStatusRestoredOrAlreadyPresent =
    report.status === 'restored' || report.status === 'already-present';
  if (isReportStatusRestoredOrAlreadyPresent) {
    return 0;
  }

  const isRestoreBlocked =
    report.status === 'conflict' ||
    report.status === 'missing-archive' ||
    report.status === 'ambiguous-selector' ||
    report.status === 'backup-only';
  if (isRestoreBlocked) {
    return 2;
  }

  return 1;
};
