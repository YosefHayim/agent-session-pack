import { defineCommand } from 'citty';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/environment.js';
import { parseOptionalProvider } from '@/providers/flag.js';
import { isRestoreOnLaunchEnabled, readSetupSettings } from '@/setup/config.js';
import { type EnsureRestoredReport, ensureSessionRestored } from './ensure-restored.js';

const COMMAND_NAME = 'ensure-restored';
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

export const ensureRestoredCommand = defineCommand({
  meta: {
    name: COMMAND_NAME,
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

export interface EnsureRestoredFlags {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly session: string | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly vaultPath?: string | undefined;
}

export async function runEnsureRestoredCommand(flags: EnsureRestoredFlags): Promise<CommandExit> {
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
  const vaultPath = flags.vaultPath ?? setupSettings?.vaultPath ?? createDefaultVaultPath(home);
  const restoreOnLaunchEnabled = isRestoreOnLaunchEnabled(setupSettings);
  const compression = flags.compression ?? createZstdCompression();

  const report = await ensureSessionRestored({
    command: COMMAND_NAME,
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
}

function isPresentLine(line: string | null): line is string {
  return line != null;
}

function writeEnsureRestoredPrintout(
  report: EnsureRestoredReport,
  isMachineOutputRequested: boolean,
): void {
  if (isMachineOutputRequested) {
    process.stdout.write(`${JSON.stringify(report, null, JSON_INDENT_SPACES)}\n`);
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
    `restoreOnLaunchEnabled: ${String(report.restoreOnLaunchEnabled)}`,
  ].filter(isPresentLine);

  process.stdout.write(`${lines.join('\n')}\n`);
}

function ensureRestoredExitCode(report: EnsureRestoredReport): number {
  const isReportStatusSuccessful = SUCCESS_STATUSES.has(report.status);
  if (isReportStatusSuccessful) {
    return 0;
  }

  const isReportStatusLifecycleDisabled = report.status === 'lifecycle-disabled';
  if (isReportStatusLifecycleDisabled) {
    return 1;
  }

  const isRestoreBlocked = BLOCKED_STATUSES.has(report.status);
  if (isRestoreBlocked) {
    return USAGE_EXIT_CODE;
  }

  return 1;
}
