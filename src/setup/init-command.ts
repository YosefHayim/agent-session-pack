import { intro, outro } from '@clack/prompts';
import { defineCommand } from 'citty';
import type { CommandExit } from '@/command-outcome.js';
import { DEFAULT_COLD_AFTER } from '@/pack/plan.js';
import { runFirstSetup } from './first-setup-flow.js';

const DEFAULT_VAULT_PATH = '~/.agent-session-pack';
const DEFAULT_RESTORE_CACHE_AFTER = '7d';

interface InitFlags {
  readonly apply?: boolean;
  readonly json?: boolean;
}

async function runInitCommand({ args }: { readonly args: InitFlags }): Promise<CommandExit> {
  const isMachineOutputRequested = args.json === true;
  if (isMachineOutputRequested) {
    process.stdout.write(
      `${JSON.stringify({
        vaultPath: DEFAULT_VAULT_PATH,
        coldAfter: DEFAULT_COLD_AFTER,
        restoreCacheAfter: DEFAULT_RESTORE_CACHE_AFTER,
        lifecycle: 'manual-proof-only',
        plannedLifecycle: 'restore-on-launch-pack-on-close',
        apply: args.apply === true,
      })}\n`,
    );
    return { exitCode: 0 };
  }

  const isInteractiveTerminal = process.stdin.isTTY === true && process.stdout.isTTY === true;
  if (isInteractiveTerminal) {
    await runFirstSetup();
    return { exitCode: 0 };
  }

  intro('Agent Session Pack init');
  process.stdout.write(
    'Defaults: vault ~/.agent-session-pack, coldAfter 7d, restoreCacheAfter 7d.\n',
  );
  process.stdout.write(
    'Lifecycle target: restore selected provider sessions on relaunch, then pack cold sessions after close.\n',
  );
  process.stdout.write('Provider selection will be explicit before lifecycle hooks are written.\n');
  process.stdout.write('Dry run only. Re-run with --apply to write config.\n');
  outro('No files changed.');
  return { exitCode: 0 };
}

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
  run: runInitCommand,
});
