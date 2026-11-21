import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canRunInteractiveCli,
  createCommandUsage,
  createHumanAgentGuide,
  createMainMenuChoices,
  createStructuredAgentGuide,
  isCliEntrypoint,
  readCliInvocation,
  readPackageVersion,
  rewriteCommandFlagAliases,
  runDoctorCommand,
  runGuideCommand,
  runNamedCommand,
} from './cli.js';
import type { PromptAdapter, PromptOption } from './prompts.js';
import type { ProviderAdapter } from './providers.js';
import { runFirstSetup } from './setup.js';

describe('readCliInvocation', () => {
  it('fills the invocation from known flags', () => {
    const cliRead = readCliInvocation([
      'pack',
      '--provider',
      'codex',
      '--older-than',
      '7d',
      '--dry-run',
      '--all-providers',
      '--max',
      '--apply',
      '--yes',
      '--json',
      '--to',
      'original',
      '--poll-ms',
      '500',
      'session-id',
    ]);

    expect(cliRead).toEqual({
      status: 'ok',
      invocation: {
        commandName: 'pack',
        apply: true,
        yes: true,
        json: true,
        dryRun: true,
        allProviders: true,
        max: true,
        provider: 'codex',
        olderThan: '7d',
        to: 'original',
        pollMs: '500',
        positionals: ['session-id'],
        execArgv: [],
      },
    });
  });

  it('returns bad usage for an unknown flag', () => {
    const cliRead = readCliInvocation(['scan', '--not-a-flag']);

    expect(cliRead.status).toBe('bad-usage');
  });

  it('runs scan when there is no command word', () => {
    const cliRead = readCliInvocation(['--json']);

    expect(cliRead).toMatchObject({
      status: 'ok',
      invocation: { commandName: 'scan', json: true },
    });
  });

  it('returns help that includes the package version', () => {
    const cliRead = readCliInvocation(['--help']);
    const usage = createCommandUsage(null);
    const scanIndex = usage.indexOf('\n  scan');
    const packIndex = usage.indexOf('\n  pack');
    const restoreIndex = usage.indexOf('\n  restore');
    const guideIndex = usage.indexOf('\n  guide');

    expect(cliRead).toEqual({ status: 'help', commandName: null });
    expect(usage).toContain(readPackageVersion());
    expect(scanIndex).toBeGreaterThan(-1);
    expect(scanIndex).toBeLessThan(packIndex);
    expect(packIndex).toBeLessThan(restoreIndex);
    expect(restoreIndex).toBeLessThan(guideIndex);
  });

  it('returns unknown-command for an unknown word', () => {
    const cliRead = readCliInvocation(['no-such-command']);

    expect(cliRead).toEqual({
      status: 'unknown-command',
      commandName: 'no-such-command',
    });
  });

  it('keeps arguments after -- as the program to run', () => {
    const cliRead = readCliInvocation(['watch', '--provider', 'codex', '--', '/bin/app', '--help']);

    expect(cliRead).toMatchObject({
      status: 'ok',
      invocation: {
        commandName: 'watch',
        provider: 'codex',
        execArgv: ['/bin/app', '--help'],
      },
    });
  });
});

describe('rewriteCommandFlagAliases', () => {
  it('rewrites supported command flag aliases into subcommands', () => {
    expect(rewriteCommandFlagAliases(['node', 'main.js', '--check'])).toEqual([
      'node',
      'main.js',
      'check',
    ]);
    expect(rewriteCommandFlagAliases(['node', 'main.js', '--doctor'])).toEqual([
      'node',
      'main.js',
      'doctor',
    ]);
    expect(rewriteCommandFlagAliases(['node', 'main.js', '--scan', '--provider', 'devin'])).toEqual(
      ['node', 'main.js', 'scan', '--provider', 'devin'],
    );
    expect(rewriteCommandFlagAliases(['node', 'main.js', '--savings'])).toEqual([
      'node',
      'main.js',
      'savings',
    ]);
    expect(rewriteCommandFlagAliases(['node', 'main.js', '--guide'])).toEqual([
      'node',
      'main.js',
      'guide',
    ]);
    expect(rewriteCommandFlagAliases(['node', 'main.js', '--unpack', '--all-providers'])).toEqual([
      'node',
      'main.js',
      'unpack',
      '--all-providers',
    ]);
  });

  it('strips a bare -- separator before the first command', () => {
    expect(rewriteCommandFlagAliases(['node', 'main.js', '--', 'doctor'])).toEqual([
      'node',
      'main.js',
      'doctor',
    ]);
  });
});

