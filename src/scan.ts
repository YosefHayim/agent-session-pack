import { cp, mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  type CommandExit,
  calculateSavedPercent,
  createZstdCompression,
  describeBytes,
  describeOptionalBytes,
  describeOptionalPercent,
  HOME_NOT_SET_CANCEL_MESSAGE,
  isPathPresent,
  readHomeFolder,
  readSha256Path,
  requireHome,
  sumSessionBytes,
  writeVerifiedArchive,
} from './archive.js';
import { DEFAULT_COLD_AFTER_MS } from './pack.js';
import { type InteractiveCliRequest, type PromptAdapter, runWithSpinner } from './prompts.js';
import {
  allProviders,
  type DiscoveredSession,
  listDefaultSessionStores,
  type ProviderAdapter,
  type ProviderId,
  type ProviderMode,
  type SessionOriginKind,
  type SessionStore,
  selectProviders,
} from './providers.js';

export interface ScanRequest {
  readonly stores: ReadonlyArray<SessionStore>;
  readonly providers: ReadonlyArray<ProviderAdapter>;
}

export interface ScanReport {
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}

export async function scanStores(request: ScanRequest): Promise<ScanReport> {
  const sessions: DiscoveredSession[] = [];

  for (const store of request.stores) {
    function isProviderOfStore(adapter: ProviderAdapter): boolean {
      return adapter.id == store.provider;
    }

    const provider = request.providers.find(isProviderOfStore);

    if (provider == null) {
      continue;
    }

    const storeSessions = await discoverStoreSessions(provider, store);
    sessions.push(...storeSessions);
  }

  return { sessions };
}

export async function discoverStoreSessions(
  provider: ProviderAdapter,
  store: SessionStore,
): Promise<ReadonlyArray<DiscoveredSession>> {
  const isStorePresent = await isPathPresent(store.path);

  if (!isStorePresent) {
    return [];
  }

  try {
    return await provider.discover(store);
  } catch (discoveryError) {
    const isStorePresentAfterFailure = await isPathPresent(store.path);

    if (!isStorePresentAfterFailure) {
      return [];
    }

    throw discoveryError;
  }
}

type ProviderInventoryStatus = 'backup-only' | 'missing' | 'ready';

interface ProviderInventorySummary {
  readonly provider: ProviderId;
  readonly label: string;
  readonly mode: ProviderMode;
  readonly sessions: number;
  readonly coldSessions: number;
  readonly guardedRecentSessions: number;
  readonly totalBytes: number;
  readonly candidateBytes: number;
  readonly paths: ReadonlyArray<string>;
  readonly status: ProviderInventoryStatus;
}

export interface ProviderInventoryReport {
  readonly rows: ReadonlyArray<ProviderInventorySummary>;
}

export interface ProviderInventoryRequest {
  readonly home: string;
  readonly providers: ReadonlyArray<ProviderAdapter>;
  readonly olderThanMs: number;
  readonly now: Date;
}

export async function inspectProviderInventory(
  request: ProviderInventoryRequest,
): Promise<ProviderInventoryReport> {
  const inventorySummaries: ProviderInventorySummary[] = [];
  const cutoffTime = request.now.getTime() - request.olderThanMs;

  for (const provider of request.providers) {
    const discovered = await discoverProviderRoots({
      home: request.home,
      provider,
    });

    const hasExistingRoots = discovered.existingRoots.length > 0;
    inventorySummaries.push(
      createInventorySummary({
        cutoffTime,
        paths: hasExistingRoots ? discovered.existingRoots : discovered.roots,
        provider,
        sessions: discovered.sessions,
      }),
    );
  }

  return { rows: inventorySummaries };
}

interface ProviderRootDiscovery {
  readonly roots: ReadonlyArray<string>;
  readonly existingRoots: ReadonlyArray<string>;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}

interface RootDiscovery {
  readonly root: string;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}

async function discoverProviderRoots(request: {
  readonly home: string;
  readonly provider: ProviderAdapter;
}): Promise<ProviderRootDiscovery> {
  const roots = request.provider.defaultRoots(request.home);
  const discoveredRoots: Array<RootDiscovery | null> = [];

  for (const root of roots) {
    const rootDiscovery = await discoverProviderRoot({
      provider: request.provider,
      root,
    });
    discoveredRoots.push(rootDiscovery);
  }

  const existingRoots = discoveredRoots.filter(isRootDiscovery);

  return {
    roots,
    existingRoots: existingRoots.map(getRootPath),
    sessions: existingRoots.flatMap(getRootSessions),
  };
}

