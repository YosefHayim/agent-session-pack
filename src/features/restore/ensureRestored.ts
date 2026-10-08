import { Effect, Either } from 'effect';
import type { ProviderId } from '../../shared/sessionModel.js';
import type { ArchiveFileSystemError } from '../archive/archiveFileSystem.js';
import type { ArchiveVerificationError, CompressionAdapter } from '../archive/archiveWriter.js';
import { listVaultSessionManifests, type ManifestStoreError } from '../archive/manifestStore.js';
import { type RestoreOutcome, restoreManifest } from './restoreManifest.js';
import { resolveSessionSelector, type SelectorMatch } from './sessionSelector.js';

/**
 * Machine-readable status for a single-session ensure-restored or restore attempt.
 */
export type EnsureRestoredStatus =
  | 'already-present'
  | 'ambiguous-selector'
  | 'backup-only'
  | 'conflict'
  | 'lifecycle-disabled'
  | 'missing-archive'
  | 'restored';

/**
 * One session an ambiguous selector could mean.
 */
export type SelectorCandidate = {
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly title: string;
};

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
  readonly candidates?: ReadonlyArray<SelectorCandidate>;
};

/**
 * Inputs for restoring one archived session from the vault.
 */
export type EnsureSessionRestoredRequest = {
  readonly command: 'ensure-restored' | 'restore';
  readonly vaultPath: string;
  readonly selector: string;
  readonly selectorMatch: SelectorMatch;
  readonly provider: ProviderId | undefined;
  readonly compression: CompressionAdapter;
  readonly restoreOnLaunchEnabled: boolean;
  /** When true, refuse to restore unless restore-on-launch is enabled in setup config. */
  readonly requireLifecycleEnabled: boolean;
  readonly backupOnlyProviders?: ReadonlyArray<ProviderId>;
};

/**
 * Restores one archived session when missing, or reports already-present / conflict.
 *
 * Manual `restore` always applies. `ensure-restored` only applies when lifecycle is enabled.
 *
 * @param request - Selector, vault, compression, and lifecycle gate.
 * @returns Effect containing a stable ensure-restored report.
 * @example
 * ```ts
 * import { ensureSessionRestored } from './ensureRestored.js';
 * import { createZstdCompression } from '../archive/zstdCompression.js';
 *
 * const report = await Effect.runPromise(
 *   ensureSessionRestored({
 *     command: 'ensure-restored',
 *     vaultPath: '/vault',
 *     selector: 'cold',
 *     selectorMatch: 'exact',
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

    const manifests = yield* listVaultSessionManifests(request.vaultPath);
    const selection = yield* Effect.either(
      resolveSessionSelector({
        selector: request.selector,
        provider: request.provider,
        manifests,
        match: request.selectorMatch,
      }),
    );

    if (Either.isLeft(selection) && selection.left._tag === 'SessionSelectorAmbiguousError') {
      const candidates = selection.left.candidates.map((manifest) => ({
        provider: manifest.provider,
        sessionId: manifest.sessionId,
        title: manifest.title,
      }));
      const candidateSelectors = candidates
        .map((candidate) => `${candidate.provider}:${candidate.sessionId}`)
        .join(', ');

      return {
        command: request.command,
        status: 'ambiguous-selector',
        restoreOnLaunchEnabled: request.restoreOnLaunchEnabled,
        provider: request.provider,
        sessionId: undefined,
        originalPath: undefined,
        archivePath: undefined,
        reason: `selector matches ${candidates.length} sessions: ${candidateSelectors}; use a longer selector or provider:id`,
        candidates,
      };
    }

    if (Either.isLeft(selection)) {
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

    const manifest = selection.right;
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
