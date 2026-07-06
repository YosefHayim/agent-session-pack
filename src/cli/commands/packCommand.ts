import { defineCommand } from 'citty';

export const packCommand = defineCommand({
  meta: {
    name: 'pack',
    description: 'Pack cold sessions after verified archive restore.',
  },
  args: {
    provider: {
      type: 'string',
      description: 'Provider id: codex, claude, kiro, cursor, or devin.',
    },
    'older-than': {
      type: 'string',
      description: 'Cold threshold such as 7d, 2w, 30d, or 12h.',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Preview changes without removing originals.',
    },
    apply: {
      type: 'boolean',
      description: 'Apply archive/remove workflow after verification.',
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: () => {
    process.stdout.write('pack is scaffolded; archive workflow is implemented in core.\n');
  },
});