async function discoverProviderRoot(request: {
  readonly provider: ProviderAdapter;
  readonly root: string;
}): Promise<RootDiscovery | null> {
  const isRootPresent = await isPathPresent(request.root);

  if (!isRootPresent) {
    return null;
  }

  const sessions = await request.provider.discover({
    provider: request.provider.id,
    path: request.root,
  });

  return {
    root: request.root,
    sessions,
  };
}

interface InventorySummaryRequest {
  readonly cutoffTime: number;
  readonly paths: ReadonlyArray<string>;
  readonly provider: ProviderAdapter;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}

function createUncountedInventorySummary(
  request: InventorySummaryRequest,
  status: ProviderInventoryStatus,
): ProviderInventorySummary {
  return {
    provider: request.provider.id,
    label: request.provider.label,
    mode: request.provider.mode,
    sessions: request.sessions.length,
    coldSessions: 0,
    guardedRecentSessions: 0,
    totalBytes: sumSessionBytes(request.sessions),
    candidateBytes: 0,
    paths: request.paths,
    status,
  };
}

function createInventorySummary(request: InventorySummaryRequest): ProviderInventorySummary {
  const isPathsEmpty = request.paths.length == 0;
  const isSessionsEmpty = request.sessions.length == 0;

  if (isPathsEmpty) {
    return createUncountedInventorySummary(request, isSessionsEmpty ? 'missing' : 'ready');
  }

  if (isSessionsEmpty) {
    return createUncountedInventorySummary(request, 'missing');
  }

  if (request.provider.mode == 'backup-only') {
    return createUncountedInventorySummary(request, 'backup-only');
  }

  function isColdSession(session: DiscoveredSession): boolean {
    return session.modifiedAt.getTime() < request.cutoffTime;
  }

  const coldSessions = request.sessions.filter(isColdSession);

  return {
    provider: request.provider.id,
    label: request.provider.label,
    mode: request.provider.mode,
    sessions: request.sessions.length,
    coldSessions: coldSessions.length,
    guardedRecentSessions: request.sessions.length - coldSessions.length,
    totalBytes: sumSessionBytes(request.sessions),
    candidateBytes: sumSessionBytes(coldSessions),
    paths: request.paths,
    status: 'ready',
  };
}

function getRootPath(discovery: RootDiscovery): string {
  return discovery.root;
}

function getRootSessions(discovery: RootDiscovery): ReadonlyArray<DiscoveredSession> {
  return discovery.sessions;
}

function isRootDiscovery(discovery: RootDiscovery | null): discovery is RootDiscovery {
  return discovery != null;
}

export interface InventorySpinnerRequest {
  readonly home: string;
  readonly now: Date;
  readonly olderThanMs: number;
  readonly prompts: PromptAdapter;
  readonly providers: ReadonlyArray<ProviderAdapter>;
  readonly startMessage: string;
  readonly stopMessage: string;
}

export function loadInventoryWithSpinner(
  request: InventorySpinnerRequest,
): Promise<ProviderInventoryReport> {
  function inspectInventory(): Promise<ProviderInventoryReport> {
    return inspectProviderInventory({
      home: request.home,
      providers: request.providers,
      olderThanMs: request.olderThanMs,
      now: request.now,
    });
  }

  return runWithSpinner({
    prompts: request.prompts,
    startMessage: request.startMessage,
    stopMessage: request.stopMessage,
    task: inspectInventory,
  });
}

export function createProviderInventoryTable(report: ProviderInventoryReport): string {
  if (report.rows.length == 0) {
    return 'No provider stores found.';
  }

  return [
    'Provider   Mode         Sessions   Cold   Guarded recent   Size       Path',
    ...report.rows.map(createProviderInventorySummary),
  ].join('\n');
}

function createProviderInventorySummary(
  inventorySummary: ProviderInventoryReport['rows'][number],
): string {
  const provider = inventorySummary.provider.padEnd(10);
  const mode = inventorySummary.mode.padEnd(12);
  const sessions = String(inventorySummary.sessions).padStart(8);
  const cold = String(inventorySummary.coldSessions).padStart(6);
  const guarded = String(inventorySummary.guardedRecentSessions).padStart(16);
  const size = describeBytes(inventorySummary.candidateBytes).padEnd(10);
  const path = inventorySummary.paths.join(', ');

  return `${provider} ${mode} ${sessions}   ${cold}   ${guarded}   ${size} ${path}`;
}

