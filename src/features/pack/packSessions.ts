import { Effect } from 'effect';
import { savedPercent, sumSessionBytes } from '../../shared/byteSavings.js';
import type {
  DiscoveredSession,
  ProviderAdapter,
  ProviderDiscoveryError,
  ProviderId,
  ProviderMode,
  SessionSourceKind,
} from '../../shared/sessionModel.js';
import { pathExists, removePath } from '../archive/archiveFileSystem.js';
import {
  type ArchiveWriteError,
  type CompressionAdapter,
  removeOriginalSession,
  writeVerifiedArchive,
} from '../archive/archiveWriter.js';
import { type ManifestStoreError, writeSessionManifest } from '../archive/manifestStore.js';
import { writeArchivedStub } from '../archive/sessionStub.js';
import {
  archivePathForSession,
  manifestPathForSession,
  verificationPathForSession,
} from '../archive/vaultPaths.js';
import { createPackThresholdPreviews, type PackThresholdPreview } from './packPlan.js';

/**
 * Outcome status reported for one provider during a pack run.
 */
export type PackSessionStatus = 'backup-only' | 'dry-run' | 'missing' | 'no-candidates' | 'packed';

/**
 * Per-provider pack result row with byte totals and status.
 */
export type PackSessionRow = {
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
  readonly rows: ReadonlyArray<PackSessionRow>;
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
 *
 * @param request - Provider selection, compression, vault, and cold threshold.
 * @returns Effect containing a provider-level archive report.
 * @example
 * ```ts
 * import { packProviderSessions } from './packSessions.js';
 * import { createZstdCompression } from '../archive/zstdCompression.js';
 *
 * const report = await Effect.runPromise(
 *   packProviderSessions({
 *     home: process.env.HOME ?? '',
 *     vaultPath: '/vault',
 *     providers,
 *     olderThan: '168h',
 *     olderThanMs: 168 * 60 * 60 * 1000,
 *     now: new Date(),
 *     apply: false,
 *     compression: createZstdCompression(),
 *   }),
 * );
 * ```
 */
export const packProviderSessions = (
  request: PackProviderSessionsRequest,
): Effect.Effect<
  PackSessionsReport,
  ArchiveWriteError | ManifestStoreError | ProviderDiscoveryError
> =>
  Effect.gen(function* () {
    const packSessionRows: PackSessionRow[] = [];
    const packableSessions: DiscoveredSession[] = [];
    const cutoffTime = request.now.getTime() - request.olderThanMs;

    for (const provider of request.providers) {
      const sessions = yield* discoverExistingProviderSessions({
        home: request.home,
        provider,
      });

      if (sessions === undefined) {
        packSessionRows.push(createMissingPackRow(provider));
        continue;
      }

      if (provider.mode === 'backup-only') {
        packSessionRows.push(createBackupOnlyPackRow(provider, sessions.length));
        continue;
      }

      packableSessions.push(...sessions);

      const candidates = sessions.filter((session) => session.modifiedAt.getTime() < cutoffTime);

      if (candidates.length === 0) {
        packSessionRows.push(createNoCandidatesPackRow(provider, sessions.length));
        continue;
      }

      if (request.apply === false) {
        packSessionRows.push(createDryRunPackRow(provider, sessions.length, candidates));
        continue;
      }

      const archived = yield* archiveCandidateSessions({
        candidates,
        compression: request.compression,
        now: request.now,
        vaultPath: request.vaultPath,
      });

      packSessionRows.push(
        createPackedRow({
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
      rows: packSessionRows,
      thresholdPreviews: createPackThresholdPreviews({
        now: request.now,
        olderThan: request.olderThan,
        olderThanMs: request.olderThanMs,
        sessions: packableSessions,
      }),
    };
  });

const discoverExistingProviderSessions = (request: {
  readonly home: string;
  readonly provider: ProviderAdapter;
}): Effect.Effect<ReadonlyArray<DiscoveredSession> | undefined, ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const roots = request.provider.defaultRoots(request.home);
    const sessions: DiscoveredSession[] = [];
    let existingRoots = 0;

    for (const root of roots) {
      const exists = yield* pathExists(root);

      if (!exists) {
        continue;
      }

      existingRoots += 1;
      const discovered = yield* request.provider.discover({
        provider: request.provider.id,
        path: root,
      });
      sessions.push(...discovered);
    }

    if (existingRoots === 0) {
      return undefined;
    }

    return sessions;
  });

const archiveCandidateSessions = (request: {
  readonly candidates: ReadonlyArray<DiscoveredSession>;
  readonly compression: CompressionAdapter;
  readonly now: Date;
  readonly vaultPath: string;
}): Effect.Effect<
  {
    readonly archiveBytes: number;
    readonly beforeBytes: number;
    readonly packedSessions: number;
  },
  ArchiveWriteError | ManifestStoreError
> =>
  Effect.gen(function* () {
    let archiveBytes = 0;
    let beforeBytes = 0;
    let packedSessions = 0;

    for (const session of request.candidates) {
      const sourceKind = sessionSourceKind(session);
      const archivePath = archivePathForSession(request.vaultPath, session, sourceKind);
      const restoredPath = verificationPathForSession(request.vaultPath, session, sourceKind);
      const manifestPath = manifestPathForSession(request.vaultPath, session);
      const archived = yield* writeVerifiedArchive({
        sessionId: session.id,
        sourcePath: session.originalPath,
        archivePath,
        restoredPath,
        apply: false,
        compression: request.compression,
        sourceKind,
      });

      yield* writeSessionManifest(manifestPath, {
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
        sourceKind,
      });
      yield* removeOriginalSession(session.originalPath);
      // Leave a tiny listable stub so GUIs can still see the session; watch materializes on open.
      yield* writeArchivedStub({
        originalPath: session.originalPath,
        sessionId: session.id,
        provider: session.provider,
        sourceKind,
      });
      yield* removePath(restoredPath);

      archiveBytes += archived.archiveBytes;
      beforeBytes += archived.sourceBytes;
      packedSessions += 1;
    }

    return {
      archiveBytes,
      beforeBytes,
      packedSessions,
    };
  });

const createMissingPackRow = (provider: ProviderAdapter): PackSessionRow => ({
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

const createBackupOnlyPackRow = (
  provider: ProviderAdapter,
  foundSessions: number,
): PackSessionRow => ({
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

const createNoCandidatesPackRow = (
  provider: ProviderAdapter,
  foundSessions: number,
): PackSessionRow => ({
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

const createDryRunPackRow = (
  provider: ProviderAdapter,
  foundSessions: number,
  candidates: ReadonlyArray<DiscoveredSession>,
): PackSessionRow => ({
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

const createPackedRow = (request: {
  readonly provider: ProviderAdapter;
  readonly foundSessions: number;
  readonly packedSessions: number;
  readonly beforeBytes: number;
  readonly archiveBytes: number;
}): PackSessionRow => ({
  provider: request.provider.id,
  mode: request.provider.mode,
  foundSessions: request.foundSessions,
  candidateSessions: request.packedSessions,
  packedSessions: request.packedSessions,
  beforeBytes: request.beforeBytes,
  archiveBytes: request.archiveBytes,
  savedBytes: request.beforeBytes - request.archiveBytes,
  savedPercent: savedPercent(request.beforeBytes, request.archiveBytes),
  touchedOriginals: request.packedSessions > 0,
  status: 'packed',
  reason: undefined,
});

const sessionSourceKind = (session: DiscoveredSession): SessionSourceKind =>
  session.sourceKind ?? 'file';
