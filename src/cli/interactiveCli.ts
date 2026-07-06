import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  select,
  spinner,
  text,
} from '@clack/prompts';
import { Effect } from 'effect';
import {
  inspectProviderInventory,
  type ProviderAdapter,
  type ProviderId,
  type ProviderInventoryReport,
  resolveDefaultVaultPath,
  validateVaultPath,
  writeSetupConfig,
} from '../core/index.js';
import { allProviders } from '../providers/index.js';
import { formatBytes } from '../output/index.js';
import { runDoctorCommand } from './commands/doctorCommand.js';
import { runPackCommand } from './commands/packCommand.js';
import { runSavingsCommand } from './commands/savingsCommand.js';
import { runScanCommand } from './commands/scanCommand.js';
import { runUnpackCommand } from './commands/unpackCommand.js';

export type PromptOption<Value extends string> = {
  readonly value: Value;
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
};

export type PromptSpinner = {
  readonly isCancelled: boolean;
  start: (message?: string) => void;
  stop: (message?: string) => void;
  cancel: (message?: string) => void;
  error: (message?: string) => void;
  message: (message?: string) => void;
  clear: () => void;
};

export type PromptAdapter = {
  intro: (title?: string) => void;
  note: (message?: string, title?: string) => void;
  outro: (message?: string) => void;
  cancel: (message?: string) => void;
  isCancel: (value: unknown) => value is symbol;
  select: <Value extends string>(options: {
    readonly message: string;
    readonly options: ReadonlyArray<PromptOption<Value>>;
    readonly initialValue?: Value;
  }) => Promise<Value | symbol>;
  multiselect: <Value extends string>(options: {
    readonly message: string;
    readonly options: ReadonlyArray<PromptOption<Value>>;
    readonly initialValues?: ReadonlyArray<Value>;
    readonly required?: boolean;
  }) => Promise<ReadonlyArray<Value> | symbol>;
  text: (options: {
    readonly message: string;
    readonly initialValue?: string;
    readonly placeholder?: string;
    readonly validate?: (value: string | undefined) => string | undefined;
  }) => Promise<string | symbol>;
  confirm: (options: {
    readonly message: string;
    readonly active?: string;
    readonly inactive?: string;
    readonly initialValue?: boolean;
  }) => Promise<boolean | symbol>;
  spinner: () => PromptSpinner;
};

export type InteractiveCliRequest = {
  readonly home?: string;
  readonly now?: Date;
  readonly olderThanMs?: number;
  readonly prompts?: PromptAdapter;
  readonly providers?: ReadonlyArray<ProviderAdapter>;
};

export type FirstSetupRequest = InteractiveCliRequest & {
  readonly showIntro?: boolean;
};

export type InteractiveCliDetectionRequest = {
  readonly argv: ReadonlyArray<string>;
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
};

type MainMenuAction = 'doctor' | 'exit' | 'pack' | 'restore' | 'review' | 'savings' | 'setup';
type ColdThresholdChoice = '14d' | '30d' | '7d' | 'custom';
type VaultPathChoice = 'custom' | 'default';
type FlowResult = 'cancelled' | 'saved';

const defaultColdAfter = '7d';
const defaultOlderThanMs = 7 * 24 * 60 * 60 * 1000;

export const clackPromptAdapter: PromptAdapter = {
  cancel,
  confirm: (options) => confirm(options),
  intro,
  isCancel,
  multiselect: (options) =>
    multiselect({
      ...options,
      options: [...options.options] as never,
      initialValues:
        options.initialValues === undefined ? undefined : ([...options.initialValues] as never),
    }),
  note,
  outro,
  select: (options) =>
    select({
      ...options,
      options: [...options.options] as never,
    }),
  spinner,
  text: (options) => text(options),
};

/**
 * Decides whether the bare binary should open the human interactive flow.
 *
 * @param request - Normalized argv and terminal state.
 * @returns True when no command or flags were provided in a TTY.
 */
export const shouldRunInteractiveCli = (request: InteractiveCliDetectionRequest): boolean => {
  if (!request.stdinIsTty || !request.stdoutIsTty) {
    return false;
  }

  return request.argv.length <= 2;
};

/**
 * Builds the main interactive menu options with Clack hint copy.
 *
 * @returns Main menu options.
 */
export const createMainMenuOptions = (): ReadonlyArray<PromptOption<MainMenuAction>> => [
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
];

/**
 * Runs the full human interactive menu.
 *
 * @param request - Optional test overrides for prompts, home, providers, and time.
 * @returns Promise that resolves after the selected action completes.
 */