const MAX_TITLE_PREVIEW_LENGTH = 96;
const TITLE_ELLIPSIS = '...';

export function createHumanScan(report: ScanReport): string {
  if (report.sessions.length == 0) {
    return 'No sessions found.';
  }

  const sessionLines = report.sessions.map(createSessionLine);

  return [
    'Found sessions',
    '',
    'Provider   Date         Size       Status   Name   Path',
    ...sessionLines,
  ].join('\n');
}

export function writeHumanScan(report: ScanReport): void {
  console.log(createHumanScan(report));
}

function createSessionLine(session: DiscoveredSession): string {
  const provider = session.provider.padEnd(10);
  const isoDateLength = 10;
  const date = session.modifiedAt.toISOString().slice(0, isoDateLength);
  const size = `${session.sizeBytes} B`.padEnd(10);
  const status = describeSessionStatus(session).padEnd(8);
  const title = createTitlePreview(session.title);

  return `${provider} ${date}   ${size} ${status} ${title}   ${session.originalPath}`;
}

function describeSessionStatus(session: DiscoveredSession): string {
  if (session.status != null) {
    return session.status;
  }

  return 'live';
}

function createTitlePreview(title: string): string {
  // Matches any run of whitespace, including newlines.
  const singleLineTitle = title.replace(/\s+/g, ' ').trim();

  if (singleLineTitle.length <= MAX_TITLE_PREVIEW_LENGTH) {
    return singleLineTitle;
  }

  return `${singleLineTitle.slice(0, MAX_TITLE_PREVIEW_LENGTH - TITLE_ELLIPSIS.length)}${TITLE_ELLIPSIS}`;
}

