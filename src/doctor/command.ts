import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defineCommand } from 'citty';
import type { CommandExit } from '@/command-outcome.js';

const execFileAsync = promisify(execFile);

type CommandCheck = {
  readonly available: boolean;
  readonly version?: string;
};

export type DoctorFlags = {
  readonly json?: boolean | undefined;
};

export const runDoctorCommand = async (flags: DoctorFlags): Promise<CommandExit> => {
  const zstd = await checkCommand('zstd', ['--version']);
  const sqlite3 = await checkCommand('sqlite3', ['--version']);

  const isStructuredRequested = flags.json === true;
  if (isStructuredRequested) {
    process.stdout.write(`${JSON.stringify({ sqlite3, zstd })}\n`);
    return { exitCode: 0 };
  }

  process.stdout.write(`zstd: ${zstd.available ? zstd.version : 'missing'}\n`);
  process.stdout.write(`sqlite3: ${sqlite3.available ? sqlite3.version : 'missing'}\n`);
  return { exitCode: 0 };
};

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

const checkCommand = async (
  command: string,
  versionArgumentList: ReadonlyArray<string>,
): Promise<CommandCheck> => {
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
};
