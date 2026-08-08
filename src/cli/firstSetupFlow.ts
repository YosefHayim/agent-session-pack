import { Effect } from 'effect';
import type { ProviderInventoryReport } from '../core/providerInventory.js';
import type { ProviderAdapter, ProviderId } from '../core/sessionStore.js';
import { validateVaultPath, writeSetupConfig } from '../core/setupConfig.js';
import { HOME_NOT_SET_CANCEL_MESSAGE } from './homeEnv.js';
import {
  DEFAULT_COLD_AFTER,
  type FirstSetupRequest,
  formatProviderInventoryTable,
  loadInventoryWithSpinner,
  normalizeHome,
  normalizeNow,
  normalizeOlderThanMs,
  normalizePrompts,
  normalizeProviders,
} from './interactiveCliContext.js';
import type { PromptAdapter, PromptOption } from './promptAdapter.js';

type ColdThresholdChoice = '14d' | '30d' | '7d' | 'custom';
type VaultPathChoice = 'custom' | 'default';
type FlowResult = 'cancelled' | 'saved';

/**
 * Runs the first setup wizard.
 *
 * @param request - Optional test overrides for prompts, home, providers, and time.
 * @returns Flow status.
 * @example
 * ```ts
 * import { runFirstSetup } from './firstSetupFlow.js';
 *
 * const result = await runFirstSetup();
 * ```
 */
export const runFirstSetup = async (request: FirstSetupRequest = {}): Promise<FlowResult> => {
  const prompts = normalizePrompts(request.prompts);
  const home = normalizeHome(request.home);

  if (home === undefined) {
    prompts.cancel(HOME_NOT_SET_CANCEL_MESSAGE);
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

  prompts.outro(formatSetupSavedCopy());
  return 'saved';
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

const promptColdThreshold = async (prompts: PromptAdapter): Promise<string | undefined> => {
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
    placeholder: DEFAULT_COLD_AFTER,
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
  const providerRoots = request.providers.flatMap((provider) =>
    provider.defaultRoots(request.home),
  );
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

const providerPromptOption = (
  row: ProviderInventoryReport['rows'][number],
): PromptOption<ProviderId> => {
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

  if (row.provider === 'grok') {
    return {
      value: row.provider,
      label: row.provider,
      hint: 'archive old Grok multi-file session directories',
    };
  }

  if (row.provider === 'kimi') {
    return {
      value: row.provider,
      label: row.provider,
      hint: 'archive old Kimi Code multi-file sessions',
    };
  }

  if (row.provider === 'opencode') {
    return {
      value: row.provider,
      label: row.provider,
      hint: 'archive old OpenCode local sessions when present',
    };
  }

  if (row.provider === 'gemini') {
    return {
      value: row.provider,
      label: row.provider,
      hint: 'archive old Gemini CLI sessions when present',
    };
  }

  return {
    value: row.provider,
    label: row.provider,
    hint: 'backup-only proof; native mutation disabled for safety',
  };
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

/**
 * Formats the setup success copy with explicit command paths.
 *
 * @returns Human next-step copy for local, one-off, and installed usage.
 */
const formatSetupSavedCopy = (): string =>
  [
    'Setup saved.',
    '',
    'Next command:',
    '  Local repo:     pnpm dev',
    '  One-off npm:    npx --yes agent-session-pack',
    '  Installed CLI:  agent-session-pack',
    '',
    'Then choose "Check savings" or "Pack cold sessions".',
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
