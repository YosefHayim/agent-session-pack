import { join } from 'node:path';
import type { DiscoveredSession, SessionOriginKind } from '@/session-model.js';
import type { SessionManifest } from './manifest-store.js';

/**
 * Resolves the default vault path below a home directory.
 *
 * @param home - User home directory.
 * @returns Default Agent Session Pack vault path.
 * @example
 * ```ts
 * import { createDefaultVaultPath } from './vault-paths.js';
 *
 * const vaultPath = createDefaultVaultPath(process.env.HOME ?? '');
 * ```
 */
export const createDefaultVaultPath = (home: string): string => join(home, '.agent-session-pack');

/**
 * Builds the vault archive path for a session.
 *
 * @param vaultPath - Vault root path.
 * @param session - Session being archived.
 * @param originKind - File or directory session kind.
 * @returns Archive path ending in `.jsonl.zst` or `.tar.zst`.
 * @example
 * ```ts
 * import { archivePathForSession } from './vault-paths.js';
 *
 * const archivePath = archivePathForSession('/vault', session, 'file');
 * ```
 */
export const archivePathForSession = (
  vaultPath: string,
  session: DiscoveredSession,
  originKind: SessionOriginKind,
): string => {
  const isOriginDirectory = originKind === 'directory';
  const extension = isOriginDirectory ? 'tar.zst' : 'jsonl.zst';
  return join(
    vaultPath,
    'archives',
    session.provider,
    `${createSafePathSegment(session.id)}.${extension}`,
  );
};

/**
 * Builds the vault manifest path for a session.
 *
 * @param vaultPath - Vault root path.
 * @param session - Session being archived.
 * @returns Manifest JSON path.
 * @example
 * ```ts
 * import { createSessionManifestPath } from './vault-paths.js';
 *
 * const manifestPath = createSessionManifestPath('/vault', session);
 * ```
 */
export const createSessionManifestPath = (vaultPath: string, session: DiscoveredSession): string =>
  join(vaultPath, 'manifests', session.provider, `${createSafePathSegment(session.id)}.json`);

/**
 * Builds the scratch path where an archive is restored for hash verification.
 *
 * @param vaultPath - Vault root path.
 * @param session - Session being archived.
 * @param originKind - File or directory session kind.
 * @returns Verification path under the vault.
 * @example
 * ```ts
 * import { createSessionVerificationPath } from './vault-paths.js';
 *
 * const verifyPath = createSessionVerificationPath('/vault', session, 'file');
 * ```
 */
export const createSessionVerificationPath = (
  vaultPath: string,
  session: DiscoveredSession,
  originKind: SessionOriginKind,
): string => {
  const isOriginDirectory = originKind === 'directory';
  if (isOriginDirectory) {
    return join(vaultPath, 'verify', session.provider, createSafePathSegment(session.id));
  }

  return join(vaultPath, 'verify', session.provider, `${createSafePathSegment(session.id)}.jsonl`);
};

/**
 * Builds the staging path where an archive is restored before it is copied back.
 *
 * @param vaultPath - Vault root path.
 * @param manifest - Manifest of the archived session.
 * @param originKind - File or directory session kind.
 * @returns Restore staging path under the vault.
 * @example
 * ```ts
 * import { restorePathForManifest } from './vault-paths.js';
 *
 * const restorePath = restorePathForManifest('/vault', manifest, 'file');
 * ```
 */
export const restorePathForManifest = (
  vaultPath: string,
  manifest: SessionManifest,
  originKind: SessionOriginKind,
): string => {
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
};

const createSafePathSegment = (unsafeSegment: string): string => {
  const segment = unsafeSegment
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const isSegmentEmpty = segment.length === 0;
  if (isSegmentEmpty) {
    return 'session';
  }

  return segment;
};
