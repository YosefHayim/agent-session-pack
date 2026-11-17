import { join } from 'node:path';
import type { DiscoveredSession, SessionOriginKind } from '@/session-model.js';
import type { SessionManifest } from './manifest-store.js';

const VERIFY_FOLDER = 'verify';

const RESTORE_FOLDER = 'restore';

const JSONL_EXTENSION = '.jsonl';

export function createDefaultVaultPath(home: string): string {
  return join(home, '.agent-session-pack');
}

export function archivePathForSession(
  vaultPath: string,
  session: DiscoveredSession,
  originKind: SessionOriginKind,
): string {
  const isOriginDirectory = originKind === 'directory';
  const extension = isOriginDirectory ? 'tar.zst' : 'jsonl.zst';
  return join(
    vaultPath,
    'archives',
    session.provider,
    `${createSafePathSegment(session.id)}.${extension}`,
  );
}

export function createSessionManifestPath(vaultPath: string, session: DiscoveredSession): string {
  return join(
    vaultPath,
    'manifests',
    session.provider,
    `${createSafePathSegment(session.id)}.json`,
  );
}

export function createSessionVerificationPath(
  vaultPath: string,
  session: DiscoveredSession,
  originKind: SessionOriginKind,
): string {
  const isOriginDirectory = originKind === 'directory';
  if (isOriginDirectory) {
    return join(vaultPath, VERIFY_FOLDER, session.provider, createSafePathSegment(session.id));
  }

  return join(
    vaultPath,
    VERIFY_FOLDER,
    session.provider,
    `${createSafePathSegment(session.id)}${JSONL_EXTENSION}`,
  );
}

export function restorePathForManifest(
  vaultPath: string,
  manifest: SessionManifest,
  originKind: SessionOriginKind,
): string {
  const isOriginDirectory = originKind === 'directory';
  if (isOriginDirectory) {
    return join(
      vaultPath,
      RESTORE_FOLDER,
      manifest.provider,
      createSafePathSegment(manifest.sessionId),
    );
  }

  return join(
    vaultPath,
    RESTORE_FOLDER,
    manifest.provider,
    `${createSafePathSegment(manifest.sessionId)}${JSONL_EXTENSION}`,
  );
}

function createSafePathSegment(unsafeSegment: string): string {
  // Matches every run of characters outside a-z, 0-9, dot, underscore and dash.
  const unsafeCharacters = /[^a-z0-9._-]+/g;
  // Matches dashes at the start or end of the segment.
  const edgeDashes = /^-+|-+$/g;
  const segment = unsafeSegment
    .toLowerCase()
    .replace(unsafeCharacters, '-')
    .replace(edgeDashes, '');

  const isSegmentEmpty = segment.length === 0;
  if (isSegmentEmpty) {
    return 'session';
  }

  return segment;
}
