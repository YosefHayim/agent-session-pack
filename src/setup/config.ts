import { constants, type Stats } from 'node:fs';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { throwWrappedError } from '@/rethrow-as-error.js';
import { ProviderIdSchema } from '@/session-model.js';

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
  const isPathEmpty = path === '~';
  if (isPathEmpty) {
    return home;
  }

  const isHomeRelativePath = path.startsWith('~/');
  if (isHomeRelativePath) {
    return join(home, path.slice(2));
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
}

export async function readSetupSettings(home: string): Promise<SetupSettings | null> {
  const settingsPath = createSettingsPath(home);
  const settingsString = await readSettingsString(settingsPath).catch(throwWrappedError);

  const isSettingsMissing = settingsString == null;

  if (isSettingsMissing) {
    return null;
  }

  return SetupSettingsSchema.parse(JSON.parse(settingsString));
}

export async function writeSetupSettings(request: WriteSetupSettingsRequest): Promise<void> {
  const settingsPath = createSettingsPath(request.home);
  await mkdir(dirname(settingsPath), { recursive: true }).catch(throwWrappedError);
  await mkdir(request.config.vaultPath, { recursive: true }).catch(throwWrappedError);
  await writeFile(settingsPath, `${JSON.stringify(request.config, null, 2)}\n`).catch(
    throwWrappedError,
  );
}

async function readSettingsString(settingsPath: string): Promise<string | null> {
  try {
    return await readFile(settingsPath, 'utf8');
  } catch (cause) {
    const isSettingsMissing = readErrorCode(cause) === 'ENOENT';

    if (isSettingsMissing) {
      return null;
    }

    return throwWrappedError(cause);
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
  } catch (cause) {
    const isPathMissing = readErrorCode(cause) === 'ENOENT';

    if (isPathMissing) {
      return null;
    }

    throw new Error(String(cause), { cause });
  }
}

async function assertWritable(path: string): Promise<void> {
  await access(path, constants.W_OK).catch(() => {
    throw new Error('Vault path is not writable.');
  });
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

function readErrorCode(cause: unknown): string | null {
  const isCauseNotObject = typeof cause !== 'object' || cause === null;
  if (isCauseNotObject) {
    return null;
  }

  const hasNoErrorCode = !('code' in cause);
  if (hasNoErrorCode) {
    return null;
  }

  return String(cause.code);
}
