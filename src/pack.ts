import {
  archivePathForSession,
  type CommandExit,
  type CompressionAdapter,
  calculateSavedPercent,
  createDefaultVaultPath,
  createSessionManifestPath,
  createSessionVerificationPath,
  createZstdCompression,
  describeBytes,
  describeOptionalBytes,
  describeOptionalPercent,
  describeStatus,
  describeTouched,
  HOME_NOT_SET_CANCEL_MESSAGE,
  isPathPresent,
  readHomeFolder,
  removeOriginalSession,
  removePath,
  requireHome,
  sumSessionBytes,
  writeArchivedStub,
  writeSessionManifest,
  writeVerifiedArchive,
} from './archive.js';
import type { InteractiveCliRequest, PromptAdapter } from './prompts.js';
import {
  allProviders,
  type DiscoveredSession,
  listDefaultSessionStores,
  type ProviderAdapter,
  type ProviderId,
  type ProviderMode,
  type SessionOriginKind,
  selectProviders,
} from './providers.js';
import {
  createProviderInventoryTable,
  loadInventoryWithSpinner,
  type ProviderInventoryReport,
  scanStores,
} from './scan.js';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;
const MILLISECONDS_PER_WEEK = 7 * MILLISECONDS_PER_DAY;

const HOUR_UNIT = 'h';
const DAY_UNIT = 'd';
const WEEK_UNIT = 'w';
const BACKUP_ONLY_MODE = 'backup-only';
const BROADER_DURATION_DIVISOR = 2;

export const DEFAULT_COLD_AFTER = '7d';

export const DEFAULT_COLD_AFTER_MS = MILLISECONDS_PER_WEEK;

interface PackPlanProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly mode: ProviderMode;
}

export interface PackPlanRequest {
  readonly now: Date;
  readonly olderThan: string;
  readonly olderThanMs: number;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
  readonly providers: ReadonlyArray<PackPlanProvider>;
}

interface PackPlanSummary {
  readonly provider: ProviderId;
  readonly mode: ProviderMode;
  readonly scannedSessions: number;
  readonly candidateSessions: number;
  readonly beforeBytes: number;
  readonly afterDryRunBytes: number;
  readonly cleanupBytes: number;
  readonly applySupport: typeof BACKUP_ONLY_MODE | 'ready';
}

export interface PackPlan {
  readonly rows: ReadonlyArray<PackPlanSummary>;
  readonly thresholdPreviews: ReadonlyArray<PackThresholdPreview>;
}

type PackThresholdPreviewKind = 'broader' | 'max' | 'safer';

export interface PackThresholdPreview {
  readonly kind: PackThresholdPreviewKind;
  readonly olderThan: string;
  readonly candidateSessions: number;
  readonly beforeBytes: number;
}

export interface PackThresholdPreviewRequest {
  readonly now: Date;
  readonly olderThan: string;
  readonly olderThanMs: number;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}

export function createPackPlan(request: PackPlanRequest): PackPlan {
  const cutoffTime = request.now.getTime() - request.olderThanMs;

  function isArchiveProvider(provider: PackPlanProvider): boolean {
    return provider.mode == 'archive';
  }

  function readProviderId(provider: PackPlanProvider): ProviderId {
    return provider.id;
  }

  const packableProviderIds = request.providers.filter(isArchiveProvider).map(readProviderId);

  function isPackableSession(session: DiscoveredSession): boolean {
    return packableProviderIds.includes(session.provider);
  }

  function isColdSession(session: DiscoveredSession): boolean {
    return session.modifiedAt.getTime() < cutoffTime;
  }

  function createProviderRow(provider: PackPlanProvider): PackPlanSummary {
    function isProviderSession(session: DiscoveredSession): boolean {
      return session.provider == provider.id;
    }

    const providerSessions = request.sessions.filter(isProviderSession);

    if (provider.mode == BACKUP_ONLY_MODE) {
      return {
        provider: provider.id,
        mode: provider.mode,
        scannedSessions: providerSessions.length,
        candidateSessions: 0,
        beforeBytes: 0,
        afterDryRunBytes: 0,
        cleanupBytes: 0,
        applySupport: BACKUP_ONLY_MODE,
      };
    }

    const candidates = providerSessions.filter(isColdSession);
    const beforeBytes = sumSessionBytes(candidates);

    return {
      provider: provider.id,
      mode: provider.mode,
      scannedSessions: providerSessions.length,
      candidateSessions: candidates.length,
      beforeBytes,
      afterDryRunBytes: beforeBytes,
      cleanupBytes: 0,
      applySupport: 'ready',
    };
  }

  const packableSessions = request.sessions.filter(isPackableSession);

  return {
    rows: request.providers.map(createProviderRow),
    thresholdPreviews: createPackThresholdPreviews({
      now: request.now,
      olderThan: request.olderThan,
      olderThanMs: request.olderThanMs,
      sessions: packableSessions,
    }),
  };
}