export const runInteractiveCli = async (request: InteractiveCliRequest = {}): Promise<void> => {
  const prompts = normalizePrompts(request.prompts);
  prompts.intro('Agent Session Pack');
  prompts.note(firstScreenCopy());

  const action = await prompts.select({
    message: 'What do you want to do?',
    options: createMainMenuOptions(),
  });

  if (prompts.isCancel(action) || action === 'exit') {
    prompts.outro('No files changed.');
    return;
  }

  await runInteractiveAction({
    ...request,
    action,
    prompts,
  });
};

/**
 * Runs the first setup wizard.
 *
 * @param request - Optional test overrides for prompts, home, providers, and time.
 * @returns Flow status.
 */
export const runFirstSetup = async (request: FirstSetupRequest = {}): Promise<FlowResult> => {
  const prompts = normalizePrompts(request.prompts);
  const home = normalizeHome(request.home);

  if (home === undefined) {
    prompts.cancel('HOME is not set. No files changed.');
    return 'cancelled';
  }

  if (request.showIntro !== false) {
    prompts.intro('Agent Session Pack setup');
  }

  prompts.note(firstSetupCopy());

  const providers = normalizeProviders(request.providers);
  const olderThanMs = normalizeOlderThanMs(request.olderThanMs);
  const now = normalizeNow(request.now);
  const inventory = await loadInventoryWithSpinner({
    home,
    now,
    olderThanMs,
    prompts,
    providers,
    startMessage: 'Scanning provider stores...',
    stopMessage: 'Scanned provider stores.',
  });

  prompts.note(formatProviderInventoryTable(inventory), 'Detected providers');

  const selectedProviders = await promptProviderSelection({
    inventory,
    prompts,
  });

  if (selectedProviders === undefined) {
    prompts.cancel('No files changed.');
    return 'cancelled';
  }

  const coldAfter = await promptColdThreshold(prompts);

  if (coldAfter === undefined) {
    prompts.cancel('No files changed.');
    return 'cancelled';
  }

  const vaultPath = await promptVaultPath({
    home,
    prompts,
    providers,
  });

  if (vaultPath === undefined) {
    prompts.cancel('No files changed.');
    return 'cancelled';
  }

  prompts.note(
    formatSetupSummary({
      coldAfter,
      providers: selectedProviders,
      vaultPath,
    }),
    'Setup summary',
  );

  const shouldSave = await prompts.confirm({
    message: 'Save this setup?',
    initialValue: true,
  });

  if (prompts.isCancel(shouldSave) || shouldSave !== true) {
    prompts.cancel('No files changed.');
    return 'cancelled';
  }

  const timestamp = now.toISOString();
  await Effect.runPromise(
    writeSetupConfig({
      home,
      config: {
        version: 1,
        providers: selectedProviders,
        vaultPath,
        coldAfter,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    }),
  );

  prompts.outro('Setup saved. Run agent-session-pack to review or pack cold sessions.');
  return 'saved';
};

const runInteractiveAction = async (
  request: InteractiveCliRequest & {
    readonly action: MainMenuAction;
    readonly prompts: PromptAdapter;
  },
): Promise<void> => {
  if (request.action === 'setup') {
    await runFirstSetup({
      ...request,
      showIntro: false,
    });
    return;
  }

  if (request.action === 'savings') {
    await runWithSpinner({
      prompts: request.prompts,
      startMessage: 'Checking savings...',
      stopMessage: 'Savings check complete.',
      task: () => Effect.runPromise(runSavingsCommand({})),
    });
    request.prompts.outro('Original sessions touched: no');
    return;
  }

  if (request.action === 'review') {
    await runReviewSessions(request);
    return;
  }

  if (request.action === 'pack') {
    await runPackFlow(request);
    return;
  }

  if (request.action === 'restore') {
    await runRestoreFlow(request);
    return;
  }

  await runDoctorCommand({});
};

const runReviewSessions = async (request: InteractiveCliRequest & { readonly prompts: PromptAdapter }) => {
  const home = normalizeHome(request.home);

  if (home === undefined) {
    request.prompts.cancel('HOME is not set. No files changed.');
    return;
  }

  const inventory = await loadInventoryWithSpinner({
    home,
    now: normalizeNow(request.now),
    olderThanMs: normalizeOlderThanMs(request.olderThanMs),
    prompts: request.prompts,
    providers: normalizeProviders(request.providers),
    startMessage: 'Scanning provider stores...',
    stopMessage: 'Scanned provider stores.',
  });

  request.prompts.note(formatProviderInventoryTable(inventory), 'Provider sessions');
  await Effect.runPromise(runScanCommand({}));
};

const runPackFlow = async (
  request: InteractiveCliRequest & { readonly prompts: PromptAdapter },
): Promise<void> => {
  const home = normalizeHome(request.home);

  if (home === undefined) {
    request.prompts.cancel('HOME is not set. No files changed.');
    return;
  }

  const inventory = await loadInventoryWithSpinner({
    home,
    now: normalizeNow(request.now),
    olderThanMs: normalizeOlderThanMs(request.olderThanMs),
    prompts: request.prompts,
    providers: normalizeProviders(request.providers),
    startMessage: 'Scanning provider stores...',
    stopMessage: 'Scanned provider stores.',
  });

  request.prompts.note(formatProviderInventoryTable(inventory), 'Pack cold sessions');

  const shouldPreview = await request.prompts.confirm({
    message: 'Continue with dry-run preview?',
    initialValue: true,
  });

  if (request.prompts.isCancel(shouldPreview) || shouldPreview !== true) {
    request.prompts.cancel('No files changed.');
    return;
  }

  await Effect.runPromise(
    runPackCommand({
      allProviders: true,
      apply: false,
      dryRun: true,
      json: false,
      olderThan: defaultColdAfter,
      provider: undefined,
      yes: false,
      confirmed: undefined,
    }),
  );

  const shouldApply = await request.prompts.confirm({
    message: formatPackApplyQuestion(inventory, home),
    initialValue: false,
  });

  if (request.prompts.isCancel(shouldApply) || shouldApply !== true) {
    request.prompts.outro('No files changed.');
    return;
  }

  await Effect.runPromise(
    runPackCommand({
      allProviders: true,
      apply: true,
      dryRun: false,
      json: false,
      olderThan: defaultColdAfter,
      provider: undefined,
      yes: true,
      confirmed: true,
    }),
  );
};

const runRestoreFlow = async (
  request: InteractiveCliRequest & { readonly prompts: PromptAdapter },
): Promise<void> => {
  const shouldPreview = await request.prompts.confirm({
    message: 'Preview archived sessions before restore?',
    initialValue: true,
  });

  if (request.prompts.isCancel(shouldPreview) || shouldPreview !== true) {
    request.prompts.cancel('No files changed.');
    return;
  }

  await runWithSpinner({
    prompts: request.prompts,
    startMessage: 'Scanning vault manifests...',
    stopMessage: 'Scanned vault manifests.',
    task: () =>
      Effect.runPromise(
        runUnpackCommand({
          allProviders: true,
          apply: false,
          json: false,
          provider: undefined,
          yes: false,
          confirmed: undefined,
        }),
      ),
  });

  const shouldApply = await request.prompts.confirm({
    message: 'Restore archived sessions back to original provider paths?',
    initialValue: false,
  });

  if (request.prompts.isCancel(shouldApply) || shouldApply !== true) {
    request.prompts.outro('No files changed.');
    return;
  }

  await Effect.runPromise(
    runUnpackCommand({
      allProviders: true,
      apply: true,
      json: false,
      provider: undefined,
      yes: true,
      confirmed: true,
    }),
  );
};

const loadInventoryWithSpinner = (request: {
  readonly home: string;
  readonly now: Date;
  readonly olderThanMs: number;
  readonly prompts: PromptAdapter;
  readonly providers: ReadonlyArray<ProviderAdapter>;
  readonly startMessage: string;
  readonly stopMessage: string;
}): Promise<ProviderInventoryReport> =>
  runWithSpinner({
    prompts: request.prompts,
    startMessage: request.startMessage,
    stopMessage: request.stopMessage,
    task: () =>
      Effect.runPromise(
        inspectProviderInventory({
          home: request.home,
          providers: request.providers,
          olderThanMs: request.olderThanMs,
          now: request.now,
        }),
      ),
  });

const runWithSpinner = async <Value>(request: {
  readonly prompts: PromptAdapter;
  readonly startMessage: string;
  readonly stopMessage: string;
  readonly task: () => Promise<Value>;
}): Promise<Value> => {
  const scanSpinner = request.prompts.spinner();
  scanSpinner.start(request.startMessage);

  try {
    const value = await request.task();
    scanSpinner.stop(request.stopMessage);
    return value;
  } catch (cause) {
    scanSpinner.error('Operation failed.');
    throw cause;
  }
};

const promptProviderSelection = async (request: {
  readonly inventory: ProviderInventoryReport;
  readonly prompts: PromptAdapter;
}): Promise<ReadonlyArray<ProviderId> | undefined> => {
  const options = request.inventory.rows.map(providerPromptOption);

  while (true) {
    const selectedProviders = await request.prompts.multiselect<ProviderId>({
      message: 'Which providers should Agent Session Pack manage?',
      options,
      required: false,
    });

    if (request.prompts.isCancel(selectedProviders)) {
      return undefined;
    }

    if (selectedProviders.length > 0) {
      return selectedProviders;
    }

    request.prompts.note('Choose at least one provider or cancel setup.', 'No providers selected');
  }
};

const promptColdThreshold = async (
  prompts: PromptAdapter,
): Promise<string | undefined> => {
  const choice = await prompts.select<ColdThresholdChoice>({
    message: 'When is a session considered cold?',
    options: [
      { value: '7d', label: '7 days', hint: 'recommended; protects normal active work' },
      { value: '14d', label: '14 days', hint: 'safer for long-running sessions' },
      { value: '30d', label: '30 days', hint: 'conservative cleanup' },
      { value: 'custom', label: 'Custom', hint: 'enter 12h, 7d, 2w, or 30d' },
    ],
    initialValue: '7d',
  });

  if (prompts.isCancel(choice)) {
    return undefined;
  }

  if (choice !== 'custom') {
    return choice;
  }

  const custom = await prompts.text({
    message: 'Enter cold threshold',
    placeholder: defaultColdAfter,
    validate: validateDurationText,
  });

  if (prompts.isCancel(custom)) {
    return undefined;
  }

  return custom;
};

const promptVaultPath = async (request: {
  readonly home: string;
  readonly prompts: PromptAdapter;
  readonly providers: ReadonlyArray<ProviderAdapter>;
}): Promise<string | undefined> => {
  const choice = await request.prompts.select<VaultPathChoice>({
    message: 'Where should archives be stored?',
    options: [
      {
        value: 'default',
        label: '~/.agent-session-pack',
        hint: 'default local vault; manifests and compressed archives live here',
      },
      {
        value: 'custom',
        label: 'Custom path',
        hint: 'useful for external drive or synced disk',
      },
    ],
    initialValue: 'default',
  });

  if (request.prompts.isCancel(choice)) {
    return undefined;
  }

  if (choice === 'default') {
    return validateVaultPathInput({
      home: request.home,
      inputPath: '~/.agent-session-pack',
      prompts: request.prompts,
      providers: request.providers,
    });
  }

  return promptCustomVaultPath(request);
};

const promptCustomVaultPath = async (request: {
  readonly home: string;
  readonly prompts: PromptAdapter;
  readonly providers: ReadonlyArray<ProviderAdapter>;
}): Promise<string | undefined> => {
  while (true) {
    const inputPath = await request.prompts.text({
      message: 'Enter vault path',
      initialValue: '~/.agent-session-pack',
    });

    if (request.prompts.isCancel(inputPath)) {
      return undefined;
    }

    const validatedPath = await validateVaultPathInput({
      home: request.home,
      inputPath,
      prompts: request.prompts,
      providers: request.providers,
    });

    if (validatedPath !== undefined) {
      return validatedPath;
    }
  }
};

const validateVaultPathInput = async (request: {
  readonly home: string;
  readonly inputPath: string;
  readonly prompts: PromptAdapter;
  readonly providers: ReadonlyArray<ProviderAdapter>;
}): Promise<string | undefined> => {
  const providerRoots = request.providers.flatMap((provider) => provider.defaultRoots(request.home));
  const result = await Effect.runPromise(
    Effect.either(
      validateVaultPath({
        home: request.home,
        inputPath: request.inputPath,
        providerRoots,
      }),
    ),
  );

  if (result._tag === 'Right') {
    return result.right.path;
  }

  request.prompts.note(result.left.message, 'Invalid vault path');
  return undefined;
};

const providerPromptOption = (row: ProviderInventoryReport['rows'][number]): PromptOption<ProviderId> => {
  if (row.provider === 'codex') {
    return {
      value: row.provider,
      label: row.provider,
      hint: 'archive old JSONL sessions; restore byte-exact when needed',
    };
  }

  if (row.provider === 'claude') {
    return {
      value: row.provider,
      label: row.provider,
      hint: 'archive old Claude Code project sessions',
    };
  }

  if (row.provider === 'kiro') {
    return {
      value: row.provider,
      label: row.provider,
      hint: 'archive old Kiro CLI sessions',
    };
  }

  return {
    value: row.provider,
    label: row.provider,
    hint: 'backup-only proof; native mutation disabled for safety',
  };
};

const formatProviderInventoryTable = (report: ProviderInventoryReport): string => {
  if (report.rows.length === 0) {
    return 'No provider stores found.';
  }

  return [
    'Provider   Mode         Sessions   Cold   Guarded recent   Size       Path',
    ...report.rows.map(formatProviderInventoryRow),
  ].join('\n');
};

const formatProviderInventoryRow = (row: ProviderInventoryReport['rows'][number]): string => {
  const provider = row.provider.padEnd(10);
  const mode = row.mode.padEnd(12);
  const sessions = String(row.sessions).padStart(8);
  const cold = String(row.coldSessions).padStart(6);
  const guarded = String(row.guardedRecentSessions).padStart(16);
  const size = formatBytes(row.candidateBytes).padEnd(10);
  const path = row.paths.join(', ');

  return `${provider} ${mode} ${sessions}   ${cold}   ${guarded}   ${size} ${path}`;
};

const formatSetupSummary = (summary: {
  readonly providers: ReadonlyArray<ProviderId>;
  readonly vaultPath: string;
  readonly coldAfter: string;
}): string =>
  [
    `Providers: ${summary.providers.join(', ')}`,
    `Vault: ${summary.vaultPath}`,
    `Cold after: ${summary.coldAfter}`,
    'Safety:',
    '  - dry-run before apply',
    '  - recent sessions guarded',
    '  - restore verified before original removal',
    '  - changed live files never overwritten',
  ].join('\n');

const formatPackApplyQuestion = (inventory: ProviderInventoryReport, home: string): string => {
  const candidateSessions = inventory.rows.reduce(
    (totalSessions, row) => totalSessions + row.coldSessions,
    0,
  );
  const candidateBytes = inventory.rows.reduce((totalBytes, row) => totalBytes + row.candidateBytes, 0);
  const providerNames = inventory.rows
    .filter((row) => row.coldSessions > 0)
    .map((row) => row.provider)
    .join(', ');

  return [
    'Apply pack now?',
    '',
    `This will archive ${candidateSessions} cold sessions from ${providerNames || 'no providers'} into:`,
    resolveDefaultVaultPath(home),
    '',
    `Candidate size: ${formatBytes(candidateBytes)}`,
    'Original files are removed only after archive write, restore verification, and manifest write.',
  ].join('\n');
};

const firstScreenCopy = (): string =>
  [
    'Compress old local AI-agent sessions without breaking resume.',
    '',
    'How it works:',
    '  1. Scans provider stores read-only',
    '  2. Proves savings on copied files first',
    '  3. Packs only cold sessions into ~/.agent-session-pack',
    '  4. Verifies byte-exact restore',
    '  5. Removes originals only after verification',
    '',
    'No daemon. No background deletion. Cursor and Devin stay backup-only for now.',
  ].join('\n');

const firstSetupCopy = (): string =>
  [
    'This setup writes Agent Session Pack config only.',
    'It does not pack, delete, or restore session files.',
  ].join('\n');

const validateDurationText = (duration: string | undefined): string | undefined => {
  if (duration === undefined) {
    return 'Use a duration such as 12h, 7d, 2w, or 30d.';
  }

  if (/^\d+(h|d|w)$/.test(duration)) {
    return undefined;
  }

  return 'Use a duration such as 12h, 7d, 2w, or 30d.';
};

const normalizeHome = (home: string | undefined): string | undefined => {
  if (home !== undefined) {
    return home;
  }

  return process.env.HOME;
};

const normalizeNow = (now: Date | undefined): Date => {
  if (now !== undefined) {
    return now;
  }

  return new Date();
};

const normalizeOlderThanMs = (olderThanMs: number | undefined): number => {
  if (olderThanMs !== undefined) {
    return olderThanMs;
  }

  return defaultOlderThanMs;
};

const normalizePrompts = (prompts: PromptAdapter | undefined): PromptAdapter => {
  if (prompts !== undefined) {
    return prompts;
  }

  return clackPromptAdapter;
};

const normalizeProviders = (
  providers: ReadonlyArray<ProviderAdapter> | undefined,
): ReadonlyArray<ProviderAdapter> => {
  if (providers !== undefined) {
    return providers;
  }

  return allProviders;
};
