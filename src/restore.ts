import {
  type CommandExit,
  type CompressionAdapter,
  copyPath,
  createDefaultVaultPath,
  createZstdCompression,
  describeBytes,
  describeStatus,
  describeTouched,
  ensureParentDirectory,
  isArchivedStubPath,
  isPathPresent,
  listVaultSessionManifests,
  readSha256File,
  readSha256Path,
  readStatPath,
  removePath,
  requireHome,
  restoreDirectoryArchive,
  restorePathForManifest,
  type SessionManifest,
} from './archive.js';
import { saveSessionAccess } from './lifecycle.js';
import { type InteractiveCliRequest, type PromptAdapter, runWithSpinner } from './prompts.js';
import {
  type ProviderAdapter,
  type ProviderId,
  parseOptionalProvider,
  readProviderId,
  type SessionOriginKind,
  selectProviders,
} from './providers.js';
import { isRestoreOnLaunchEnabled, readSetupSettings } from './setup.js';

const RESTORED_EXIT = 'restored';
const CONTINUE_RESTORE_EXIT = 'continue-restore';

export type RestoreExit = 'already-present' | 'conflict' | 'restored';

export interface RestoreManifestRequest {
  readonly compression: CompressionAdapter;
  readonly manifest: SessionManifest;
  readonly vaultPath: string;
}

export async function restoreManifest(request: RestoreManifestRequest): Promise<RestoreExit> {
  const originKind = readManifestOriginKind(request.manifest);

  const liveExit = await findLiveExitWhenPresent(request.manifest, originKind);

  if (liveExit != null) {
    return liveExit;
  }

  const restoredPath = restorePathForManifest(request.vaultPath, request.manifest, originKind);

  if (originKind == 'directory') {
    await restoreDirectoryArchive({
      sessionId: request.manifest.sessionId,
      archivePath: request.manifest.archivePath,
      restoredPath,
      originalPath: request.manifest.originalPath,
      expectedSha256: request.manifest.sourceSha256,
      compression: request.compression,
    });
    return RESTORED_EXIT;
  }

  await ensureParentDirectory(restoredPath);
  await request.compression.decompress({
    archivePath: request.manifest.archivePath,
    restoredPath,
  });

  const restoredSha256 = await readSha256File(restoredPath);

  if (restoredSha256 != request.manifest.sourceSha256) {
    throw createVerificationError({
      sessionId: request.manifest.sessionId,
      sourceSha256: request.manifest.sourceSha256,
      restoredSha256,
    });
  }

  await ensureParentDirectory(request.manifest.originalPath);
  await copyPath(restoredPath, request.manifest.originalPath);

  const originalSha256 = await readSha256File(request.manifest.originalPath);

  if (originalSha256 != request.manifest.sourceSha256) {
    throw createVerificationError({
      sessionId: request.manifest.sessionId,
      sourceSha256: request.manifest.sourceSha256,
      restoredSha256: originalSha256,
    });
  }

  await removePath(restoredPath);

  return RESTORED_EXIT;
}

async function findLiveExitWhenPresent(
  manifest: SessionManifest,
  originKind: SessionOriginKind,
): Promise<RestoreExit | null> {
  const isOriginalPresent = await isPathPresent(manifest.originalPath);

  if (!isOriginalPresent) {
    return null;
  }

  const liveExit = await findLiveOriginalExit({
    originalPath: manifest.originalPath,
    sourceKind: originKind,
    sourceSha256: manifest.sourceSha256,
  });

  if (liveExit == CONTINUE_RESTORE_EXIT) {
    return null;
  }

  return liveExit;
}

async function findLiveOriginalExit(request: {
  readonly originalPath: string;
  readonly sourceKind: SessionOriginKind;
  readonly sourceSha256: string;
}): Promise<RestoreExit | typeof CONTINUE_RESTORE_EXIT> {
  if (await isArchivedStubPath(request.originalPath, request.sourceKind)) {
    await removePath(request.originalPath);
    return CONTINUE_RESTORE_EXIT;
  }

  const existingSha256 = await readSha256Path(request.originalPath, request.sourceKind);

  if (existingSha256 == request.sourceSha256) {
    return 'already-present';
  }

  return 'conflict';
}

function createVerificationError(mismatch: {
  readonly sessionId: string;
  readonly sourceSha256: string;
  readonly restoredSha256: string;
}): Error {
  return new Error(
    `Archive verification failed for session ${mismatch.sessionId}: source ${mismatch.sourceSha256} does not match restored ${mismatch.restoredSha256}`,
  );
}

function readManifestOriginKind(manifest: SessionManifest): SessionOriginKind {
  return manifest.sourceKind ?? 'file';
}

export type SelectorMode = 'exact' | 'fuzzy';

export interface SessionSelectorRequest {
  readonly selector: string;
  readonly provider: ProviderId | undefined;
  readonly manifests: ReadonlyArray<SessionManifest>;
  readonly match: SelectorMode;
}