export function createPackThresholdPreviews(
  request: PackThresholdPreviewRequest,
): ReadonlyArray<PackThresholdPreview> {
  const duration = parseDuration(request.olderThan);

  const maxPreview = createThresholdPreview({
    kind: 'max',
    olderThan: '0h',
    olderThanMs: 0,
    now: request.now,
    sessions: request.sessions,
  });

  if (duration == null) {
    return [maxPreview];
  }

  if (duration.value == 0) {
    return [maxPreview];
  }

  const safer = multiplyDuration(duration, 2);
  const broader = halveDuration(duration);

  return [
    createThresholdPreview({
      kind: 'safer',
      olderThan: describeDuration(safer),
      olderThanMs: convertDurationToMilliseconds(safer),
      now: request.now,
      sessions: request.sessions,
    }),
    createThresholdPreview({
      kind: 'broader',
      olderThan: describeDuration(broader),
      olderThanMs: convertDurationToMilliseconds(broader),
      now: request.now,
      sessions: request.sessions,
    }),
    maxPreview,
  ];
}

type DurationUnit = typeof DAY_UNIT | typeof HOUR_UNIT | typeof WEEK_UNIT;

interface Duration {
  readonly value: number;
  readonly unit: DurationUnit;
}

export function parseDurationMs(duration: string): number {
  const parsed = parseDuration(duration);

  if (parsed == null) {
    return DEFAULT_COLD_AFTER_MS;
  }

  return convertDurationToMilliseconds(parsed);
}

function createThresholdPreview(request: {
  readonly kind: PackThresholdPreviewKind;
  readonly olderThan: string;
  readonly olderThanMs: number;
  readonly now: Date;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}): PackThresholdPreview {
  const cutoffTime = request.now.getTime() - request.olderThanMs;

  function isColdSession(session: DiscoveredSession): boolean {
    return session.modifiedAt.getTime() < cutoffTime;
  }

  const candidates = request.sessions.filter(isColdSession);

  return {
    kind: request.kind,
    olderThan: request.olderThan,
    candidateSessions: candidates.length,
    beforeBytes: sumSessionBytes(candidates),
  };
}

function parseDuration(duration: string): Duration | null {
  // Catches a whole number followed by one unit letter, such as 12h, 7d or 2w.
  const durationPattern = /^(\d+)(h|d|w)$/;
  const durationParts = duration.match(durationPattern);

  if (durationParts == null) {
    return null;
  }

  const knownUnits: ReadonlyArray<DurationUnit> = [HOUR_UNIT, DAY_UNIT, WEEK_UNIT];

  function isMatchingUnit(knownUnit: DurationUnit): boolean {
    return knownUnit == durationParts?.[2];
  }

  const unit = knownUnits.find(isMatchingUnit);

  if (unit == null) {
    return null;
  }

  return {
    value: Number(durationParts[1]),
    unit,
  };
}

function multiplyDuration(duration: Duration, factor: number): Duration {
  return {
    value: duration.value * factor,
    unit: duration.unit,
  };
}

function halveDuration(duration: Duration): Duration {
  if (duration.unit == HOUR_UNIT) {
    return {
      value: Math.max(0, Math.floor(duration.value / BROADER_DURATION_DIVISOR)),
      unit: HOUR_UNIT,
    };
  }

  const isDurationInDays = duration.unit == DAY_UNIT;
  if (isDurationInDays && duration.value <= 1) {
    const halfDayPreviewHours = 12;
    return {
      value: halfDayPreviewHours,
      unit: HOUR_UNIT,
    };
  }

  const isDurationInWeeks = duration.unit == WEEK_UNIT;
  if (isDurationInWeeks && duration.value <= 1) {
    const weekPreviewDays = 3;
    return {
      value: weekPreviewDays,
      unit: DAY_UNIT,
    };
  }

  return {
    value: Math.floor(duration.value / BROADER_DURATION_DIVISOR),
    unit: duration.unit,
  };
}

function convertDurationToMilliseconds(duration: Duration): number {
  const millisecondsPerUnit: Record<DurationUnit, number> = {
    [HOUR_UNIT]: MILLISECONDS_PER_HOUR,
    [DAY_UNIT]: MILLISECONDS_PER_DAY,
    [WEEK_UNIT]: MILLISECONDS_PER_WEEK,
  };

  return duration.value * millisecondsPerUnit[duration.unit];
}

function describeDuration(duration: Duration): string {
  return `${duration.value}${duration.unit}`;
}

const BACKUP_ONLY_LABEL = 'backup-only';

type PackSessionStatus = 'backup-only' | 'dry-run' | 'missing' | 'no-candidates' | 'packed';

