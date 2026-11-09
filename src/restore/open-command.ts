import { defineCommand } from 'citty';
import { resolveDefaultVaultPath } from '@/archive/vault-paths.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import { requireHome } from '@/home-env.js';
import { recordSessionAccess } from '@/lifecycle/session-access.js';
import { parseOptionalProvider } from '@/providers/flag.js';
import { isRestoreOnLaunchEnabled, readSetupConfig } from '@/setup/config.js';
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
    await runOpenCommand({
      json: args.json,
      provider: args.provider,
      session: args.session,
    });
  },
});

/**
 * Decoded arguments for the open command.
 */
export type OpenArgs = {
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
 * @param args - Decoded command-line arguments.
 */
export const runOpenCommand = async (args: OpenArgs): Promise<void> => {
  const home = requireHome(args.home);

  if (home === undefined) {
    return;
  }

  const sessionSelector = args.session?.trim() ?? '';

  if (sessionSelector.length === 0) {
    process.stderr.write(
      'Missing session. Use agent-session-pack open [--provider codex] <session>.\n',
    );
    process.exitCode = 2;
    return;
  }

  const provider = parseOptionalProvider(args.provider);

  if (args.provider !== undefined && provider === undefined) {
    process.stderr.write(`Unknown provider: ${args.provider}\n`);
    process.exitCode = 2;
    return;
  }

  const setupConfig = await readSetupConfig(home);
  const restoreOnLaunchEnabled = isRestoreOnLaunchEnabled(setupConfig);
  const vaultPath = args.vaultPath ?? setupConfig?.vaultPath ?? resolveDefaultVaultPath(home);
  const compression = args.compression ?? createZstdCompression();
  const now = args.now ?? new Date();

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

  if (
    (report.status === 'restored' || report.status === 'already-present') &&
    report.provider !== undefined &&
    report.sessionId !== undefined
  ) {
    await recordSessionAccess({
      vaultPath,
      provider: report.provider,
      sessionId: report.sessionId,
      accessedAt: now,
    });
  }

  writeOpenOutput(report, restoreOnLaunchEnabled, args.json === true);
  process.exitCode = openExitCode(report);
};

const writeOpenOutput = (
  report: EnsureRestoredReport,
  restoreOnLaunchEnabled: boolean,
  json: boolean,
): void => {
  const payload = {
    ...report,
    command: 'open' as const,
    restoreOnLaunchEnabled,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const lines = [
    `open: ${report.status}`,
    report.provider === undefined ? undefined : `provider: ${report.provider}`,
    report.sessionId === undefined ? undefined : `session: ${report.sessionId}`,
    report.originalPath === undefined ? undefined : `originalPath: ${report.originalPath}`,
    report.reason === undefined ? undefined : `reason: ${report.reason}`,
  ].filter((line): line is string => line !== undefined);

  process.stdout.write(`${lines.join('\n')}\n`);
};

const openExitCode = (report: EnsureRestoredReport): number | undefined => {
  if (report.status === 'restored' || report.status === 'already-present') {
    return undefined;
  }

  if (
    report.status === 'conflict' ||
    report.status === 'missing-archive' ||
    report.status === 'ambiguous-selector' ||
    report.status === 'backup-only'
  ) {
    return 2;
  }

  return 1;
};
