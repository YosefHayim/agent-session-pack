import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import {
  ArchiveFileSystemError,
  ArchiveVerificationError,
  type ArchiveWriteError,
  type CompressionAdapter,
  removeOriginalSession,
  restoreDirectoryArchive,
  sha256File,
  sha256Path,
  writeVerifiedArchive,
} from './archiveWriter.js';
import {
  listSessionManifestPaths,
  type ManifestStoreError,
  readSessionManifest,
  type SessionManifest,
  writeSessionManifest,
} from './manifestStore.js';
import { createPackThresholdPreviews, type PackThresholdPreview } from './packPlan.js';
import type {
  DiscoveredSession,
  ProviderAdapter,
  ProviderDiscoveryError,
  ProviderId,
  ProviderMode,
  SessionSourceKind,
} from './sessionStore.js';

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
 * Outcome status reported for one provider during an unpack run.
 */
export type UnpackSessionStatus =
  | 'already-present'
  | 'conflict'
  | 'dry-run'
  | 'no-archives'
  | 'restored';

/**
 * Per-provider unpack result row with restore counts and byte totals.
 */
export type UnpackSessionRow = {
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
};

/**
 * Full unpack report covering all providers.
 */
export type UnpackSessionsReport = {
  readonly command: 'unpack';
  readonly apply: boolean;
  readonly vaultPath: string;
  readonly rows: ReadonlyArray<UnpackSessionRow>;
};

/**
 * Inputs required to restore archived provider sessions from the vault.
 */
export type UnpackProviderSessionsRequest = {
  readonly vaultPath: string;
  readonly providers: ReadonlyArray<ProviderAdapter>;
  readonly apply: boolean;
  readonly compression: CompressionAdapter;
};

type RestoreOutcome = 'already-present' | 'conflict' | 'restored';

/**
 * Machine-readable status for a single-session ensure-restored or restore attempt.
 */
export type EnsureRestoredStatus =
  | 'already-present'
  | 'backup-only'
  | 'conflict'
  | 'lifecycle-disabled'
  | 'missing-archive'
  | 'restored';

/**
 * Stable report for agent JSON output when ensuring one archived session is live.
 */
export type EnsureRestoredReport = {
  readonly command: 'ensure-restored' | 'restore';
  readonly status: EnsureRestoredStatus;
  readonly restoreOnLaunchEnabled: boolean;
  readonly provider: ProviderId | undefined;
  readonly sessionId: string | undefined;
  readonly originalPath: string | undefined;
  readonly archivePath: string | undefined;
  readonly reason: string | undefined;
};

/**
 * Inputs for restoring one archived session from the vault.
 */
export type EnsureSessionRestoredRequest = {
  readonly command: 'ensure-restored' | 'restore';
  readonly vaultPath: string;
  readonly selector: string;
  readonly provider: ProviderId | undefined;
  readonly compression: CompressionAdapter;
  readonly restoreOnLaunchEnabled: boolean;
  /** When true, refuse to restore unless restore-on-launch is enabled in setup config. */
  readonly requireLifecycleEnabled: boolean;
  readonly backupOnlyProviders?: ReadonlyArray<ProviderId>;
};

/**
 * Resolves the default vault path below a home directory.
 *
 * @param home - User home directory.
 * @returns Default Agent Session Pack vault path.
 * @example
 * ```ts
 * import { resolveDefaultVaultPath } from './sessionArchive.js';
 *
 * const vaultPath = resolveDefaultVaultPath(process.env.HOME ?? '');
 * ```
 */
export const resolveDefaultVaultPath = (home: string): string => join(home, '.agent-session-pack');

/**
 * Packs cold sessions for the selected providers into the vault.
 *
 * @param request - Provider selection, compression, vault, and cold threshold.
 * @returns Effect containing a provider-level archive report.
 * @example
 * ```ts
 * import { packProviderSessions } from './sessionArchive.js';
 * import { createZstdCompression } from './archiveReader.js';
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

/**
 * Lists every session manifest stored under a vault.
 *
 * @param vaultPath - Vault root path.
 * @returns Effect containing decoded manifests.
 * @example
 * ```ts
 * import { listVaultSessionManifests } from './sessionArchive.js';
 *
 * const manifests = await Effect.runPromise(listVaultSessionManifests('/vault'));
 * ```
 */
export const listVaultSessionManifests = (
  vaultPath: string,
): Effect.Effect<ReadonlyArray<SessionManifest>, ManifestStoreError> =>
  readVaultManifests(vaultPath);

