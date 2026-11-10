import { defineCommand } from 'citty';
import type { CommandExit } from '@/command-outcome.js';
import { createHumanAgentGuide, createStructuredAgentGuide } from './agent-guide-output.js';

/**
 * Arguments for the guide command.
 */
export interface GuideFlags {
  readonly json?: boolean;
}

/**
 * Writes the agent guide, as JSON when requested.
 */
export const runGuideCommand = async (flags: GuideFlags): Promise<CommandExit> => {
  const isStructuredRequested = flags.json === true;

  if (isStructuredRequested) {
    process.stdout.write(createStructuredAgentGuide());
    return { exitCode: 0 };
  }

  process.stdout.write(`${createHumanAgentGuide()}\n`);
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
