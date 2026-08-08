import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Effect } from 'effect';
import {
  type DiscoveredSession,
  measureDirectorySession,
  ProviderDiscoveryError,
  type ProviderId,
  type SessionStore,
  slugifyTitle,
} from '../core/sessionStore.js';

/**
 * Marker files that identify a directory-backed provider session.
 */
export type DirectorySessionMarkers = ReadonlyArray<string>;

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
 *
 * @param options - Provider markers, depth, and title extraction hooks.
 * @returns Effect containing discovered directory sessions.
 * @example
 * ```ts
 * import { discoverDirectoryProviderSessions } from './directorySessions.js';
 *
 * const sessions = discoverDirectoryProviderSessions({
 *   provider: 'grok',
 *   store,
 *   markers: ['summary.json', 'updates.jsonl'],
 *   maxDepth: 3,
 * });
 * ```
 */
export const discoverDirectoryProviderSessions = (
  options: DirectoryProviderDiscoveryOptions,
): Effect.Effect<ReadonlyArray<DiscoveredSession>, ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const directories = yield* Effect.tryPromise({
      try: () =>
        collectSessionDirectories(options.store.path, {
          markers: options.markers,
          maxDepth: options.maxDepth,
          excludedNames: options.excludedNames ?? [],
        }),
      catch: (cause) =>
        new ProviderDiscoveryError({
          provider: options.provider,
          path: options.store.path,
          message: String(cause),
        }),
    });

    const sessions: DiscoveredSession[] = [];

    for (const directory of directories) {
      const sessionId =
        options.sessionIdFromDirectory?.(directory) ?? defaultSessionIdFromDirectory(directory);

      if (options.activeSessionIds?.has(sessionId) === true) {
        continue;
      }

      const measured = yield* measureDirectorySession(directory).pipe(
        Effect.mapError(
          (error) =>
            new ProviderDiscoveryError({
              provider: options.provider,
              path: directory,
              message: error.message,
            }),
        ),
      );
      const title = yield* Effect.promise(async () => {
        if (options.titleFromDirectory === undefined) {
          return sessionId;
        }

        try {
          const value = await options.titleFromDirectory(directory);
          return value.length > 0 ? value : sessionId;
        } catch {
          return sessionId;
        }
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
  });

/**
 * Reads JSON text from a file when present.
 *
 * @param path - JSON file path.
 * @returns Parsed JSON value or undefined when missing/invalid.
 * @example
 * ```ts
 * import { readJsonFile } from './directorySessions.js';
 *
 * const value = await readJsonFile('/sessions/abc/summary.json');
 * ```
 */
export const readJsonFile = async (path: string): Promise<unknown | undefined> => {
  try {
    const content = await readFile(path, 'utf8');
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
};

const defaultSessionIdFromDirectory = (path: string): string => {
  const name = basename(path);
  const uuidMatch = name.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  if (uuidMatch !== null) {
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
  const rootStat = await stat(root).catch(() => undefined);

  if (rootStat === undefined || !rootStat.isDirectory()) {
    return [];
  }

  const found: string[] = [];

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > options.maxDepth) {
      return;
    }

    if (await directoryHasMarkers(directory, options.markers)) {
      found.push(directory);
      return;
    }

    if (depth === options.maxDepth) {
      return;
    }

    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (options.excludedNames.includes(entry.name)) {
        continue;
      }

      if (entry.name.startsWith('.')) {
        continue;
      }

      await walk(join(directory, entry.name), depth + 1);
    }
  };

  await walk(root, 0);
  return found;
};

const directoryHasMarkers = async (
  directory: string,
  markers: DirectorySessionMarkers,
): Promise<boolean> => {
  for (const marker of markers) {
    const markerPath = join(directory, marker);
    const markerStat = await stat(markerPath).catch(() => undefined);

    if (markerStat?.isFile() === true) {
      return true;
    }
  }

  return false;
};
