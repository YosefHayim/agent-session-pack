import { fileURLToPath } from 'node:url';
import { defineCommand, runMain } from 'citty';
import { doctorCommand } from './commands/doctorCommand.js';
import { guideCommand } from './commands/guideCommand.js';
import { initCommand } from './commands/initCommand.js';
import { listCommand } from './commands/listCommand.js';
import { packCommand } from './commands/packCommand.js';
import { restoreCommand } from './commands/restoreCommand.js';
import { checkCommand, savingsCommand } from './commands/savingsCommand.js';
import { scanCommand } from './commands/scanCommand.js';
import { unpackCommand } from './commands/unpackCommand.js';
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
