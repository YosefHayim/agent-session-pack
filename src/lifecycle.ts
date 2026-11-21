import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { appendFile, chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type CommandExit,
  type CompressionAdapter,
  createDefaultVaultPath,
  createZstdCompression,
  isArchivedStubPath,
  isDirectoryStubOpened,
  listVaultSessionManifests,
  requireHome,
  type SessionManifest,
} from './archive.js';
import {
  createHumanPackReport,
  DEFAULT_COLD_AFTER,
  packProviderSessions,
  parseDurationMs,
} from './pack.js';
import {
  allProviders,
  type ProviderAdapter,
  type ProviderId,
  parseOptionalProvider,
  readProviderId,
} from './providers.js';
import { type EnsureRestoredReport, ensureSessionRestored } from './restore.js';
import {
  isRestoreOnLaunchEnabled,
  readSetupSettings,
  type SetupSettings,
  writeSetupSettings,
} from './setup.js';

export interface ClosePackRequest {
  readonly packOnAgentExit: boolean | undefined;
  readonly modifiedAt: Date;
  readonly now: Date;
  readonly coldAfterMs: number;
}

export interface ClosePackDecision {
  readonly shouldPack: boolean;
}

export function decideClosePack(request: ClosePackRequest): ClosePackDecision {
  if (request.packOnAgentExit != true) {
    return { shouldPack: false };
  }

  const coldBeforeMs = request.now.getTime() - request.coldAfterMs;
  if (request.modifiedAt.getTime() >= coldBeforeMs) {
    return { shouldPack: false };
  }

  return { shouldPack: true };
}

interface SessionAccessEvent {
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly accessedAt: string;
}

export interface SaveSessionAccessRequest {
  readonly vaultPath: string;
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly accessedAt: Date;
}

export interface SessionHotCheckRequest {
  readonly events: ReadonlyArray<SessionAccessEvent>;
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly sinceMs: number;
}

// Catches a UUID or a long hex id standing alone in an argument.
const sessionIdPattern =
  /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{26,})\b/gi;

const knownSessionFlagNames = new Set([
  '--session',
  '--session-id',
  '--resume',
  'resume',
  '-s',
  '--id',
]);

// Catches --session=, --session-id=, --resume= or --id= and captures the id after the equals sign.
const inlineSessionFlagPattern = /^--(?:session|session-id|resume|id)=(.+)$/i;

export function createWrappersBinPath(vaultPath: string): string {
  return join(vaultPath, 'bin');
}

export function createAccessLogPath(vaultPath: string): string {
  return join(vaultPath, 'access-log.jsonl');
}

export function extractSessionIdsFromArgv(argv: ReadonlyArray<string>): ReadonlyArray<string> {
  const found = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg == null) {
      continue;
    }

    if (tryTakeFlagSessionId(found, arg, argv[index + 1])) {
      index += 1;
      continue;
    }

    if (tryTakeInlineSessionId(found, arg)) {
      continue;
    }

    if (!arg.startsWith('-')) {
      addUuidHits(found, arg);
    }
  }

  return [...found];
}

