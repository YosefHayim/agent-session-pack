import { constants, type Stats } from 'node:fs';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { throwWrappedError } from '@/rethrow-as-error.js';
import { ProviderIdSchema } from '@/session-model.js';

/**
 * Schema describing persisted setup configuration.
 */
const SetupSettingsSchema = z.object({
  version: z.literal(1),
  providers: z.array(ProviderIdSchema),
  vaultPath: z.string(),
  coldAfter: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** When true, `ensure-restored` may write native session files on launch helpers. */
  restoreOnLaunch: z.boolean().optional(),
  /** Optional cache window (e.g. `7d`) for how long restored sessions stay live. */
  restoreCacheAfter: z.string().optional(),
});

/**
 * Decoded setup configuration record.
 */
export type SetupSettings = z.infer<typeof SetupSettingsSchema>;

/**
 * Reports whether restore-on-launch lifecycle helpers are enabled in setup config.
 */
export const isRestoreOnLaunchEnabled = (settings: SetupSettings | null): boolean =>
  settings?.restoreOnLaunch === true;

/**
 * Vault path that has passed setup validation.
 */
export type ValidatedVaultPath = {
  readonly path: string;
};

/**
 * Inputs required to validate a proposed vault path.
 */
export type VaultPathValidationRequest = {
  readonly home: string;
  readonly inputPath: string;
  readonly providerRoots: ReadonlyArray<string>;
};

/**
 * Inputs required to persist setup configuration.
 */
export type WriteSetupSettingsRequest = {
  readonly home: string;
  readonly config: SetupSettings;
};

/**
 * Expands a user-entered path against the current home directory.
 */
export const expandHomePath = (path: string, home: string): string => {
  const isPathEmpty = path === '~';
  if (isPathEmpty) {
    return home;
  }

  const isHomeRelativePath = path.startsWith('~/');
  if (isHomeRelativePath) {
    return join(home, path.slice(2));
  }

  return resolve(path);
};

/**
 * Resolves the setup config pointer stored below the default Agent Session Pack directory.
 */
export const createSettingsPath = (home: string): string =>
  join(home, '.agent-session-pack', 'config.json');

/**
 * Validates a proposed archive vault path before setup writes config, throwing when it is rejected.
 */
export const validateVaultPath = async (
  request: VaultPathValidationRequest,
): Promise<ValidatedVaultPath> => {
  const trimmedPath = request.inputPath.trim();

  const isPathEmpty = trimmedPath.length === 0;

  if (isPathEmpty) {
    throw new Error('Vault path cannot be empty.');
  }

  const path = expandHomePath(trimmedPath, request.home);
  const providerRoots = request.providerRoots.map((providerRoot) =>
    expandHomePath(providerRoot, request.home),
  );

  const isInsideProviderStore = providerRoots.some((providerRoot) =>
    isPathInsideOrSame(path, providerRoot),
  );

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
};

/**
 * Reads saved setup config when it exists, or undefined when setup has not run.
 */
export const readSetupSettings = async (home: string): Promise<SetupSettings | null> => {
  const settingsPath = createSettingsPath(home);
  const settingsString = await readSettingsString(settingsPath).catch(throwWrappedError);

  const isSettingsMissing = settingsString == null;

  if (isSettingsMissing) {
    return null;
  }

  return SetupSettingsSchema.parse(JSON.parse(settingsString));
};

/**
 * Writes setup config and creates the selected vault directory.
 */
export const writeSetupSettings = async (request: WriteSetupSettingsRequest): Promise<void> => {
  const settingsPath = createSettingsPath(request.home);
  await mkdir(dirname(settingsPath), { recursive: true }).catch(throwWrappedError);
  await mkdir(request.config.vaultPath, { recursive: true }).catch(throwWrappedError);
  await writeFile(settingsPath, `${JSON.stringify(request.config, null, 2)}\n`).catch(
    throwWrappedError,
  );
};

const readSettingsString = async (settingsPath: string): Promise<string | null> => {
  try {
    return await readFile(settingsPath, 'utf8');
  } catch (cause) {
    const isSettingsMissing = readErrorCode(cause) === 'ENOENT';

    if (isSettingsMissing) {
      return null;
    }

    return throwWrappedError(cause);
  }
};

const assertExistingVaultDirectory = async (request: {
  readonly path: string;
  readonly targetStat: Stats;
}): Promise<void> => {
  const isNotTargetDirectory = !request.targetStat.isDirectory();

  if (isNotTargetDirectory) {
    throw new Error('Vault path exists but is not a directory.');
  }

  await assertWritable(request.path);
};

const assertNewVaultParent = async (path: string): Promise<void> => {
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
};

const readStatOptional = async (path: string): Promise<Stats | null> => {
  try {
    return await stat(path);
  } catch (cause) {
    const isPathMissing = readErrorCode(cause) === 'ENOENT';

    if (isPathMissing) {
      return null;
    }

    throw new Error(String(cause), { cause });
  }
};

const assertWritable = async (path: string): Promise<void> => {
  await access(path, constants.W_OK).catch(() => {
    throw new Error('Vault path is not writable.');
  });
};

const isPathInsideOrSame = (path: string, parentPath: string): boolean => {
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
};

const readErrorCode = (cause: unknown): string | null => {
  const isCauseNotObject = typeof cause !== 'object' || cause === null;
  if (isCauseNotObject) {
    return null;
  }

  const hasNoErrorCode = !('code' in cause);
  if (hasNoErrorCode) {
    return null;
  }

  return String(cause.code);
};
