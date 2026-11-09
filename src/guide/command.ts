import { defineCommand } from 'citty';
import type { CommandOutcome } from '@/command-outcome.js';
import { formatHumanAgentGuide, formatJsonAgentGuide } from './agent-guide-output.js';

/**
 * Arguments for the guide command.
 */
export interface GuideArgs {
  readonly json?: boolean;
}

/**
 * Writes the agent guide, as JSON when requested.
 */
export const runGuideCommand = async (args: GuideArgs): Promise<CommandOutcome> => {
  const isJsonRequested = args.json === true;

  if (isJsonRequested) {
    process.stdout.write(formatJsonAgentGuide());
    return { exitCode: 0 };
  }

  process.stdout.write(`${formatHumanAgentGuide()}\n`);
  return { exitCode: 0 };
};

/**
 * Citty command that shows safe commands for agents and automation.
 */
export const guideCommand = defineCommand({
  meta: {
    name: 'guide',
    description: 'Show safe commands for agents and automation.',
  },
  args: {
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    return runGuideCommand({
      json: args.json,
    });
  },
});