export type SessionSelection =
  | { readonly status: 'found'; readonly manifest: SessionManifest }
  | { readonly status: 'not-found' }
  | { readonly status: 'ambiguous'; readonly candidates: ReadonlyArray<SessionManifest> };

interface ParsedSelector {
  readonly provider: ProviderId | undefined;
  readonly query: string;
}

export function findSessionSelector(request: SessionSelectorRequest): SessionSelection {
  const parsed = parseSelector(request.selector);
  const provider = request.provider ?? parsed.provider;

  function isRequestedProvider(manifest: SessionManifest): boolean {
    if (provider == null) {
      return true;
    }

    return manifest.provider == provider;
  }

  const candidates = request.manifests.filter(isRequestedProvider);
  const hits = listMatchingManifests(parsed.query, candidates, request.match);
  const isNoHit = hits.length == 0;
  const isAmbiguous = hits.length > 1;

  if (isNoHit) {
    return { status: 'not-found' };
  }

  if (isAmbiguous) {
    return { status: 'ambiguous', candidates: hits };
  }

  return { status: 'found', manifest: hits[0] };
}

function isProviderId(candidate: string): candidate is ProviderId {
  return readProviderId(candidate) != null;
}

function parseSelector(selector: string): ParsedSelector {
  const trimmedSelector = selector.trim();
  const separatorIndex = trimmedSelector.indexOf(':');
  const prefix = trimmedSelector.slice(0, separatorIndex).toLowerCase();

  const plainSelector = {
    provider: undefined,
    query: trimmedSelector.toLowerCase(),
  };

  if (separatorIndex == -1) {
    return plainSelector;
  }

  if (!isProviderId(prefix)) {
    return plainSelector;
  }

  return {
    provider: prefix,
    query: trimmedSelector
      .slice(separatorIndex + 1)
      .trim()
      .toLowerCase(),
  };
}

function listMatchingManifests(
  query: string,
  candidates: ReadonlyArray<SessionManifest>,
  selectorMode: SelectorMode,
): ReadonlyArray<SessionManifest> {
  if (query.length == 0) {
    return [];
  }

  function isExactNameHit(manifest: SessionManifest): boolean {
    function isQueryName(name: string): boolean {
      return name.toLowerCase() == query;
    }

    return [manifest.sessionId, manifest.slug, manifest.title].some(isQueryName);
  }

  const exactHits = candidates.filter(isExactNameHit);

  const hasAnyExactHit = exactHits.length > 0;
  const isExactModeRequested = selectorMode == 'exact';
  if (hasAnyExactHit || isExactModeRequested) {
    return exactHits;
  }

  function isIdPrefixHit(manifest: SessionManifest): boolean {
    return manifest.sessionId.toLowerCase().startsWith(query);
  }

  const idPrefixHits = candidates.filter(isIdPrefixHit);

  if (idPrefixHits.length > 0) {
    return idPrefixHits;
  }

  // Splits the query on every run of characters that are not lowercase letters or digits.
  const nonAlphanumericRun = /[^a-z0-9]+/;

  function isNonEmptyWord(word: string): boolean {
    return word.length > 0;
  }

  const words = query.split(nonAlphanumericRun).filter(isNonEmptyWord);

  if (words.length == 0) {
    return [];
  }

  function matchesEveryWord(manifest: SessionManifest): boolean {
    function matchesWord(word: string): boolean {
      const isInSlug = manifest.slug.includes(word);
      const isInTitle = manifest.title.toLowerCase().includes(word);
      return isInSlug || isInTitle;
    }

    return words.every(matchesWord);
  }

  return candidates.filter(matchesEveryWord);
}

type EnsureRestoredStatus =
  | 'already-present'
  | 'ambiguous-selector'
  | 'backup-only'
  | 'conflict'
  | 'lifecycle-disabled'
  | 'missing-archive'
  | 'restored';

interface SelectorCandidate {
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly title: string;
}

export interface EnsureRestoredReport {
  readonly command: 'ensure-restored' | 'restore';
  readonly status: EnsureRestoredStatus;
  readonly restoreOnLaunchEnabled: boolean;
  readonly provider: ProviderId | undefined;
  readonly sessionId: string | undefined;
  readonly originalPath: string | undefined;
  readonly archivePath: string | undefined;
  readonly reason: string | undefined;
  readonly candidates?: ReadonlyArray<SelectorCandidate>;
}

export interface EnsureSessionRestoredRequest {
  readonly command: 'ensure-restored' | 'restore';
  readonly vaultPath: string;
  readonly selector: string;
  readonly selectorMatch: SelectorMode;
  readonly provider: ProviderId | undefined;
  readonly compression: CompressionAdapter;
  readonly restoreOnLaunchEnabled: boolean;
  readonly requireLifecycleEnabled: boolean;
  readonly backupOnlyProviders?: ReadonlyArray<ProviderId>;
}

