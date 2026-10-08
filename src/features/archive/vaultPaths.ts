import { join } from 'node:path';
import type { DiscoveredSession, SessionSourceKind } from '../../shared/sessionModel.js';
import type { SessionManifest } from './manifestStore.js';

/**
 * Resolves the default vault path below a home directory.
 *
 * @param home - User home directory.
 * @returns Default Agent Session Pack vault path.
 * @example
 * ```ts
 * import { resolveDefaultVaultPath } from './vaultPaths.js';
 *
 * const vaultPath = resolveDefaultVaultPath(process.env.HOME ?? '');
 * ```
 */
export const resolveDefaultVaultPath = (home: string): string => join(home, '.agent-session-pack');

/**
 * Builds the vault archive path for a session.
 *
 * @param vaultPath - Vault root path.
 * @param session - Session being archived.
 * @param sourceKind - File or directory session kind.
 * @returns Archive path ending in `.jsonl.zst` or `.tar.zst`.
 * @example
 * ```ts
 * import { archivePathForSession } from './vaultPaths.js';
 *
 * const archivePath = archivePathForSession('/vault', session, 'file');
 * ```
 */
export const archivePathForSession = (
  vaultPath: string,
  session: DiscoveredSession,
  sourceKind: SessionSourceKind,
): string => {
  const extension = sourceKind === 'directory' ? 'tar.zst' : 'jsonl.zst';
  return join(
    vaultPath,
    'archives',
    session.provider,
    `${safePathSegment(session.id)}.${extension}`,
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
 * import { manifestPathForSession } from './vaultPaths.js';
 *
 * const manifestPath = manifestPathForSession('/vault', session);
 * ```
 */
export const manifestPathForSession = (vaultPath: string, session: DiscoveredSession): string =>
  join(vaultPath, 'manifests', session.provider, `${safePathSegment(session.id)}.json`);

/**
 * Builds the scratch path where an archive is restored for hash verification.
 *
 * @param vaultPath - Vault root path.
 * @param session - Session being archived.
 * @param sourceKind - File or directory session kind.
 * @returns Verification path under the vault.
 * @example
 * ```ts
 * import { verificationPathForSession } from './vaultPaths.js';
 *
 * const verifyPath = verificationPathForSession('/vault', session, 'file');
 * ```
 */
export const verificationPathForSession = (
  vaultPath: string,
  session: DiscoveredSession,
  sourceKind: SessionSourceKind,
): string => {
  if (sourceKind === 'directory') {
    return join(vaultPath, 'verify', session.provider, safePathSegment(session.id));
  }

  return join(vaultPath, 'verify', session.provider, `${safePathSegment(session.id)}.jsonl`);
};

/**
 * Builds the staging path where an archive is restored before it is copied back.
 *
 * @param vaultPath - Vault root path.
 * @param manifest - Manifest of the archived session.
 * @param sourceKind - File or directory session kind.
 * @returns Restore staging path under the vault.
 * @example
 * ```ts
 * import { restorePathForManifest } from './vaultPaths.js';
 *
 * const restorePath = restorePathForManifest('/vault', manifest, 'file');
 * ```
 */
export const restorePathForManifest = (
  vaultPath: string,
  manifest: SessionManifest,
  sourceKind: SessionSourceKind,
): string => {
  if (sourceKind === 'directory') {
    return join(vaultPath, 'restore', manifest.provider, safePathSegment(manifest.sessionId));
  }

  return join(
    vaultPath,
    'restore',
    manifest.provider,
    `${safePathSegment(manifest.sessionId)}.jsonl`,
  );
};

const safePathSegment = (value: string): string => {
  const segment = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (segment.length === 0) {
    return 'session';
  }

  return segment;
};
