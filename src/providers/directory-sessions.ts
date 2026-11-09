import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { DiscoveredSession, ProviderId, SessionStore } from '@/session-model.js';
import { measureDirectorySession, slugifyTitle } from './session-discovery.js';

/**
 * Marker files that identify a directory-backed provider session.
 */
type DirectorySessionMarkers = ReadonlyArray<string>;

/**
 * Options for discovering directory-backed provider sessions.
 */
export type DirectoryProviderDiscoveryOptions = {
  readonly provider: ProviderId;
  readonly store: SessionStore;
  readonly markers: DirectorySessionMarkers;
  readonly maxDepth: number;
  readonly excludedNames?: ReadonlyArray<string>;
  readonly activeSessionIds?: ReadonlySet<string>;
  readonly titleFromDirectory?: (path: string) => Promise<string>;
  readonly sessionIdFromDirectory?: (path: string) => string;
};

/**
 * Discovers directory-backed provider sessions under a store root.
 */
export const discoverDirectoryProviderSessions = async (
  options: DirectoryProviderDiscoveryOptions,
): Promise<ReadonlyArray<DiscoveredSession>> => {
  const directories = await collectSessionDirectories(options.store.path, {
    markers: options.markers,
    maxDepth: options.maxDepth,
    excludedNames: options.excludedNames ?? [],
  });
  const sessions: DiscoveredSession[] = [];

  for (const directory of directories) {
    const sessionId =
      options.sessionIdFromDirectory?.(directory) ?? defaultSessionIdFromDirectory(directory);

    const isSessionActive = options.activeSessionIds?.has(sessionId) === true;

    if (isSessionActive) {
      continue;
    }

    const measured = await measureDirectorySession(directory);
    const title = await readDirectoryTitle({
      directory,
      sessionId,
      titleFromDirectory: options.titleFromDirectory,
    });

    sessions.push({
      id: sessionId,
      provider: options.provider,
      title,
      slug: slugifyTitle(title),
      originalPath: directory,
      modifiedAt: measured.modifiedAt,
      sizeBytes: measured.sizeBytes,
      sourceKind: 'directory',
      status: 'live',
    });
  }

  return sessions;
};

/**
 * Reads JSON text from a file when present.
 */
export const readJsonFile = async (path: string): Promise<unknown | undefined> => {
  try {
    const content = await readFile(path, 'utf8');
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
};

const readDirectoryTitle = async (request: {
  readonly directory: string;
  readonly sessionId: string;
  readonly titleFromDirectory?: (path: string) => Promise<string>;
}): Promise<string> => {
  const isTitleFromDirectoryMissing = request.titleFromDirectory == null;
  if (isTitleFromDirectoryMissing) {
    return request.sessionId;
  }

  try {
    const titleFound = await request.titleFromDirectory(request.directory);
    const isTitleFound = titleFound.length > 0;
    return isTitleFound ? titleFound : request.sessionId;
  } catch {
    // A title reader that fails falls back to the session id, as discovery always did.
    return request.sessionId;
  }
};

const defaultSessionIdFromDirectory = (path: string): string => {
  const name = basename(path);
  const uuidMatch = name.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  const isUuidFound = uuidMatch != null;
  if (isUuidFound) {
    return uuidMatch[0];
  }

  return name;
};

const collectSessionDirectories = async (
  root: string,
  options: {
    readonly markers: DirectorySessionMarkers;
    readonly maxDepth: number;
    readonly excludedNames: ReadonlyArray<string>;
  },
): Promise<ReadonlyArray<string>> => {
  const isRootDirectory = await isDirectoryPath(root);
  const isNotRootDirectory = !isRootDirectory;

  if (isNotRootDirectory) {
    return [];
  }

  const found: string[] = [];

  const walk = async (directory: string, depth: number): Promise<void> => {
    const isDepthAboveMaxDepth = depth > options.maxDepth;
    if (isDepthAboveMaxDepth) {
      return;
    }

    const hasSessionMarkers = await directoryHasMarkers(directory, options.markers);
    if (hasSessionMarkers) {
      found.push(directory);
      return;
    }

    const isAtMaxDepth = depth === options.maxDepth;
    if (isAtMaxDepth) {
      return;
    }

    const entries = await readChildEntries(directory);

    for (const entry of entries) {
      const isNotDirectory = !entry.isDirectory();
      if (isNotDirectory) {
        continue;
      }

      const isNameInExcludedNames = options.excludedNames.includes(entry.name);
      if (isNameInExcludedNames) {
        continue;
      }

      const isHiddenEntry = entry.name.startsWith('.');
      if (isHiddenEntry) {
        continue;
      }

      await walk(join(directory, entry.name), depth + 1);
    }
  };

  await walk(root, 0);
  return found;
};

const readChildEntries = async (directory: string): Promise<ReadonlyArray<Dirent>> => {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    // An unreadable subfolder is skipped, as discovery always did.
    return [];
  }
};

const isDirectoryPath = (path: string): Promise<boolean> =>
  stat(path).then(
    (pathStat) => pathStat.isDirectory(),
    () => false,
  );

const isFilePath = (path: string): Promise<boolean> =>
  stat(path).then(
    (pathStat) => pathStat.isFile(),
    () => false,
  );

const directoryHasMarkers = async (
  directory: string,
  markers: DirectorySessionMarkers,
): Promise<boolean> => {
  for (const marker of markers) {
    const markerPath = join(directory, marker);

    const isMarkerFound = await isFilePath(markerPath);

    if (isMarkerFound) {
      return true;
    }
  }

  return false;
};
