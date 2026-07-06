import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defineCommand } from 'citty';

const execFileAsync = promisify(execFile);

type CommandCheck = {
  readonly available: boolean;
  readonly version?: string;
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
    const zstd = await checkCommand('zstd', ['--version']);
    const sqlite3 = await checkCommand('sqlite3', ['--version']);

    if (args.json === true) {
      process.stdout.write(`${JSON.stringify({ sqlite3, zstd })}\n`);
      return;
    }

    process.stdout.write(`zstd: ${zstd.available ? zstd.version : 'missing'}\n`);
    process.stdout.write(`sqlite3: ${sqlite3.available ? sqlite3.version : 'missing'}\n`);
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