interface PackSessionSummary {
  readonly provider: ProviderId;
  readonly mode: ProviderMode;
  readonly foundSessions: number;
  readonly candidateSessions: number;
  readonly packedSessions: number;
  readonly beforeBytes: number;
  readonly archiveBytes: number | undefined;
  readonly savedBytes: number | undefined;
  readonly savedPercent: number | undefined;
  readonly touchedOriginals: boolean;
  readonly status: PackSessionStatus;
  readonly reason: string | undefined;
}

export interface PackSessionsReport {
  readonly command: 'pack';
  readonly apply: boolean;
  readonly vaultPath: string;
  readonly rows: ReadonlyArray<PackSessionSummary>;
  readonly thresholdPreviews: ReadonlyArray<PackThresholdPreview>;
}

export interface PackProviderSessionsRequest {
  readonly home: string;
  readonly vaultPath: string;
  readonly providers: ReadonlyArray<ProviderAdapter>;
  readonly olderThan: string;
  readonly olderThanMs: number;
  readonly now: Date;
  readonly apply: boolean;
  readonly compression: CompressionAdapter;
}

export async function packProviderSessions(
  request: PackProviderSessionsRequest,
): Promise<PackSessionsReport> {
  const packSessionSummaries: PackSessionSummary[] = [];
  const packableSessions: DiscoveredSession[] = [];
  const cutoffTime = request.now.getTime() - request.olderThanMs;

  function isColdSession(session: DiscoveredSession): boolean {
    return session.modifiedAt.getTime() < cutoffTime;
  }

  for (const provider of request.providers) {
    const sessions = await discoverExistingProviderSessions({
      home: request.home,
      provider,
    });

    if (sessions == null) {
      packSessionSummaries.push(createMissingPackSummary(provider));
      continue;
    }

    if (provider.mode == BACKUP_ONLY_LABEL) {
      packSessionSummaries.push(createBackupOnlyPackSummary(provider, sessions.length));
      continue;
    }

    packableSessions.push(...sessions);

    const candidates = sessions.filter(isColdSession);

    if (candidates.length == 0) {
      packSessionSummaries.push(createNoCandidatesPackSummary(provider, sessions.length));
      continue;
    }

    if (request.apply == false) {
      packSessionSummaries.push(createDryRunPackSummary(provider, sessions.length, candidates));
      continue;
    }

    const archived = await archiveCandidateSessions({
      candidates,
      compression: request.compression,
      now: request.now,
      vaultPath: request.vaultPath,
    });

    packSessionSummaries.push(
      createPackedSummary({
        provider,
        foundSessions: sessions.length,
        packedSessions: archived.packedSessions,
        beforeBytes: archived.beforeBytes,
        archiveBytes: archived.archiveBytes,
      }),
    );
  }

  return {
    command: 'pack',
    apply: request.apply,
    vaultPath: request.vaultPath,
    rows: packSessionSummaries,
    thresholdPreviews: createPackThresholdPreviews({
      now: request.now,
      olderThan: request.olderThan,
      olderThanMs: request.olderThanMs,
      sessions: packableSessions,
    }),
  };
}

async function discoverExistingProviderSessions(request: {
  readonly home: string;
  readonly provider: ProviderAdapter;
}): Promise<ReadonlyArray<DiscoveredSession> | null> {
  const roots = request.provider.defaultRoots(request.home);
  const sessions: DiscoveredSession[] = [];
  let existingRoots = 0;

  for (const root of roots) {
    const doesRootExist = await isPathPresent(root);

    if (!doesRootExist) {
      continue;
    }

    existingRoots += 1;
    const discovered = await request.provider.discover({
      provider: request.provider.id,
      path: root,
    });
    sessions.push(...discovered);
  }

  if (existingRoots == 0) {
    return null;
  }

  return sessions;
}

async function archiveCandidateSessions(request: {
  readonly candidates: ReadonlyArray<DiscoveredSession>;
  readonly compression: CompressionAdapter;
  readonly now: Date;
  readonly vaultPath: string;
}): Promise<{
  readonly archiveBytes: number;
  readonly beforeBytes: number;
  readonly packedSessions: number;
}> {
  let archiveBytes = 0;
  let beforeBytes = 0;
  let packedSessions = 0;

  for (const session of request.candidates) {
    const originKind = readSessionOriginKind(session);
    const archivePath = archivePathForSession(request.vaultPath, session, originKind);
    const restoredPath = createSessionVerificationPath(request.vaultPath, session, originKind);
    const manifestPath = createSessionManifestPath(request.vaultPath, session);
    const archived = await writeVerifiedArchive({
      sessionId: session.id,
      sessionPath: session.originalPath,
      archivePath,
      restoredPath,
      apply: false,
      compression: request.compression,
      sourceKind: originKind,
    });

    await writeSessionManifest(manifestPath, {
      sessionId: session.id,
      provider: session.provider,
      title: session.title,
      slug: session.slug,
      originalPath: session.originalPath,
      archivePath,
      sourceSha256: archived.sourceSha256,
      sourceBytes: archived.sourceBytes,
      archiveBytes: archived.archiveBytes,
      archivedAt: request.now.toISOString(),
      sourceKind: originKind,
    });
    await removeOriginalSession(session.originalPath);
    // Leave a tiny listable stub so GUIs can still see the session; watch materializes on open.
    await writeArchivedStub({
      originalPath: session.originalPath,
      sessionId: session.id,
      provider: session.provider,
      sourceKind: originKind,
    });
    await removePath(restoredPath);

    archiveBytes += archived.archiveBytes;
    beforeBytes += archived.sourceBytes;
    packedSessions += 1;
  }

  return {
    archiveBytes,
    beforeBytes,
    packedSessions,
  };
}