interface PackageManifest {
  readonly version: string;
}

async function readPackageManifest(): Promise<PackageManifest> {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const packagePath = join(testDirectory, '..', 'package.json');
  const packageManifest = JSON.parse(await readFile(packagePath, 'utf8')) as PackageManifest;

  return packageManifest;
}

describe('main command metadata', () => {
  it('uses the package version in CLI help output', async () => {
    const packageManifest = await readPackageManifest();

    expect(createCommandUsage(null)).toContain(packageManifest.version);
  });
});

describe('CLI entrypoint detection', () => {
  it('accepts npm bin symlinks that resolve to the built module path', () => {
    function realpath(path: string): string {
      if (path == '/prefix/bin/agent-session-pack') {
        return '/package/dist/cli/main.js';
      }

      return path;
    }

    expect(
      isCliEntrypoint('/prefix/bin/agent-session-pack', '/package/dist/cli/main.js', realpath),
    ).toBe(true);
  });
});

function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-interactive-'));
}

type RecordingPromptAdapter = PromptAdapter & {
  readonly confirms: unknown[];
  readonly multiselects: Array<{
    readonly message: string;
    readonly options: ReadonlyArray<PromptOption<string>>;
  }>;
  readonly outros: string[];
  readonly selects: Array<{
    readonly message: string;
    readonly options: ReadonlyArray<PromptOption<string>>;
  }>;
  readonly spinnerEvents: string[];
  readonly texts: unknown[];
};

function createPromptAdapter(answers: ReadonlyArray<unknown>): RecordingPromptAdapter {
  const queue = [...answers];
  const adapter: RecordingPromptAdapter = {
    confirms: [],
    multiselects: [],
    outros: [],
    selects: [],
    spinnerEvents: [],
    texts: [],
    cancel: () => undefined,
    confirm: async (question) => {
      adapter.confirms.push(question);
      return queue.shift() as boolean;
    },
    intro: () => undefined,
    isCancel: (answer: unknown): answer is symbol =>
      typeof answer == 'symbol' && answer.description == 'cancel',
    multiselect: async (question) => {
      adapter.multiselects.push(question);
      return queue.shift() as ReadonlyArray<string> as never;
    },
    note: () => undefined,
    outro: (message) => adapter.outros.push(message ?? ''),
    select: async (question) => {
      adapter.selects.push(question);
      return queue.shift() as never;
    },
    spinner: () => ({
      cancel: (message?: string) => adapter.spinnerEvents.push(`cancel:${message ?? ''}`),
      clear: () => adapter.spinnerEvents.push('clear'),
      error: (message?: string) => adapter.spinnerEvents.push(`error:${message ?? ''}`),
      isCancelled: false,
      message: (message?: string) => adapter.spinnerEvents.push(`message:${message ?? ''}`),
      start: (message?: string) => adapter.spinnerEvents.push(`start:${message ?? ''}`),
      stop: (message?: string) => adapter.spinnerEvents.push(`stop:${message ?? ''}`),
    }),
    text: async (question) => {
      adapter.texts.push(question);
      return queue.shift() as string;
    },
  };

  return adapter;
}

function createProvider(root: string): ProviderAdapter {
  return {
    id: 'codex',
    label: 'Codex',
    mode: 'archive',
    defaultRoots: () => [root],
    discover: () =>
      Promise.resolve([
        {
          id: 'codex-session',
          provider: 'codex',
          title: 'Codex session',
          slug: 'codex-session',
          originalPath: join(root, 'session.jsonl'),
          modifiedAt: new Date('2026-06-01T12:00:00.000Z'),
          sizeBytes: 10_000,
        },
      ]),
  };
}