function createStructuredScan(report: ScanReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function writeStructuredScan(report: ScanReport): void {
  process.stdout.write(createStructuredScan(report));
}

export interface ScanFlags {
  readonly provider?: string;
  readonly json?: boolean;
}

export async function runScanCommand(flags: ScanFlags): Promise<CommandExit> {
  const home = requireHome();

  const isHomeMissing = home == null;

  if (isHomeMissing) {
    return { exitCode: 1 };
  }

  const { providers, isProviderUnknown } = selectProviders(flags.provider);
  const providerExitCode = isProviderUnknown ? 2 : 0;

  const stores = listDefaultSessionStores(providers, home);
  const report = await scanStores({
    providers,
    stores,
  });

  if (flags.json == true) {
    writeStructuredScan(report);
    return { exitCode: providerExitCode };
  }

  writeHumanScan(report);
  return { exitCode: providerExitCode };
}

export function runListCommand(): CommandExit {
  process.stdout.write('No indexed sessions yet. Run agent-session-pack scan first.\n');
  return { exitCode: 0 };
}

export async function runReviewSessions(
  request: InteractiveCliRequest & { readonly prompts: PromptAdapter },
): Promise<CommandExit> {
  const home = request.home ?? readHomeFolder();

  const isHomeMissing = home == null;

  if (isHomeMissing) {
    request.prompts.cancel(HOME_NOT_SET_CANCEL_MESSAGE);
    return { exitCode: 0 };
  }

  const inventory = await loadInventoryWithSpinner({
    home,
    now: request.now ?? new Date(),
    olderThanMs: request.olderThanMs ?? DEFAULT_COLD_AFTER_MS,
    prompts: request.prompts,
    providers: request.providers ?? allProviders,
    startMessage: 'Scanning provider stores...',
    stopMessage: 'Scanned provider stores.',
  });

  request.prompts.note(createProviderInventoryTable(inventory), 'Provider sessions');
  return runScanCommand({});
}

export interface SizeBoundSession {
  readonly modifiedAt: Date;
  readonly sizeBytes: number;
}

export function selectNewestSessionWithinSize<Session extends SizeBoundSession>(
  sessions: ReadonlyArray<Session>,
  maxSizeBytes: number,
): Session | undefined {
  function isWithinMaxSize(session: Session): boolean {
    return session.sizeBytes <= maxSizeBytes;
  }

  const eligibleSessions = sessions.filter(isWithinMaxSize);

  if (eligibleSessions.length > 0) {
    return selectNewestSession(eligibleSessions) ?? undefined;
  }

  return selectSmallestSession(sessions) ?? undefined;
}

function selectNewestSession<Session extends { readonly modifiedAt: Date }>(
  sessions: ReadonlyArray<Session>,
): Session | null {
  const [firstSession, ...remainingSessions] = sessions;

  const isFirstSessionMissing = firstSession == null;
  if (isFirstSessionMissing) {
    return null;
  }

  function pickLaterModified(selected: Session, session: Session): Session {
    if (session.modifiedAt > selected.modifiedAt) {
      return session;
    }

    return selected;
  }

  return remainingSessions.reduce(pickLaterModified, firstSession);
}

function selectSmallestSession<Session extends { readonly sizeBytes: number }>(
  sessions: ReadonlyArray<Session>,
): Session | null {
  const [firstSession, ...remainingSessions] = sessions;

  const isFirstSessionMissing = firstSession == null;
  if (isFirstSessionMissing) {
    return null;
  }

  function pickSmaller(selected: Session, session: Session): Session {
    if (session.sizeBytes < selected.sizeBytes) {
      return session;
    }

    return selected;
  }

  return remainingSessions.reduce(pickSmaller, firstSession);
}

const maxArchiveEvidenceOriginBytes = 25 * 1024 * 1024;
const maxBackupEvidenceOriginBytes = 128 * 1024 * 1024;
const MaxTitlePreviewLengthLocalEvidence = 96;
const TitleEllipsisLocalEvidence = '...';

export interface ProviderEvidence {
  readonly provider: ProviderId;
  readonly foundSessions: number;
  readonly sampledSources: number;
  readonly mode: ProviderMode;
  readonly sourceBytes?: number;
  readonly archiveBytes?: number;
  readonly savedPercent?: number;
  readonly byteExact?: boolean;
  readonly originalTouched: boolean;
  readonly titlePreview?: string;
  readonly originalPath?: string;
  readonly fixturePath?: string;
  readonly archivePath?: string;
  readonly restoredPath?: string;
  readonly originalSha256?: string;
  readonly fixtureSha256?: string;
  readonly restoredSha256?: string;
  readonly maxEvidenceSourceBytes?: number;
  readonly sourceKind?: SessionOriginKind;
}

export interface LocalEvidenceReport {
  readonly scope: 'sampled-copy-proof';
  readonly workRoot: string;
  readonly evidence: ReadonlyArray<ProviderEvidence>;
}

export interface LocalEvidenceRequest {
  readonly home: string;
  readonly workRoot: string;
  readonly providers: ReadonlyArray<ProviderAdapter>;
}

export async function runLocalEvidence(
  request: LocalEvidenceRequest,
): Promise<LocalEvidenceReport> {
  const compression = createZstdCompression();
  const evidence: ProviderEvidence[] = [];

  for (const provider of request.providers) {
    const roots = provider.defaultRoots(request.home);
    const sessions = await discoverProviderSessions(provider, roots);
    const isProviderModeBackupOnly = provider.mode == 'backup-only';
    const maxEvidenceOriginBytes = isProviderModeBackupOnly
      ? maxBackupEvidenceOriginBytes
      : maxArchiveEvidenceOriginBytes;
    const selected = selectNewestSessionWithinSize(sessions, maxEvidenceOriginBytes);

    if (selected == null) {
      continue;
    }

    if (selected.sizeBytes > maxEvidenceOriginBytes) {
      evidence.push({
        provider: provider.id,
        foundSessions: sessions.length,
        sampledSources: 0,
        mode: provider.mode,
        originalTouched: false,
        maxEvidenceSourceBytes: maxEvidenceOriginBytes,
      });
      continue;
    }

    const originKind = selected.sourceKind ?? 'file';
    const fileName = basename(selected.originalPath);
    const fixtureDir = join(request.workRoot, provider.id);
    const fixturePath = join(fixtureDir, fileName);
    const isOriginDirectory = originKind == 'directory';
    const archivePath = join(
      fixtureDir,
      isOriginDirectory ? `${fileName}.tar.zst` : `${fileName}.zst`,
    );
    const restoredPath = join(fixtureDir, `restored-${fileName}`);

    await mkdir(fixtureDir, { recursive: true });
    await rm(fixturePath, { force: true, recursive: true });
    await rm(archivePath, { force: true, recursive: true });
    await rm(restoredPath, { force: true, recursive: true });
    await cp(selected.originalPath, fixturePath, {
      recursive: isOriginDirectory,
    });

    const verified = await writeVerifiedArchive({
      sessionId: selected.id,
      sessionPath: fixturePath,
      archivePath,
      restoredPath,
      apply: false,
      compression,
      sourceKind: originKind,
    });
    const originalSha256 = await readSha256Path(selected.originalPath, originKind);

    evidence.push({
      provider: provider.id,
      foundSessions: sessions.length,
      sampledSources: 1,
      mode: provider.mode,
      sourceKind: originKind,
      titlePreview: createTitlePreviewLocalEvidence(selected.title),
      originalPath: selected.originalPath,
      fixturePath,
      archivePath,
      restoredPath,
      originalSha256,
      fixtureSha256: verified.sourceSha256,
      restoredSha256: verified.restoredSha256,
      byteExact:
        originalSha256 == verified.sourceSha256 && verified.sourceSha256 == verified.restoredSha256,
      originalTouched: false,
      sourceBytes: verified.sourceBytes,
      archiveBytes: verified.archiveBytes,
      maxEvidenceSourceBytes: maxEvidenceOriginBytes,
      savedPercent: calculateSavedPercent(verified.sourceBytes, verified.archiveBytes),
    });
  }

  return {
    scope: 'sampled-copy-proof',
    workRoot: request.workRoot,
    evidence,
  };
}

async function discoverProviderSessions(
  provider: ProviderAdapter,
  roots: ReadonlyArray<string>,
): Promise<ReadonlyArray<DiscoveredSession>> {
  const discovered: DiscoveredSession[] = [];

  for (const root of roots) {
    const sessions = await discoverStoreSessions(provider, {
      provider: provider.id,
      path: root,
    });
    discovered.push(...sessions);
  }

  return discovered;
}

function createTitlePreviewLocalEvidence(title: string): string {
  // Catches any run of whitespace so the title fits on one line.
  const singleLineTitle = title.replace(/\s+/g, ' ').trim();

  if (singleLineTitle.length <= MaxTitlePreviewLengthLocalEvidence) {
    return singleLineTitle;
  }

  return `${singleLineTitle.slice(0, MaxTitlePreviewLengthLocalEvidence - TitleEllipsisLocalEvidence.length)}${TitleEllipsisLocalEvidence}`;
}

const MISSING_LABEL = '-';
const YES_LABEL = 'yes';
const NO_LABEL = 'no';
const PROVIDER_COLUMN_WIDTH = 13;
const DISCOVERED_COLUMN_WIDTH = 11;
const SAMPLES_COLUMN_WIDTH = 8;
const MODE_COLUMN_WIDTH = 12;
const BEFORE_COLUMN_WIDTH = 13;
const AFTER_COLUMN_WIDTH = 12;
const SAVED_COLUMN_WIDTH = 8;
const EXACT_COLUMN_WIDTH = 7;

export function createHumanEvidenceReport(report: LocalEvidenceReport): string {
  if (report.evidence.length == 0) {
    return [
      'Local evidence',
      '',
      'No eligible sessions found.',
      `Work root: ${report.workRoot}`,
    ].join('\n');
  }

  const totalOriginBytes = sumEvidenceBytes(report.evidence, 'sourceBytes');
  const totalArchiveBytes = sumEvidenceBytes(report.evidence, 'archiveBytes');
  const totalFoundSessions = report.evidence.reduce(addFoundSessions, 0);
  const totalSampledOrigins = report.evidence.reduce(addSampledSources, 0);
  const touchedOriginals = report.evidence.some(isOriginalTouched);
  const touchedLabel = touchedOriginals ? YES_LABEL : NO_LABEL;
  const totalSavedPercent = describeSampledPercent(
    totalOriginBytes,
    totalArchiveBytes,
    totalSampledOrigins,
  );
  const totalBefore = describeSampledBytes(totalOriginBytes, totalSampledOrigins);
  const totalAfter = describeSampledBytes(totalArchiveBytes, totalSampledOrigins);

  return [
    'Local evidence',
    '',
    'Copies only. Real session files are not modified.',
    'One eligible source per provider is copied and measured.',
    'Proof bytes are not a whole-store estimate.',
    '',
    'Provider      Discovered  Samples  Mode         Proof before  Proof after  Saved    Exact   Touched',
    ...report.evidence.map(createEvidenceLine),
    '------------- -----------  -------- ----------- ------------- ------------ -------- ------- -------',
    `${'sample total'.padEnd(PROVIDER_COLUMN_WIDTH)} ${String(totalFoundSessions).padEnd(DISCOVERED_COLUMN_WIDTH)} ${String(totalSampledOrigins).padEnd(SAMPLES_COLUMN_WIDTH)} ${''.padEnd(MODE_COLUMN_WIDTH)} ${totalBefore.padEnd(BEFORE_COLUMN_WIDTH)} ${totalAfter.padEnd(AFTER_COLUMN_WIDTH)} ${totalSavedPercent.padEnd(SAVED_COLUMN_WIDTH)} ${''.padEnd(EXACT_COLUMN_WIDTH)} ${touchedLabel}`,
    '',
    `Original sessions touched: ${touchedLabel}`,
    `Work root: ${report.workRoot}`,
  ].join('\n');
}

export function createStructuredEvidenceReport(report: LocalEvidenceReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function addFoundSessions(totalSessions: number, providerEvidence: ProviderEvidence): number {
  return totalSessions + providerEvidence.foundSessions;
}

function addSampledSources(totalSamples: number, providerEvidence: ProviderEvidence): number {
  return totalSamples + providerEvidence.sampledSources;
}

function isOriginalTouched(providerEvidence: ProviderEvidence): boolean {
  return providerEvidence.originalTouched;
}

function createEvidenceLine(providerEvidence: ProviderEvidence): string {
  const provider = providerEvidence.provider.padEnd(PROVIDER_COLUMN_WIDTH);
  const foundSessions = String(providerEvidence.foundSessions).padEnd(DISCOVERED_COLUMN_WIDTH);
  const sampledOrigins = String(providerEvidence.sampledSources).padEnd(SAMPLES_COLUMN_WIDTH);
  const mode = providerEvidence.mode.padEnd(MODE_COLUMN_WIDTH);
  const before = describeOptionalBytes(providerEvidence.sourceBytes, MISSING_LABEL).padEnd(
    BEFORE_COLUMN_WIDTH,
  );
  const after = describeOptionalBytes(providerEvidence.archiveBytes, MISSING_LABEL).padEnd(
    AFTER_COLUMN_WIDTH,
  );
  const saved = describeOptionalPercent(providerEvidence.savedPercent, MISSING_LABEL).padEnd(
    SAVED_COLUMN_WIDTH,
  );
  const exact = describeByteExact(providerEvidence.byteExact).padEnd(EXACT_COLUMN_WIDTH);
  const touched = providerEvidence.originalTouched ? YES_LABEL : NO_LABEL;

  return `${provider} ${foundSessions} ${sampledOrigins} ${mode} ${before} ${after} ${saved} ${exact} ${touched}`;
}

function sumEvidenceBytes(
  evidence: ReadonlyArray<ProviderEvidence>,
  key: 'archiveBytes' | 'sourceBytes',
): number {
  function addEvidenceBytes(totalBytes: number, providerEvidence: ProviderEvidence): number {
    return totalBytes + (providerEvidence[key] ?? 0);
  }

  return evidence.reduce(addEvidenceBytes, 0);
}

function describeSampledBytes(bytes: number, sampledOrigins: number): string {
  const isNothingSampled = sampledOrigins == 0;
  return isNothingSampled ? MISSING_LABEL : describeBytes(bytes);
}

function describeSampledPercent(
  originBytes: number,
  archiveBytes: number,
  sampledOrigins: number,
): string {
  const isNothingSampled = sampledOrigins == 0;
  if (isNothingSampled) {
    return describeOptionalPercent(undefined, MISSING_LABEL);
  }

  return describeOptionalPercent(calculateSavedPercent(originBytes, archiveBytes), MISSING_LABEL);
}

function describeByteExact(byteExact: boolean | undefined): string {
  if (byteExact == null) {
    return MISSING_LABEL;
  }

  return byteExact ? YES_LABEL : NO_LABEL;
}

export interface SavingsFlags {
  readonly provider?: string;
  readonly json?: boolean;
}

export async function runSavingsCommand(flags: SavingsFlags): Promise<CommandExit> {
  const home = requireHome();

  if (home == null) {
    return { exitCode: 1 };
  }

  const { providers, isProviderUnknown } = selectProviders(flags.provider);
  const providerExitCode = isProviderUnknown ? 2 : 0;
  const report = await runLocalEvidence({
    home,
    workRoot: createEvidenceWorkRoot(process.cwd(), String(process.pid)),
    providers,
  });

  if (flags.json == true) {
    process.stdout.write(createStructuredEvidenceReport(report));
    return { exitCode: providerExitCode };
  }

  process.stdout.write(`${createHumanEvidenceReport(report)}\n`);
  return { exitCode: providerExitCode };
}

export function createEvidenceWorkRoot(cwd: string, runId: string): string {
  return join(cwd, '.vault-test', 'evidence-local', runId);
}
