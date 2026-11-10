import { defineCommand } from 'citty';
import { createDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { parseOptionalProvider } from '@/providers/flag.js';
import { readSetupSettings } from '@/setup/config.js';
import { type EnsureRestoredReport, ensureSessionRestored } from './ensure-restored.js';

/**
 * Citty command that restores a packed session by id, id prefix, name, slug, or fuzzy words.
 */
export const restoreCommand = defineCommand({
  meta: {
    name: 'restore',
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

/**
 * Decoded arguments for the restore command.
 */
export type RestoreFlags = {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly selector: string | undefined;
  readonly to: string | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly vaultPath?: string | undefined;
};

/**
 * Runs the restore command for human and agent callers.
 *
 * @param flags - Decoded command-line arguments.
 */
export const runRestoreCommand = async (flags: RestoreFlags): Promise<CommandExit> => {
  const home = requireHome(flags.home);

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const selector = flags.selector?.trim() ?? '';

  const isSelectorEmpty = selector.length === 0;
  if (isSelectorEmpty) {
    process.stderr.write('Missing selector. Use agent-session-pack restore <selector>.\n');
    return { exitCode: 2 };
  }

  const hasCustomRestoreTarget = flags.to != null && flags.to !== 'original';
  if (hasCustomRestoreTarget) {
    process.stderr.write(
      'Only --to original is supported. Custom restore destinations are not available yet.\n',
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
  const compression = flags.compression ?? createZstdCompression();

  const report = await ensureSessionRestored({
    command: 'restore',
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
};

const writeRestorePrintout = (
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
    `restore: ${report.status}`,
    isReportProviderMissing ? null : `provider: ${report.provider}`,
    isReportSessionIdMissing ? null : `session: ${report.sessionId}`,
    isReportOriginalPathMissing ? null : `originalPath: ${report.originalPath}`,
    isReportReasonMissing ? null : `reason: ${report.reason}`,
  ].filter((line): line is string => line != null);

  process.stdout.write(`${lines.join('\n')}\n`);
};

const restoreExitCode = (report: EnsureRestoredReport): number => {
  const isRestoreSuccessful = report.status === 'restored' || report.status === 'already-present';
  if (isRestoreSuccessful) {
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
