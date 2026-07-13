import { constants } from 'node:fs';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Effect, Schema } from 'effect';
import { ProviderIdSchema } from './sessionStore.js';

/**
 * Schema describing persisted setup configuration.
 */
export const SetupConfigSchema = Schema.Struct({
  version: Schema.Literal(1),
  providers: Schema.Array(ProviderIdSchema),
  vaultPath: Schema.String,
  coldAfter: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

/**
 * Decoded setup configuration record.
 */
export type SetupConfig = typeof SetupConfigSchema.Type;

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
 * Typed error raised when a proposed vault path is rejected.
 */
export class VaultPathValidationError extends Schema.TaggedError<VaultPathValidationError>()(
  'VaultPathValidationError',
  {
    inputPath: Schema.String,
    reason: Schema.Literal(
      'empty',
      'inside-provider-store',
      'not-directory',
      'parent-missing',
      'parent-not-directory',
      'not-writable',
      'stat-failed',
    ),
    message: Schema.String,
  },
) {}

/**
 * Typed error raised when reading or writing the setup config file fails.
 */
export class SetupConfigFileError extends Schema.TaggedError<SetupConfigFileError>()(
  'SetupConfigFileError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

/**
 * Expands a user-entered path against the current home directory.
 *
 * @param path - Raw path from CLI input.
 * @param home - User home directory.
 * @returns Absolute path with leading `~` resolved.
 * @example
 * ```ts
 * import { expandHomePath } from './setupConfig.js';
 *
 * const absolutePath = expandHomePath('~/vault', process.env.HOME ?? '');
 * ```
 */
export const expandHomePath = (path: string, home: string): string => {
  if (path === '~') {
    return home;
  }

  if (path.startsWith('~/')) {
    return join(home, path.slice(2));
  }

  if (isAbsolute(path)) {
    return resolve(path);
  }

  return resolve(path);
};

/**
 * Resolves the setup config pointer stored below the default Agent Session Pack directory.
 *
 * @param home - User home directory.
 * @returns Config file path.
 * @example
 * ```ts
 * import { resolveConfigPath } from './setupConfig.js';
 *
 * const configPath = resolveConfigPath(process.env.HOME ?? '');
 * ```
 */
export const resolveConfigPath = (home: string): string =>
  join(home, '.agent-session-pack', 'config.json');

/**
 * Validates a proposed archive vault path before setup writes config.
 *
 * @param request - Home, raw path, and provider roots to protect.
 * @returns Validated absolute vault path.
 * @example
 * ```ts
 * import { validateVaultPath } from './setupConfig.js';
 *
 * const validated = await Effect.runPromise(
 *   validateVaultPath({ home: process.env.HOME ?? '', inputPath: '~/vault', providerRoots: [] }),
 * );
 * ```
 */
export const validateVaultPath = (
  request: VaultPathValidationRequest,
): Effect.Effect<ValidatedVaultPath, VaultPathValidationError> =>
  Effect.gen(function* () {
    const trimmedPath = request.inputPath.trim();

    if (trimmedPath.length === 0) {
      return yield* Effect.fail(
        createVaultPathError({
          inputPath: request.inputPath,
          reason: 'empty',
          message: 'Vault path cannot be empty.',
        }),
      );
    }

    const path = expandHomePath(trimmedPath, request.home);
    const providerRoots = request.providerRoots.map((providerRoot) =>
      expandHomePath(providerRoot, request.home),
    );

    if (providerRoots.some((providerRoot) => isPathInsideOrSame(path, providerRoot))) {
      return yield* Effect.fail(
        createVaultPathError({
          inputPath: request.inputPath,
          reason: 'inside-provider-store',
          message: 'Vault path cannot be inside a provider session store.',
        }),
      );
    }

    const targetStat = yield* statOptional({
      inputPath: request.inputPath,
      path,
    });

    if (targetStat !== undefined) {
      if (!targetStat.isDirectory()) {
        return yield* Effect.fail(
          createVaultPathError({
            inputPath: request.inputPath,
            reason: 'not-directory',
            message: 'Vault path exists but is not a directory.',
          }),
        );
      }

      yield* assertWritable({
        inputPath: request.inputPath,
        path,
      });

      return { path };
    }

    const parentPath = dirname(path);
    const parentStat = yield* statOptional({
      inputPath: request.inputPath,
      path: parentPath,
    });

    if (parentStat === undefined) {
      return yield* Effect.fail(
        createVaultPathError({
          inputPath: request.inputPath,
          reason: 'parent-missing',
          message: 'Vault parent directory does not exist.',
        }),
      );
    }

    if (!parentStat.isDirectory()) {
      return yield* Effect.fail(
        createVaultPathError({
          inputPath: request.inputPath,
          reason: 'parent-not-directory',
          message: 'Vault parent path exists but is not a directory.',
        }),
      );
    }

    yield* assertWritable({
      inputPath: request.inputPath,
      path: parentPath,
    });

    return { path };
  });

/**
 * Reads saved setup config when it exists.
 *
 * @param home - User home directory.
 * @returns Parsed setup config, or undefined when setup has not run.
 * @example
 * ```ts
 * import { readSetupConfig } from './setupConfig.js';
 *
 * const config = await Effect.runPromise(readSetupConfig(process.env.HOME ?? ''));
 * ```
 */
export const readSetupConfig = (
  home: string,
): Effect.Effect<SetupConfig | undefined, SetupConfigFileError> => {
  const configPath = resolveConfigPath(home);

  return Effect.tryPromise({
    try: async () => {
      const content = await readFile(configPath, 'utf8').catch((cause: unknown) => {
        if (errorCode(cause) === 'ENOENT') {
          return undefined;
        }

        return Promise.reject(cause);
      });

      if (content === undefined) {
        return undefined;
      }

      return Schema.decodeUnknownSync(SetupConfigSchema)(JSON.parse(content));
    },
    catch: (cause) =>
      new SetupConfigFileError({
        path: configPath,
        message: String(cause),
      }),
  });
};

/**
 * Writes setup config and creates the selected vault directory.
 *
 * @param request - Config and home directory.
 * @returns Effect that completes after config has been persisted.
 * @example
 * ```ts
 * import { writeSetupConfig } from './setupConfig.js';
 *
 * await Effect.runPromise(writeSetupConfig({ home: process.env.HOME ?? '', config }));
 * ```
 */
export const writeSetupConfig = (
  request: WriteSetupConfigRequest,
): Effect.Effect<void, SetupConfigFileError> => {
  const configPath = resolveConfigPath(request.home);

  return Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(configPath), { recursive: true });
      await mkdir(request.config.vaultPath, { recursive: true });
      await writeFile(configPath, `${JSON.stringify(request.config, null, 2)}\n`);
    },
    catch: (cause) =>
      new SetupConfigFileError({
        path: configPath,
        message: String(cause),
      }),
  });
};

