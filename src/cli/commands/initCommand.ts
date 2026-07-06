import { intro, outro } from '@clack/prompts';
import { defineCommand } from 'citty';
import { runFirstSetup } from '../interactiveCli.js';

export const initCommand = defineCommand({
  meta: {
    name: 'init',
    description: 'Show default vault policy and dry-run setup.',
  },
  args: {
    apply: {
      type: 'boolean',
      description: 'Write config after review.',
    },
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    if (args.json === true) {
      process.stdout.write(
        `${JSON.stringify({
          vaultPath: '~/.agent-session-pack',
          coldAfter: '7d',
          restoreCacheAfter: '7d',
          lifecycle: 'manual-proof-only',
          plannedLifecycle: 'restore-on-launch-pack-on-close',
          apply: args.apply === true,
        })}\n`,
      );
      return;
    }

    if (process.stdin.isTTY === true && process.stdout.isTTY === true) {
      await runFirstSetup();
      return;
    }

    intro('Agent Session Pack init');
    process.stdout.write(
      'Defaults: vault ~/.agent-session-pack, coldAfter 7d, restoreCacheAfter 7d.\n',
    );
    process.stdout.write(
      'Lifecycle target: restore selected provider sessions on relaunch, then pack cold sessions after close.\n',
    );
    process.stdout.write(
      'Provider selection will be explicit before lifecycle hooks are written.\n',
    );
    process.stdout.write('Dry run only. Re-run with --apply to write config.\n');
    outro('No files changed.');
  },
});
