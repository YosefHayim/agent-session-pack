import { defineCommand } from 'citty';
import type { CommandOutcome } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { selectProviders } from '@/providers/flag.js';
import { runLocalEvidence } from './local-evidence.js';
import { createHumanEvidenceReport, createJsonEvidenceReport } from './output.js';
import { createEvidenceWorkRoot } from './work-root.js';

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
export const runSavingsCommand = async (args: SavingsArgs): Promise<CommandOutcome> => {
  const home = requireHome();

  const isHomeMissing = home == null;

  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const { providers, isProviderUnknown } = selectProviders(args.provider);
  const providerExitCode = isProviderUnknown ? 2 : 0;
  const report = await runLocalEvidence({
    home,
    workRoot: createEvidenceWorkRoot(process.cwd(), String(process.pid)),
    providers,
  });

  const isJsonRequested = args.json === true;

  if (isJsonRequested) {
    process.stdout.write(createJsonEvidenceReport(report));
    return { exitCode: providerExitCode };
  }

  process.stdout.write(`${createHumanEvidenceReport(report)}\n`);
  return { exitCode: providerExitCode };
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
    return runSavingsCommand({
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
    return runSavingsCommand({
      provider: args.provider,
      json: args.json,
    });
  },
});