function toSelectorCandidate(manifest: SessionManifest): SelectorCandidate {
  return {
    provider: manifest.provider,
    sessionId: manifest.sessionId,
    title: manifest.title,
  };
}

function toProviderSessionSelector(candidate: SelectorCandidate): string {
  return `${candidate.provider}:${candidate.sessionId}`;
}

export async function ensureSessionRestored(
  request: EnsureSessionRestoredRequest,
): Promise<EnsureRestoredReport> {
  const isLifecycleRequired = request.requireLifecycleEnabled;
  const isRestoreOnLaunchOff = !request.restoreOnLaunchEnabled;
  if (isLifecycleRequired && isRestoreOnLaunchOff) {
    return {
      command: request.command,
      status: 'lifecycle-disabled',
      restoreOnLaunchEnabled: false,
      provider: request.provider,
      sessionId: undefined,
      originalPath: undefined,
      archivePath: undefined,
      reason:
        'restore-on-launch is disabled; enable with `agent-session-pack lifecycle enable` or use `unpack` / `restore` manually',
    };
  }

  const manifests = await listVaultSessionManifests(request.vaultPath);
  const selection = findSessionSelector({
    selector: request.selector,
    provider: request.provider,
    manifests,
    match: request.selectorMatch,
  });

  if (selection.status == 'ambiguous') {
    const candidates = selection.candidates.map(toSelectorCandidate);
    const candidateSelectors = candidates.map(toProviderSessionSelector).join(', ');

    return {
      command: request.command,
      status: 'ambiguous-selector',
      restoreOnLaunchEnabled: request.restoreOnLaunchEnabled,
      provider: request.provider,
      sessionId: undefined,
      originalPath: undefined,
      archivePath: undefined,
      reason: `selector matches ${candidates.length} sessions: ${candidateSelectors}; use a longer selector or provider:id`,
      candidates,
    };
  }

  if (selection.status == 'not-found') {
    return {
      command: request.command,
      status: 'missing-archive',
      restoreOnLaunchEnabled: request.restoreOnLaunchEnabled,
      provider: request.provider,
      sessionId: undefined,
      originalPath: undefined,
      archivePath: undefined,
      reason: 'no vault manifest matched the selector',
    };
  }

  const manifest = selection.manifest;
  const backupOnlyProviders = request.backupOnlyProviders ?? ['cursor', 'devin'];

  if (backupOnlyProviders.includes(manifest.provider)) {
    return {
      command: request.command,
      status: 'backup-only',
      restoreOnLaunchEnabled: request.restoreOnLaunchEnabled,
      provider: manifest.provider,
      sessionId: manifest.sessionId,
      originalPath: manifest.originalPath,
      archivePath: manifest.archivePath,
      reason: 'backup-only provider stores are not mutated',
    };
  }

  const exit = await restoreManifest({
    compression: request.compression,
    manifest,
    vaultPath: request.vaultPath,
  });

  return {
    command: request.command,
    status: exit,
    restoreOnLaunchEnabled: request.restoreOnLaunchEnabled,
    provider: manifest.provider,
    sessionId: manifest.sessionId,
    originalPath: manifest.originalPath,
    archivePath: manifest.archivePath,
    reason: ensureRestoredReason(exit) ?? undefined,
  };
}

function ensureRestoredReason(status: RestoreExit): string | null {
  if (status == 'conflict') {
    return 'live file differs from manifest hash; not overwritten';
  }

  if (status == 'already-present') {
    return 'native session already matches archive';
  }

  return null;
}

type UnpackSessionStatus = 'already-present' | 'conflict' | 'dry-run' | 'no-archives' | 'restored';

interface UnpackSessionSummary {
  readonly provider: ProviderId;
  readonly archivedSessions: number;
  readonly restoredSessions: number;
  readonly alreadyPresentSessions: number;
  readonly conflictSessions: number;
  readonly beforeBytes: number;
  readonly archiveBytes: number;
  readonly restoredBytes: number;
  readonly touchedOriginals: boolean;
  readonly status: UnpackSessionStatus;
  readonly reason: string | undefined;
}

export interface UnpackSessionsReport {
  readonly command: 'unpack';
  readonly apply: boolean;
  readonly vaultPath: string;
  readonly rows: ReadonlyArray<UnpackSessionSummary>;
}

export interface UnpackProviderSessionsRequest {
  readonly vaultPath: string;
  readonly providers: ReadonlyArray<ProviderAdapter>;
  readonly apply: boolean;
  readonly compression: CompressionAdapter;
}