const createVaultPathError = (error: {
  readonly inputPath: string;
  readonly reason: VaultPathValidationError['reason'];
  readonly message: string;
}): VaultPathValidationError =>
  new VaultPathValidationError({
    inputPath: error.inputPath,
    reason: error.reason,
    message: error.message,
  });

const statOptional = (request: {
  readonly inputPath: string;
  readonly path: string;
}): Effect.Effect<Awaited<ReturnType<typeof stat>> | undefined, VaultPathValidationError> =>
  Effect.tryPromise({
    try: async () => {
      const entry = await stat(request.path).catch((cause: unknown) => {
        if (errorCode(cause) === 'ENOENT') {
          return undefined;
        }

        return Promise.reject(cause);
      });

      return entry;
    },
    catch: (cause) =>
      createVaultPathError({
        inputPath: request.inputPath,
        reason: 'stat-failed',
        message: String(cause),
      }),
  });

const assertWritable = (request: {
  readonly inputPath: string;
  readonly path: string;
}): Effect.Effect<void, VaultPathValidationError> =>
  Effect.tryPromise({
    try: () => access(request.path, constants.W_OK),
    catch: () =>
      createVaultPathError({
        inputPath: request.inputPath,
        reason: 'not-writable',
        message: 'Vault path is not writable.',
      }),
  });

const isPathInsideOrSame = (path: string, parentPath: string): boolean => {
  const relativePath = relative(resolve(parentPath), resolve(path));

  if (relativePath.length === 0) {
    return true;
  }

  if (relativePath.startsWith('..')) {
    return false;
  }

  return !isAbsolute(relativePath);
};

const errorCode = (cause: unknown): string | undefined => {
  if (typeof cause !== 'object' || cause === null) {
    return undefined;
  }

  if (!('code' in cause)) {
    return undefined;
  }

  return String(cause.code);
};
