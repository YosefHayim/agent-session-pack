import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveWrappersBinPath } from './session-access.js';

const WRAPPER_PROVIDERS: ReadonlyArray<string> = [
  'codex',
  'claude',
  'grok',
  'gemini',
  'kimi',
  'opencode',
  'kiro',
];

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
 * @returns The wrappers bin directory path.
 */
export const installLifecycleWrappers = async (
  request: InstallLifecycleWrappersRequest,
): Promise<string> => {
  const binPath = resolveWrappersBinPath(request.vaultPath);

  try {
    await mkdir(binPath, { recursive: true });
    await writeProviderWrappers(binPath, request.cliEntrypoint);
    return binPath;
  } catch (cause) {
    throw new Error(String(cause), { cause });
  }
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
 */
export const uninstallLifecycleWrappers = async (vaultPath: string): Promise<void> => {
  const binPath = resolveWrappersBinPath(vaultPath);

  try {
    const entries = await listWrapperEntries(binPath);

    for (const entry of entries) {
      const isWrapperEntry = WRAPPER_PROVIDERS.includes(entry);
      if (isWrapperEntry) {
        await rm(join(binPath, entry), { force: true });
      }
    }
  } catch (cause) {
    throw new Error(String(cause), { cause });
  }
};

const listWrapperEntries = async (binPath: string): Promise<string[]> => {
  try {
    return await readdir(binPath);
  } catch (cause) {
    const isThereNoBinDirectory = isEnoent(cause);
    if (isThereNoBinDirectory) {
      return [];
    }

    throw cause;
  }
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