/**
 * Restores one archived session when missing, or reports already-present / conflict.
 *
 * Manual `restore` always applies. `ensure-restored` only applies when lifecycle is enabled.
 *
 * @param request - Selector, vault, compression, and lifecycle gate.
 * @returns Effect containing a stable ensure-restored report.
 * @example
 * ```ts
 * import { ensureSessionRestored } from './sessionArchive.js';
 * import { createZstdCompression } from './archiveReader.js';
 *
 * const report = await Effect.runPromise(
 *   ensureSessionRestored({
 *     command: 'ensure-restored',
 *     vaultPath: '/vault',
 *     selector: 'cold',
 *     provider: 'codex',
 *     compression: createZstdCompression(),
 *     restoreOnLaunchEnabled: true,
 *     requireLifecycleEnabled: true,
 *   }),
 * );
 * ```
 */
export const ensureSessionRestored = (
  request: EnsureSessionRestoredRequest,
): Effect.Effect<
  EnsureRestoredReport,
  ArchiveFileSystemError | ArchiveVerificationError | ManifestStoreError
> =>
  Effect.gen(function* () {
    if (request.requireLifecycleEnabled && !request.restoreOnLaunchEnabled) {
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

    const manifests = yield* readVaultManifests(request.vaultPath);
    const manifest = findSessionManifest({
      manifests,
      provider: request.provider,
      selector: request.selector,
    });

    if (manifest === undefined) {
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

    const outcome = yield* restoreManifest({
      compression: request.compression,
      manifest,
      vaultPath: request.vaultPath,
    });

    return {
      command: request.command,
      status: outcome,
      restoreOnLaunchEnabled: request.restoreOnLaunchEnabled,
      provider: manifest.provider,
      sessionId: manifest.sessionId,
      originalPath: manifest.originalPath,
      archivePath: manifest.archivePath,
      reason: ensureRestoredReason(outcome),
    };
  });

const ensureRestoredReason = (status: RestoreOutcome): string | undefined => {
  if (status === 'conflict') {
    return 'live file differs from manifest hash; not overwritten';
  }

  if (status === 'already-present') {
    return 'native session already matches archive';
  }

  return undefined;
};

/**
 * Restores archived sessions for the selected providers back to original paths.
 *
 * @param request - Provider selection, compression, vault, and apply mode.
 * @returns Effect containing a provider-level restore report.
 * @example
 * ```ts
 * import { unpackProviderSessions } from './sessionArchive.js';
 * import { createZstdCompression } from './archiveReader.js';
 *
 * const report = await Effect.runPromise(
 *   unpackProviderSessions({
 *     vaultPath: '/vault',
 *     providers,
 *     apply: false,
 *     compression: createZstdCompression(),
 *   }),
 * );
 * ```
 */
export const unpackProviderSessions = (
  request: UnpackProviderSessionsRequest,
): Effect.Effect<
  UnpackSessionsReport,
  ArchiveFileSystemError | ArchiveVerificationError | ManifestStoreError
> =>
  Effect.gen(function* () {
    const manifests = yield* readVaultManifests(request.vaultPath);
    const unpackSessionRows: UnpackSessionRow[] = [];

    for (const provider of request.providers) {
      const providerManifests = manifests.filter((manifest) => manifest.provider === provider.id);

      if (providerManifests.length === 0) {
        unpackSessionRows.push(createNoArchivesUnpackRow(provider.id));
        continue;
      }

      const archiveBytes = yield* sumArchiveBytes(providerManifests);
      const beforeBytes = sumManifestSourceBytes(providerManifests);

      if (request.apply === false) {
        unpackSessionRows.push(createDryRunUnpackRow(provider.id, providerManifests, archiveBytes));
        continue;
      }

      const restored = yield* restoreProviderManifests({
        compression: request.compression,
        manifests: providerManifests,
        vaultPath: request.vaultPath,
      });

      unpackSessionRows.push({
        provider: provider.id,
        archivedSessions: providerManifests.length,
        restoredSessions: restored.restoredSessions,
        alreadyPresentSessions: restored.alreadyPresentSessions,
        conflictSessions: restored.conflictSessions,
        beforeBytes,
        archiveBytes,
        restoredBytes: restored.restoredBytes,
        touchedOriginals: restored.restoredSessions > 0,
        status: unpackStatus(restored),
        reason: restored.conflictSessions > 0 ? 'live file differs from manifest hash' : undefined,
      });
    }

    return {
      command: 'unpack',
      apply: request.apply,
      vaultPath: request.vaultPath,
      rows: unpackSessionRows,
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

const restoreProviderManifests = (request: {
  readonly compression: CompressionAdapter;
  readonly manifests: ReadonlyArray<SessionManifest>;
  readonly vaultPath: string;
}): Effect.Effect<
  {
    readonly alreadyPresentSessions: number;
    readonly conflictSessions: number;
    readonly restoredBytes: number;
    readonly restoredSessions: number;
  },
  ArchiveFileSystemError | ArchiveVerificationError
> =>
  Effect.gen(function* () {
    let alreadyPresentSessions = 0;
    let conflictSessions = 0;
    let restoredBytes = 0;
    let restoredSessions = 0;

    for (const manifest of request.manifests) {
      const outcome = yield* restoreManifest({
        compression: request.compression,
        manifest,
        vaultPath: request.vaultPath,
      });

      if (outcome === 'already-present') {
        alreadyPresentSessions += 1;
        continue;
      }

      if (outcome === 'conflict') {
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
  });

const restoreManifest = (request: {
  readonly compression: CompressionAdapter;
  readonly manifest: SessionManifest;
  readonly vaultPath: string;
}): Effect.Effect<RestoreOutcome, ArchiveFileSystemError | ArchiveVerificationError> =>
  Effect.gen(function* () {
    const sourceKind = manifestSourceKind(request.manifest);
    const originalExists = yield* pathExists(request.manifest.originalPath);

    if (originalExists) {
      const existingSha256 = yield* sha256Path(request.manifest.originalPath, sourceKind);

      if (existingSha256 === request.manifest.sourceSha256) {
        return 'already-present';
      }

      return 'conflict';
    }

    const restoredPath = restorePathForManifest(request.vaultPath, request.manifest, sourceKind);

    if (sourceKind === 'directory') {
      yield* restoreDirectoryArchive({
        sessionId: request.manifest.sessionId,
        archivePath: request.manifest.archivePath,
        restoredPath,
        originalPath: request.manifest.originalPath,
        expectedSha256: request.manifest.sourceSha256,
        compression: request.compression,
      });
      return 'restored';
    }

    yield* ensureParentDirectory(restoredPath);
    yield* request.compression.decompress({
      archivePath: request.manifest.archivePath,
      restoredPath,
    });

    const restoredSha256 = yield* sha256File(restoredPath);

    if (restoredSha256 !== request.manifest.sourceSha256) {
      return yield* Effect.fail(
        new ArchiveVerificationError({
          sessionId: request.manifest.sessionId,
          sourceSha256: request.manifest.sourceSha256,
          restoredSha256,
        }),
      );
    }

    yield* ensureParentDirectory(request.manifest.originalPath);
    yield* copyPath(restoredPath, request.manifest.originalPath);

    const originalSha256 = yield* sha256File(request.manifest.originalPath);

    if (originalSha256 !== request.manifest.sourceSha256) {
      return yield* Effect.fail(
        new ArchiveVerificationError({
          sessionId: request.manifest.sessionId,
          sourceSha256: request.manifest.sourceSha256,
          restoredSha256: originalSha256,
        }),
      );
    }

    yield* removePath(restoredPath);

    return 'restored';
  });

const readVaultManifests = (
  vaultPath: string,
): Effect.Effect<ReadonlyArray<SessionManifest>, ManifestStoreError> =>
  Effect.gen(function* () {
    const manifestPaths = yield* listSessionManifestPaths(join(vaultPath, 'manifests'));
    const manifests: SessionManifest[] = [];

    for (const manifestPath of manifestPaths) {
      const manifest = yield* readSessionManifest(manifestPath);
      manifests.push(manifest);
    }

    return manifests;
  });

const findSessionManifest = (request: {
  readonly manifests: ReadonlyArray<SessionManifest>;
  readonly provider: ProviderId | undefined;
  readonly selector: string;
}): SessionManifest | undefined => {
  const trimmedSelector = request.selector.trim();
  const prefixed = trimmedSelector.match(
    /^(codex|claude|kiro|cursor|devin|grok|kimi|opencode|gemini):(.+)$/i,
  );
  const providerFilter =
    request.provider ?? (prefixed?.[1]?.toLowerCase() as ProviderId | undefined);
  const query = (prefixed?.[2] ?? trimmedSelector).trim().toLowerCase();

  if (query.length === 0) {
    return undefined;
  }

  const candidates = request.manifests.filter((manifest) => {
    if (providerFilter !== undefined && manifest.provider !== providerFilter) {
      return false;
    }

    return (
      manifest.sessionId.toLowerCase() === query ||
      manifest.slug.toLowerCase() === query ||
      manifest.title.toLowerCase() === query
    );
  });

  if (candidates.length !== 1) {
    return undefined;
  }

  return candidates[0];
};

const sumArchiveBytes = (
  manifests: ReadonlyArray<SessionManifest>,
): Effect.Effect<number, ArchiveFileSystemError> =>
  Effect.gen(function* () {
    let archiveBytes = 0;

    for (const manifest of manifests) {
      const bytes = yield* archiveBytesForManifest(manifest);
      archiveBytes += bytes;
    }

    return archiveBytes;
  });

const archiveBytesForManifest = (
  manifest: SessionManifest,
): Effect.Effect<number, ArchiveFileSystemError> => {
  if (manifest.archiveBytes !== undefined) {
    return Effect.succeed(manifest.archiveBytes);
  }

  return fileSizeBytes(manifest.archivePath);
};

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

const createNoArchivesUnpackRow = (provider: ProviderId): UnpackSessionRow => ({
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
});

const createDryRunUnpackRow = (
  provider: ProviderId,
  manifests: ReadonlyArray<SessionManifest>,
  archiveBytes: number,
): UnpackSessionRow => ({
  provider,
  archivedSessions: manifests.length,
  restoredSessions: 0,
  alreadyPresentSessions: 0,
  conflictSessions: 0,
  beforeBytes: sumManifestSourceBytes(manifests),
  archiveBytes,
  restoredBytes: 0,
  touchedOriginals: false,
  status: 'dry-run',
  reason: '--apply required to restore originals',
});

const unpackStatus = (restored: {
  readonly alreadyPresentSessions: number;
  readonly conflictSessions: number;
  readonly restoredSessions: number;
}): UnpackSessionStatus => {
  if (restored.conflictSessions > 0) {
    return 'conflict';
  }

  if (restored.restoredSessions > 0) {
    return 'restored';
  }

  return 'already-present';
};

const sumSessionBytes = (sessions: ReadonlyArray<DiscoveredSession>): number =>
  sessions.reduce((totalBytes, session) => totalBytes + session.sizeBytes, 0);

const sumManifestSourceBytes = (manifests: ReadonlyArray<SessionManifest>): number =>
  manifests.reduce((totalBytes, manifest) => totalBytes + manifest.sourceBytes, 0);

const savedPercent = (sourceBytes: number, archiveBytes: number): number => {
  if (sourceBytes === 0) {
    return 0;
  }

  return Number((100 - (archiveBytes / sourceBytes) * 100).toFixed(1));
};

const sessionSourceKind = (session: DiscoveredSession): SessionSourceKind =>
  session.sourceKind ?? 'file';

const manifestSourceKind = (manifest: SessionManifest): SessionSourceKind =>
  manifest.sourceKind ?? 'file';

const archivePathForSession = (
  vaultPath: string,
  session: DiscoveredSession,
  sourceKind: SessionSourceKind,
): string => {
  const extension = sourceKind === 'directory' ? 'tar.zst' : 'jsonl.zst';
  return join(
    vaultPath,
    'archives',
    session.provider,
    `${safePathSegment(session.id)}.${extension}`,
  );
};

const manifestPathForSession = (vaultPath: string, session: DiscoveredSession): string =>
  join(vaultPath, 'manifests', session.provider, `${safePathSegment(session.id)}.json`);

const verificationPathForSession = (
  vaultPath: string,
  session: DiscoveredSession,
  sourceKind: SessionSourceKind,
): string => {
  if (sourceKind === 'directory') {
    return join(vaultPath, 'verify', session.provider, safePathSegment(session.id));
  }

  return join(vaultPath, 'verify', session.provider, `${safePathSegment(session.id)}.jsonl`);
};

const restorePathForManifest = (
  vaultPath: string,
  manifest: SessionManifest,
  sourceKind: SessionSourceKind,
): string => {
  if (sourceKind === 'directory') {
    return join(vaultPath, 'restore', manifest.provider, safePathSegment(manifest.sessionId));
  }

  return join(
    vaultPath,
    'restore',
    manifest.provider,
    `${safePathSegment(manifest.sessionId)}.jsonl`,
  );
};

const safePathSegment = (value: string): string => {
  const segment = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (segment.length === 0) {
    return 'session';
  }

  return segment;
};

const pathExists = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    stat(path)
      .then(() => true)
      .catch(() => false),
  );

const fileSizeBytes = (path: string): Effect.Effect<number, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: async () => {
      const fileStat = await stat(path);

      return fileStat.size;
    },
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });

const ensureParentDirectory = (path: string): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () => mkdir(dirname(path), { recursive: true }).then(() => undefined),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });

const copyPath = (
  sourcePath: string,
  destinationPath: string,
): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () => copyFile(sourcePath, destinationPath).then(() => undefined),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path: destinationPath,
        message: String(cause),
      }),
  });

const removePath = (path: string): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: () => rm(path, { force: true, recursive: true }).then(() => undefined),
    catch: (cause) =>
      new ArchiveFileSystemError({
        path,
        message: String(cause),
      }),
  });