function createMissingPackSummary(provider: ProviderAdapter): PackSessionSummary {
  return {
    provider: provider.id,
    mode: provider.mode,
    foundSessions: 0,
    candidateSessions: 0,
    packedSessions: 0,
    beforeBytes: 0,
    archiveBytes: undefined,
    savedBytes: undefined,
    savedPercent: undefined,
    touchedOriginals: false,
    status: 'missing',
    reason: 'provider store not found',
  };
}

function createBackupOnlyPackSummary(
  provider: ProviderAdapter,
  foundSessions: number,
): PackSessionSummary {
  return {
    provider: provider.id,
    mode: provider.mode,
    foundSessions,
    candidateSessions: 0,
    packedSessions: 0,
    beforeBytes: 0,
    archiveBytes: undefined,
    savedBytes: undefined,
    savedPercent: undefined,
    touchedOriginals: false,
    status: BACKUP_ONLY_LABEL,
    reason: `${BACKUP_ONLY_LABEL} provider is not mutated`,
  };
}

function createNoCandidatesPackSummary(
  provider: ProviderAdapter,
  foundSessions: number,
): PackSessionSummary {
  return {
    provider: provider.id,
    mode: provider.mode,
    foundSessions,
    candidateSessions: 0,
    packedSessions: 0,
    beforeBytes: 0,
    archiveBytes: undefined,
    savedBytes: undefined,
    savedPercent: undefined,
    touchedOriginals: false,
    status: 'no-candidates',
    reason: 'no sessions older than threshold',
  };
}

function createDryRunPackSummary(
  provider: ProviderAdapter,
  foundSessions: number,
  candidates: ReadonlyArray<DiscoveredSession>,
): PackSessionSummary {
  return {
    provider: provider.id,
    mode: provider.mode,
    foundSessions,
    candidateSessions: candidates.length,
    packedSessions: 0,
    beforeBytes: sumSessionBytes(candidates),
    archiveBytes: undefined,
    savedBytes: undefined,
    savedPercent: undefined,
    touchedOriginals: false,
    status: 'dry-run',
    reason: '--apply required to write archives',
  };
}

function createPackedSummary(request: {
  readonly provider: ProviderAdapter;
  readonly foundSessions: number;
  readonly packedSessions: number;
  readonly beforeBytes: number;
  readonly archiveBytes: number;
}): PackSessionSummary {
  return {
    provider: request.provider.id,
    mode: request.provider.mode,
    foundSessions: request.foundSessions,
    candidateSessions: request.packedSessions,
    packedSessions: request.packedSessions,
    beforeBytes: request.beforeBytes,
    archiveBytes: request.archiveBytes,
    savedBytes: request.beforeBytes - request.archiveBytes,
    savedPercent: calculateSavedPercent(request.beforeBytes, request.archiveBytes),
    touchedOriginals: request.packedSessions > 0,
    status: 'packed',
    reason: undefined,
  };
}

function readSessionOriginKind(session: DiscoveredSession): SessionOriginKind {
  return session.sourceKind ?? 'file';
}

const PENDING_LABEL = 'pending';
const TOTAL_LABEL = 'total';
const DRY_RUN_LABEL = 'dry-run';
const SAFER_PREVIEW_KIND = 'safer';
const BROADER_PREVIEW_KIND = 'broader';
const LINE_BREAK = '\n';
const JSON_INDENT = 2;

const PROVIDER_COLUMN_WIDTH = 10;
const MODE_COLUMN_WIDTH = 12;
const PLAN_FOUND_COLUMN_WIDTH = 5;
const PLAN_CANDIDATES_COLUMN_WIDTH = 10;
const PLAN_BEFORE_COLUMN_WIDTH = 10;
const PLAN_AFTER_COLUMN_WIDTH = 15;
const REPORT_SESSIONS_COLUMN_WIDTH = 9;
const REPORT_CANDIDATES_COLUMN_WIDTH = 10;
const REPORT_PACKED_COLUMN_WIDTH = 6;
const REPORT_BEFORE_COLUMN_WIDTH = 10;
const REPORT_ARCHIVE_COLUMN_WIDTH = 10;
const REPORT_SAVED_COLUMN_WIDTH = 10;
const REPORT_SAVED_PERCENT_COLUMN_WIDTH = 8;
const REPORT_TOUCHED_COLUMN_WIDTH = 6;

