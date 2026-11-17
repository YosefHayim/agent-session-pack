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

    const isSessionsMissing = sessions == null;
    if (isSessionsMissing) {
      packSessionSummaries.push(createMissingPackSummary(provider));
      continue;
    }

    const isProviderModeBackupOnly = provider.mode === BACKUP_ONLY_LABEL;
    if (isProviderModeBackupOnly) {
      packSessionSummaries.push(createBackupOnlyPackSummary(provider, sessions.length));
      continue;
    }

    packableSessions.push(...sessions);

    const candidates = sessions.filter(isColdSession);

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
