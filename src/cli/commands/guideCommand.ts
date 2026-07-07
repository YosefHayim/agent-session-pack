import { defineCommand } from 'citty';
import { Effect, Schema } from 'effect';
import { formatHumanAgentGuide, formatJsonAgentGuide } from '../../output/index.js';

export const GuideArgsSchema = Schema.Struct({
  json: Schema.optional(Schema.Boolean),
});

export type GuideArgs = typeof GuideArgsSchema.Type;

/**
 * Runs the agent guide command.
 *
 * @param args - Decoded command-line arguments.
 * @returns Effect that writes guide output.
 */
export const runGuideCommand = (args: GuideArgs): Effect.Effect<void> =>
  Effect.sync(() => {
    if (args.json === true) {
      process.stdout.write(formatJsonAgentGuide());
      return;
    }

    process.stdout.write(`${formatHumanAgentGuide()}\n`);
  });

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
    await Effect.runPromise(
      runGuideCommand({
        json: args.json,
      }),
    );
  },
});
