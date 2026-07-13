import { defineCommand } from 'citty';
import { Effect, Schema } from 'effect';
import { formatHumanAgentGuide, formatJsonAgentGuide } from '../../output/index.js';

/**
 * Schema describing the guide command arguments.
 */
export const GuideArgsSchema = Schema.Struct({
  json: Schema.optional(Schema.Boolean),
});

/**
 * Decoded arguments for the guide command.
 */
export type GuideArgs = typeof GuideArgsSchema.Type;

/**
 * Runs the agent guide command.
 *
 * @param args - Decoded command-line arguments.
 * @returns Effect that writes guide output.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { runGuideCommand } from './commands/guideCommand.js';
 *
 * await Effect.runPromise(runGuideCommand({ json: true }));
 * ```
 */
export const runGuideCommand = (args: GuideArgs): Effect.Effect<void> =>
  Effect.sync(() => {
    if (args.json === true) {
      process.stdout.write(formatJsonAgentGuide());
      return;
    }

    process.stdout.write(`${formatHumanAgentGuide()}\n`);
  });

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
    await Effect.runPromise(
      runGuideCommand({
        json: args.json,
      }),
    );
  },
});