type PackReportRow = PackSessionsReport['rows'][number];
type PackPlanRow = PackPlan['rows'][number];
type ThresholdPreview = PackPlan['thresholdPreviews'][number];

export interface PackPlanPrintoutSettings {
  readonly olderThan: string;
}

export function createHumanPackPlan(plan: PackPlan, settings: PackPlanPrintoutSettings): string {
  const totalBeforeBytes = plan.rows.reduce(addPlanBeforeBytes, 0);
  const totalProvider = TOTAL_LABEL.padEnd(PROVIDER_COLUMN_WIDTH);
  const totalMode = ''.padEnd(MODE_COLUMN_WIDTH);
  const totalFound = ''.padStart(PLAN_FOUND_COLUMN_WIDTH);
  const totalCandidates = ''.padStart(PLAN_CANDIDATES_COLUMN_WIDTH);
  const totalBefore = describeBytes(totalBeforeBytes).padEnd(PLAN_BEFORE_COLUMN_WIDTH);
  const totalAfter = describeBytes(totalBeforeBytes).padEnd(PLAN_AFTER_COLUMN_WIDTH);
  const totalCleanup = describeBytes(0);

  return [
    'Pack dry run',
    '',
    `Cold threshold: ${settings.olderThan}`,
    'No files changed. Cleanup is 0 B until --apply is enabled and runs.',
    '',
    'Provider   Mode         Found   Candidates   Before     After dry-run   Cleanup',
    ...plan.rows.map(createPackPlanSummary),
    '--------   ----         -----   ----------   ------     -------------   -------',
    `${totalProvider} ${totalMode} ${totalFound}   ${totalCandidates}   ${totalBefore} ${totalAfter} ${totalCleanup}`,
    '',
    ...createThresholdPreviewBlock(plan.thresholdPreviews),
    '',
    'Backup-only providers are scanned for visibility but skipped for cleanup.',
    'Re-run with --apply to pack cold sessions.',
  ].join(LINE_BREAK);
}

export function createStructuredPackPlan(plan: PackPlan): string {
  return `${JSON.stringify(plan, null, JSON_INDENT)}${LINE_BREAK}`;
}

export function createHumanPackReport(
  report: PackSessionsReport,
  settings: PackPlanPrintoutSettings,
): string {
  const totals = sumPackTotals(report);
  const isApplyReport = report.apply;
  const modeLabel = isApplyReport ? 'apply' : DRY_RUN_LABEL;
  const confirmationLine = isApplyReport
    ? 'Confirmed. Originals are removed only after verified archives and manifests.'
    : 'No files changed. Re-run with --apply to pack cold sessions.';
  const statusLabel = isApplyReport ? 'applied' : DRY_RUN_LABEL;

  const totalProvider = TOTAL_LABEL.padEnd(PROVIDER_COLUMN_WIDTH);
  const totalSessions = String(totals.foundSessions).padEnd(REPORT_SESSIONS_COLUMN_WIDTH);
  const totalMode = ''.padEnd(MODE_COLUMN_WIDTH);
  const totalCandidates = String(totals.candidateSessions).padStart(REPORT_CANDIDATES_COLUMN_WIDTH);
  const totalPacked = String(totals.packedSessions).padStart(REPORT_PACKED_COLUMN_WIDTH);
  const totalBefore = describeBytes(totals.beforeBytes).padEnd(REPORT_BEFORE_COLUMN_WIDTH);
  const totalArchive = describeOptionalBytes(totals.archiveBytes, PENDING_LABEL).padEnd(
    REPORT_ARCHIVE_COLUMN_WIDTH,
  );
  const totalSaved = describeOptionalBytes(totals.savedBytes, PENDING_LABEL).padEnd(
    REPORT_SAVED_COLUMN_WIDTH,
  );
  const totalSavedPercent = describeOptionalPercent(totals.savedPercent, PENDING_LABEL).padEnd(
    REPORT_SAVED_PERCENT_COLUMN_WIDTH,
  );
  const totalTouched = describeTouched(totals.touchedOriginals).padEnd(REPORT_TOUCHED_COLUMN_WIDTH);

  return [
    'Pack all providers',
    '',
    `Mode: ${modeLabel}`,
    `Cold threshold: ${settings.olderThan}`,
    `Vault: ${report.vaultPath}`,
    confirmationLine,
    '',
    'Provider   Sessions  Mode         Candidates  Packed  Before     Archive    Saved      Saved %  Touch  Status',
    ...report.rows.map(createPackReportSummary),
    '--------   --------  ----         ----------  ------  ------     -------    -----      -------  -----  ------',
    `${totalProvider} ${totalSessions} ${totalMode} ${totalCandidates}  ${totalPacked}  ${totalBefore} ${totalArchive} ${totalSaved} ${totalSavedPercent} ${totalTouched} ${statusLabel}`,
    '',
    ...createThresholdPreviewBlock(report.thresholdPreviews),
  ].join(LINE_BREAK);
}

