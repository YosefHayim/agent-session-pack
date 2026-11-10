import { HOME_NOT_SET_CANCEL_MESSAGE } from '@/home-env.js';
import type { InteractiveCliRequest } from '@/interactive-cli-request.js';
import { DEFAULT_COLD_AFTER, DEFAULT_COLD_AFTER_MS } from '@/pack/plan.js';
import type { PromptAdapter } from '@/prompt-adapter.js';
import { clackPromptAdapter, type PromptOption } from '@/prompt-adapter.js';
import { allProviders } from '@/providers/all-providers.js';
import { createProviderInventoryTable, loadInventoryWithSpinner } from '@/scan/inventory-prompt.js';
import type { ProviderInventoryReport } from '@/scan/provider-inventory.js';
import type { ProviderAdapter, ProviderId } from '@/session-model.js';
import { validateVaultPath, writeSetupSettings } from './config.js';

type ColdThresholdChoice = '14d' | '30d' | '7d' | 'custom';
type VaultPathChoice = 'custom' | 'default';
type FlowReport = 'cancelled' | 'saved';

export type FirstSetupRequest = InteractiveCliRequest & {
  readonly showIntro?: boolean;
};

export const runFirstSetup = async (request: FirstSetupRequest = {}): Promise<FlowReport> => {
  const prompts = request.prompts ?? clackPromptAdapter;
  const home = request.home ?? process.env.HOME;

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    prompts.cancel(HOME_NOT_SET_CANCEL_MESSAGE);
    return 'cancelled';
  }

  const isIntroShown = request.showIntro !== false;
  if (isIntroShown) {
    prompts.intro('Agent Session Pack setup');
  }

  prompts.note(readFirstSetupCopy());

  const providers = request.providers ?? allProviders;
  const olderThanMs = request.olderThanMs ?? DEFAULT_COLD_AFTER_MS;
  const now = request.now ?? new Date();
  const inventory = await loadInventoryWithSpinner({
    home,
    now,
    olderThanMs,
    prompts,
    providers,
    startMessage: 'Scanning provider stores...',
    stopMessage: 'Scanned provider stores.',
  });

  prompts.note(createProviderInventoryTable(inventory), 'Detected providers');

  const selectedProviders = await askProviderSelection({
    inventory,
    prompts,
  });

  const isSelectedProvidersMissing = selectedProviders == null;
  if (isSelectedProvidersMissing) {
    prompts.cancel('No files changed.');
    return 'cancelled';
  }

  const coldAfter = await askColdThreshold(prompts);

  const isColdAfterMissing = coldAfter == null;
  if (isColdAfterMissing) {
    prompts.cancel('No files changed.');
    return 'cancelled';
  }

  const vaultPath = await askVaultPath({
    home,
    prompts,
    providers,
  });

  const isVaultPathMissing = vaultPath == null;
  if (isVaultPathMissing) {
    prompts.cancel('No files changed.');
    return 'cancelled';
  }

  prompts.note(
    createSetupSummary({
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

  const isSaveStopped = prompts.isCancel(shouldSave) || shouldSave !== true;
  if (isSaveStopped) {
    prompts.cancel('No files changed.');
    return 'cancelled';
  }

  const timestamp = now.toISOString();
  await writeSetupSettings({
    home,
    config: {
      version: 1,
      providers: selectedProviders,
      vaultPath,
      coldAfter,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  });

  prompts.outro(createSetupSavedCopy());
  return 'saved';
};

const askProviderSelection = async (request: {
  readonly inventory: ProviderInventoryReport;
  readonly prompts: PromptAdapter;
}): Promise<ReadonlyArray<ProviderId> | undefined> => {
  const choices = request.inventory.rows.map(createProviderPromptOption);

  while (true) {
    const selectedProviders = await request.prompts.multiselect<ProviderId>({
      message: 'Which providers should Agent Session Pack manage?',
      options: choices,
      required: false,
    });

    const isSelectionCancelled = request.prompts.isCancel(selectedProviders);
    if (isSelectionCancelled) {
      return undefined;
    }

    const hasSelectedProviders = selectedProviders.length > 0;
    if (hasSelectedProviders) {
      return selectedProviders;
    }

    request.prompts.note('Choose at least one provider or cancel setup.', 'No providers selected');
  }
};

const askColdThreshold = async (prompts: PromptAdapter): Promise<string | undefined> => {
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

  const isChoiceCancel = prompts.isCancel(choice);
  if (isChoiceCancel) {
    return undefined;
  }

  const isChoiceNotCustom = choice !== 'custom';
  if (isChoiceNotCustom) {
    return choice;
  }

  const custom = await prompts.text({
    message: 'Enter cold threshold',
    placeholder: DEFAULT_COLD_AFTER,
    validate: validateDurationString,
  });

  const isCustomCancel = prompts.isCancel(custom);
  if (isCustomCancel) {
    return undefined;
  }

  return custom;
};

const askVaultPath = async (request: {
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

  const isChoiceCancel = request.prompts.isCancel(choice);
  if (isChoiceCancel) {
    return undefined;
  }

  const isChoiceDefault = choice === 'default';
  if (isChoiceDefault) {
    return validateVaultPathDetails({
      home: request.home,
      inputPath: '~/.agent-session-pack',
      prompts: request.prompts,
      providers: request.providers,
    });
  }

  return askCustomVaultPath(request);
};

const askCustomVaultPath = async (request: {
  readonly home: string;
  readonly prompts: PromptAdapter;
  readonly providers: ReadonlyArray<ProviderAdapter>;
}): Promise<string | undefined> => {
  while (true) {
    const typedPath = await request.prompts.text({
      message: 'Enter vault path',
      initialValue: '~/.agent-session-pack',
    });

    const isPathCancel = request.prompts.isCancel(typedPath);
    if (isPathCancel) {
      return undefined;
    }

    const validatedPath = await validateVaultPathDetails({
      home: request.home,
      inputPath: typedPath,
      prompts: request.prompts,
      providers: request.providers,
    });

    const isValidatedPathFound = validatedPath != null;
    if (isValidatedPathFound) {
      return validatedPath;
    }
  }
};

const validateVaultPathDetails = async (request: {
  readonly home: string;
  readonly inputPath: string;
  readonly prompts: PromptAdapter;
  readonly providers: ReadonlyArray<ProviderAdapter>;
}): Promise<string | undefined> => {
  const providerRoots = request.providers.flatMap((provider) =>
    provider.defaultRoots(request.home),
  );
  try {
    const validatedPath = await validateVaultPath({
      home: request.home,
      inputPath: request.inputPath,
      providerRoots,
    });
    return validatedPath.path;
  } catch (validationError) {
    const isErrorObject = validationError instanceof Error;
    const validationMessage = isErrorObject ? validationError.message : String(validationError);
    request.prompts.note(validationMessage, 'Invalid vault path');
    return undefined;
  }
};

const createProviderPromptOption = (
  inventorySummary: ProviderInventoryReport['rows'][number],
): PromptOption<ProviderId> => {
  const isCodexProvider = inventorySummary.provider === 'codex';
  if (isCodexProvider) {
    return {
      value: inventorySummary.provider,
      label: inventorySummary.provider,
      hint: 'archive old JSONL sessions; restore byte-exact when needed',
    };
  }

  const isClaudeProvider = inventorySummary.provider === 'claude';
  if (isClaudeProvider) {
    return {
      value: inventorySummary.provider,
      label: inventorySummary.provider,
      hint: 'archive old Claude Code project sessions',
    };
  }

  const isInventoryProviderKiro = inventorySummary.provider === 'kiro';
  if (isInventoryProviderKiro) {
    return {
      value: inventorySummary.provider,
      label: inventorySummary.provider,
      hint: 'archive old Kiro CLI sessions',
    };
  }

  const isInventoryProviderGrok = inventorySummary.provider === 'grok';
  if (isInventoryProviderGrok) {
    return {
      value: inventorySummary.provider,
      label: inventorySummary.provider,
      hint: 'archive old Grok multi-file session directories',
    };
  }

  const isInventoryProviderKimi = inventorySummary.provider === 'kimi';
  if (isInventoryProviderKimi) {
    return {
      value: inventorySummary.provider,
      label: inventorySummary.provider,
      hint: 'archive old Kimi Code multi-file sessions',
    };
  }

  const isOpencodeProvider = inventorySummary.provider === 'opencode';
  if (isOpencodeProvider) {
    return {
      value: inventorySummary.provider,
      label: inventorySummary.provider,
      hint: 'archive old OpenCode local sessions when present',
    };
  }

  const isGeminiProvider = inventorySummary.provider === 'gemini';
  if (isGeminiProvider) {
    return {
      value: inventorySummary.provider,
      label: inventorySummary.provider,
      hint: 'archive old Gemini CLI sessions when present',
    };
  }

  return {
    value: inventorySummary.provider,
    label: inventorySummary.provider,
    hint: 'backup-only proof; native mutation disabled for safety',
  };
};

const createSetupSummary = (summary: {
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

const createSetupSavedCopy = (): string =>
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

const readFirstSetupCopy = (): string =>
  [
    'This setup writes Agent Session Pack config only.',
    'It does not pack, delete, or restore session files.',
  ].join('\n');

const validateDurationString = (duration: string | undefined): string | undefined => {
  const isDurationMissing = duration == null;
  if (isDurationMissing) {
    return 'Use a duration such as 12h, 7d, 2w, or 30d.';
  }

  const isDurationFormat = /^\d+(h|d|w)$/.test(duration);
  if (isDurationFormat) {
    return undefined;
  }

  return 'Use a duration such as 12h, 7d, 2w, or 30d.';
};
