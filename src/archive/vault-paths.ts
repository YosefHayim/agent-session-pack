import { join } from 'node:path';
import type { DiscoveredSession, SessionOriginKind } from '@/session-model.js';
import type { SessionManifest } from './manifest-store.js';

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
    return join(vaultPath, 'verify', session.provider, createSafePathSegment(session.id));
  }

  return join(vaultPath, 'verify', session.provider, `${createSafePathSegment(session.id)}.jsonl`);
}

export function restorePathForManifest(
  vaultPath: string,
  manifest: SessionManifest,
  originKind: SessionOriginKind,
): string {
  const isOriginDirectory = originKind === 'directory';
  if (isOriginDirectory) {
    return join(vaultPath, 'restore', manifest.provider, createSafePathSegment(manifest.sessionId));
  }

  return join(
    vaultPath,
    'restore',
    manifest.provider,
    `${createSafePathSegment(manifest.sessionId)}.jsonl`,
  );
}

function createSafePathSegment(unsafeSegment: string): string {
  const segment = unsafeSegment
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const isSegmentEmpty = segment.length === 0;
  if (isSegmentEmpty) {
    return 'session';
  }

  return segment;
}
