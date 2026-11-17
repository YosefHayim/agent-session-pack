import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWrappersBinPath } from './session-access.js';

const WRAPPER_PROVIDERS: ReadonlyArray<string> = [
  'codex',
  'claude',
  'grok',
  'gemini',
  'kimi',
  'opencode',
  'kiro',
];

const EXECUTABLE_FILE_MODE = 0o755;

export interface InstallLifecycleWrappersRequest {
  readonly vaultPath: string;
  readonly cliEntrypoint: string;
}

export async function installLifecycleWrappers(
  request: InstallLifecycleWrappersRequest,
): Promise<string> {
  const binPath = createWrappersBinPath(request.vaultPath);

  try {
    await mkdir(binPath, { recursive: true });
    await writeProviderWrappers(binPath, request.cliEntrypoint);
    return binPath;
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

async function writeProviderWrappers(binPath: string, cliEntrypoint: string): Promise<void> {
  for (const provider of WRAPPER_PROVIDERS) {
    const wrapperPath = join(binPath, provider);
    const script = createWrapperScript({
      provider,
      cliEntrypoint,
      binPath,
    });
    await writeFile(wrapperPath, script, { encoding: 'utf8' });
    await chmod(wrapperPath, EXECUTABLE_FILE_MODE);
  }
}

export async function uninstallLifecycleWrappers(vaultPath: string): Promise<void> {
  const binPath = createWrappersBinPath(vaultPath);

  try {
    const names = await listWrapperNames(binPath);

    for (const name of names) {
      const isNotWrapperName = !WRAPPER_PROVIDERS.includes(name);
      if (isNotWrapperName) {
        continue;
      }

      await rm(join(binPath, name), { force: true });
    }
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

async function listWrapperNames(binPath: string): Promise<string[]> {
  try {
    return await readdir(binPath);
  } catch (error) {
    const isThereNoBinDirectory = isEnoent(error);
    if (isThereNoBinDirectory) {
      return [];
    }

    throw error;
  }
}

function createWrapperScript(request: {
  readonly provider: string;
  readonly cliEntrypoint: string;
  readonly binPath: string;
}): string {
  return `#!/usr/bin/env bash
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
}

function isEnoent(error: unknown): boolean {
  const isNotError = !(error instanceof Error);
  if (isNotError) {
    return false;
  }

  const hasErrorCode = 'code' in error;
  if (!hasErrorCode) {
    return false;
  }

  return error.code === 'ENOENT';
}
