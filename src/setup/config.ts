import { constants, type Stats } from 'node:fs';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { ProviderIdSchema } from '@/session-model.js';

const HOME_PREFIX = '~/';
const MISSING_PATH_CODE = 'ENOENT';

const SetupSettingsSchema = z.object({
  version: z.literal(1),
  providers: z.array(ProviderIdSchema),
  vaultPath: z.string(),
  coldAfter: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  restoreOnLaunch: z.boolean().optional(),
  restoreCacheAfter: z.string().optional(),
});

export type SetupSettings = z.infer<typeof SetupSettingsSchema>;

export function isRestoreOnLaunchEnabled(settings: SetupSettings | null): boolean {
  return settings?.restoreOnLaunch === true;
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
  const isHomeOnlyPath = path === '~';
  if (isHomeOnlyPath) {
    return home;
  }

  const isHomeRelativePath = path.startsWith(HOME_PREFIX);
  if (isHomeRelativePath) {
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

  const isPathEmpty = trimmedPath.length === 0;
  if (isPathEmpty) {
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

  const isInsideProviderStore = providerRoots.some(isPathInsideProviderRoot);
  if (isInsideProviderStore) {
    throw new Error('Vault path cannot be inside a provider session store.');
  }

  const targetStat = await readStatOptional(path);

  const isTargetFound = targetStat != null;
  if (isTargetFound) {
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

  return SetupSettingsSchema.parse(JSON.parse(settingsFileContents));
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
    const isSettingsMissing = readErrorCode(error) === MISSING_PATH_CODE;
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
  const isNotTargetDirectory = !request.targetStat.isDirectory();
  if (isNotTargetDirectory) {
    throw new Error('Vault path exists but is not a directory.');
  }

  await assertWritable(request.path);
}

async function assertNewVaultParent(path: string): Promise<void> {
  const parentPath = dirname(path);
  const parentStat = await readStatOptional(parentPath);

  const isParentMissing = parentStat == null;
  if (isParentMissing) {
    throw new Error('Vault parent directory does not exist.');
  }

  const isNotParentDirectory = !parentStat.isDirectory();
  if (isNotParentDirectory) {
    throw new Error('Vault parent path exists but is not a directory.');
  }

  await assertWritable(parentPath);
}

async function readStatOptional(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    const isPathMissing = readErrorCode(error) === MISSING_PATH_CODE;
    if (isPathMissing) {
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

  const isRelativePathEmpty = relativePath.length === 0;
  if (isRelativePathEmpty) {
    return true;
  }

  const isOutsideRoot = relativePath.startsWith('..');
  if (isOutsideRoot) {
    return false;
  }

  return !isAbsolute(relativePath);
}

function readErrorCode(error: unknown): string | null {
  const isErrorNotObject = typeof error !== 'object';
  if (isErrorNotObject) {
    return null;
  }

  const isErrorNull = error === null;
  if (isErrorNull) {
    return null;
  }

  const hasNoErrorCode = !('code' in error);
  if (hasNoErrorCode) {
    return null;
  }

  return String(error.code);
}
