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

  if (home === undefined) {
    return { exitCode: 1 };
  }

  const sessionSelector = args.session?.trim() ?? '';

  if (sessionSelector.length === 0) {
    process.stderr.write(
      'Missing session selector. Use agent-session-pack ensure-restored [--provider codex] <session>.\n',
    );
    return { exitCode: 2 };
  }

  const provider = parseOptionalProvider(args.provider);

  if (args.provider !== undefined && provider === undefined) {
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

  const lines = [
    `ensure-restored: ${report.status}`,
    report.provider === undefined ? undefined : `provider: ${report.provider}`,
    report.sessionId === undefined ? undefined : `session: ${report.sessionId}`,
    report.originalPath === undefined ? undefined : `originalPath: ${report.originalPath}`,
    report.reason === undefined ? undefined : `reason: ${report.reason}`,
    `restoreOnLaunchEnabled: ${String(report.restoreOnLaunchEnabled)}`,
  ].filter((line): line is string => line !== undefined);

  process.stdout.write(`${lines.join('\n')}\n`);
};

const ensureRestoredExitCode = (report: EnsureRestoredReport): number => {
  if (report.status === 'restored' || report.status === 'already-present') {
    return 0;
  }

  if (report.status === 'lifecycle-disabled') {
    return 1;
  }

  if (
    report.status === 'conflict' ||
    report.status === 'missing-archive' ||
    report.status === 'ambiguous-selector'
  ) {
    return 2;
  }

  if (report.status === 'backup-only') {
    return 2;
  }

  return 1;
};
