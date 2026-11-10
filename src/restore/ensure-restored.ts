import { listVaultSessionManifests } from '@/archive/manifest-store.js';
import type { CompressionAdapter } from '@/archive/writer.js';
import type { ProviderId } from '@/session-model.js';
import { type RestoreExit, restoreManifest } from './manifest.js';
import { findSessionSelector, type SelectorMode } from './session-selector.js';

type EnsureRestoredStatus =
  | 'already-present'
  | 'ambiguous-selector'
  | 'backup-only'
  | 'conflict'
  | 'lifecycle-disabled'
  | 'missing-archive'
  | 'restored';

type SelectorCandidate = {
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly title: string;
};

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

export type EnsureSessionRestoredRequest = {
  readonly command: 'ensure-restored' | 'restore';
  readonly vaultPath: string;
  readonly selector: string;
  readonly selectorMatch: SelectorMode;
  readonly provider: ProviderId | undefined;
  readonly compression: CompressionAdapter;
  readonly restoreOnLaunchEnabled: boolean;
  readonly requireLifecycleEnabled: boolean;
  readonly backupOnlyProviders?: ReadonlyArray<ProviderId>;
};

export const ensureSessionRestored = async (
  request: EnsureSessionRestoredRequest,
): Promise<EnsureRestoredReport> => {
  const isLifecycleDisabled = request.requireLifecycleEnabled && !request.restoreOnLaunchEnabled;

  if (isLifecycleDisabled) {
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

  const manifests = await listVaultSessionManifests(request.vaultPath);
  const selection = findSessionSelector({
    selector: request.selector,
    provider: request.provider,
    manifests,
    match: request.selectorMatch,
  });

  const isSelectionStatusAmbiguous = selection.status === 'ambiguous';
  if (isSelectionStatusAmbiguous) {
    const candidates = selection.candidates.map((manifest) => ({
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

  const isSelectionStatusNotFound = selection.status === 'not-found';
  if (isSelectionStatusNotFound) {
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

  const manifest = selection.manifest;
  const backupOnlyProviders = request.backupOnlyProviders ?? ['cursor', 'devin'];

  const isBackupOnlyProvider = backupOnlyProviders.includes(manifest.provider);
  if (isBackupOnlyProvider) {
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

  const exit = await restoreManifest({
    compression: request.compression,
    manifest,
    vaultPath: request.vaultPath,
  });

  return {
    command: request.command,
    status: exit,
    restoreOnLaunchEnabled: request.restoreOnLaunchEnabled,
    provider: manifest.provider,
    sessionId: manifest.sessionId,
    originalPath: manifest.originalPath,
    archivePath: manifest.archivePath,
    reason: ensureRestoredReason(exit),
  };
};

const ensureRestoredReason = (status: RestoreExit): string | undefined => {
  const isStatusConflict = status === 'conflict';
  if (isStatusConflict) {
    return 'live file differs from manifest hash; not overwritten';
  }

  const isStatusAlreadyPresent = status === 'already-present';
  if (isStatusAlreadyPresent) {
    return 'native session already matches archive';
  }

  return undefined;
};
