import { fileURLToPath } from 'node:url';
import { defineCommand, runMain } from 'citty';
import {
  checkCommand,
  doctorCommand,
  guideCommand,
  initCommand,
  listCommand,
  packCommand,
  restoreCommand,
  savingsCommand,
  scanCommand,
  unpackCommand,
} from './commands/index.js';
import { runInteractiveCli, shouldRunInteractiveCli } from './interactiveCli.js';
import { normalizeCliArgv } from './mainArgs.js';
import { isCliEntrypoint } from './mainEntrypoint.js';

export const mainCommand = defineCommand({
  meta: {
    name: 'agent-session-pack',
    version: '0.1.0',
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
  process.argv.splice(0, process.argv.length, ...normalizeCliArgv(process.argv));

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
