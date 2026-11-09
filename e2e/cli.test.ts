import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const REPO_ROOT = process.cwd();
const CLI_PATH = join(REPO_ROOT, 'src', 'cli', 'main.ts');
const TSX_PATH = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

describe('CLI read-only discovery and savings proof', () => {
  let workspace: string | undefined;

  afterEach(async () => {
    if (workspace !== undefined) {
      await rm(workspace, { recursive: true, force: true });
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

    const commandEnvironment = { ...process.env, HOME: home };
    const scanOutput = await execFileAsync(TSX_PATH, [CLI_PATH, 'scan', '--json'], {
      cwd: commandCwd,
      env: commandEnvironment,
    });
    const scanReport = JSON.parse(scanOutput.stdout) as {
      readonly sessions: ReadonlyArray<{ readonly provider: string }>;
    };

    expect(scanReport.sessions).toHaveLength(2);
    expect(scanReport.sessions.every((session) => session.provider === 'codex')).toBe(true);

    const savingsOutput = await execFileAsync(TSX_PATH, [CLI_PATH, 'check'], {
      cwd: commandCwd,
      env: commandEnvironment,
    });

    expect(savingsOutput.stdout).toContain('Discovered  Samples');
    expect(savingsOutput.stdout).toContain('Proof bytes are not a whole-store estimate.');
    expect(savingsOutput.stdout).toContain('codex');
    expect(savingsOutput.stdout).toContain('2');
    expect(savingsOutput.stdout).toContain('sample total');
    expect(await readFile(firstSessionPath, 'utf8')).toBe(firstSessionBytes);
    expect(await readFile(secondSessionPath, 'utf8')).toBe(secondSessionBytes);
  });
});