export function createStructuredPackReport(report: PackSessionsReport): string {
  return `${JSON.stringify(report, null, JSON_INDENT)}${LINE_BREAK}`;
}

function addPlanBeforeBytes(totalBytes: number, packPlanSummary: PackPlanRow): number {
  return totalBytes + packPlanSummary.beforeBytes;
}

function createPackPlanSummary(packPlanSummary: PackPlanRow): string {
  const provider = packPlanSummary.provider.padEnd(PROVIDER_COLUMN_WIDTH);
  const mode = packPlanSummary.mode.padEnd(MODE_COLUMN_WIDTH);
  const found = String(packPlanSummary.scannedSessions).padStart(PLAN_FOUND_COLUMN_WIDTH);
  const candidates = String(packPlanSummary.candidateSessions).padStart(
    PLAN_CANDIDATES_COLUMN_WIDTH,
  );
  const before = describeBytes(packPlanSummary.beforeBytes).padEnd(PLAN_BEFORE_COLUMN_WIDTH);
  const after = describeBytes(packPlanSummary.afterDryRunBytes).padEnd(PLAN_AFTER_COLUMN_WIDTH);
  const cleanup = describeBytes(packPlanSummary.cleanupBytes);

  return `${provider} ${mode} ${found}   ${candidates}   ${before} ${after} ${cleanup}`;
}

function createThresholdPreviewBlock(
  previews: PackPlan['thresholdPreviews'],
): ReadonlyArray<string> {
  if (previews.length == 0) {
    return [];
  }

  return [
    'What if:',
    ...previews.map(createThresholdPreviewLine),
    'Tip: use --max --dry-run to preview every archive-mode session without touching files.',
  ];
}

function createThresholdPreviewLine(preview: ThresholdPreview): string {
  const label = createThresholdPreviewLabel(preview.kind).padEnd(11);
  const command = createThresholdPreviewCommand(preview).padEnd(17);
  const sessions = describeSessionCount(preview.candidateSessions).padEnd(11);

  return `${label} ${command} ${sessions} ${describeBytes(preview.beforeBytes)} source`;
}

function createThresholdPreviewLabel(kind: ThresholdPreview['kind']): string {
  if (kind == SAFER_PREVIEW_KIND) {
    return SAFER_PREVIEW_KIND;
  }

  if (kind == BROADER_PREVIEW_KIND) {
    return BROADER_PREVIEW_KIND;
  }

  return 'max preview';
}

function createThresholdPreviewCommand(preview: ThresholdPreview): string {
  if (preview.kind == 'max') {
    return '--max --dry-run';
  }

  return `--older-than ${preview.olderThan}`;
}

function describeSessionCount(sessions: number): string {
  if (sessions == 1) {
    return '1 session';
  }

  return `${sessions} sessions`;
}

function createPackReportSummary(packSessionSummary: PackReportRow): string {
  const provider = packSessionSummary.provider.padEnd(PROVIDER_COLUMN_WIDTH);
  const sessions = String(packSessionSummary.foundSessions).padEnd(REPORT_SESSIONS_COLUMN_WIDTH);
  const mode = packSessionSummary.mode.padEnd(MODE_COLUMN_WIDTH);
  const candidates = String(packSessionSummary.candidateSessions).padStart(
    REPORT_CANDIDATES_COLUMN_WIDTH,
  );
  const packed = String(packSessionSummary.packedSessions).padStart(REPORT_PACKED_COLUMN_WIDTH);
  const before = describeBytes(packSessionSummary.beforeBytes).padEnd(REPORT_BEFORE_COLUMN_WIDTH);
  const archive = describeOptionalBytes(packSessionSummary.archiveBytes, PENDING_LABEL).padEnd(
    REPORT_ARCHIVE_COLUMN_WIDTH,
  );
  const saved = describeOptionalBytes(packSessionSummary.savedBytes, PENDING_LABEL).padEnd(
    REPORT_SAVED_COLUMN_WIDTH,
  );
  const savedPercent = describeOptionalPercent(
    packSessionSummary.savedPercent,
    PENDING_LABEL,
  ).padEnd(REPORT_SAVED_PERCENT_COLUMN_WIDTH);
  const touched = describeTouched(packSessionSummary.touchedOriginals).padEnd(
    REPORT_TOUCHED_COLUMN_WIDTH,
  );
  const status = describeStatus(packSessionSummary.status, packSessionSummary.reason);

  return `${provider} ${sessions} ${mode} ${candidates}  ${packed}  ${before} ${archive} ${saved} ${savedPercent} ${touched} ${status}`;
}

