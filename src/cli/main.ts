import { fileURLToPath } from 'node:url';
import { defineCommand, runMain } from 'citty';
import { doctorCommand } from '../features/doctor/doctorCommand.js';
import { checkCommand, savingsCommand } from '../features/evidence/savingsCommand.js';
import { guideCommand } from '../features/guide/guideCommand.js';
import { lifecycleCommand } from '../features/lifecycle/lifecycleCommand.js';
import { maintainCommand } from '../features/lifecycle/maintainCommand.js';
import { preflightCommand } from '../features/lifecycle/preflightCommand.js';
import { watchCommand } from '../features/lifecycle/watchCommand.js';
import { packCommand } from '../features/pack/packCommand.js';
import { ensureRestoredCommand } from '../features/restore/ensureRestoredCommand.js';
import { openCommand } from '../features/restore/openCommand.js';
import { restoreCommand } from '../features/restore/restoreCommand.js';
import { unpackCommand } from '../features/restore/unpackCommand.js';
import { listCommand } from '../features/scan/listCommand.js';
import { scanCommand } from '../features/scan/scanCommand.js';
import { initCommand } from '../features/setup/initCommand.js';
import { runInteractiveCli, shouldRunInteractiveCli } from './interactiveCli.js';
import { rewriteCommandFlagAliases } from './mainArgs.js';
import { isCliEntrypoint } from './mainEntrypoint.js';

/**
 * Root citty command that wires all Agent Session Pack subcommands.
 */
export const mainCommand = defineCommand({
  meta: {
    name: 'agent-session-pack',
    version: '0.3.0',
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
