import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Effect } from 'effect';
import {
  type ArchiveWriteError,
  createZstdCompression,
  type ProviderDiscoveryError,
  selectNewestSessionWithinSize,
  sha256File,
  writeVerifiedArchive,
} from '../src/core/index.js';
import {
  claudeCodeProvider,
  codexProvider,
  devinProvider,
  kiroProvider,
} from '../src/providers/index.js';

const evidenceProviders = [codexProvider, claudeCodeProvider, kiroProvider, devinProvider];
const maxArchiveEvidenceSourceBytes = 25 * 1024 * 1024;
const maxBackupEvidenceSourceBytes = 128 * 1024 * 1024;
const maxTitlePreviewLength = 96;

/**
 * Runs opt-in local evidence against copied provider sessions.
 *
 * @returns Effect that prints local evidence as JSON.
 */
export const runEvidenceLocal = (): Effect.Effect<
  void,
  ArchiveWriteError | ProviderDiscoveryError
> =>
  Effect.gen(function* () {
    const home = process.env.HOME;

    if (home === undefined) {
      process.stderr.write('HOME is not set.\n');
      process.exitCode = 1;
      return;
    }

    const workRoot = join(process.cwd(), '.vault-test', 'evidence-local');
    const compression = createZstdCompression();
    const evidence = [];

    for (const provider of evidenceProviders) {
      const roots = provider.defaultRoots(home);
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
      const fixtureDir = join(workRoot, provider.id);
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

    process.stdout.write(`${JSON.stringify({ workRoot, evidence }, null, 2)}\n`);
  });

const formatTitlePreview = (title: string): string => {
  const singleLineTitle = title.replace(/\s+/g, ' ').trim();

  if (singleLineTitle.length <= maxTitlePreviewLength) {
    return singleLineTitle;
  }

  return `${singleLineTitle.slice(0, maxTitlePreviewLength - 3)}...`;
};

await Effect.runPromise(runEvidenceLocal()).catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
