import { defineCommand } from 'citty';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/environment.js';
import { parseOptionalProvider } from '@/providers/flag.js';
import { readSetupSettings } from '@/setup/config.js';
import { type EnsureRestoredReport, ensureSessionRestored } from './ensure-restored.js';

const COMMAND_NAME = 'restore';
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

export const restoreCommand = defineCommand({
  meta: {
    name: COMMAND_NAME,
    description:
      'Restore a packed session by id, id prefix, name, slug, fuzzy words, or provider-prefixed selector.',
  },
  args: {
    selector: {
      type: 'positional',
      description:
        'Session id or id prefix, exact name, slug, fuzzy words, or provider-prefixed selector.',
    },
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
    },
    to: {
      type: 'string',
      description: 'Restore destination: original (default). Custom paths are not supported yet.',
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    return runRestoreCommand({
      json: args.json,
      provider: args.provider,
      selector: args.selector,
      to: args.to,
    });
  },
});

export interface RestoreFlags {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly selector: string | undefined;
  readonly to: string | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly vaultPath?: string | undefined;
}

export async function runRestoreCommand(flags: RestoreFlags): Promise<CommandExit> {
  const home = requireHome(flags.home);

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const selector = flags.selector?.trim() ?? '';

  const isSelectorEmpty = selector.length === 0;
  if (isSelectorEmpty) {
    process.stderr.write('Missing selector. Use agent-session-pack restore <selector>.\n');
    return { exitCode: USAGE_EXIT_CODE };
  }

  const isRestoreTargetGiven = flags.to != null;
  const isRestoreTargetCustom = flags.to !== 'original';
  const hasCustomRestoreTarget = isRestoreTargetGiven && isRestoreTargetCustom;
  if (hasCustomRestoreTarget) {
    process.stderr.write(
      'Only --to original is supported. Custom restore destinations are not available yet.\n',
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
  const compression = flags.compression ?? createZstdCompression();

  const report = await ensureSessionRestored({
    command: COMMAND_NAME,
    vaultPath,
    selector,
    selectorMatch: 'fuzzy',
    provider,
    compression,
    restoreOnLaunchEnabled: setupSettings?.restoreOnLaunch === true,
    requireLifecycleEnabled: false,
  });

  writeRestorePrintout(report, flags.json === true);
  return { exitCode: restoreExitCode(report) };
}

function isPresentLine(line: string | null): line is string {
  return line != null;
}

function writeRestorePrintout(
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
  ].filter(isPresentLine);

  process.stdout.write(`${lines.join('\n')}\n`);
}

function restoreExitCode(report: EnsureRestoredReport): number {
  const isRestoreSuccessful = SUCCESS_STATUSES.has(report.status);
  if (isRestoreSuccessful) {
    return 0;
  }

  const isRestoreBlocked = BLOCKED_STATUSES.has(report.status);
  if (isRestoreBlocked) {
    return USAGE_EXIT_CODE;
  }

  return 1;
}
