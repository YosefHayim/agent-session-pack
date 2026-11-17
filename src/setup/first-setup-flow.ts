import { HOME_NOT_SET_CANCEL_MESSAGE, readHomeFolder } from '@/environment.js';
import type { InteractiveCliRequest } from '@/interactive-cli-request.js';
import { DEFAULT_COLD_AFTER, DEFAULT_COLD_AFTER_MS } from '@/pack/plan.js';
import type { PromptAdapter } from '@/prompt-adapter.js';
import { clackPromptAdapter, type PromptOption } from '@/prompt-adapter.js';
import { allProviders } from '@/providers/all-providers.js';
import { createProviderInventoryTable, loadInventoryWithSpinner } from '@/scan/inventory-prompt.js';
import type { ProviderInventoryReport } from '@/scan/provider-inventory.js';
import type { ProviderAdapter, ProviderId } from '@/session-model.js';
import { validateVaultPath, writeSetupSettings } from './config.js';

const DEFAULT_VAULT_PATH = '~/.agent-session-pack';
const SETUP_CANCELLED_MESSAGE = 'No files changed.';
const DURATION_HINT_MESSAGE = 'Use a duration such as 12h, 7d, 2w, or 30d.';

type ColdThresholdChoice = '14d' | '30d' | '7d' | 'custom';
type VaultPathChoice = 'custom' | 'default';
type FlowReport = 'cancelled' | 'saved';

export type FirstSetupRequest = InteractiveCliRequest & {
  readonly showIntro?: boolean;
};