export async function saveSessionAccess(request: SaveSessionAccessRequest): Promise<void> {
  const path = createAccessLogPath(request.vaultPath);
  const event: SessionAccessEvent = {
    provider: request.provider,
    sessionId: request.sessionId,
    accessedAt: request.accessedAt.toISOString(),
  };

  try {
    await mkdir(request.vaultPath, { recursive: true });
    await appendFile(path, `${JSON.stringify(event)}\n`);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

export function isSessionAccessedSince(request: SessionHotCheckRequest): boolean {
  function isMatchingRecentEvent(event: SessionAccessEvent): boolean {
    const isSameProvider = event.provider == request.provider;
    const isSameSession = event.sessionId == request.sessionId;
    const isRecent = Date.parse(event.accessedAt) >= request.sinceMs;

    return isSameProvider && isSameSession && isRecent;
  }

  return request.events.some(isMatchingRecentEvent);
}

function tryTakeFlagSessionId(found: Set<string>, arg: string, next: string | undefined): boolean {
  if (!knownSessionFlagNames.has(arg)) {
    return false;
  }

  if (next == null) {
    return true;
  }

  const isNextFlag = next.startsWith('-');
  const isNextNoise = isNoiseToken(next);

  if (!isNextFlag && !isNextNoise) {
    found.add(next);
  }

  return true;
}

function tryTakeInlineSessionId(found: Set<string>, arg: string): boolean {
  const inlineFlagMatch = arg.match(inlineSessionFlagPattern);
  const inlineId = inlineFlagMatch?.[1];

  if (inlineId == null) {
    return false;
  }

  if (isNoiseToken(inlineId)) {
    return false;
  }

  found.add(inlineId);
  return true;
}

function addUuidHits(found: Set<string>, arg: string): void {
  for (const hit of arg.matchAll(sessionIdPattern)) {
    const matchedId = hit[1];

    if (matchedId != null) {
      found.add(matchedId);
    }
  }
}

function isNoiseToken(token: string): boolean {
  const noiseTokens = new Set(['true', 'false', 'json', 'apply', 'yes', 'resume', 'session']);
  const noiseSuffixes = ['.json', '.jsonl', '.ts', '.js'];
  const lowerToken = token.toLowerCase();

  function endsWithNoiseSuffix(suffix: string): boolean {
    return lowerToken.endsWith(suffix);
  }

  const isNoiseWord = noiseTokens.has(lowerToken);

  return isNoiseWord || noiseSuffixes.some(endsWithNoiseSuffix);
}

const WRAPPER_PROVIDERS: ReadonlyArray<string> = [
  'codex',
  'claude',
  'grok',
  'gemini',
  'kimi',
  'opencode',
  'kiro',
];

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
    await chmod(wrapperPath, 0o755);
  }
}

