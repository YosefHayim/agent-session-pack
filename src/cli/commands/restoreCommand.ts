import { defineCommand } from 'citty';

export const restoreCommand = defineCommand({
  meta: {
    name: 'restore',
    description: 'Restore a packed session by id, name, slug, or picker.',
  },
  args: {
    selector: {
      type: 'positional',
      description: 'Session id, exact name, slug, fuzzy query, or provider-prefixed selector.',
    },
    to: {
      type: 'string',
      description: 'Restore destination: original or a custom path.',
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: ({ args }) => {
    if (args.selector === undefined) {
      process.stderr.write('Missing selector. Use agent-session-pack restore <selector>.\n');
      process.exitCode = 2;
      return;
    }

    process.stdout.write(`restore is scaffolded for selector: ${args.selector}\n`);
  },
});