export async function unpackProviderSessions(
  request: UnpackProviderSessionsRequest,
): Promise<UnpackSessionsReport> {
  const manifests = await listVaultSessionManifests(request.vaultPath);
  const unpackSessionSummaries: UnpackSessionSummary[] = [];

  for (const provider of request.providers) {
    function isProviderManifest(manifest: SessionManifest): boolean {
      return manifest.provider == provider.id;
    }

    const providerManifests = manifests.filter(isProviderManifest);

    if (providerManifests.length == 0) {
      unpackSessionSummaries.push(createNoArchivesUnpackSummary(provider.id));
      continue;
    }

    const archiveBytes = await sumArchiveBytes(providerManifests);
    const beforeBytes = sumManifestOriginBytes(providerManifests);

    if (request.apply == false) {
      unpackSessionSummaries.push(
        createDryRunUnpackSummary(provider.id, providerManifests, archiveBytes),
      );
      continue;
    }

    const restored = await restoreProviderManifests({
      compression: request.compression,
      manifests: providerManifests,
      vaultPath: request.vaultPath,
    });

    const hasConflictSessions = restored.conflictSessions > 0;
    unpackSessionSummaries.push({
      provider: provider.id,
      archivedSessions: providerManifests.length,
      restoredSessions: restored.restoredSessions,
      alreadyPresentSessions: restored.alreadyPresentSessions,
      conflictSessions: restored.conflictSessions,
      beforeBytes,
      archiveBytes,
      restoredBytes: restored.restoredBytes,
      touchedOriginals: restored.restoredSessions > 0,
      status: readUnpackStatus(restored),
      reason: hasConflictSessions ? 'live file differs from manifest hash' : undefined,
    });
  }

  return {
    command: 'unpack',
    apply: request.apply,
    vaultPath: request.vaultPath,
    rows: unpackSessionSummaries,
  };
}

async function restoreProviderManifests(request: {
  readonly compression: CompressionAdapter;
  readonly manifests: ReadonlyArray<SessionManifest>;
  readonly vaultPath: string;
}): Promise<{
  readonly alreadyPresentSessions: number;
  readonly conflictSessions: number;
  readonly restoredBytes: number;
  readonly restoredSessions: number;
}> {
  let alreadyPresentSessions = 0;
  let conflictSessions = 0;
  let restoredBytes = 0;
  let restoredSessions = 0;

  for (const manifest of request.manifests) {
    const exit = await restoreManifest({
      compression: request.compression,
      manifest,
      vaultPath: request.vaultPath,
    });

    if (exit == 'already-present') {
      alreadyPresentSessions += 1;
      continue;
    }

    if (exit == 'conflict') {
      conflictSessions += 1;
      continue;
    }

    restoredBytes += manifest.sourceBytes;
    restoredSessions += 1;
  }

  return {
    alreadyPresentSessions,
    conflictSessions,
    restoredBytes,
    restoredSessions,
  };
}

async function sumArchiveBytes(manifests: ReadonlyArray<SessionManifest>): Promise<number> {
  let archiveBytes = 0;

  for (const manifest of manifests) {
    const bytes = await archiveBytesForManifest(manifest);
    archiveBytes += bytes;
  }

  return archiveBytes;
}

async function archiveBytesForManifest(manifest: SessionManifest): Promise<number> {
  const knownArchiveBytes = manifest.archiveBytes;

  if (knownArchiveBytes != null) {
    return knownArchiveBytes;
  }

  const archiveStats = await readStatPath(manifest.archivePath);
  return archiveStats.size;
}

function createNoArchivesUnpackSummary(provider: ProviderId): UnpackSessionSummary {
  return {
    provider,
    archivedSessions: 0,
    restoredSessions: 0,
    alreadyPresentSessions: 0,
    conflictSessions: 0,
    beforeBytes: 0,
    archiveBytes: 0,
    restoredBytes: 0,
    touchedOriginals: false,
    status: 'no-archives',
    reason: 'no manifests found in vault',
  };
}

function createDryRunUnpackSummary(
  provider: ProviderId,
  manifests: ReadonlyArray<SessionManifest>,
  archiveBytes: number,
): UnpackSessionSummary {
  return {
    provider,
    archivedSessions: manifests.length,
    restoredSessions: 0,
    alreadyPresentSessions: 0,
    conflictSessions: 0,
    beforeBytes: sumManifestOriginBytes(manifests),
    archiveBytes,
    restoredBytes: 0,
    touchedOriginals: false,
    status: 'dry-run',
    reason: '--apply required to restore originals',
  };
}

function readUnpackStatus(restored: {
  readonly alreadyPresentSessions: number;
  readonly conflictSessions: number;
  readonly restoredSessions: number;
}): UnpackSessionStatus {
  const hasConflictSessions = restored.conflictSessions > 0;
  if (hasConflictSessions) {
    return 'conflict';
  }

  if (restored.restoredSessions > 0) {
    return 'restored';
  }

  return 'already-present';
}

function sumManifestOriginBytes(manifests: ReadonlyArray<SessionManifest>): number {
  function addManifestSourceBytes(totalBytes: number, manifest: SessionManifest): number {
    return totalBytes + manifest.sourceBytes;
  }

  return manifests.reduce(addManifestSourceBytes, 0);
}

