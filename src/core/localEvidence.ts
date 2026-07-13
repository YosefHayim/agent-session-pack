import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Effect } from 'effect';
import { createZstdCompression } from './archiveReader.js';
import type { ArchiveWriteError } from './archiveWriter.js';
import { sha256File, writeVerifiedArchive } from './archiveWriter.js';
import { selectNewestSessionWithinSize } from './sessionSelection.js';
import type {
  ProviderAdapter,
  ProviderDiscoveryError,
  ProviderId,
  ProviderMode,
} from './sessionStore.js';

/**
 * Per-provider byte-exact compression evidence produced by a local run.
 */
export type LocalEvidenceEntry = {
  readonly provider: ProviderId;
  readonly foundSessions: number;
  readonly mode: ProviderMode;
  readonly sourceBytes: number;
  readonly archiveBytes: number;
  readonly savedPercent: number;
  readonly byteExact: boolean;
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
};

/**
 * Aggregated local evidence report across all inspected providers.
 */
export type LocalEvidenceReport = {
  readonly workRoot: string;
  readonly evidence: ReadonlyArray<LocalEvidenceEntry>;
};

/**
 * Inputs required to run a local evidence pass over provider sessions.
 */
export type LocalEvidenceRequest = {
  readonly home: string;
  readonly workRoot: string;
  readonly providers: ReadonlyArray<ProviderAdapter>;
};

const maxArchiveEvidenceSourceBytes = 25 * 1024 * 1024;
const maxBackupEvidenceSourceBytes = 128 * 1024 * 1024;
const maxTitlePreviewLength = 96;

/**
 * Creates copy-only local compression evidence from provider sessions.
 *
 * @param request - Home directory, work root, and providers to inspect.
 * @returns Report containing byte-exact compression proof for eligible sessions.
 * @example
 * ```ts
 * import { runLocalEvidence } from './localEvidence.js';
 * import { providers } from '../providers/index.js';
 *
 * const report = await Effect.runPromise(
 *   runLocalEvidence({ home: process.env.HOME ?? '', workRoot: '/tmp/evidence', providers }),
 * );
 * ```
 */
export const runLocalEvidence = (
  request: LocalEvidenceRequest,
): Effect.Effect<LocalEvidenceReport, ArchiveWriteError | ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const compression = createZstdCompression();
    const evidence: LocalEvidenceEntry[] = [];

    for (const provider of request.providers) {
      const roots = provider.defaultRoots(request.home);
      const root = roots[0];

      if (root === undefined) {
        continue;
      }

      const maxEvidenceSourceBytes =
        provider.mode === 'backup-only'
          ? maxBackupEvidenceSourceBytes
          : maxArchiveEvidenceSourceBytes;
      const sessions = yield* provider.discover({
        provider: provider.id,
        path: root,
      });
      const selected = selectNewestSessionWithinSize(sessions, maxEvidenceSourceBytes);

      if (selected === undefined) {
        continue;
      }

      const sourceStat = yield* Effect.promise(() => stat(selected.originalPath));

      if (sourceStat.size > maxEvidenceSourceBytes) {
        continue;
      }

      const fileName = basename(selected.originalPath);
      const fixtureDir = join(request.workRoot, provider.id);
      const fixturePath = join(fixtureDir, fileName);
      const archivePath = join(fixtureDir, `${fileName}.zst`);
      const restoredPath = join(fixtureDir, `restored-${fileName}`);

      yield* Effect.promise(() => mkdir(fixtureDir, { recursive: true }));
      yield* Effect.promise(() => rm(fixturePath, { force: true }));
      yield* Effect.promise(() => rm(archivePath, { force: true }));
      yield* Effect.promise(() => rm(restoredPath, { force: true }));
      yield* Effect.promise(() => copyFile(selected.originalPath, fixturePath));

      const verified = yield* writeVerifiedArchive({
        sessionId: selected.id,
        sourcePath: fixturePath,
        archivePath,
        restoredPath,
        apply: false,
        compression,
      });
      const originalSha256 = yield* sha256File(selected.originalPath);

      evidence.push({
        provider: provider.id,
        foundSessions: sessions.length,
        mode: provider.mode,
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
        savedPercent: Number(
          (100 - (verified.archiveBytes / verified.sourceBytes) * 100).toFixed(1),
        ),
      });
    }

    return {
      workRoot: request.workRoot,
      evidence,
    };
  });

const formatTitlePreview = (title: string): string => {
  const singleLineTitle = title.replace(/\s+/g, ' ').trim();

  if (singleLineTitle.length <= maxTitlePreviewLength) {
    return singleLineTitle;
  }

  return `${singleLineTitle.slice(0, maxTitlePreviewLength - 3)}...`;
};
