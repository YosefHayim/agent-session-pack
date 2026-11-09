import { constants, type Stats } from 'node:fs';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { rethrowAsError } from '@/rethrow-as-error.js';
import { ProviderIdSchema } from '@/session-model.js';

/**
 * Schema describing persisted setup configuration.
 */
const SetupConfigSchema = z.object({
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
export type SetupConfig = z.infer<typeof SetupConfigSchema>;

/**
 * Reports whether restore-on-launch lifecycle helpers are enabled in setup config.
 */
export const isRestoreOnLaunchEnabled = (config: SetupConfig | undefined): boolean =>
  config?.restoreOnLaunch === true;

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
export type WriteSetupConfigRequest = {
  readonly home: string;
  readonly config: SetupConfig;
};

/**
 * Expands a user-entered path against the current home directory.
 */
export const expandHomePath = (path: string, home: string): string => {
  const isPathEmpty = path === '~';
  if (isPathEmpty) {
    return home;
  }

  const isPathStartsWithEmpty = path.startsWith('~/');
  if (isPathStartsWithEmpty) {
    return join(home, path.slice(2));
  }

  return resolve(path);
};

/**
 * Resolves the setup config pointer stored below the default Agent Session Pack directory.
 */
export const resolveConfigPath = (home: string): string =>
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

  const targetStat = await statOptional(path);

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
export const readSetupConfig = async (home: string): Promise<SetupConfig | undefined> => {
  const configPath = resolveConfigPath(home);
  const configText = await readConfigText(configPath).catch(rethrowAsError);

  const isConfigMissing = configText == null;

  if (isConfigMissing) {
    return undefined;
  }

  return SetupConfigSchema.parse(JSON.parse(configText));
};

/**
 * Writes setup config and creates the selected vault directory.
 */
export const writeSetupConfig = async (request: WriteSetupConfigRequest): Promise<void> => {
  const configPath = resolveConfigPath(request.home);
  await mkdir(dirname(configPath), { recursive: true }).catch(rethrowAsError);
  await mkdir(request.config.vaultPath, { recursive: true }).catch(rethrowAsError);
  await writeFile(configPath, `${JSON.stringify(request.config, null, 2)}\n`).catch(rethrowAsError);
};

const readConfigText = async (configPath: string): Promise<string | null> => {
  try {
    return await readFile(configPath, 'utf8');
  } catch (cause) {
    const isConfigMissing = errorCode(cause) === 'ENOENT';

    if (isConfigMissing) {
      return null;
    }

    return rethrowAsError(cause);
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
  const parentStat = await statOptional(parentPath);

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

const statOptional = async (path: string): Promise<Stats | undefined> => {
  try {
    return await stat(path);
  } catch (cause) {
    const isPathMissing = errorCode(cause) === 'ENOENT';

    if (isPathMissing) {
      return undefined;
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

  const isRelativePathStartsWithEmpty = relativePath.startsWith('..');
  if (isRelativePathStartsWithEmpty) {
    return false;
  }

  return !isAbsolute(relativePath);
};

const errorCode = (cause: unknown): string | undefined => {
  const isCauseNotObject = typeof cause !== 'object' || cause === null;
  if (isCauseNotObject) {
    return undefined;
  }

  const hasNoErrorCode = !('code' in cause);
  if (hasNoErrorCode) {
    return undefined;
  }

  return String(cause.code);
};