type UnpackSessionSummaryUnpackOutput = UnpackSessionsReport['rows'][number];

type SummableField =
  | 'alreadyPresentSessions'
  | 'archiveBytes'
  | 'archivedSessions'
  | 'beforeBytes'
  | 'conflictSessions'
  | 'restoredBytes'
  | 'restoredSessions';

const DRY_RUN_LABEL = 'dry-run';
const BYTES_COLUMN_WIDTH = 10;

export function createHumanUnpackReport(report: UnpackSessionsReport): string {
  const totals = sumUnpackTotals(report);
  const isApplyMode = report.apply;

  const modeLabel = isApplyMode ? 'apply' : DRY_RUN_LABEL;
  const appliedLabel = isApplyMode ? 'applied' : DRY_RUN_LABEL;
  const applyNotice = isApplyMode
    ? 'Confirmed. Existing changed live files are not overwritten.'
    : 'No files changed. Re-run with --apply to restore archived sessions.';
  const totalLine = createUnpackReportLine({
    provider: 'total',
    summary: totals,
    status: appliedLabel,
  });

  return [
    'Unpack all providers',
    '',
    `Mode: ${modeLabel}`,
    `Vault: ${report.vaultPath}`,
    applyNotice,
    '',
    'Provider   Archived  Restored  Present  Conflicts  Before     Archive    Restored   Touch  Status',
    ...report.rows.map(createUnpackReportSummary),
    '--------   --------  --------  -------  ---------  ------     -------    --------   -----  ------',
    totalLine,
  ].join('\n');
}

function createUnpackReportSummary(unpackSessionSummary: UnpackSessionSummaryUnpackOutput): string {
  return createUnpackReportLine({
    provider: unpackSessionSummary.provider,
    summary: unpackSessionSummary,
    status: describeStatus(unpackSessionSummary.status, unpackSessionSummary.reason),
  });
}

function createUnpackReportLine(line: {
  readonly provider: string;
  readonly summary: UnpackTotals;
  readonly status: string;
}): string {
  const summary = line.summary;
  const provider = line.provider.padEnd(10);
  const archived = String(summary.archivedSessions).padEnd(9);
  const restored = String(summary.restoredSessions).padEnd(9);
  const present = String(summary.alreadyPresentSessions).padEnd(8);
  const conflicts = String(summary.conflictSessions).padEnd(10);
  const before = describeBytes(summary.beforeBytes).padEnd(BYTES_COLUMN_WIDTH);
  const archive = describeBytes(summary.archiveBytes).padEnd(BYTES_COLUMN_WIDTH);
  const restoredBytes = describeBytes(summary.restoredBytes).padEnd(BYTES_COLUMN_WIDTH);
  const touched = describeTouched(summary.touchedOriginals).padEnd(6);

  return `${provider} ${archived} ${restored} ${present} ${conflicts} ${before} ${archive} ${restoredBytes} ${touched} ${line.status}`;
}

interface UnpackTotals {
  readonly alreadyPresentSessions: number;
  readonly archiveBytes: number;
  readonly archivedSessions: number;
  readonly beforeBytes: number;
  readonly conflictSessions: number;
  readonly restoredBytes: number;
  readonly restoredSessions: number;
  readonly touchedOriginals: boolean;
}

function sumUnpackTotals(report: UnpackSessionsReport): UnpackTotals {
  const rows = report.rows;

  function isTouched(unpackSessionSummary: UnpackSessionSummaryUnpackOutput): boolean {
    return unpackSessionSummary.touchedOriginals;
  }

  return {
    alreadyPresentSessions: sumRowField(rows, 'alreadyPresentSessions'),
    archiveBytes: sumRowField(rows, 'archiveBytes'),
    archivedSessions: sumRowField(rows, 'archivedSessions'),
    beforeBytes: sumRowField(rows, 'beforeBytes'),
    conflictSessions: sumRowField(rows, 'conflictSessions'),
    restoredBytes: sumRowField(rows, 'restoredBytes'),
    restoredSessions: sumRowField(rows, 'restoredSessions'),
    touchedOriginals: rows.some(isTouched),
  };
}

function sumRowField(
  rows: ReadonlyArray<UnpackSessionSummaryUnpackOutput>,
  field: SummableField,
): number {
  let total = 0;
  for (const unpackSessionSummary of rows) {
    total += unpackSessionSummary[field];
  }
  return total;
}

const COMMAND_NAME = 'restore';
const USAGE_EXIT_CODE = 2;

export interface RestoreFlags {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly selector: string | undefined;
  readonly to: string | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly vaultPath?: string | undefined;
}

