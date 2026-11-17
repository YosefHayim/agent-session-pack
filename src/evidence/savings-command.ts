import { join } from 'node:path';
import { defineCommand } from 'citty';
import type { CommandExit } from '@/command-outcome.js';
import { requireHome } from '@/environment.js';
import { selectProviders } from '@/providers/flag.js';
import { runLocalEvidence } from './local-evidence.js';
import { createHumanEvidenceReport, createStructuredEvidenceReport } from './output.js';

const UNKNOWN_PROVIDER_EXIT_CODE = 2;
const PROVIDER_FLAG_DESCRIPTION =
  'Provider id: codex, claude, kiro, grok, kimi, opencode, gemini, cursor, or devin.';
const JSON_FLAG_DESCRIPTION = 'Write stable JSON output.';

export interface SavingsFlags {
  readonly provider?: string;
  readonly json?: boolean;
}

export async function runSavingsCommand(flags: SavingsFlags): Promise<CommandExit> {
  const home = requireHome();

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const { providers, isProviderUnknown } = selectProviders(flags.provider);
  const providerExitCode = isProviderUnknown ? UNKNOWN_PROVIDER_EXIT_CODE : 0;
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
}

async function runSavingsFromArgs({ args }: { readonly args: SavingsFlags }): Promise<CommandExit> {
  return runSavingsCommand({
    provider: args.provider,
    json: args.json,
  });
}

export const savingsCommand = defineCommand({
  meta: {
    name: 'savings',
    description: 'Show copy-only local before/after compression proof.',
  },
  args: {
    provider: {
      type: 'string',
      description: PROVIDER_FLAG_DESCRIPTION,
      valueHint: 'provider',
    },
    json: {
      type: 'boolean',
      description: JSON_FLAG_DESCRIPTION,
    },
  },
  run: runSavingsFromArgs,
});

export const checkCommand = defineCommand({
  meta: {
    name: 'check',
    description: 'Run the no-install local savings proof.',
  },
  args: {
    provider: {
      type: 'string',
      description: PROVIDER_FLAG_DESCRIPTION,
      valueHint: 'provider',
    },
    json: {
      type: 'boolean',
      description: JSON_FLAG_DESCRIPTION,
    },
  },
  run: runSavingsFromArgs,
});

export function createEvidenceWorkRoot(cwd: string, runId: string): string {
  return join(cwd, '.vault-test', 'evidence-local', runId);
}
