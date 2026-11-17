import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defineCommand } from 'citty';
import type { CommandExit } from '@/command-outcome.js';

const execFileAsync = promisify(execFile);
const VERSION_ARGUMENT_LIST: ReadonlyArray<string> = ['--version'];

interface CommandCheck {
  readonly available: boolean;
  readonly version?: string;
}

export interface DoctorFlags {
  readonly json?: boolean | undefined;
}

export async function runDoctorCommand(flags: DoctorFlags): Promise<CommandExit> {
  const zstd = await checkCommand('zstd', VERSION_ARGUMENT_LIST);
  const sqlite3 = await checkCommand('sqlite3', VERSION_ARGUMENT_LIST);

  const isMachineOutputRequested = flags.json === true;
  if (isMachineOutputRequested) {
    process.stdout.write(`${JSON.stringify({ sqlite3, zstd })}\n`);
    return { exitCode: 0 };
  }

  process.stdout.write(`zstd: ${describeCommandVersion(zstd)}\n`);
  process.stdout.write(`sqlite3: ${describeCommandVersion(sqlite3)}\n`);
  return { exitCode: 0 };
}

export const doctorCommand = defineCommand({
  meta: {
    name: 'doctor',
    description: 'Check local prerequisites.',
  },
  args: {
    json: {
      type: 'boolean',
      description: 'Write stable JSON output.',
    },
  },
  run: async ({ args }) => {
    return runDoctorCommand({
      json: args.json,
    });
  },
});

function describeCommandVersion(commandCheck: CommandCheck): string | undefined {
  const isCommandMissing = !commandCheck.available;
  if (isCommandMissing) {
    return 'missing';
  }

  return commandCheck.version;
}

async function checkCommand(
  command: string,
  versionArgumentList: ReadonlyArray<string>,
): Promise<CommandCheck> {
  try {
    const printout = await execFileAsync(command, [...versionArgumentList]);

    return {
      available: true,
      version: printout.stdout.trim(),
    };
  } catch {
    return {
      available: false,
    };
  }
}
