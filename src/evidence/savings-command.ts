import { defineCommand } from 'citty';
import { requireHome } from '@/home-env.js';
import { selectProviders } from '@/providers/flag.js';
import { runLocalEvidence } from './local-evidence.js';
import { formatHumanEvidenceReport, formatJsonEvidenceReport } from './output.js';
import { resolveEvidenceWorkRoot } from './work-root.js';

/**
 * Arguments for the savings command.
 */
export interface SavingsArgs {
  readonly provider?: string;
  readonly json?: boolean;
}

/**
 * Runs copy-only local savings proof against provider sessions and writes the report.
 */
export const runSavingsCommand = async (args: SavingsArgs): Promise<void> => {
  const home = requireHome();
  const isHomeMissing = home === undefined;

  if (isHomeMissing) {
    return;
  }

  const providers = selectProviders(args.provider);
  const report = await runLocalEvidence({
    home,
    workRoot: resolveEvidenceWorkRoot(process.cwd(), String(process.pid)),
    providers,
  });
  const isJsonRequested = args.json === true;

  if (isJsonRequested) {
    process.stdout.write(formatJsonEvidenceReport(report));
    return;
  }

  process.stdout.write(`${formatHumanEvidenceReport(report)}\n`);
};

/**
 * Citty command that shows copy-only local before/after compression proof.
 */
export const savingsCommand = defineCommand({
  meta: {
    name: 'savings',
    description: 'Show copy-only local before/after compression proof.',
  },
  args: {
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
      valueHint: 'provider',
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    await runSavingsCommand({
      provider: args.provider,
      json: args.json,
    });
  },
});

/**
 * Citty command that runs the no-install local savings proof.
 */
export const checkCommand = defineCommand({
  meta: {
    name: 'check',
    description: 'Run the no-install local savings proof.',
  },
  args: {
    provider: {
      type: 'string',
      description:
        'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.',
      valueHint: 'provider',
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    await runSavingsCommand({
      provider: args.provider,
      json: args.json,
    });
  },
});