function readArchiveBytes(packSessionSummary: PackReportRow): number | undefined {
  return packSessionSummary.archiveBytes;
}

function addReportBeforeBytes(totalBytes: number, packSessionSummary: PackReportRow): number {
  return totalBytes + packSessionSummary.beforeBytes;
}

function addCandidateSessions(totalSessions: number, packSessionSummary: PackReportRow): number {
  return totalSessions + packSessionSummary.candidateSessions;
}

function addFoundSessions(totalSessions: number, packSessionSummary: PackReportRow): number {
  return totalSessions + packSessionSummary.foundSessions;
}

function addPackedSessions(totalSessions: number, packSessionSummary: PackReportRow): number {
  return totalSessions + packSessionSummary.packedSessions;
}

function hasTouchedOriginals(packSessionSummary: PackReportRow): boolean {
  return packSessionSummary.touchedOriginals;
}

function sumPackTotals(report: PackSessionsReport): {
  readonly archiveBytes: number | undefined;
  readonly beforeBytes: number;
  readonly candidateSessions: number;
  readonly foundSessions: number;
  readonly packedSessions: number;
  readonly savedBytes: number | undefined;
  readonly savedPercent: number | undefined;
  readonly touchedOriginals: boolean;
} {
  const archiveBytesSum = sumMaybe(report.rows.map(readArchiveBytes));
  const archiveBytes = archiveBytesSum ?? undefined;
  const beforeBytes = report.rows.reduce(addReportBeforeBytes, 0);
  const isArchiveBytesMissing = archiveBytes == null;
  const savedBytes = isArchiveBytesMissing ? undefined : beforeBytes - archiveBytes;

  return {
    archiveBytes,
    beforeBytes,
    candidateSessions: report.rows.reduce(addCandidateSessions, 0),
    foundSessions: report.rows.reduce(addFoundSessions, 0),
    packedSessions: report.rows.reduce(addPackedSessions, 0),
    savedBytes,
    savedPercent: isArchiveBytesMissing
      ? undefined
      : calculateSavedPercent(beforeBytes, archiveBytes),
    touchedOriginals: report.rows.some(hasTouchedOriginals),
  };
}

function isNumberMissing(maybeBytes: number | undefined): boolean {
  return maybeBytes == null;
}

function sumMaybe(maybeByteCounts: ReadonlyArray<number | undefined>): number | null {
  if (maybeByteCounts.some(isNumberMissing)) {
    return null;
  }

  let totalBytes = 0;

  for (const maybeBytes of maybeByteCounts) {
    totalBytes += Number(maybeBytes);
  }

  return totalBytes;
}

const LineBreakCommand = '\n';
const USAGE_EXIT_CODE = 2;

export interface PackFlags {
  readonly allProviders: boolean | undefined;
  readonly provider: string | undefined;
  readonly max?: boolean | undefined;
  readonly olderThan: string | undefined;
  readonly dryRun: boolean | undefined;
  readonly apply: boolean | undefined;
  readonly json: boolean | undefined;
  readonly yes: boolean | undefined;
  readonly confirmed?: boolean | undefined;
  readonly compression?: CompressionAdapter | undefined;
  readonly home?: string | undefined;
  readonly now?: Date | undefined;
  readonly providers?: ReadonlyArray<ProviderAdapter> | undefined;
  readonly vaultPath?: string | undefined;
}

export async function runPackCommand(flags: PackFlags): Promise<CommandExit> {
  const isMachineReadableRequested = flags.json == true;

  if (flags.max == true && flags.apply == true) {
    process.stderr.write('Refusing --max with --apply. Use --max as a dry-run preview only.\n');
    process.stderr.write(LineBreakCommand);
    return { exitCode: USAGE_EXIT_CODE };
  }

  const home = requireHome(flags.home);

  if (home == null) {
    return { exitCode: 1 };
  }

  if (flags.apply == true && flags.confirmed != true) {
    process.stderr.write('Cancelled. Re-run with --apply and confirm with y to pack sessions.\n');
    process.stderr.write(LineBreakCommand);
    return { exitCode: USAGE_EXIT_CODE };
  }

  const isMaxRequested = flags.max == true;
  const olderThan = isMaxRequested ? '0h' : (flags.olderThan ?? DEFAULT_COLD_AFTER);
  const olderThanMs = parseDurationMs(olderThan);
  const { providers, isProviderUnknown } = selectProviders(flags.provider, flags.providers);
  const providerExitCode = isProviderUnknown ? USAGE_EXIT_CODE : 0;

  if (canUseArchiveWorkflow(flags)) {
    const report = await packProviderSessions({
      home,
      vaultPath: flags.vaultPath ?? createDefaultVaultPath(home),
      providers,
      olderThan,
      olderThanMs,
      now: flags.now ?? new Date(),
      apply: flags.apply == true,
      compression: flags.compression ?? createZstdCompression(),
    });

    writeArchiveReport({ report, olderThan, isMachineReadableRequested });
    return { exitCode: providerExitCode };
  }

  const stores = listDefaultSessionStores(providers, home);
  const report = await scanStores({
    providers,
    stores,
  });
  const plan = createPackPlan({
    now: new Date(),
    olderThan,
    olderThanMs,
    sessions: report.sessions,
    providers: providers.map(describePlanProvider),
  });

  if (isMachineReadableRequested) {
    process.stdout.write(createStructuredPackPlan(plan));
    return { exitCode: providerExitCode };
  }

  process.stdout.write(`${createHumanPackPlan(plan, { olderThan })}\n`);
  return { exitCode: providerExitCode };
}

