import { type ExecFileException, execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const CLI_PATH = join(REPO_ROOT, 'src', 'cli.ts');
const TSCONFIG_PATH = join(REPO_ROOT, 'tsconfig.json');
const TSX_PATH = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

interface CommandPrintout {
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(
  argumentList: ReadonlyArray<string>,
  cwd: string,
  commandEnvironment?: NodeJS.ProcessEnv,
): Promise<CommandPrintout> {
  const commandArguments = ['--tsconfig', TSCONFIG_PATH, CLI_PATH, ...argumentList];

  function runCommand(
    succeed: (printout: CommandPrintout) => void,
    fail: (error: ExecFileException) => void,
  ): void {
    function finishCommand(error: ExecFileException | null, stdout: string, stderr: string): void {
      if (error != null) {
        fail(error);
        return;
      }

      succeed({ stdout, stderr });
    }

    execFile(
      TSX_PATH,
      commandArguments,
      { cwd, encoding: 'utf8', env: commandEnvironment },
      finishCommand,
    );
  }

  return new Promise(runCommand);
}

describe('CLI read-only discovery and savings proof', () => {
  let workspace: string | undefined;

  afterEach(async () => {
    const createdWorkspace = workspace;
    if (createdWorkspace != null) {
      await rm(createdWorkspace, { recursive: true, force: true });
    }
  });

  it('skips absent providers and labels sampled savings without touching originals', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-session-pack-cli-integration-'));
    const home = join(workspace, 'home');
    const commandCwd = join(workspace, 'command');
    const sessionDirectory = join(home, '.codex', 'sessions', '2026', '08', '23');
    const firstSessionPath = join(sessionDirectory, 'first.jsonl');
    const secondSessionPath = join(sessionDirectory, 'second.jsonl');
    const firstSessionBytes = `${'{"type":"user","text":"first proof session"}\n'.repeat(50)}`;
    const secondSessionBytes = `${'{"type":"user","text":"second proof session"}\n'.repeat(50)}`;

    await mkdir(sessionDirectory, { recursive: true });
    await mkdir(commandCwd, { recursive: true });
    await writeFile(firstSessionPath, firstSessionBytes);
    await writeFile(secondSessionPath, secondSessionBytes);

    const commandEnvironment = {
      ...process.env,
      // biome-ignore lint/style/useNamingConvention: this is the environment variable name
      HOME: home,
    };
    const { stdout: scanStdout } = await runCli(['scan', '--json'], commandCwd, commandEnvironment);
    const scanReport = JSON.parse(scanStdout) as {
      readonly sessions: ReadonlyArray<{ readonly provider: string }>;
    };

    expect(scanReport.sessions).toHaveLength(2);
    function isCodexSession(session: { readonly provider: string }): boolean {
      return session.provider == 'codex';
    }

    expect(scanReport.sessions.every(isCodexSession)).toBe(true);

    const { stdout: savingsStdout } = await runCli(['check'], commandCwd, commandEnvironment);

    expect(savingsStdout).toContain('Discovered  Samples');
    expect(savingsStdout).toContain('Proof bytes are not a whole-store estimate.');
    expect(savingsStdout).toContain('codex');
    expect(savingsStdout).toContain('2');
    expect(savingsStdout).toContain('sample total');
    expect(await readFile(firstSessionPath, 'utf8')).toBe(firstSessionBytes);
    expect(await readFile(secondSessionPath, 'utf8')).toBe(secondSessionBytes);
  });
});

describe('CLI exit codes', () => {
  it('exits 0 when a subcommand succeeds', async () => {
    const { stdout: guideStdout } = await runCli(['guide', '--json'], REPO_ROOT);
    const guideReport = JSON.parse(guideStdout) as { readonly mode: string };

    expect(guideReport.mode).toBe('agent-guide');
  });

  it('exits 2 for an unknown command', async () => {
    await expect(runCli(['no-such-command'], REPO_ROOT)).rejects.toMatchObject({ code: 2 });
  });
});
