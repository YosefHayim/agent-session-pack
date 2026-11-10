import { defineCommand } from 'citty';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/home-env.js';
import { selectProviders } from '@/providers/flag.js';
import { runLocalEvidence } from './local-evidence.js';
import { createHumanEvidenceReport, createStructuredEvidenceReport } from './output.js';
import { createEvidenceWorkRoot } from './work-root.js';

export interface SavingsFlags {
  readonly provider?: string;
  readonly json?: boolean;
}

export const runSavingsCommand = async (flags: SavingsFlags): Promise<CommandExit> => {
  const home = requireHome();

  const isHomeMissing = home == null;

  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const { providers, isProviderUnknown } = selectProviders(flags.provider);
  const providerExitCode = isProviderUnknown ? 2 : 0;
  const report = await runLocalEvidence({
    home,
    workRoot: createEvidenceWorkRoot(process.cwd(), String(process.pid)),
    providers,
  });

  const isMachineOutputRequested = flags.json === true;

  if (isMachineOutputRequested) {
    process.stdout.write(createStructuredEvidenceReport(report));
    return { exitCode: providerExitCode };
  }

  process.stdout.write(`${createHumanEvidenceReport(report)}\n`);
  return { exitCode: providerExitCode };
};

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