export async function uninstallLifecycleWrappers(vaultPath: string): Promise<void> {
  const binPath = createWrappersBinPath(vaultPath);

  try {
    const names = await listWrapperNames(binPath);

    for (const name of names) {
      if (!WRAPPER_PROVIDERS.includes(name)) {
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
    if (isEnoent(error)) {
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
  if (!(error instanceof Error)) {
    return false;
  }

  const hasErrorCode = 'code' in error;
  if (!hasErrorCode) {
    return false;
  }

  return error.code == 'ENOENT';
}

export interface PackColdSessionsOnCloseRequest {
  readonly home: string;
  readonly provider: ProviderId | null;
  readonly settings: SetupSettings | null;
  readonly now: Date;
  readonly compression: CompressionAdapter;
  readonly providers?: ReadonlyArray<ProviderAdapter>;
}

export async function packColdSessionsOnClose(
  request: PackColdSessionsOnCloseRequest,
): Promise<void> {
  const settings = request.settings;

  if (settings == null) {
    return;
  }

  const olderThanMs = parseDurationMs(settings.coldAfter);
  if (isClosePackOff(settings.packOnAgentExit, request.now, olderThanMs)) {
    return;
  }

  const providers = pickCloseProviders(request);

  try {
    await packProviderSessions({
      home: request.home,
      vaultPath: settings.vaultPath,
      providers,
      olderThan: settings.coldAfter,
      olderThanMs,
      now: request.now,
      apply: true,
      compression: request.compression,
    });
  } catch (error) {
    console.error({ provider: request.provider, error });
  }
}

function isClosePackOff(
  packOnAgentExit: boolean | undefined,
  now: Date,
  coldAfterMs: number,
): boolean {
  const oneMillisecond = 1;
  const definitelyColdAt = new Date(now.getTime() - coldAfterMs - oneMillisecond);
  const decision = decideClosePack({
    packOnAgentExit,
    modifiedAt: definitelyColdAt,
    now,
    coldAfterMs,
  });

  return decision.shouldPack == false;
}

function pickCloseProviders(
  request: PackColdSessionsOnCloseRequest,
): ReadonlyArray<ProviderAdapter> {
  if (request.providers != null) {
    return request.providers;
  }

  return filterArchiveProviders(allProviders, request.provider);
}

function isArchiveProvider(provider: ProviderAdapter): boolean {
  return provider.mode == 'archive';
}

function filterArchiveProviders(
  providers: ReadonlyArray<ProviderAdapter>,
  providerId: ProviderId | null,
): ReadonlyArray<ProviderAdapter> {
  const archiveProviders = providers.filter(isArchiveProvider);

  if (providerId == null) {
    return archiveProviders;
  }

  function isSelectedProvider(provider: ProviderAdapter): boolean {
    return provider.id == providerId;
  }

  return archiveProviders.filter(isSelectedProvider);
}

export const DEFAULT_POLL_INTERVAL_MS = 750;

export interface SessionWatchEvent {
  readonly sessionId: string;
  readonly provider: ProviderId;
  readonly status: string;
  readonly originalPath: string;
}

export interface WatchSessionStubsRequest {
  readonly vaultPath: string;
  readonly provider: ProviderId | undefined;
  readonly compression?: CompressionAdapter;
  readonly pollIntervalMs?: number;
  readonly shouldStop: () => boolean;
  readonly onEvent?: (event: SessionWatchEvent) => void;
}

export async function watchSessionStubs(request: WatchSessionStubsRequest): Promise<void> {
  const compression = request.compression ?? createZstdCompression();
  const pollIntervalMs = request.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const watchers = new Map<string, ReturnType<typeof watch>>();
  const restoringPaths = new Set<string>();

  function isManifestInScope(manifest: SessionManifest): boolean {
    const isAnyProviderWanted = request.provider == null;
    const isWantedProvider = manifest.provider == request.provider;

    return isAnyProviderWanted || isWantedProvider;
  }

  function refreshWatchers(manifests: ReadonlyArray<SessionManifest>): void {
    const activePaths = new Set<string>();

    for (const manifest of manifests) {
      if (!isManifestInScope(manifest)) {
        continue;
      }

      activePaths.add(manifest.originalPath);

      if (watchers.has(manifest.originalPath)) {
        continue;
      }

      function materializeOnFileEvent(): void {
        void materializeIfNeeded(manifest, true);
      }

      try {
        const watcher = watch(manifest.originalPath, { persistent: true }, materializeOnFileEvent);
        watchers.set(manifest.originalPath, watcher);
      } catch {
        // Path may not exist yet; poll path will create watchers later.
      }
    }

    for (const [path, watcher] of watchers) {
      if (!activePaths.has(path)) {
        watcher.close();
        watchers.delete(path);
      }
    }
  }

  async function materializeIfNeeded(
    manifest: SessionManifest,
    forceFromFsEvent: boolean,
  ): Promise<void> {
    const originKind = manifest.sourceKind ?? 'file';

    const isPathArchivedStub = await isArchivedStubPath(manifest.originalPath, originKind);

    if (!isPathArchivedStub) {
      return;
    }

    const isDirectoryStubCheckNeeded = !forceFromFsEvent && originKind == 'directory';
    const isStubOpenedWhenChecked = isDirectoryStubCheckNeeded
      ? await isDirectoryStubOpened(manifest.originalPath)
      : false;

    if (isDirectoryStubCheckNeeded && !isStubOpenedWhenChecked) {
      return;
    }

    if (!forceFromFsEvent && originKind == 'file') {
      // File stubs only materialize on fs events (reads/writes from the provider).
      return;
    }

    // One write fires several fs events; concurrent restores would share one staging path.
    if (restoringPaths.has(manifest.originalPath)) {
      return;
    }

    restoringPaths.add(manifest.originalPath);
    try {
      const report = await ensureSessionRestored({
        command: 'ensure-restored',
        vaultPath: request.vaultPath,
        selector: manifest.sessionId,
        selectorMatch: 'exact',
        provider: manifest.provider,
        compression,
        restoreOnLaunchEnabled: true,
        requireLifecycleEnabled: false,
      });

      request.onEvent?.({
        sessionId: manifest.sessionId,
        provider: manifest.provider,
        status: report.status,
        originalPath: manifest.originalPath,
      });
    } finally {
      restoringPaths.delete(manifest.originalPath);
    }
  }

  while (!request.shouldStop()) {
    const manifests = await listVaultSessionManifests(request.vaultPath);
    const scoped = manifests.filter(isManifestInScope);

    refreshWatchers(scoped);

    for (const manifest of scoped) {
      await materializeIfNeeded(manifest, false);
    }

    function schedulePollWakeUp(wakeUp: () => void): void {
      setTimeout(wakeUp, pollIntervalMs);
    }

    await new Promise<void>(schedulePollWakeUp);
  }

  for (const watcher of watchers.values()) {
    watcher.close();
  }
}

const ENABLE_ACTION = 'enable';
const DEFAULT_RESTORE_CACHE_AFTER = '7d';
const OPEN_COMMAND_HINT = 'agent-session-pack open --provider <id> <session> --json';

export interface LifecycleFlags {
  readonly action: string | undefined;
  readonly json: boolean | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly cliEntrypoint?: string | undefined;
}

export async function runLifecycleCommand(flags: LifecycleFlags): Promise<CommandExit> {
  const home = requireHome(flags.home);

  if (home == null) {
    return { exitCode: 1 };
  }

  const action = flags.action?.trim().toLowerCase();

  const isActionKnown = action == ENABLE_ACTION || action == 'disable' || action == 'status';

  if (!isActionKnown) {
    process.stderr.write('Unknown lifecycle action. Use enable, disable, or status.\n');
    return { exitCode: 2 };
  }

  const existingSettings = await readSetupSettings(home);
  const now = flags.now ?? new Date();
  const vaultPath = existingSettings?.vaultPath ?? createDefaultVaultPath(home);
  const wrappersBin = createWrappersBinPath(vaultPath);
  const cliEntrypoint = flags.cliEntrypoint ?? pickCliEntrypoint();
  const isMachineReadableRequested = flags.json == true;

  if (action == 'status') {
    writeLifecycleStatus(
      {
        restoreOnLaunch: isRestoreOnLaunchEnabled(existingSettings),
        restoreCacheAfter: existingSettings?.restoreCacheAfter,
        coldAfter: existingSettings?.coldAfter,
        packOnAgentExit: existingSettings?.packOnAgentExit == true,
        vaultPath,
        wrappersBin,
        pathHint: `export PATH="${wrappersBin}:$PATH"`,
        configPresent: existingSettings != null,
        openCommand: OPEN_COMMAND_HINT,
        maintainCommand: 'agent-session-pack maintain --dry-run --json',
      },
      isMachineReadableRequested,
    );
    return { exitCode: 0 };
  }

  const nextSettings = createLifecycleSettings({
    existingConfig: existingSettings,
    home,
    now,
    restoreOnLaunch: action == ENABLE_ACTION,
  });

  if (action == ENABLE_ACTION) {
    writeEnablePreview(nextSettings);
  }

  await writeSetupSettings({
    home,
    config: nextSettings,
  });

  if (action == ENABLE_ACTION) {
    await installLifecycleWrappers({
      vaultPath: nextSettings.vaultPath,
      cliEntrypoint,
    });
  } else {
    await uninstallLifecycleWrappers(nextSettings.vaultPath);
  }

  writeLifecycleStatus(
    {
      restoreOnLaunch: nextSettings.restoreOnLaunch == true,
      restoreCacheAfter: nextSettings.restoreCacheAfter,
      coldAfter: nextSettings.coldAfter,
      packOnAgentExit: nextSettings.packOnAgentExit == true,
      vaultPath: nextSettings.vaultPath,
      wrappersBin: createWrappersBinPath(nextSettings.vaultPath),
      pathHint: `export PATH="${createWrappersBinPath(nextSettings.vaultPath)}:$PATH"`,
      configPresent: true,
      action,
      openCommand: OPEN_COMMAND_HINT,
      maintainCommand: 'agent-session-pack maintain --apply --yes --json',
    },
    isMachineReadableRequested,
  );
  return { exitCode: 0 };
}

function createLifecycleSettings(request: {
  readonly existingConfig: SetupSettings | null;
  readonly home: string;
  readonly now: Date;
  readonly restoreOnLaunch: boolean;
}): SetupSettings {
  const timestamp = request.now.toISOString();
  const vaultPath = request.existingConfig?.vaultPath ?? createDefaultVaultPath(request.home);

  if (request.existingConfig == null) {
    return {
      version: 1,
      providers: ['codex', 'claude', 'grok', 'gemini'],
      vaultPath,
      coldAfter: DEFAULT_COLD_AFTER,
      createdAt: timestamp,
      updatedAt: timestamp,
      restoreOnLaunch: request.restoreOnLaunch,
      restoreCacheAfter: DEFAULT_RESTORE_CACHE_AFTER,
      packOnAgentExit: request.restoreOnLaunch,
    };
  }

  return {
    ...request.existingConfig,
    updatedAt: timestamp,
    restoreOnLaunch: request.restoreOnLaunch,
    restoreCacheAfter: request.existingConfig.restoreCacheAfter ?? DEFAULT_RESTORE_CACHE_AFTER,
    packOnAgentExit: request.restoreOnLaunch,
  };
}

function writeEnablePreview(settings: SetupSettings): void {
  const providerList = settings.providers.join(', ');
  process.stderr.write(
    [
      'lifecycle enable',
      `providers: ${providerList}`,
      `vaultPath: ${settings.vaultPath}`,
      `coldAfter: ${settings.coldAfter}`,
      'packOnAgentExit: true',
      '',
    ].join('\n'),
  );
}

// The wrappers must run the script that is running now. The build emits that script as dist/cli.js.
function pickCliEntrypoint(): string {
  const runningScriptPath = process.argv[1];

  if (runningScriptPath == null) {
    return 'agent-session-pack';
  }

  return runningScriptPath;
}

function isPresentLine(line: string | null): line is string {
  return line != null;
}

function writeLifecycleStatus(
  status: {
    readonly restoreOnLaunch: boolean;
    readonly restoreCacheAfter: string | undefined;
    readonly coldAfter?: string | undefined;
    readonly packOnAgentExit: boolean;
    readonly vaultPath: string;
    readonly wrappersBin: string;
    readonly pathHint: string;
    readonly configPresent: boolean;
    readonly action?: string;
    readonly openCommand?: string;
    readonly maintainCommand?: string;
  },
  isMachineReadableRequested: boolean,
): void {
  if (isMachineReadableRequested) {
    process.stdout.write(
      `${JSON.stringify(
        {
          command: 'lifecycle',
          ...status,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const isStatusActionMissing = status.action == null;
  const isRestoreCacheAfterMissing = status.restoreCacheAfter == null;
  const isStatusColdAfterMissing = status.coldAfter == null;
  const isStatusOpenCommandMissing = status.openCommand == null;
  const isStatusMaintainCommandMissing = status.maintainCommand == null;
  const lines = [
    isStatusActionMissing ? 'lifecycle status' : `lifecycle ${status.action}`,
    `restoreOnLaunch: ${String(status.restoreOnLaunch)}`,
    isRestoreCacheAfterMissing ? null : `restoreCacheAfter: ${status.restoreCacheAfter}`,
    isStatusColdAfterMissing ? null : `coldAfter: ${status.coldAfter}`,
    `packOnAgentExit: ${String(status.packOnAgentExit)}`,
    `vaultPath: ${status.vaultPath}`,
    `wrappersBin: ${status.wrappersBin}`,
    `pathHint: ${status.pathHint}`,
    isStatusOpenCommandMissing ? null : `open: ${status.openCommand}`,
    isStatusMaintainCommandMissing ? null : `maintain: ${status.maintainCommand}`,
    `configPresent: ${String(status.configPresent)}`,
  ].filter(isPresentLine);

  process.stdout.write(`${lines.join('\n')}\n`);
}

function isArchiveProviderMaintainCommand(provider: { readonly mode: string }): boolean {
  return provider.mode == 'archive';
}

interface MaintainFlags {
  readonly apply: boolean | undefined;
  readonly confirmed?: boolean | undefined;
  readonly dryRun: boolean | undefined;
  readonly json: boolean | undefined;
  readonly yes: boolean | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly vaultPath?: string | undefined;
}

export async function runMaintainCommand(flags: MaintainFlags): Promise<CommandExit> {
  const home = requireHome(flags.home);

  if (home == null) {
    return { exitCode: 1 };
  }

  const setupSettings = await readSetupSettings(home);

  if (!isRestoreOnLaunchEnabled(setupSettings)) {
    process.stderr.write(
      'Lifecycle is disabled. Run `agent-session-pack lifecycle enable` for continuous maintain, or use `pack` directly.\n',
    );
    return { exitCode: 1 };
  }

  const isApplyRequested = flags.apply == true;
  const isConfirmationMissing = flags.confirmed != true;

  if (isApplyRequested && isConfirmationMissing) {
    process.stderr.write(
      'Cancelled. Re-run with --apply and confirm with y (or --yes) to pack cold sessions.\n',
    );
    return { exitCode: 2 };
  }

  const olderThan = setupSettings?.coldAfter ?? DEFAULT_COLD_AFTER;
  const coldAfter = olderThan.trim().toLowerCase();
  const olderThanMs = parseDurationMs(coldAfter);
  const vaultPath = flags.vaultPath ?? setupSettings?.vaultPath ?? createDefaultVaultPath(home);
  const archiveProviders = allProviders.filter(isArchiveProviderMaintainCommand);

  const report = await packProviderSessions({
    home,
    vaultPath,
    providers: archiveProviders,
    olderThan,
    olderThanMs,
    now: flags.now ?? new Date(),
    apply: isApplyRequested,
    compression: flags.compression ?? createZstdCompression(),
  });

  if (flags.json == true) {
    process.stdout.write(
      `${JSON.stringify(
        {
          command: 'maintain',
          lifecycleEnabled: true,
          olderThan,
          pack: report,
        },
        null,
        2,
      )}\n`,
    );
    return { exitCode: 0 };
  }

  const packMode = isApplyRequested ? 'apply' : 'dry-run';

  process.stdout.write(
    [
      `maintain: cold pack (${packMode}) olderThan=${olderThan}`,
      createHumanPackReport(report, { olderThan }),
    ].join('\n'),
  );
  return { exitCode: 0 };
}

export interface PreflightFlags {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly passthroughArgv: ReadonlyArray<string>;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly vaultPath?: string | undefined;
}

export async function runPreflightCommand(flags: PreflightFlags): Promise<CommandExit> {
  const home = requireHome(flags.home);

  if (home == null) {
    return { exitCode: 1 };
  }

  const provider = parseProvider(flags.provider);

  const isProviderMissing = provider == null;
  if (isProviderMissing) {
    process.stderr.write(`Unknown or missing provider: ${flags.provider ?? ''}\n`);
    return { exitCode: 2 };
  }

  const setupSettings = await readSetupSettings(home);
  const restoreOnLaunchEnabled = isRestoreOnLaunchEnabled(setupSettings);
  const vaultPath = flags.vaultPath ?? setupSettings?.vaultPath ?? createDefaultVaultPath(home);
  const compression = flags.compression ?? createZstdCompression();
  const now = flags.now ?? new Date();
  const sessionIds = extractSessionIdsFromArgv(flags.passthroughArgv);
  const isMachineReadableRequested = flags.json == true;

  if (!restoreOnLaunchEnabled) {
    writePreflightPrintout(
      {
        command: 'preflight',
        provider,
        restoreOnLaunchEnabled: false,
        sessionIds,
        restores: [],
        reason: 'lifecycle disabled; no auto-restore',
      },
      isMachineReadableRequested,
    );
    return { exitCode: 0 };
  }

  if (sessionIds.length == 0) {
    writePreflightPrintout(
      {
        command: 'preflight',
        provider,
        restoreOnLaunchEnabled: true,
        sessionIds: [],
        restores: [],
        reason: 'no session ids found in argv',
      },
      isMachineReadableRequested,
    );
    return { exitCode: 0 };
  }

  const restores: EnsureRestoredReport[] = [];

  for (const sessionId of sessionIds) {
    const report = await ensureSessionRestored({
      command: 'ensure-restored',
      vaultPath,
      selector: sessionId,
      selectorMatch: 'exact',
      provider,
      compression,
      restoreOnLaunchEnabled: true,
      requireLifecycleEnabled: true,
    });
    restores.push(report);

    const reportSessionId = report.sessionId;

    const isReportRestored = report.status == 'restored';
    const isReportAlreadyPresent = report.status == 'already-present';
    const isReportUsable = isReportRestored || isReportAlreadyPresent;

    if (!isReportUsable) {
      continue;
    }

    if (reportSessionId == null) {
      continue;
    }

    await saveSessionAccess({
      vaultPath,
      provider,
      sessionId: reportSessionId,
      accessedAt: now,
    });
  }

  writePreflightPrintout(
    {
      command: 'preflight',
      provider,
      restoreOnLaunchEnabled: true,
      sessionIds,
      restores,
      reason: undefined,
    },
    isMachineReadableRequested,
  );
  return { exitCode: 0 };
}

function parseProvider(provider: string | undefined): ProviderId | null {
  const isProviderMissing = provider == null;
  if (isProviderMissing) {
    return null;
  }

  return readProviderId(provider);
}

function describeRestore(report: EnsureRestoredReport): string {
  const isReportReasonMissing = report.reason == null;
  const reasonSuffix = isReportReasonMissing ? '' : ` (${report.reason})`;

  return `- ${report.sessionId ?? '?'}: ${report.status}${reasonSuffix}`;
}

function isPresentLinePreflightCommand(line: string | null): line is string {
  return line != null;
}

function writePreflightPrintout(
  payload: {
    readonly command: 'preflight';
    readonly provider: ProviderId;
    readonly restoreOnLaunchEnabled: boolean;
    readonly sessionIds: ReadonlyArray<string>;
    readonly restores: ReadonlyArray<EnsureRestoredReport>;
    readonly reason: string | undefined;
  },
  isMachineReadableRequested: boolean,
): void {
  if (isMachineReadableRequested) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const isReasonMissing = payload.reason == null;
  const lines = [
    `preflight: ${payload.provider}`,
    `restoreOnLaunchEnabled: ${String(payload.restoreOnLaunchEnabled)}`,
    `sessionIds: ${payload.sessionIds.join(', ') || '(none)'}`,
    isReasonMissing ? null : `reason: ${payload.reason}`,
    ...payload.restores.map(describeRestore),
  ].filter(isPresentLinePreflightCommand);

  process.stdout.write(`${lines.join('\n')}\n`);
}

const USAGE_ERROR_EXIT_CODE = 2;

interface WatchFlags {
  readonly provider: string | undefined;
  readonly json: boolean | undefined;
  readonly pollMs: string | undefined;
  readonly execArgv: ReadonlyArray<string>;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly vaultPath?: string | undefined;
}

export async function runWatchCommand(flags: WatchFlags): Promise<CommandExit> {
  const home = requireHome(flags.home);

  if (home == null) {
    return { exitCode: 1 };
  }

  const provider = parseOptionalProvider(flags.provider);

  const isProviderFlagGiven = flags.provider != null;
  const isProviderUnparsed = provider == null;

  if (isProviderFlagGiven && isProviderUnparsed) {
    process.stderr.write(`Unknown provider: ${flags.provider}\n`);
    return { exitCode: USAGE_ERROR_EXIT_CODE };
  }

  const setupSettings = await readSetupSettings(home);

  const vaultPath = flags.vaultPath ?? setupSettings?.vaultPath ?? createDefaultVaultPath(home);
  const pollIntervalMs = parsePollMs(flags.pollMs);
  const compression = flags.compression ?? createZstdCompression();
  const isMachineReadableRequested = flags.json == true;

  let childExitCode: number | null = null;
  let stop = false;

  // Watch runs even when restore on launch is off; wrappers enable lifecycle first.
  const hasExecCommand = flags.execArgv.length > 0;
  const [command, ...commandArgumentList] = flags.execArgv;

  if (hasExecCommand && command == null) {
    process.stderr.write('Missing command after -- for watch --exec.\n');
    return { exitCode: USAGE_ERROR_EXIT_CODE };
  }

  if (hasExecCommand) {
    const child = spawn(command, commandArgumentList, {
      stdio: 'inherit',
      env: process.env,
    });

    function recordChildExit(code: number | null): void {
      childExitCode = code ?? 0;
      stop = true;
    }

    child.on('exit', recordChildExit);
  } else {
    function requestWatchStop(): void {
      stop = true;
    }
    process.once('SIGINT', requestWatchStop);
    process.once('SIGTERM', requestWatchStop);
  }

  function writeWatchEvent(event: SessionWatchEvent): void {
    if (isMachineReadableRequested) {
      process.stdout.write(`${JSON.stringify({ command: 'watch', ...event })}\n`);
      return;
    }

    process.stderr.write(`watch: ${event.provider}/${event.sessionId} → ${event.status}\n`);
  }

  const isHumanReadable = !isMachineReadableRequested;
  const isExecCommandAbsent = !hasExecCommand;

  if (isHumanReadable && isExecCommandAbsent) {
    const isProviderMissing = provider == null;
    process.stderr.write(
      `watch: monitoring stubs under vault ${vaultPath}${isProviderMissing ? '' : ` for ${provider}`} (Ctrl+C to stop)\n`,
    );
  }

  function isWatchStopped(): boolean {
    return stop;
  }

  await watchSessionStubs({
    vaultPath,
    provider,
    compression,
    pollIntervalMs,
    shouldStop: isWatchStopped,
    onEvent: writeWatchEvent,
  });

  if (childExitCode != null) {
    await packColdSessionsOnClose({
      home,
      provider: provider ?? null,
      settings: setupSettings,
      now: new Date(),
      compression,
    });
  }

  return { exitCode: childExitCode ?? 0 };
}

function parsePollMs(millisecondsString: string | undefined): number {
  if (millisecondsString == null) {
    return DEFAULT_POLL_INTERVAL_MS;
  }

  const parsedMilliseconds = Number(millisecondsString);

  const minimumPollIntervalMilliseconds = 100;

  const isPollIntervalNotFinite = !Number.isFinite(parsedMilliseconds);
  const isPollIntervalTooShort = parsedMilliseconds < minimumPollIntervalMilliseconds;

  if (isPollIntervalNotFinite || isPollIntervalTooShort) {
    return DEFAULT_POLL_INTERVAL_MS;
  }

  return Math.floor(parsedMilliseconds);
}
