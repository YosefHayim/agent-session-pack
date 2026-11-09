import { defineCommand } from 'citty';
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
export const runGuideCommand = async (args: GuideArgs): Promise<void> => {
  const isJsonRequested = args.json === true;

  if (isJsonRequested) {
    process.stdout.write(formatJsonAgentGuide());
    return;
  }

  process.stdout.write(`${formatHumanAgentGuide()}\n`);
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
    await runGuideCommand({
      json: args.json,
    });
  },
});
