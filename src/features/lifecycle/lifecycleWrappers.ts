import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { resolveWrappersBinPath } from './sessionAccess.js';

const WRAPPER_PROVIDERS = [
  'codex',
  'claude',
  'grok',
  'gemini',
  'kimi',
  'opencode',
  'kiro',
] as const;

/**
 * Typed error raised when provider launch wrappers cannot be installed or removed.
 */
export class LifecycleWrapperError extends Schema.TaggedError<LifecycleWrapperError>()(
  'LifecycleWrapperError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

/**
 * Inputs required to install lifecycle provider wrappers.
 */
export type InstallLifecycleWrappersRequest = {
  readonly vaultPath: string;
  readonly cliEntrypoint: string;
};

/**
 * Installs thin provider wrappers that preflight-restore packed sessions before exec.
 *
 * @param request - Install fields for vault path and CLI entrypoint.
 * @returns Effect with the wrappers bin directory path.
 * @example
 * ```ts
 * import { installLifecycleWrappers } from './lifecycleWrappers.js';
 *
 * await Effect.runPromise(
 *   installLifecycleWrappers({
 *     vaultPath: '/Users/me/.agent-session-pack',
 *     cliEntrypoint: '/path/to/agent-session-pack/dist/cli/main.js',
 *   }),
 * );
 * ```
 */
export const installLifecycleWrappers = (
  request: InstallLifecycleWrappersRequest,
): Effect.Effect<string, LifecycleWrapperError> => {
  const binPath = resolveWrappersBinPath(request.vaultPath);

  return Effect.tryPromise({
    try: async () => {
      await mkdir(binPath, { recursive: true });
      await writeProviderWrappers(binPath, request.cliEntrypoint);
      return binPath;
    },
    catch: (cause) =>
      new LifecycleWrapperError({
        path: binPath,
        message: String(cause),
      }),
  });
};

const writeProviderWrappers = async (binPath: string, cliEntrypoint: string): Promise<void> => {
  for (const provider of WRAPPER_PROVIDERS) {
    const wrapperPath = join(binPath, provider);
    const script = buildWrapperScript({
      provider,
      cliEntrypoint,
      binPath,
    });
    await writeFile(wrapperPath, script, { encoding: 'utf8' });
    await chmod(wrapperPath, 0o755);
  }
};

/**
 * Removes installed provider launch wrappers from the vault bin directory.
 *
 * @param vaultPath - Vault root path.
 * @returns Effect completing after removal.
 * @example
 * ```ts
 * import { uninstallLifecycleWrappers } from './lifecycleWrappers.js';
 *
 * await Effect.runPromise(uninstallLifecycleWrappers('/Users/me/.agent-session-pack'));
 * ```
 */
export const uninstallLifecycleWrappers = (
  vaultPath: string,
): Effect.Effect<void, LifecycleWrapperError> => {
  const binPath = resolveWrappersBinPath(vaultPath);

  return Effect.tryPromise({
    try: async () => {
      const entries = await readdir(binPath).catch((cause: unknown) => {
        if (isEnoent(cause)) {
          return [];
        }

        return Promise.reject(cause);
      });

      for (const entry of entries) {
        if ((WRAPPER_PROVIDERS as ReadonlyArray<string>).includes(entry)) {
          await rm(join(binPath, entry), { force: true });
        }
      }
    },
    catch: (cause) =>
      new LifecycleWrapperError({
        path: binPath,
        message: String(cause),
      }),
  });
};

const buildWrapperScript = (request: {
  readonly provider: string;
  readonly cliEntrypoint: string;
  readonly binPath: string;
}): string => `#!/usr/bin/env bash
# agent-session-pack lifecycle wrapper for ${request.provider}
# Preflight-restores packed sessions, then execs the real provider binary.
set -euo pipefail
WRAPPER_DIR="${request.binPath}"
PROVIDER="${request.provider}"
CLI_ENTRY="${request.cliEntrypoint}"

# Drop this wrapper dir from PATH so we find the real binary.
FILTERED_PATH=""
IFS=':' read -r -a PATH_PARTS <<< "\${PATH}"
for part in "\${PATH_PARTS[@]}"; do
  if [ "$part" = "$WRAPPER_DIR" ]; then
    continue
  fi
  if [ -z "$FILTERED_PATH" ]; then
    FILTERED_PATH="$part"
  else
    FILTERED_PATH="$FILTERED_PATH:$part"
  fi
done
export PATH="$FILTERED_PATH"

REAL_BIN="$(command -v "$PROVIDER" || true)"
if [ -z "$REAL_BIN" ]; then
  echo "agent-session-pack wrapper: real '$PROVIDER' binary not found on PATH" >&2
  exit 127
fi

# Best-effort auto-restore of any session ids present in argv.
if command -v node >/dev/null 2>&1; then
  node "$CLI_ENTRY" preflight --provider "$PROVIDER" -- "$@" >/dev/null 2>&1 || true
fi

# Follow the provider process and materialize GUI-opened stubs (no session id in argv).
if command -v node >/dev/null 2>&1; then
  exec node "$CLI_ENTRY" watch --provider "$PROVIDER" -- "$REAL_BIN" "$@"
fi

exec "$REAL_BIN" "$@"
`;

const isEnoent = (cause: unknown): boolean =>
  typeof cause === 'object' &&
  cause !== null &&
  'code' in cause &&
  (cause as { code?: string }).code === 'ENOENT';