describe('interactive CLI flow', () => {
  it('runs only for bare TTY invocations', () => {
    expect(
      canRunInteractiveCli({
        argv: ['node', 'main.js'],
        stdinIsTty: true,
        stdoutIsTty: true,
      }),
    ).toBe(true);
    expect(
      canRunInteractiveCli({
        argv: ['node', 'main.js', 'scan'],
        stdinIsTty: true,
        stdoutIsTty: true,
      }),
    ).toBe(false);
    expect(
      canRunInteractiveCli({
        argv: ['node', 'main.js'],
        stdinIsTty: false,
        stdoutIsTty: true,
      }),
    ).toBe(false);
  });

  it('renders main menu options with explanatory hints', () => {
    expect(createMainMenuChoices()).toEqual([
      {
        value: 'setup',
        label: 'First setup',
        hint: 'choose providers, vault path, cold threshold, and safety defaults',
      },
      {
        value: 'savings',
        label: 'Check savings',
        hint: 'copy-only proof; shows what you could save without touching sessions',
      },
      {
        value: 'review',
        label: 'Review sessions',
        hint: 'scan all providers; show dates, paths, size, cold/active status',
      },
      {
        value: 'pack',
        label: 'Pack cold sessions',
        hint: 'dry-run first; apply only after verified archive + confirmation',
      },
      {
        value: 'restore',
        label: 'Restore sessions',
        hint: 'unpack archived sessions back to native provider paths',
      },
      {
        value: 'doctor',
        label: 'Doctor',
        hint: 'check zstd, sqlite, provider roots, vault health, and config',
      },
      {
        value: 'exit',
        label: 'Exit',
        hint: 'leave without changing files',
      },
    ]);
  });

  it('uses provider multi-select and spinner-backed scanning during setup', async () => {
    const home = await createWorkspace();
    const root = join(home, '.codex', 'sessions');
    const prompts = createPromptAdapter([['codex'], '7d', 'default', true]);
    await mkdir(root, { recursive: true });

    await runFirstSetup({
      home,
      now: new Date('2026-07-07T00:00:00.000Z'),
      olderThanMs: 7 * 24 * 60 * 60 * 1000,
      prompts,
      providers: [createProvider(root)],
    });

    expect(prompts.spinnerEvents).toContain('start:Scanning provider stores...');
    expect(prompts.spinnerEvents).toContain('stop:Scanned provider stores.');
    expect(prompts.multiselects[0]).toMatchObject({
      message: 'Which providers should Agent Session Pack manage?',
    });
    expect(prompts.multiselects[0]?.options[0]).toMatchObject({
      value: 'codex',
      label: 'codex',
      hint: 'archive old JSONL sessions; restore byte-exact when needed',
    });
    expect(prompts.outros[0]).toContain('Local repo:     pnpm dev');
    expect(prompts.outros[0]).toContain('One-off npm:    npx --yes agent-session-pack');
    expect(prompts.outros[0]).toContain('Installed CLI:  agent-session-pack');
    await expect(
      readFile(join(home, '.agent-session-pack', 'config.json'), 'utf8'),
    ).resolves.toContain('"providers": [');
  });

  it('validates and writes a custom vault path during setup', async () => {
    const home = await createWorkspace();
    const root = join(home, '.codex', 'sessions');
    const vaultPath = join(home, 'session-vault');
    const prompts = createPromptAdapter([['codex'], '7d', 'custom', vaultPath, true]);
    await mkdir(root, { recursive: true });

    await runFirstSetup({
      home,
      now: new Date('2026-07-07T00:00:00.000Z'),
      olderThanMs: 7 * 24 * 60 * 60 * 1000,
      prompts,
      providers: [createProvider(root)],
    });

    await expect(
      readFile(join(home, '.agent-session-pack', 'config.json'), 'utf8'),
    ).resolves.toContain(`"vaultPath": "${vaultPath}"`);
  });
});

describe('runNamedCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not ask a question when pack apply is json', async () => {
    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrWrites.push(String(chunk));
      return true;
    });

    const commandExit = await runNamedCommand({
      commandName: 'pack',
      apply: true,
      yes: false,
      json: true,
      dryRun: false,
      allProviders: false,
      max: false,
      provider: 'codex',
      olderThan: '7d',
      to: undefined,
      pollMs: undefined,
      positionals: [],
      execArgv: [],
    });
    const printout = stderrWrites.join('');

    expect(commandExit.exitCode).toBe(2);
    expect(printout).toContain('Cancelled');
    expect(printout).not.toContain('Continue?');
  });
});

