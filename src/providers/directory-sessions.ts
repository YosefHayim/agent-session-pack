import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { DiscoveredSession, ProviderId, SessionStore } from '@/session-model.js';
import { measureDirectorySession, slugifyTitle } from './session-discovery.js';

type DirectorySessionMarkers = ReadonlyArray<string>;

export type DirectoryProviderDiscoverySettings = {
  readonly provider: ProviderId;
  readonly store: SessionStore;
  readonly markers: DirectorySessionMarkers;
  readonly maxDepth: number;
  readonly excludedNames?: ReadonlyArray<string>;
  readonly activeSessionIds?: ReadonlySet<string>;
  readonly titleFromDirectory?: (path: string) => Promise<string>;
  readonly sessionIdFromDirectory?: (path: string) => string;
};

export const discoverDirectoryProviderSessions = async (
  settings: DirectoryProviderDiscoverySettings,
): Promise<ReadonlyArray<DiscoveredSession>> => {
  const directories = await collectSessionDirectories(settings.store.path, {
    markers: settings.markers,
    maxDepth: settings.maxDepth,
    excludedNames: settings.excludedNames ?? [],
  });
  const sessions: DiscoveredSession[] = [];

  for (const directory of directories) {
    const sessionId =
      settings.sessionIdFromDirectory?.(directory) ?? readDefaultSessionIdFromDirectory(directory);

    const isSessionActive = settings.activeSessionIds?.has(sessionId) === true;

    if (isSessionActive) {
      continue;
    }

    const measured = await measureDirectorySession(directory);
    const title = await readDirectoryTitle({
      directory,
      sessionId,
      titleFromDirectory: settings.titleFromDirectory,
    });

    sessions.push({
      id: sessionId,
      provider: settings.provider,
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

export const readDocumentFile = async (path: string): Promise<unknown | null> => {
  try {
    const fileString = await readFile(path, 'utf8');
    return JSON.parse(fileString) as unknown;
  } catch {
    return null;
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
    return request.sessionId;
  }
};

const readDefaultSessionIdFromDirectory = (path: string): string => {
  const name = basename(path);
  const uuidHit = name.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  const isUuidFound = uuidHit != null;
  if (isUuidFound) {
    return uuidHit[0];
  }

  return name;
};

const collectSessionDirectories = async (
  root: string,
  settings: {
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
    const isDepthAboveMaxDepth = depth > settings.maxDepth;
    if (isDepthAboveMaxDepth) {
      return;
    }

    const hasSessionMarkers = await hasDirectoryMarkers(directory, settings.markers);
    if (hasSessionMarkers) {
      found.push(directory);
      return;
    }

    const isAtMaxDepth = depth === settings.maxDepth;
    if (isAtMaxDepth) {
      return;
    }

    const dirents = await readChildDirents(directory);

    for (const dirent of dirents) {
      const isNotDirectory = !dirent.isDirectory();
      if (isNotDirectory) {
        continue;
      }

      const isNameInExcludedNames = settings.excludedNames.includes(dirent.name);
      if (isNameInExcludedNames) {
        continue;
      }

      const isHiddenName = dirent.name.startsWith('.');
      if (isHiddenName) {
        continue;
      }

      await walk(join(directory, dirent.name), depth + 1);
    }
  };

  await walk(root, 0);
  return found;
};

const readChildDirents = async (directory: string): Promise<ReadonlyArray<Dirent>> => {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
};

const isDirectoryPath = async (path: string): Promise<boolean> => {
  try {
    const pathStat = await stat(path);
    return pathStat.isDirectory();
  } catch {
    return false;
  }
};

const isFilePath = async (path: string): Promise<boolean> => {
  try {
    const pathStat = await stat(path);
    return pathStat.isFile();
  } catch {
    return false;
  }
};

const hasDirectoryMarkers = async (
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
