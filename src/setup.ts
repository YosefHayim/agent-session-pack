import { constants, type Stats } from 'node:fs';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { type CommandExit, HOME_NOT_SET_CANCEL_MESSAGE, readHomeFolder } from './archive.js';
import { DEFAULT_COLD_AFTER, DEFAULT_COLD_AFTER_MS } from './pack.js';
import {
  type InteractiveCliRequest,
  type PromptAdapter,
  type PromptOption,
  terminalPromptAdapter,
} from './prompts.js';
import {
  allProviders,
  type ProviderAdapter,
  type ProviderId,
  readProviderId,
} from './providers.js';
import {
  createProviderInventoryTable,
  loadInventoryWithSpinner,
  type ProviderInventoryReport,
} from './scan.js';

const HOME_PREFIX = '~/';
const MISSING_PATH_CODE = 'ENOENT';

export interface SetupSettings {
  readonly version: 1;
  readonly providers: ReadonlyArray<ProviderId>;
  readonly vaultPath: string;
  readonly coldAfter: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly restoreOnLaunch?: boolean;
  readonly restoreCacheAfter?: string;
  readonly packOnAgentExit?: boolean;
}

export function isRestoreOnLaunchEnabled(settings: SetupSettings | null): boolean {
  return settings?.restoreOnLaunch == true;
}

export interface ValidatedVaultPath {
  readonly path: string;
}

export interface VaultPathValidationRequest {
  readonly home: string;
  readonly inputPath: string;
  readonly providerRoots: ReadonlyArray<string>;
}

export interface WriteSetupSettingsRequest {
  readonly home: string;
  readonly config: SetupSettings;
}

export function expandHomePath(path: string, home: string): string {
  if (path == '~') {
    return home;
  }

  if (path.startsWith(HOME_PREFIX)) {
    return join(home, path.slice(HOME_PREFIX.length));
  }

  return resolve(path);
}

export function createSettingsPath(home: string): string {
  return join(home, '.agent-session-pack', 'config.json');
}

export async function validateVaultPath(
  request: VaultPathValidationRequest,
): Promise<ValidatedVaultPath> {
  const trimmedPath = request.inputPath.trim();

  if (trimmedPath.length == 0) {
    throw new Error('Vault path cannot be empty.');
  }

  const path = expandHomePath(trimmedPath, request.home);

  function expandProviderRoot(providerRoot: string): string {
    return expandHomePath(providerRoot, request.home);
  }

  function isPathInsideProviderRoot(providerRoot: string): boolean {
    return isPathInsideOrSame(path, providerRoot);
  }

  const providerRoots = request.providerRoots.map(expandProviderRoot);

  if (providerRoots.some(isPathInsideProviderRoot)) {
    throw new Error('Vault path cannot be inside a provider session store.');
  }

  const targetStat = await readStatOptional(path);

  if (targetStat != null) {
    await assertExistingVaultDirectory({ path, targetStat });
    return { path };
  }

  await assertNewVaultParent(path);
  return { path };
}

export async function readSetupSettings(home: string): Promise<SetupSettings | null> {
  const settingsPath = createSettingsPath(home);

  var settingsString: string | null;
  try {
    settingsString = await readSettingsString(settingsPath);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }

  const settingsFileContents = settingsString;

  const isSettingsMissing = settingsFileContents == null;
  if (isSettingsMissing) {
    return null;
  }

  return readSetupSettingsDocument(JSON.parse(settingsFileContents));
}

function readSetupSettingsDocument(parsed: unknown): SetupSettings {
  const settingsFields = readSettingsFields(parsed);
  const version = settingsFields.version;
  if (version != 1) {
    throw new Error('Setup settings field version must be 1.');
  }

  const settings: SetupSettings = {
    version: 1,
    providers: readProviderList(settingsFields.providers),
    vaultPath: readRequiredSettingsString(settingsFields, 'vaultPath'),
    coldAfter: readRequiredSettingsString(settingsFields, 'coldAfter'),
    createdAt: readRequiredSettingsString(settingsFields, 'createdAt'),
    updatedAt: readRequiredSettingsString(settingsFields, 'updatedAt'),
  };

  return {
    ...settings,
    ...readOptionalSettings(settingsFields),
  };
}

function readSettingsFields(parsed: unknown): Record<string, unknown> {
  if (typeof parsed != 'object') {
    throw new Error('Setup settings must be an object.');
  }

  if (parsed == null) {
    throw new Error('Setup settings must be an object.');
  }

  const isArray = Array.isArray(parsed);

  if (isArray) {
    throw new Error('Setup settings must be an object.');
  }

  return parsed as Record<string, unknown>;
}

