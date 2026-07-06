import { fileURLToPath } from 'node:url';
import { defineCommand, runMain } from 'citty';
import {
  doctorCommand,
  initCommand,
  listCommand,
  packCommand,
  restoreCommand,
  scanCommand,
} from './commands/index.js';
import { normalizeCliArgv } from './mainArgs.js';

export const mainCommand = defineCommand({
  meta: {
    name: 'agent-recall',
    version: '0.1.0',
    description: 'Compress cold local AI coding-agent sessions with byte-exact restore.',
  },
  subCommands: {
    init: initCommand,
    scan: scanCommand,
    pack: packCommand,
    list: listCommand,
    restore: restoreCommand,
    doctor: doctorCommand,
  },
  default: 'scan',
});

const entrypointPath = process.argv[1];
const modulePath = fileURLToPath(import.meta.url);

if (entrypointPath === modulePath) {
  process.argv.splice(0, process.argv.length, ...normalizeCliArgv(process.argv));
  await runMain(mainCommand);
}