export async function runRestoreCommand(flags: RestoreFlags): Promise<CommandExit> {
  const home = requireHome(flags.home);

  if (home == null) {
    return { exitCode: 1 };
  }

  const selector = flags.selector?.trim() ?? '';

  if (selector.length == 0) {
    process.stderr.write('Missing selector. Use agent-session-pack restore <selector>.\n');
    return { exitCode: USAGE_EXIT_CODE };
  }

  const isRestoreTargetGiven = flags.to != null;
  const isRestoreTargetCustom = flags.to != 'original';
  if (isRestoreTargetGiven && isRestoreTargetCustom) {
    process.stderr.write(
      'Only --to original is supported. Custom restore destinations are not available yet.\n',
    );
    return { exitCode: USAGE_EXIT_CODE };
  }

  const provider = parseOptionalProvider(flags.provider);

  const isProviderFlagGiven = flags.provider != null;
  const isProviderUnparsed = provider == null;
  if (isProviderFlagGiven && isProviderUnparsed) {
    process.stderr.write(`Unknown provider: ${flags.provider}\n`);
    return { exitCode: USAGE_EXIT_CODE };
  }

  const setupSettings = await readSetupSettings(home);
  const vaultPath = flags.vaultPath ?? setupSettings?.vaultPath ?? createDefaultVaultPath(home);
  const compression = flags.compression ?? createZstdCompression();

  const report = await ensureSessionRestored({
    command: COMMAND_NAME,
    vaultPath,
    selector,
    selectorMatch: 'fuzzy',
    provider,
    compression,
    restoreOnLaunchEnabled: setupSettings?.restoreOnLaunch == true,
    requireLifecycleEnabled: false,
  });

  writeRestorePrintout(report, flags.json == true);
  return { exitCode: restoreExitCode(report) };
}

function isPresentLine(line: string | null): line is string {
  return line != null;
}

function writeRestorePrintout(
  report: EnsureRestoredReport,
  isMachineReadableRequested: boolean,
): void {
  if (isMachineReadableRequested) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const isReportProviderMissing = report.provider == null;
  const isReportSessionIdMissing = report.sessionId == null;
  const isReportOriginalPathMissing = report.originalPath == null;
  const isReportReasonMissing = report.reason == null;
  const lines = [
    `${COMMAND_NAME}: ${report.status}`,
    isReportProviderMissing ? null : `provider: ${report.provider}`,
    isReportSessionIdMissing ? null : `session: ${report.sessionId}`,
    isReportOriginalPathMissing ? null : `originalPath: ${report.originalPath}`,
    isReportReasonMissing ? null : `reason: ${report.reason}`,
  ].filter(isPresentLine);

  process.stdout.write(`${lines.join('\n')}\n`);
}

function restoreExitCode(report: EnsureRestoredReport): number {
  const successStatuses: ReadonlySet<EnsureRestoredReport['status']> = new Set([
    'restored',
    'already-present',
  ]);
  if (successStatuses.has(report.status)) {
    return 0;
  }

  const blockedStatuses: ReadonlySet<EnsureRestoredReport['status']> = new Set([
    'conflict',
    'missing-archive',
    'ambiguous-selector',
    'backup-only',
  ]);
  if (blockedStatuses.has(report.status)) {
    return USAGE_EXIT_CODE;
  }

  return 1;
}

const CommandNameEnsureRestoredCommand = 'ensure-restored';
const UsageExitCodeEnsureRestoredCommand = 2;

export interface EnsureRestoredFlags {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly session: string | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly vaultPath?: string | undefined;
}

export async function runEnsureRestoredCommand(flags: EnsureRestoredFlags): Promise<CommandExit> {
  const home = requireHome(flags.home);

  if (home == null) {
    return { exitCode: 1 };
  }

  const sessionSelector = flags.session?.trim() ?? '';

  if (sessionSelector.length == 0) {
    process.stderr.write(
      'Missing session selector. Use agent-session-pack ensure-restored [--provider codex] <session>.\n',
    );
    return { exitCode: UsageExitCodeEnsureRestoredCommand };
  }

  const provider = parseOptionalProvider(flags.provider);

  const isProviderFlagGiven = flags.provider != null;
  const isProviderUnparsed = provider == null;
  if (isProviderFlagGiven && isProviderUnparsed) {
    process.stderr.write(`Unknown provider: ${flags.provider}\n`);
    return { exitCode: UsageExitCodeEnsureRestoredCommand };
  }

  const setupSettings = await readSetupSettings(home);
  const vaultPath = flags.vaultPath ?? setupSettings?.vaultPath ?? createDefaultVaultPath(home);
  const restoreOnLaunchEnabled = isRestoreOnLaunchEnabled(setupSettings);
  const compression = flags.compression ?? createZstdCompression();

  const report = await ensureSessionRestored({
    command: CommandNameEnsureRestoredCommand,
    vaultPath,
    selector: sessionSelector,
    selectorMatch: 'exact',
    provider,
    compression,
    restoreOnLaunchEnabled,
    requireLifecycleEnabled: true,
  });

  writeEnsureRestoredPrintout(report, flags.json == true);
  return { exitCode: ensureRestoredExitCode(report) };
}