function readRequiredSettingsString(
  settingsFields: Record<string, unknown>,
  fieldName: string,
): string {
  const field = settingsFields[fieldName];
  const isNotString = typeof field != 'string';

  if (isNotString) {
    throw new Error(`Setup settings field ${fieldName} must be a string.`);
  }

  if (field.length == 0) {
    throw new Error(`Setup settings field ${fieldName} must be a string.`);
  }

  return field;
}

function readProviderList(field: unknown): ReadonlyArray<ProviderId> {
  if (Array.isArray(field) == false) {
    throw new Error('Setup settings field providers must be a list of provider ids.');
  }

  const providerIds: ProviderId[] = [];

  for (const candidate of field) {
    const isNotString = typeof candidate != 'string';

    if (isNotString) {
      throw new Error('Setup settings field providers must be a list of provider ids.');
    }

    const providerId = readProviderId(candidate);
    if (providerId == null) {
      throw new Error('Setup settings field providers must be a list of provider ids.');
    }

    providerIds.push(providerId);
  }

  return providerIds;
}

function readOptionalSettings(
  settingsFields: Record<string, unknown>,
): Pick<SetupSettings, 'restoreOnLaunch' | 'restoreCacheAfter' | 'packOnAgentExit'> {
  return {
    restoreOnLaunch: readOptionalBoolean(settingsFields, 'restoreOnLaunch'),
    restoreCacheAfter: readOptionalString(settingsFields, 'restoreCacheAfter'),
    packOnAgentExit: readOptionalBoolean(settingsFields, 'packOnAgentExit'),
  };
}

function readOptionalBoolean(
  settingsFields: Record<string, unknown>,
  fieldName: string,
): boolean | undefined {
  const isFieldMissing = Object.hasOwn(settingsFields, fieldName) == false;

  if (isFieldMissing) {
    return undefined;
  }

  const field = settingsFields[fieldName];
  if (typeof field == 'boolean') {
    return field;
  }

  throw new Error(`Setup settings field ${fieldName} must be a boolean.`);
}

function readOptionalString(
  settingsFields: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  const isFieldMissing = Object.hasOwn(settingsFields, fieldName) == false;

  if (isFieldMissing) {
    return undefined;
  }

  const field = settingsFields[fieldName];
  if (typeof field == 'string') {
    return field;
  }

  throw new Error(`Setup settings field ${fieldName} must be a string.`);
}

