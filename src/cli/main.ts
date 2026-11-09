import { fileURLToPath } from 'node:url';
import { defineCommand, runMain } from 'citty';
import packageJson from '../../package.json' with { type: 'json' };
import { doctorCommand } from '../features/doctor/command.js';
import { checkCommand, savingsCommand } from '../features/evidence/savings-command.js';
import { guideCommand } from '../features/guide/command.js';
import { lifecycleCommand } from '../features/lifecycle/command.js';
import { maintainCommand } from '../features/lifecycle/maintain-command.js';
import { preflightCommand } from '../features/lifecycle/preflight-command.js';
import { watchCommand } from '../features/lifecycle/watch-command.js';
import { packCommand } from '../features/pack/command.js';
import { restoreCommand } from '../features/restore/command.js';
import { ensureRestoredCommand } from '../features/restore/ensure-restored-command.js';
import { openCommand } from '../features/restore/open-command.js';
import { unpackCommand } from '../features/restore/unpack-command.js';
import { scanCommand } from '../features/scan/command.js';
import { listCommand } from '../features/scan/list-command.js';
import { initCommand } from '../features/setup/init-command.js';
import { runInteractiveCli, shouldRunInteractiveCli } from './interactive-cli.js';
import { rewriteCommandFlagAliases } from './main-args.js';
import { isCliEntrypoint } from './main-entrypoint.js';

/**
 * Root citty command that wires all Agent Session Pack subcommands.
 */
export const mainCommand = defineCommand({
  meta: {
    name: 'agent-session-pack',
    version: packageJson.version,
    description:
      'Pack cold local AI coding-agent sessions with byte-exact restore. Run guide for agent-safe commands.',
  },
  subCommands: {
    check: checkCommand,
    guide: guideCommand,
    init: initCommand,
    scan: scanCommand,
    pack: packCommand,
    unpack: unpackCommand,
    list: listCommand,
    restore: restoreCommand,
    open: openCommand,
    preflight: preflightCommand,
    watch: watchCommand,
    maintain: maintainCommand,
    'ensure-restored': ensureRestoredCommand,
    lifecycle: lifecycleCommand,
    savings: savingsCommand,
    doctor: doctorCommand,
  },
  default: 'scan',
});

const entrypointPath = process.argv[1];
const modulePath = fileURLToPath(import.meta.url);

if (isCliEntrypoint(entrypointPath, modulePath)) {
  process.argv.splice(0, process.argv.length, ...rewriteCommandFlagAliases(process.argv));

  if (
    shouldRunInteractiveCli({
      argv: process.argv,
      stdinIsTty: process.stdin.isTTY === true,
      stdoutIsTty: process.stdout.isTTY === true,
    })
  ) {
    await runInteractiveCli();
  } else {
    await runMain(mainCommand);
  }
}
