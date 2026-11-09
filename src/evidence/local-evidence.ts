import { cp, mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { sha256Path } from '@/archive/hash.js';
import { writeVerifiedArchive } from '@/archive/writer.js';
import { createZstdCompression } from '@/archive/zstd-compression.js';
import { discoverStoreSessions } from '@/scan/stores.js';
import type {
  DiscoveredSession,
  ProviderAdapter,
  ProviderId,
  ProviderMode,
  SessionSourceKind,
} from '@/session-model.js';
import { selectNewestSessionWithinSize } from './sample.js';

const MAX_ARCHIVE_EVIDENCE_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_BACKUP_EVIDENCE_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_TITLE_PREVIEW_LENGTH = 96;

/**
 * Describes discovered sessions and copied proof samples for one provider.
 */
export interface LocalEvidenceEntry {
  readonly provider: ProviderId;
  /** Sessions discovered in the provider store before proof sampling. */
  readonly foundSessions: number;
  /** Sources copied into the isolated proof workspace and measured. */
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
  readonly sourceKind?: SessionSourceKind;
}

/**
 * Aggregates provider discovery under the sampled-copy proof scope.
 */
export interface LocalEvidenceReport {
  /** Declares that byte measurements describe copied samples rather than whole stores. */
  readonly scope: 'sampled-copy-proof';
  readonly workRoot: string;
  readonly evidence: ReadonlyArray<LocalEvidenceEntry>;
}

/**
 * Inputs required to run a local evidence pass over provider sessions.
 */
export interface LocalEvidenceRequest {
  readonly home: string;
  readonly workRoot: string;
  readonly providers: ReadonlyArray<ProviderAdapter>;
}

/**
 * Creates copy-only local compression evidence from provider sessions.
 */
export const runLocalEvidence = async (
  request: LocalEvidenceRequest,
): Promise<LocalEvidenceReport> => {
  const compression = createZstdCompression();
  const evidence: LocalEvidenceEntry[] = [];

  for (const provider of request.providers) {
    const roots = provider.defaultRoots(request.home);
    const sessions = await discoverProviderSessions(provider, roots);
    const maxEvidenceSourceBytes =
      provider.mode === 'backup-only'
        ? MAX_BACKUP_EVIDENCE_SOURCE_BYTES
        : MAX_ARCHIVE_EVIDENCE_SOURCE_BYTES;
    const selected = selectNewestSessionWithinSize(sessions, maxEvidenceSourceBytes);

    if (selected === undefined) {
      continue;
    }

    if (selected.sizeBytes > maxEvidenceSourceBytes) {
      evidence.push({
        provider: provider.id,
        foundSessions: sessions.length,
        sampledSources: 0,
        mode: provider.mode,
        originalTouched: false,
        maxEvidenceSourceBytes,
      });
      continue;
    }

    const sourceKind = selected.sourceKind ?? 'file';
    const fileName = basename(selected.originalPath);
    const fixtureDir = join(request.workRoot, provider.id);
    const fixturePath = join(fixtureDir, fileName);
    const archivePath = join(
      fixtureDir,
      sourceKind === 'directory' ? `${fileName}.tar.zst` : `${fileName}.zst`,
    );
    const restoredPath = join(fixtureDir, `restored-${fileName}`);

    await mkdir(fixtureDir, { recursive: true });
    await rm(fixturePath, { force: true, recursive: true });
    await rm(archivePath, { force: true, recursive: true });
    await rm(restoredPath, { force: true, recursive: true });
    await cp(selected.originalPath, fixturePath, {
      recursive: sourceKind === 'directory',
    });

    const verified = await writeVerifiedArchive({
      sessionId: selected.id,
      sourcePath: fixturePath,
      archivePath,
      restoredPath,
      apply: false,
      compression,
      sourceKind,
    });
    const originalSha256 = await sha256Path(selected.originalPath, sourceKind);

    evidence.push({
      provider: provider.id,
      foundSessions: sessions.length,
      sampledSources: 1,
      mode: provider.mode,
      sourceKind,
      titlePreview: formatTitlePreview(selected.title),
      originalPath: selected.originalPath,
      fixturePath,
      archivePath,
      restoredPath,
      originalSha256,
      fixtureSha256: verified.sourceSha256,
      restoredSha256: verified.restoredSha256,
      byteExact:
        originalSha256 === verified.sourceSha256 &&
        verified.sourceSha256 === verified.restoredSha256,
      originalTouched: false,
      sourceBytes: verified.sourceBytes,
      archiveBytes: verified.archiveBytes,
      maxEvidenceSourceBytes,
      savedPercent: Number((100 - (verified.archiveBytes / verified.sourceBytes) * 100).toFixed(1)),
    });
  }

  return {
    scope: 'sampled-copy-proof',
    workRoot: request.workRoot,
    evidence,
  };
};

const discoverProviderSessions = async (
  provider: ProviderAdapter,
  roots: ReadonlyArray<string>,
): Promise<ReadonlyArray<DiscoveredSession>> => {
  const discovered: DiscoveredSession[] = [];

  for (const root of roots) {
    const sessions = await discoverStoreSessions(provider, {
      provider: provider.id,
      path: root,
    });
    discovered.push(...sessions);
  }

  return discovered;
};

const formatTitlePreview = (title: string): string => {
  const singleLineTitle = title.replace(/\s+/g, ' ').trim();

  if (singleLineTitle.length <= MAX_TITLE_PREVIEW_LENGTH) {
    return singleLineTitle;
  }

  return `${singleLineTitle.slice(0, MAX_TITLE_PREVIEW_LENGTH - 3)}...`;
};
