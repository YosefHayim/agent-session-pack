import { Effect } from 'effect';
import type { ProviderId } from '../../shared/sessionModel.js';
import type { ArchiveFileSystemError } from '../archive/archiveFileSystem.js';
import type { ArchiveVerificationError, CompressionAdapter } from '../archive/archiveWriter.js';
import {
  listVaultSessionManifests,
  type ManifestStoreError,
  type SessionManifest,
} from '../archive/manifestStore.js';
import { type RestoreOutcome, restoreManifest } from './restoreManifest.js';

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
