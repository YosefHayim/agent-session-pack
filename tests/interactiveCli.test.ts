import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  createMainMenuOptions,
  type PromptAdapter,
  type PromptOption,
  runFirstSetup,
  shouldRunInteractiveCli,
} from '../src/cli/interactiveCli.js';
import type { ProviderAdapter } from '../src/core/index.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-interactive-'));

type RecordingPromptAdapter = PromptAdapter & {
  readonly confirms: unknown[];
  readonly multiselects: Array<{
    readonly message: string;
    readonly options: ReadonlyArray<PromptOption<string>>;
  }>;
  readonly selects: Array<{
    readonly message: string;
    readonly options: ReadonlyArray<PromptOption<string>>;
  }>;
  readonly spinnerEvents: string[];
  readonly texts: unknown[];
};

const createPromptAdapter = (answers: ReadonlyArray<unknown>): RecordingPromptAdapter => {
  const queue = [...answers];
  const adapter: RecordingPromptAdapter = {
    confirms: [],
    multiselects: [],
    selects: [],
    spinnerEvents: [],
    texts: [],
    cancel: () => undefined,
    confirm: async (options) => {
      adapter.confirms.push(options);
      return queue.shift() as boolean;
    },
    intro: () => undefined,
    isCancel: (value: unknown): value is symbol =>
      typeof value === 'symbol' && value.description === 'cancel',
    multiselect: async (options) => {
      adapter.multiselects.push(options);
      return queue.shift() as ReadonlyArray<string> as never;
    },
    note: () => undefined,
    outro: () => undefined,
    select: async (options) => {
      adapter.selects.push(options);
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
    text: async (options) => {
      adapter.texts.push(options);
      return queue.shift() as string;
    },
  };

  return adapter;
};

const createProvider = (root: string): ProviderAdapter => ({
  id: 'codex',
  label: 'Codex',
  mode: 'archive',
  defaultRoots: () => [root],
  discover: () =>
    Effect.succeed([
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
});

describe('interactive CLI flow', () => {
  it('runs only for bare TTY invocations', () => {
    expect(
      shouldRunInteractiveCli({
        argv: ['node', 'main.js'],
        stdinIsTty: true,
        stdoutIsTty: true,
      }),
    ).toBe(true);
    expect(
      shouldRunInteractiveCli({
        argv: ['node', 'main.js', 'scan'],
        stdinIsTty: true,
        stdoutIsTty: true,
      }),
    ).toBe(false);
    expect(
      shouldRunInteractiveCli({
        argv: ['node', 'main.js'],
        stdinIsTty: false,
        stdoutIsTty: true,
      }),
    ).toBe(false);
  });

  it('renders main menu options with explanatory hints', () => {
    expect(createMainMenuOptions()).toEqual([
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
