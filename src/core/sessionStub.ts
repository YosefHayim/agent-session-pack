import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect, Schema } from 'effect';
import { ArchiveFileSystemError } from './archiveWriter.js';
import type { ProviderId, SessionSourceKind } from './sessionStore.js';

/**
 * Magic marker written into packed-session stubs so GUI list/open can find them.
 */
export const ARCHIVED_STUB_KIND = 'agent-session-pack-archived-stub' as const;

const STUB_MARKER_FILE = '.agent-session-pack-archived.json';

/**
 * Schema for archived session stub metadata.
 */
export const ArchivedStubSchema = Schema.Struct({
  agentSessionPack: Schema.Literal(ARCHIVED_STUB_KIND),
  version: Schema.Literal(1),
  sessionId: Schema.String,
  provider: Schema.String,
  sourceKind: Schema.Literal('file', 'directory'),
});

/**
 * Decoded archived stub metadata.
 */
export type ArchivedStub = typeof ArchivedStubSchema.Type;

/**
 * Inputs for writing an archived-session stub.
 */
export type WriteArchivedStubRequest = {
  readonly originalPath: string;
  readonly sessionId: string;
  readonly provider: ProviderId;
  readonly sourceKind: SessionSourceKind;
};

/**
 * Writes a tiny listable stub at the original session path after pack removes the full session.
 *
 * @param request - Stub write fields for path, identity, and source kind.
 * @returns Effect completing after the stub is written.
 * @example
 * ```ts
 * import { writeArchivedStub } from './sessionStub.js';
 *
 * await Effect.runPromise(
 *   writeArchivedStub({
 *     originalPath: '/sessions/abc',
 *     sessionId: 'abc',
 *     provider: 'grok',
 *     sourceKind: 'directory',
 *   }),
 * );
 * ```
 */
export const writeArchivedStub = (
  request: WriteArchivedStubRequest,
): Effect.Effect<void, ArchiveFileSystemError> =>
  Effect.tryPromise({
    try: async () => {
      const stub: ArchivedStub = {
        agentSessionPack: ARCHIVED_STUB_KIND,
        version: 1,
        sessionId: request.sessionId,
        provider: request.provider,
        sourceKind: request.sourceKind,
      };
      const body = `${JSON.stringify(stub, null, 2)}\n`;

      if (request.sourceKind === 'directory') {
        await mkdir(request.originalPath, { recursive: true });
        await writeFile(join(request.originalPath, STUB_MARKER_FILE), body, 'utf8');
        return;
      }

      await mkdir(dirname(request.originalPath), { recursive: true });
      await writeFile(request.originalPath, body, 'utf8');
    },
    catch: (cause) =>
      new ArchiveFileSystemError({
        path: request.originalPath,
        message: String(cause),
      }),
  });

/**
 * Returns true when the path is an archived stub (not a full live session).
 *
 * @param path - Original provider session path.
 * @param sourceKind - File or directory session kind.
 * @returns Effect containing whether the path is a stub.
 * @example
 * ```ts
 * import { isArchivedStubPath } from './sessionStub.js';
 *
 * const stub = await Effect.runPromise(isArchivedStubPath('/sessions/abc', 'directory'));
 * ```
 */
export const isArchivedStubPath = (
  path: string,
  sourceKind: SessionSourceKind,
): Effect.Effect<boolean, never> =>
  Effect.promise(async () => {
    try {
      if (sourceKind === 'directory') {
        const markerPath = join(path, STUB_MARKER_FILE);
        const content = await readFile(markerPath, 'utf8');
        return isStubJson(content);
      }

      const content = await readFile(path, 'utf8');
      return isStubJson(content);
    } catch {
      return false;
    }
  });

/**
 * Returns true when a directory stub has been touched beyond the marker (provider open signal).
 *
 * @param path - Session directory path.
 * @returns Effect containing whether non-marker files exist.
 * @example
 * ```ts
 * import { directoryStubWasOpened } from './sessionStub.js';
 *
 * await Effect.runPromise(directoryStubWasOpened('/sessions/abc'));
 * ```
 */
export const directoryStubWasOpened = (path: string): Effect.Effect<boolean, never> =>
  Effect.promise(async () => {
    try {
      const entries = await readdir(path);
      return entries.some((entry) => entry !== STUB_MARKER_FILE);
    } catch {
      return false;
    }
  });

/**
 * Returns the stub marker filename used inside directory sessions.
 *
 * @returns Marker basename.
 * @example
 * ```ts
 * import { archivedStubMarkerFileName } from './sessionStub.js';
 *
 * archivedStubMarkerFileName();
 * ```
 */
export const archivedStubMarkerFileName = (): string => STUB_MARKER_FILE;

/**
 * Reads stub metadata when present.
 *
 * @param path - Original provider session path.
 * @param sourceKind - File or directory session kind.
 * @returns Effect containing stub metadata or undefined.
 * @example
 * ```ts
 * import { readArchivedStub } from './sessionStub.js';
 *
 * await Effect.runPromise(readArchivedStub('/sessions/abc', 'directory'));
 * ```
 */
export const readArchivedStub = (
  path: string,
  sourceKind: SessionSourceKind,
): Effect.Effect<ArchivedStub | undefined, never> =>
  Effect.promise(async () => {
    try {
      const content =
        sourceKind === 'directory'
          ? await readFile(join(path, STUB_MARKER_FILE), 'utf8')
          : await readFile(path, 'utf8');
      return Schema.decodeUnknownSync(ArchivedStubSchema)(JSON.parse(content));
    } catch {
      return undefined;
    }
  });

const isStubJson = (content: string): boolean => {
  try {
    const parsed = JSON.parse(content) as { agentSessionPack?: string };
    return parsed.agentSessionPack === ARCHIVED_STUB_KIND;
  } catch {
    return false;
  }
};