function describePlanProvider(provider: ProviderAdapter): PackPlanRequest['providers'][number] {
  return {
    id: provider.id,
    label: provider.label,
    mode: provider.mode,
  };
}

interface ArchiveReportDetails {
  readonly report: PackSessionsReport;
  readonly olderThan: string;
  readonly isMachineReadableRequested: boolean;
}

function writeArchiveReport(details: ArchiveReportDetails): void {
  const isMachineReadableRequested = details.isMachineReadableRequested;
  if (isMachineReadableRequested) {
    process.stdout.write(createStructuredPackReport(details.report));
    return;
  }

  process.stdout.write(
    `${createHumanPackReport(details.report, { olderThan: details.olderThan })}\n`,
  );
}

function canUseArchiveWorkflow(flags: PackFlags): boolean {
  if (flags.apply == true) {
    return true;
  }

  if (flags.allProviders == true) {
    return true;
  }

  const isMaxRequested = flags.max == true;
  if (isMaxRequested) {
    return true;
  }

  return false;
}

const NO_FILES_CHANGED_MESSAGE = 'No files changed.';

type InventoryRow = ProviderInventoryReport['rows'][number];

export async function runPackFlow(
  request: InteractiveCliRequest & { readonly prompts: PromptAdapter },
): Promise<CommandExit> {
  const home = request.home ?? readHomeFolder();

  if (home == null) {
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

  request.prompts.note(createProviderInventoryTable(inventory), 'Pack cold sessions');

  const shouldPreview = await request.prompts.confirm({
    message: 'Continue with dry-run preview?',
    initialValue: true,
  });

  if (request.prompts.isCancel(shouldPreview)) {
    request.prompts.cancel(NO_FILES_CHANGED_MESSAGE);
    return { exitCode: 0 };
  }

  if (shouldPreview != true) {
    request.prompts.cancel(NO_FILES_CHANGED_MESSAGE);
    return { exitCode: 0 };
  }

  const previewExit = await runPackCommand({
    allProviders: true,
    apply: false,
    dryRun: true,
    json: false,
    olderThan: DEFAULT_COLD_AFTER,
    provider: undefined,
    yes: false,
    confirmed: undefined,
  });

  const shouldApply = await request.prompts.confirm({
    message: createPackApplyQuestion(inventory, home),
    initialValue: false,
  });

  if (request.prompts.isCancel(shouldApply)) {
    request.prompts.outro(NO_FILES_CHANGED_MESSAGE);
    return previewExit;
  }

  if (shouldApply != true) {
    request.prompts.outro(NO_FILES_CHANGED_MESSAGE);
    return previewExit;
  }

  const applyExit = await runPackCommand({
    allProviders: true,
    apply: true,
    dryRun: false,
    json: false,
    olderThan: DEFAULT_COLD_AFTER,
    provider: undefined,
    yes: true,
    confirmed: true,
  });
  return applyExit;
}

function createPackApplyQuestion(inventory: ProviderInventoryReport, home: string): string {
  function addColdSessions(totalSessions: number, inventorySummary: InventoryRow): number {
    return totalSessions + inventorySummary.coldSessions;
  }

  function addCandidateBytes(totalBytes: number, inventorySummary: InventoryRow): number {
    return totalBytes + inventorySummary.candidateBytes;
  }

  function hasColdSessions(inventorySummary: InventoryRow): boolean {
    return inventorySummary.coldSessions > 0;
  }

  function readProviderId(inventorySummary: InventoryRow): string {
    return inventorySummary.provider;
  }

  const candidateSessions = inventory.rows.reduce(addColdSessions, 0);
  const candidateBytes = inventory.rows.reduce(addCandidateBytes, 0);
  const providerNames = inventory.rows.filter(hasColdSessions).map(readProviderId).join(', ');

  return [
    'Apply pack now?',
    '',
    `This will archive ${candidateSessions} cold sessions from ${providerNames || 'no providers'} into:`,
    createDefaultVaultPath(home),
    '',
    `Candidate size: ${describeBytes(candidateBytes)}`,
    'Original files are removed only after archive write, restore verification, and manifest write.',
  ].join('\n');
}