describe('doctor command', () => {
  const writes: string[] = [];

  beforeEach(() => {
    writes.length = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes stable JSON prerequisite status', async () => {
    await runDoctorCommand({ json: true });

    const printedDocument = JSON.parse(writes.join('')) as {
      readonly sqlite3: { readonly available: boolean; readonly version?: string };
      readonly zstd: { readonly available: boolean; readonly version?: string };
    };

    expect(printedDocument).toHaveProperty('sqlite3');
    expect(printedDocument).toHaveProperty('zstd');
    expect(typeof printedDocument.sqlite3.available).toBe('boolean');
    expect(typeof printedDocument.zstd.available).toBe('boolean');

    if (printedDocument.zstd.available) {
      expect(typeof printedDocument.zstd.version).toBe('string');
    }

    if (printedDocument.sqlite3.available) {
      expect(typeof printedDocument.sqlite3.version).toBe('string');
    }
  });

  it('writes human-readable prerequisite lines', async () => {
    await runDoctorCommand({ json: undefined });

    const printout = writes.join('');
    expect(printout).toMatch(/^zstd: (missing|.+)/m);
    expect(printout).toMatch(/^sqlite3: (missing|.+)/m);
  });
});

describe('guide command', () => {
  const writes: string[] = [];

  beforeEach(() => {
    writes.length = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes stable JSON guide without prompting', async () => {
    const commandExit = await runGuideCommand({ json: true });

    const printedDocument = JSON.parse(writes.join(''));
    expect(printedDocument).toMatchObject({
      name: 'agent-session-pack',
      mode: 'agent-guide',
      safety: {
        bareCommand: 'human-tty-only',
        machineOutput: '--json',
        applyConfirmation: '--apply --yes',
      },
    });
    expect(commandExit.exitCode).toBe(0);
  });

  it('writes human guide text by default', async () => {
    const commandExit = await runGuideCommand({ json: undefined });

    expect(writes.join('')).toContain('Agent-first quickstart');
    expect(writes.join('')).toContain('Prefer explicit subcommands with --json.');
    expect(commandExit.exitCode).toBe(0);
  });
});

describe('agent guide output', () => {
  it('shows a safe non-interactive command path for coding agents', () => {
    const printout = createHumanAgentGuide();

    expect(printout).toContain('Agent-first quickstart');
    expect(printout).toContain('Prefer explicit subcommands with --json.');
    expect(printout).toContain('npx --yes agent-session-pack check --json');
    expect(printout).toContain(
      'npx --yes agent-session-pack pack --all-providers --older-than 7d --dry-run --json',
    );
    expect(printout).toContain(
      'npx --yes agent-session-pack pack --all-providers --older-than 7d --apply --yes --json',
    );
    expect(printout).toContain(
      'npx --yes agent-session-pack unpack --all-providers --apply --yes --json',
    );
    expect(printout).toContain('npx --yes agent-session-pack lifecycle enable --json');
    expect(printout).toContain(
      'npx --yes agent-session-pack open --provider codex <session-id> --json',
    );
    expect(printout).toContain('npx --yes agent-session-pack maintain --apply --yes --json');
    expect(printout).toContain('npx --yes agent-session-pack pack --max --dry-run --json');
    expect(printout).toContain('Bare agent-session-pack is for human TTY setup.');
  });

  it('formats a stable JSON guide for agents', () => {
    const guide = JSON.parse(createStructuredAgentGuide());

    expect(guide).toMatchObject({
      name: 'agent-session-pack',
      mode: 'agent-guide',
      safety: {
        bareCommand: 'human-tty-only',
        defaultMutation: 'none',
        machineOutput: '--json',
      },
    });
    function readStepCommand(step: { command: string }): string {
      return step.command;
    }

    expect(guide.recommendedFlow.map(readStepCommand)).toEqual([
      'npx --yes agent-session-pack check --json',
      'npx --yes agent-session-pack pack --all-providers --older-than 7d --dry-run --json',
      'npx --yes agent-session-pack pack --all-providers --older-than 7d --apply --yes --json',
      'npx --yes agent-session-pack unpack --all-providers --apply --yes --json',
      'npx --yes agent-session-pack lifecycle enable --json',
      'npx --yes agent-session-pack open --provider codex <session-id> --json',
      'npx --yes agent-session-pack maintain --apply --yes --json',
    ]);
    expect(guide.commands.openSession).toContain('open');
    expect(guide.commands.maintain).toContain('maintain');
    expect(guide.commands.lifecycleEnable).toContain('lifecycle enable');
  });
});