export async function writeSetupSettings(request: WriteSetupSettingsRequest): Promise<void> {
  const settingsPath = createSettingsPath(request.home);

  try {
    await mkdir(dirname(settingsPath), { recursive: true });
    await mkdir(request.config.vaultPath, { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(request.config, null, 2)}\n`);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

async function readSettingsString(settingsPath: string): Promise<string | null> {
  try {
    return await readFile(settingsPath, 'utf8');
  } catch (error) {
    const isSettingsMissing = readErrorCode(error) == MISSING_PATH_CODE;
    if (isSettingsMissing) {
      return null;
    }

    throw new Error(String(error), { cause: error });
  }
}

async function assertExistingVaultDirectory(request: {
  readonly path: string;
  readonly targetStat: Stats;
}): Promise<void> {
  if (!request.targetStat.isDirectory()) {
    throw new Error('Vault path exists but is not a directory.');
  }

  await assertWritable(request.path);
}

async function assertNewVaultParent(path: string): Promise<void> {
  const parentPath = dirname(path);
  const parentStat = await readStatOptional(parentPath);

  if (parentStat == null) {
    throw new Error('Vault parent directory does not exist.');
  }

  if (!parentStat.isDirectory()) {
    throw new Error('Vault parent path exists but is not a directory.');
  }

  await assertWritable(parentPath);
}

async function readStatOptional(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (readErrorCode(error) == MISSING_PATH_CODE) {
      return null;
    }

    throw new Error(String(error), { cause: error });
  }
}

async function assertWritable(path: string): Promise<void> {
  try {
    await access(path, constants.W_OK);
  } catch {
    throw new Error('Vault path is not writable.');
  }
}

function isPathInsideOrSame(path: string, parentPath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(path));

  if (relativePath.length == 0) {
    return true;
  }

  if (relativePath.startsWith('..')) {
    return false;
  }

  return !isAbsolute(relativePath);
}

function readErrorCode(error: unknown): string | null {
  if (typeof error != 'object') {
    return null;
  }

  if (error == null) {
    return null;
  }

  if (!('code' in error)) {
    return null;
  }

  return String(error.code);
}

export interface InitFlags {
  readonly apply?: boolean;
  readonly json?: boolean;
}

export async function runInitCommand(flags: InitFlags): Promise<CommandExit> {
  if (flags.json == true) {
    process.stdout.write(
      `${JSON.stringify({
        vaultPath: '~/.agent-session-pack',
        coldAfter: DEFAULT_COLD_AFTER,
        restoreCacheAfter: '7d',
        lifecycle: 'manual-proof-only',
        plannedLifecycle: 'restore-on-launch-pack-on-close',
        apply: flags.apply == true,
      })}\n`,
    );
    return { exitCode: 0 };
  }

  if (isTerminalSession()) {
    await runFirstSetup();
    return { exitCode: 0 };
  }

  process.stdout.write('Agent Session Pack init\n');
  process.stdout.write(
    'Defaults: vault ~/.agent-session-pack, coldAfter 7d, restoreCacheAfter 7d.\n',
  );
  process.stdout.write(
    'Lifecycle target: restore selected provider sessions on relaunch, then pack cold sessions after close.\n',
  );
  process.stdout.write('Provider selection will be explicit before lifecycle hooks are written.\n');
  process.stdout.write('Dry run only. Re-run with --apply to write config.\n');
  process.stdout.write('No files changed.\n');
  return { exitCode: 0 };
}

function isTerminalSession(): boolean {
  if (process.stdin.isTTY != true) {
    return false;
  }

  return process.stdout.isTTY == true;
}

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
  const prompts = request.prompts ?? terminalPromptAdapter;
  const home = request.home ?? readHomeFolder();

  if (home == null) {
    prompts.cancel(HOME_NOT_SET_CANCEL_MESSAGE);
    return 'cancelled';
  }

  if (request.showIntro != false) {
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

  if (selectedProviders == null) {
    prompts.cancel(SETUP_CANCELLED_MESSAGE);
    return 'cancelled';
  }

  const coldAfter = await askColdThreshold(prompts);

  if (coldAfter == null) {
    prompts.cancel(SETUP_CANCELLED_MESSAGE);
    return 'cancelled';
  }

  const vaultPath = await askVaultPath({
    home,
    prompts,
    providers,
  });

  if (vaultPath == null) {
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

  if (prompts.isCancel(shouldSave)) {
    prompts.cancel(SETUP_CANCELLED_MESSAGE);
    return 'cancelled';
  }

  if (shouldSave != true) {
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

    if (request.prompts.isCancel(selectedProviders)) {
      return null;
    }

    if (selectedProviders.length > 0) {
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

  if (choice != 'custom') {
    return choice;
  }

  const custom = await prompts.text({
    message: 'Enter cold threshold',
    placeholder: DEFAULT_COLD_AFTER,
    validate: validateDurationString,
  });

  if (prompts.isCancel(custom)) {
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

  if (choice == 'default') {
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

    if (request.prompts.isCancel(typedPath)) {
      return null;
    }

    const validatedPath = await validateVaultPathDetails({
      home: request.home,
      inputPath: typedPath,
      prompts: request.prompts,
      providers: request.providers,
    });

    if (validatedPath != null) {
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

const PROVIDER_ARCHIVE_HINTS: Partial<Record<ProviderId, string>> = {
  codex: 'archive old JSONL sessions; restore byte-exact when needed',
  claude: 'archive old Claude Code project sessions',
  kiro: 'archive old Kiro CLI sessions',
  grok: 'archive old Grok multi-file session directories',
  kimi: 'archive old Kimi Code multi-file sessions',
  opencode: 'archive old OpenCode local sessions when present',
  gemini: 'archive old Gemini CLI sessions when present',
};

function createProviderPromptOption(
  inventorySummary: ProviderInventoryReport['rows'][number],
): PromptOption<ProviderId> {
  return {
    value: inventorySummary.provider,
    label: inventorySummary.provider,
    hint:
      PROVIDER_ARCHIVE_HINTS[inventorySummary.provider] ??
      'backup-only proof; native mutation disabled for safety',
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
  if (duration == null) {
    return DURATION_HINT_MESSAGE;
  }

  // Catches a whole number followed by h, d, or w, such as 12h or 7d.
  if (/^\d+(h|d|w)$/.test(duration)) {
    return undefined;
  }

  return DURATION_HINT_MESSAGE;
}