function isPresentLineEnsureRestoredCommand(line: string | null): line is string {
  return line != null;
}

function writeEnsureRestoredPrintout(
  report: EnsureRestoredReport,
  isMachineReadableRequested: boolean,
): void {
  if (isMachineReadableRequested) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const isReportProviderMissing = report.provider == null;
  const isReportSessionIdMissing = report.sessionId == null;
  const isReportOriginalPathMissing = report.originalPath == null;
  const isReportReasonMissing = report.reason == null;
  const lines = [
    `${CommandNameEnsureRestoredCommand}: ${report.status}`,
    isReportProviderMissing ? null : `provider: ${report.provider}`,
    isReportSessionIdMissing ? null : `session: ${report.sessionId}`,
    isReportOriginalPathMissing ? null : `originalPath: ${report.originalPath}`,
    isReportReasonMissing ? null : `reason: ${report.reason}`,
    `restoreOnLaunchEnabled: ${String(report.restoreOnLaunchEnabled)}`,
  ].filter(isPresentLineEnsureRestoredCommand);

  process.stdout.write(`${lines.join('\n')}\n`);
}

function ensureRestoredExitCode(report: EnsureRestoredReport): number {
  const successStatuses: ReadonlySet<EnsureRestoredReport['status']> = new Set([
    'restored',
    'already-present',
  ]);
  if (successStatuses.has(report.status)) {
    return 0;
  }

  if (report.status == 'lifecycle-disabled') {
    return 1;
  }

  const blockedStatuses: ReadonlySet<EnsureRestoredReport['status']> = new Set([
    'conflict',
    'missing-archive',
    'ambiguous-selector',
    'backup-only',
  ]);
  if (blockedStatuses.has(report.status)) {
    return UsageExitCodeEnsureRestoredCommand;
  }

  return 1;
}

const CommandNameOpenCommand = 'open';
const UsageExitCodeOpenCommand = 2;
const SUCCESS_STATUSES: ReadonlySet<EnsureRestoredReport['status']> = new Set([
  'restored',
  'already-present',
]);

export interface OpenFlags {
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly session: string | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly vaultPath?: string | undefined;
}

export async function runOpenCommand(flags: OpenFlags): Promise<CommandExit> {
  const home = requireHome(flags.home);

  if (home == null) {
    return { exitCode: 1 };
  }

  const sessionSelector = flags.session?.trim() ?? '';

  if (sessionSelector.length == 0) {
    process.stderr.write(
      'Missing session. Use agent-session-pack open [--provider codex] <session>.\n',
    );
    return { exitCode: UsageExitCodeOpenCommand };
  }

  const provider = parseOptionalProvider(flags.provider);

  const isProviderFlagGiven = flags.provider != null;
  const isProviderUnparsed = provider == null;
  if (isProviderFlagGiven && isProviderUnparsed) {
    process.stderr.write(`Unknown provider: ${flags.provider}\n`);
    return { exitCode: UsageExitCodeOpenCommand };
  }

  const setupSettings = await readSetupSettings(home);
  const restoreOnLaunchEnabled = isRestoreOnLaunchEnabled(setupSettings);
  const vaultPath = flags.vaultPath ?? setupSettings?.vaultPath ?? createDefaultVaultPath(home);
  const compression = flags.compression ?? createZstdCompression();
  const now = flags.now ?? new Date();

  // When lifecycle is off, open still restores (lookup path) so "look for session"
  // always materializes packed history without needing a separate restore step.
  // Lifecycle wrappers use preflight/ensure-restored for the enable gate.
  const report = await ensureSessionRestored({
    command: 'restore',
    vaultPath,
    selector: sessionSelector,
    selectorMatch: 'fuzzy',
    provider,
    compression,
    restoreOnLaunchEnabled,
    requireLifecycleEnabled: false,
  });

  const reportedProvider = report.provider;
  const reportedSessionId = report.sessionId;

  const isReportStatusSuccessful = SUCCESS_STATUSES.has(report.status);
  const isReportedProviderPresent = reportedProvider != null;
  const isReportedSessionIdPresent = reportedSessionId != null;
  const isSessionOpenable =
    isReportStatusSuccessful && isReportedProviderPresent && isReportedSessionIdPresent;
  if (isSessionOpenable) {
    await saveSessionAccess({
      vaultPath,
      provider: reportedProvider,
      sessionId: reportedSessionId,
      accessedAt: now,
    });
  }

  writeOpenPrintout(report, restoreOnLaunchEnabled, flags.json == true);
  return { exitCode: openExitCode(report) };
}

function isPresentLineOpenCommand(line: string | null): line is string {
  return line != null;
}

