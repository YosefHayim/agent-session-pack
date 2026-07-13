import { defineCommand } from 'citty';

/**
 * Citty command that lists indexed sessions with date, status, and path.
 */
export const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List indexed sessions with date, status, and path.',
  },
  args: {
    provider: {
      type: 'string',
      description: 'Provider id: codex, claude, kiro, cursor, or devin.',
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: () => {
    process.stdout.write('No indexed sessions yet. Run agent-session-pack scan first.\n');
  },
});