export async function runFirstSetup(request: FirstSetupRequest = {}): Promise<FlowReport> {
  const prompts = request.prompts ?? clackPromptAdapter;
  const home = request.home ?? readHomeFolder();

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
    prompts.cancel(SETUP_CANCELLED_MESSAGE);
    return 'cancelled';
  }

  const coldAfter = await askColdThreshold(prompts);

  const isColdAfterMissing = coldAfter == null;
  if (isColdAfterMissing) {
    prompts.cancel(SETUP_CANCELLED_MESSAGE);
    return 'cancelled';
  }

  const vaultPath = await askVaultPath({
    home,
    prompts,
    providers,
  });

  const isVaultPathMissing = vaultPath == null;
  if (isVaultPathMissing) {
    prompts.cancel(SETUP_CANCELLED_MESSAGE);
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

  const isSaveCancelled = prompts.isCancel(shouldSave);
  if (isSaveCancelled) {
    prompts.cancel(SETUP_CANCELLED_MESSAGE);
    return 'cancelled';
  }

  const isSaveDeclined = shouldSave !== true;
  if (isSaveDeclined) {
    prompts.cancel(SETUP_CANCELLED_MESSAGE);
    return 'cancelled';
  }

  const timestamp = now.toISOString();
  await writeSetupSettings({
    home,
    config: {
      version: 1,
      providers: [...selectedProviders],
      vaultPath,
      coldAfter,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  });

  prompts.outro(createSetupSavedCopy());
  return 'saved';
}

async function askProviderSelection(request: {
  readonly inventory: ProviderInventoryReport;
  readonly prompts: PromptAdapter;
}): Promise<ReadonlyArray<ProviderId> | null> {
  const choices = request.inventory.rows.map(createProviderPromptOption);

  while (true) {
    const selectedProviders = await request.prompts.multiselect<ProviderId>({
      message: 'Which providers should Agent Session Pack manage?',
      options: choices,
      required: false,
    });

    const isSelectionCancelled = request.prompts.isCancel(selectedProviders);
    if (isSelectionCancelled) {
      return null;
    }

    const hasSelectedProviders = selectedProviders.length > 0;
    if (hasSelectedProviders) {
      return selectedProviders;
    }

    request.prompts.note('Choose at least one provider or cancel setup.', 'No providers selected');
  }
}

async function askColdThreshold(prompts: PromptAdapter): Promise<string | null> {
  const choice = await prompts.select<ColdThresholdChoice>({
    message: 'When is a session considered cold?',
    options: [
      {
        value: DEFAULT_COLD_AFTER,
        label: '7 days',
        hint: 'recommended; protects normal active work',
      },
      { value: '14d', label: '14 days', hint: 'safer for long-running sessions' },
      { value: '30d', label: '30 days', hint: 'conservative cleanup' },
      { value: 'custom', label: 'Custom', hint: 'enter 12h, 7d, 2w, or 30d' },
    ],
    initialValue: DEFAULT_COLD_AFTER,
  });

  const isChoiceCancel = prompts.isCancel(choice);
  if (isChoiceCancel) {
    return null;
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
    return null;
  }

  return custom;
}

async function askVaultPath(request: {
  readonly home: string;
  readonly prompts: PromptAdapter;
  readonly providers: ReadonlyArray<ProviderAdapter>;
}): Promise<string | null> {
  const choice = await request.prompts.select<VaultPathChoice>({
    message: 'Where should archives be stored?',
    options: [
      {
        value: 'default',
        label: DEFAULT_VAULT_PATH,
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
    return null;
  }

  const isChoiceDefault = choice === 'default';
  if (isChoiceDefault) {
    return validateVaultPathDetails({
      home: request.home,
      inputPath: DEFAULT_VAULT_PATH,
      prompts: request.prompts,
      providers: request.providers,
    });
  }

  return askCustomVaultPath(request);
}

async function askCustomVaultPath(request: {
  readonly home: string;
  readonly prompts: PromptAdapter;
  readonly providers: ReadonlyArray<ProviderAdapter>;
}): Promise<string | null> {
  while (true) {
    const typedPath = await request.prompts.text({
      message: 'Enter vault path',
      initialValue: DEFAULT_VAULT_PATH,
    });

    const isPathCancel = request.prompts.isCancel(typedPath);
    if (isPathCancel) {
      return null;
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
}

async function validateVaultPathDetails(request: {
  readonly home: string;
  readonly inputPath: string;
  readonly prompts: PromptAdapter;
  readonly providers: ReadonlyArray<ProviderAdapter>;
}): Promise<string | null> {
  function listDefaultRoots(provider: ProviderAdapter): ReadonlyArray<string> {
    return provider.defaultRoots(request.home);
  }

  const providerRoots = request.providers.flatMap(listDefaultRoots);

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
    return null;
  }
}

function createProviderPromptOption(
  inventorySummary: ProviderInventoryReport['rows'][number],
): PromptOption<ProviderId> {
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
}

function createSetupSummary(summary: {
  readonly providers: ReadonlyArray<ProviderId>;
  readonly vaultPath: string;
  readonly coldAfter: string;
}): string {
  return [
    `Providers: ${summary.providers.join(', ')}`,
    `Vault: ${summary.vaultPath}`,
    `Cold after: ${summary.coldAfter}`,
    'Safety:',
    '  - dry-run before apply',
    '  - recent sessions guarded',
    '  - restore verified before original removal',
    '  - changed live files never overwritten',
  ].join('\n');
}

function createSetupSavedCopy(): string {
  return [
    'Setup saved.',
    '',
    'Next command:',
    '  Local repo:     pnpm dev',
    '  One-off npm:    npx --yes agent-session-pack',
    '  Installed CLI:  agent-session-pack',
    '',
    'Then choose "Check savings" or "Pack cold sessions".',
  ].join('\n');
}

function readFirstSetupCopy(): string {
  return [
    'This setup writes Agent Session Pack config only.',
    'It does not pack, delete, or restore session files.',
  ].join('\n');
}

function validateDurationString(duration: string | undefined): string | undefined {
  const isDurationMissing = duration == null;
  if (isDurationMissing) {
    return DURATION_HINT_MESSAGE;
  }

  // Catches a whole number followed by h, d, or w, such as 12h or 7d.
  const isDurationFormat = /^\d+(h|d|w)$/.test(duration);
  if (isDurationFormat) {
    return undefined;
  }

  return DURATION_HINT_MESSAGE;
}