function writeOpenPrintout(
  report: EnsureRestoredReport,
  restoreOnLaunchEnabled: boolean,
  isMachineReadableRequested: boolean,
): void {
  const openReport = {
    ...report,
    command: CommandNameOpenCommand,
    restoreOnLaunchEnabled,
  };

  if (isMachineReadableRequested) {
    process.stdout.write(`${JSON.stringify(openReport, null, 2)}\n`);
    return;
  }

  const isReportProviderMissing = report.provider == null;
  const isReportSessionIdMissing = report.sessionId == null;
  const isReportOriginalPathMissing = report.originalPath == null;
  const isReportReasonMissing = report.reason == null;
  const lines = [
    `${CommandNameOpenCommand}: ${report.status}`,
    isReportProviderMissing ? null : `provider: ${report.provider}`,
    isReportSessionIdMissing ? null : `session: ${report.sessionId}`,
    isReportOriginalPathMissing ? null : `originalPath: ${report.originalPath}`,
    isReportReasonMissing ? null : `reason: ${report.reason}`,
  ].filter(isPresentLineOpenCommand);

  process.stdout.write(`${lines.join('\n')}\n`);
}

function openExitCode(report: EnsureRestoredReport): number {
  const isReportStatusSuccessful = SUCCESS_STATUSES.has(report.status);
  if (isReportStatusSuccessful) {
    return 0;
  }

  const blockedStatuses: ReadonlySet<EnsureRestoredReport['status']> = new Set([
    'conflict',
    'missing-archive',
    'ambiguous-selector',
    'backup-only',
  ]);
  if (blockedStatuses.has(report.status)) {
    return UsageExitCodeOpenCommand;
  }

  return 1;
}

const UsageExitCodeUnpackCommand = 2;

export interface UnpackFlags {
  readonly allProviders: boolean | undefined;
  readonly apply: boolean | undefined;
  readonly json: boolean | undefined;
  readonly provider: string | undefined;
  readonly yes: boolean | undefined;
  readonly confirmed?: boolean | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly providers?: ReadonlyArray<ProviderAdapter> | undefined;
  readonly vaultPath?: string | undefined;
}

export async function runUnpackCommand(flags: UnpackFlags): Promise<CommandExit> {
  const home = requireHome(flags.home);

  if (home == null) {
    return { exitCode: 1 };
  }

  const isApplyRequested = flags.apply == true;
  const isApplyNotConfirmed = flags.confirmed != true;
  if (isApplyRequested && isApplyNotConfirmed) {
    process.stderr.write('Cancelled. Re-run with --apply and confirm with y to unpack sessions.\n');
    process.stderr.write('\n');
    return { exitCode: UsageExitCodeUnpackCommand };
  }

  const { providers, isProviderUnknown } = selectProviders(flags.provider, flags.providers);
  const providerExitCode = isProviderUnknown ? UsageExitCodeUnpackCommand : 0;

  const report = await unpackProviderSessions({
    vaultPath: flags.vaultPath ?? createDefaultVaultPath(home),
    providers,
    apply: flags.apply == true,
    compression: flags.compression ?? createZstdCompression(),
  });

  if (flags.json == true) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return { exitCode: providerExitCode };
  }

  process.stdout.write(`${createHumanUnpackReport(report)}\n`);
  return { exitCode: providerExitCode };
}

const NO_FILES_CHANGED_MESSAGE = 'No files changed.';

export async function runRestoreFlow(
  request: InteractiveCliRequest & { readonly prompts: PromptAdapter },
): Promise<CommandExit> {
  const shouldPreview = await request.prompts.confirm({
    message: 'Preview archived sessions before restore?',
    initialValue: true,
  });

  const isPreviewCancelled = request.prompts.isCancel(shouldPreview);
  const isPreviewDeclined = shouldPreview != true;
  if (isPreviewCancelled || isPreviewDeclined) {
    request.prompts.cancel(NO_FILES_CHANGED_MESSAGE);
    return { exitCode: 0 };
  }

  function previewUnpack(): Promise<CommandExit> {
    return runUnpackCommand({
      allProviders: true,
      apply: false,
      json: false,
      provider: undefined,
      yes: false,
      confirmed: undefined,
    });
  }

  const previewExit = await runWithSpinner({
    prompts: request.prompts,
    startMessage: 'Scanning vault manifests...',
    stopMessage: 'Scanned vault manifests.',
    task: previewUnpack,
  });

  const shouldApply = await request.prompts.confirm({
    message: 'Restore archived sessions back to original provider paths?',
    initialValue: false,
  });

  const isApplyCancelled = request.prompts.isCancel(shouldApply);
  const isApplyDeclined = shouldApply != true;
  if (isApplyCancelled || isApplyDeclined) {
    request.prompts.outro(NO_FILES_CHANGED_MESSAGE);
    return previewExit;
  }

  const applyExit = await runUnpackCommand({
    allProviders: true,
    apply: true,
    json: false,
    provider: undefined,
    yes: true,
    confirmed: true,
  });
  return applyExit;
}
