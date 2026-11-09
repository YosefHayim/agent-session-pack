import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defineCommand } from 'citty';
import type { CommandOutcome } from '@/command-outcome.js';

const execFileAsync = promisify(execFile);

type CommandCheck = {
  readonly available: boolean;
  readonly version?: string;
};

/**
 * Arguments for the doctor prerequisite command.
 */
export type DoctorArgs = {
  readonly json?: boolean | undefined;
};

/**
 * Runs local prerequisite checks.
 *
 * @param args - Output mode.
 * @returns Promise that resolves after output is written.
 * @example
 * ```ts
 * import { runDoctorCommand } from './command.js';
 *
 * await runDoctorCommand({ json: true });
 * ```
 */
export const runDoctorCommand = async (args: DoctorArgs): Promise<CommandOutcome> => {
  const zstd = await checkCommand('zstd', ['--version']);
  const sqlite3 = await checkCommand('sqlite3', ['--version']);

  const isJsonOutput = args.json === true;
  if (isJsonOutput) {
    process.stdout.write(`${JSON.stringify({ sqlite3, zstd })}\n`);
    return { exitCode: 0 };
  }

  process.stdout.write(`zstd: ${zstd.available ? zstd.version : 'missing'}\n`);
  process.stdout.write(`sqlite3: ${sqlite3.available ? sqlite3.version : 'missing'}\n`);
  return { exitCode: 0 };
};

/**
 * Citty command that checks local prerequisites.
 */
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
  versionArgs: ReadonlyArray<string>,
): Promise<CommandCheck> => {
  try {
    const output = await execFileAsync(command, [...versionArgs]);

    return {
      available: true,
      version: output.stdout.trim(),
    };
  } catch {
    return {
      available: false,
    };
  }
};
