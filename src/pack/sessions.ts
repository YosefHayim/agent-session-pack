import { isPathPresent, removePath } from '@/archive/file-system.js';
import { writeSessionManifest } from '@/archive/manifest-store.js';
import { writeArchivedStub } from '@/archive/session-stub.js';
import {
  archivePathForSession,
  createSessionManifestPath,
  createSessionVerificationPath,
} from '@/archive/vault-paths.js';
import {
  type CompressionAdapter,
  removeOriginalSession,
  writeVerifiedArchive,
} from '@/archive/writer.js';
import { calculateSavedPercent, sumSessionBytes } from '@/byte-savings.js';
import type {
  DiscoveredSession,
  ProviderAdapter,
  ProviderId,
  ProviderMode,
  SessionOriginKind,
} from '@/session-model.js';
import { createPackThresholdPreviews, type PackThresholdPreview } from './plan.js';

/**
 * Outcome status reported for one provider during a pack run.
 */
type PackSessionStatus = 'backup-only' | 'dry-run' | 'missing' | 'no-candidates' | 'packed';

/**
 * Per-provider pack result row with byte totals and status.
 */
type PackSessionSummary = {
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
};

/**
 * Full pack report covering all providers and threshold previews.
 */
export type PackSessionsReport = {
  readonly command: 'pack';
  readonly apply: boolean;
  readonly vaultPath: string;
  readonly rows: ReadonlyArray<PackSessionSummary>;
  readonly thresholdPreviews: ReadonlyArray<PackThresholdPreview>;
};

/**
 * Inputs required to pack cold provider sessions into the vault.
 */
export type PackProviderSessionsRequest = {
  readonly home: string;
  readonly vaultPath: string;
  readonly providers: ReadonlyArray<ProviderAdapter>;
  readonly olderThan: string;
  readonly olderThanMs: number;
  readonly now: Date;
  readonly apply: boolean;
  readonly compression: CompressionAdapter;
};

/**
 * Packs cold sessions for the selected providers into the vault.
 */
export const packProviderSessions = async (
  request: PackProviderSessionsRequest,
): Promise<PackSessionsReport> => {
  const packSessionSummaries: PackSessionSummary[] = [];
  const packableSessions: DiscoveredSession[] = [];
  const cutoffTime = request.now.getTime() - request.olderThanMs;

  for (const provider of request.providers) {
    const sessions = await discoverExistingProviderSessions({
      home: request.home,
      provider,
    });

    const isSessionsMissing = sessions == null;
    if (isSessionsMissing) {
      packSessionSummaries.push(createMissingPackSummary(provider));
      continue;
    }

    const isProviderModeBackupOnly = provider.mode === 'backup-only';
    if (isProviderModeBackupOnly) {
      packSessionSummaries.push(createBackupOnlyPackSummary(provider, sessions.length));
      continue;
    }

    packableSessions.push(...sessions);

    const candidates = sessions.filter((session) => session.modifiedAt.getTime() < cutoffTime);

    const isCandidatesEmpty = candidates.length === 0;
    if (isCandidatesEmpty) {
      packSessionSummaries.push(createNoCandidatesPackSummary(provider, sessions.length));
      continue;
    }

    const isPreviewOnly = request.apply === false;
    if (isPreviewOnly) {
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
};

const discoverExistingProviderSessions = async (request: {
  readonly home: string;
  readonly provider: ProviderAdapter;
}): Promise<ReadonlyArray<DiscoveredSession> | undefined> => {
  const roots = request.provider.defaultRoots(request.home);
  const sessions: DiscoveredSession[] = [];
  let existingRoots = 0;

  for (const root of roots) {
    const doesRootExist = await isPathPresent(root);
    const isRootAbsent = !doesRootExist;

    if (isRootAbsent) {
      continue;
    }

    existingRoots += 1;
    const discovered = await request.provider.discover({
      provider: request.provider.id,
      path: root,
    });
    sessions.push(...discovered);
  }

  const hasNoExistingRoot = existingRoots === 0;

  if (hasNoExistingRoot) {
    return undefined;
  }

  return sessions;
};

const archiveCandidateSessions = async (request: {
  readonly candidates: ReadonlyArray<DiscoveredSession>;
  readonly compression: CompressionAdapter;
  readonly now: Date;
  readonly vaultPath: string;
}): Promise<{
  readonly archiveBytes: number;
  readonly beforeBytes: number;
  readonly packedSessions: number;
}> => {
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
      sourcePath: session.originalPath,
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
};

const createMissingPackSummary = (provider: ProviderAdapter): PackSessionSummary => ({
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
});

const createBackupOnlyPackSummary = (
  provider: ProviderAdapter,
  foundSessions: number,
): PackSessionSummary => ({
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
  status: 'backup-only',
  reason: 'backup-only provider is not mutated',
});

const createNoCandidatesPackSummary = (
  provider: ProviderAdapter,
  foundSessions: number,
): PackSessionSummary => ({
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
});

const createDryRunPackSummary = (
  provider: ProviderAdapter,
  foundSessions: number,
  candidates: ReadonlyArray<DiscoveredSession>,
): PackSessionSummary => ({
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
});

const createPackedSummary = (request: {
  readonly provider: ProviderAdapter;
  readonly foundSessions: number;
  readonly packedSessions: number;
  readonly beforeBytes: number;
  readonly archiveBytes: number;
}): PackSessionSummary => ({
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
});

const readSessionOriginKind = (session: DiscoveredSession): SessionOriginKind =>
  session.sourceKind ?? 'file';
