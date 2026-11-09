import { statPath } from '@/archive/file-system.js';
import { listVaultSessionManifests, type SessionManifest } from '@/archive/manifest-store.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import type { ProviderAdapter, ProviderId } from '@/session-model.js';
import { restoreManifest } from './manifest.js';

/**
 * Outcome status reported for one provider during an unpack run.
 */
type UnpackSessionStatus = 'already-present' | 'conflict' | 'dry-run' | 'no-archives' | 'restored';

/**
 * Per-provider unpack result row with restore counts and byte totals.
 */
type UnpackSessionRow = {
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

/**
 * Restores archived sessions for the selected providers back to original paths.
 */
export const unpackProviderSessions = async (
  request: UnpackProviderSessionsRequest,
): Promise<UnpackSessionsReport> => {
  const manifests = await listVaultSessionManifests(request.vaultPath);
  const unpackSessionRows: UnpackSessionRow[] = [];

  for (const provider of request.providers) {
    const providerManifests = manifests.filter((manifest) => manifest.provider === provider.id);

    if (providerManifests.length === 0) {
      unpackSessionRows.push(createNoArchivesUnpackRow(provider.id));
      continue;
    }

    const archiveBytes = await sumArchiveBytes(providerManifests);
    const beforeBytes = sumManifestSourceBytes(providerManifests);

    if (request.apply === false) {
      unpackSessionRows.push(createDryRunUnpackRow(provider.id, providerManifests, archiveBytes));
      continue;
    }

    const restored = await restoreProviderManifests({
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
};

const restoreProviderManifests = async (request: {
  readonly compression: CompressionAdapter;
  readonly manifests: ReadonlyArray<SessionManifest>;
  readonly vaultPath: string;
}): Promise<{
  readonly alreadyPresentSessions: number;
  readonly conflictSessions: number;
  readonly restoredBytes: number;
  readonly restoredSessions: number;
}> => {
  let alreadyPresentSessions = 0;
  let conflictSessions = 0;
  let restoredBytes = 0;
  let restoredSessions = 0;

  for (const manifest of request.manifests) {
    const outcome = await restoreManifest({
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
};

const sumArchiveBytes = async (manifests: ReadonlyArray<SessionManifest>): Promise<number> => {
  let archiveBytes = 0;

  for (const manifest of manifests) {
    const bytes = await archiveBytesForManifest(manifest);
    archiveBytes += bytes;
  }

  return archiveBytes;
};

const archiveBytesForManifest = async (manifest: SessionManifest): Promise<number> => {
  const knownArchiveBytes = manifest.archiveBytes;
  const isArchiveBytesKnown = knownArchiveBytes !== undefined;

  if (isArchiveBytesKnown) {
    return knownArchiveBytes;
  }

  const archiveStats = await statPath(manifest.archivePath);
  return archiveStats.size;
};

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

const sumManifestSourceBytes = (manifests: ReadonlyArray<SessionManifest>): number =>
  manifests.reduce((totalBytes, manifest) => totalBytes + manifest.sourceBytes, 0);
