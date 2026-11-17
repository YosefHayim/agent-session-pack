import { defineCommand } from 'citty';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/environment.js';
import { saveSessionAccess } from '@/lifecycle/session-access.js';
import { parseOptionalProvider } from '@/providers/flag.js';
import { isRestoreOnLaunchEnabled, readSetupSettings } from '@/setup/config.js';
import { type EnsureRestoredReport, ensureSessionRestored } from './ensure-restored.js';

const COMMAND_NAME = 'open';
const USAGE_EXIT_CODE = 2;
const JSON_INDENT_SPACES = 2;
const SUCCESS_STATUSES: ReadonlySet<EnsureRestoredReport['status']> = new Set([
  'restored',
  'already-present',
]);
const BLOCKED_STATUSES: ReadonlySet<EnsureRestoredReport['status']> = new Set([
  'conflict',
  'missing-archive',
  'ambiguous-selector',
  'backup-only',
]);

export const openCommand = defineCommand({
  meta: {
    name: COMMAND_NAME,
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

export interface OpenFlags {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly session: string | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly vaultPath?: string | undefined;
}

export async function runOpenCommand(flags: OpenFlags): Promise<CommandExit> {
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
    return { exitCode: USAGE_EXIT_CODE };
  }

  const provider = parseOptionalProvider(flags.provider);

  const isProviderFlagGiven = flags.provider != null;
  const isProviderUnparsed = provider == null;
  const isUnknownProviderGiven = isProviderFlagGiven && isProviderUnparsed;
  if (isUnknownProviderGiven) {
    process.stderr.write(`Unknown provider: ${flags.provider}\n`);
    return { exitCode: USAGE_EXIT_CODE };
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

  const reportedProvider = report.provider;
  const reportedSessionId = report.sessionId;

  const isReportStatusSuccessful = SUCCESS_STATUSES.has(report.status);
  const isReportedProviderPresent = reportedProvider != null;
  const isReportedSessionIdPresent = reportedSessionId != null;
  const isSessionOpenable =
    isReportStatusSuccessful && isReportedProviderPresent && isReportedSessionIdPresent;
  if (isSessionOpenable) {
    await saveSessionAccess({
      vaultPath,
      provider: reportedProvider,
      sessionId: reportedSessionId,
      accessedAt: now,
    });
  }

  writeOpenPrintout(report, restoreOnLaunchEnabled, flags.json === true);
  return { exitCode: openExitCode(report) };
}

function isPresentLine(line: string | null): line is string {
  return line != null;
}

function writeOpenPrintout(
  report: EnsureRestoredReport,
  restoreOnLaunchEnabled: boolean,
  isMachineReadableRequested: boolean,
): void {
  const openReport = {
    ...report,
    command: COMMAND_NAME,
    restoreOnLaunchEnabled,
  };

  if (isMachineReadableRequested) {
    process.stdout.write(`${JSON.stringify(openReport, null, JSON_INDENT_SPACES)}\n`);
    return;
  }

  const isReportProviderMissing = report.provider == null;
  const isReportSessionIdMissing = report.sessionId == null;
  const isReportOriginalPathMissing = report.originalPath == null;
  const isReportReasonMissing = report.reason == null;
  const lines = [
    `${COMMAND_NAME}: ${report.status}`,
    isReportProviderMissing ? null : `provider: ${report.provider}`,
    isReportSessionIdMissing ? null : `session: ${report.sessionId}`,
    isReportOriginalPathMissing ? null : `originalPath: ${report.originalPath}`,
    isReportReasonMissing ? null : `reason: ${report.reason}`,
  ].filter(isPresentLine);

  process.stdout.write(`${lines.join('\n')}\n`);
}

function openExitCode(report: EnsureRestoredReport): number {
  const isReportStatusSuccessful = SUCCESS_STATUSES.has(report.status);
  if (isReportStatusSuccessful) {
    return 0;
  }

  const isRestoreBlocked = BLOCKED_STATUSES.has(report.status);
  if (isRestoreBlocked) {
    return USAGE_EXIT_CODE;
  }

  return 1;
}
