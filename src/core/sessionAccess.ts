import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import type { ProviderId } from './sessionStore.js';

/**
 * One recorded session access used to keep recently opened sessions hot.
 */
export type SessionAccessEvent = {
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly accessedAt: string;
};

/**
 * Inputs required to append one session access event.
 */
export type RecordSessionAccessRequest = {
  readonly vaultPath: string;
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly accessedAt: Date;
};

/**
 * Inputs required to check whether a session is still hot.
 */
export type SessionHotCheckRequest = {
  readonly events: ReadonlyArray<SessionAccessEvent>;
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly sinceMs: number;
};

/**
 * Typed error raised when the vault access log cannot be read or written.
 */
export class SessionAccessLogError extends Schema.TaggedError<SessionAccessLogError>()(
  'SessionAccessLogError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

const SESSION_ID_PATTERN =
  /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{26,})\b/gi;

const FLAG_NAMES = new Set(['--session', '--session-id', '--resume', 'resume', '-s', '--id']);

/**
 * Resolves the vault bin directory that holds provider launch wrappers.
 *
 * @param vaultPath - Vault root path.
 * @returns Absolute wrappers bin path.
 * @example
 * ```ts
 * import { resolveWrappersBinPath } from './sessionAccess.js';
 *
 * resolveWrappersBinPath('/Users/me/.agent-session-pack');
 * ```
 */
export const resolveWrappersBinPath = (vaultPath: string): string => join(vaultPath, 'bin');

/**
 * Resolves the session access log path under the vault.
 *
 * @param vaultPath - Vault root path.
 * @returns Absolute access log path.
 * @example
 * ```ts
 * import { resolveAccessLogPath } from './sessionAccess.js';
 *
 * resolveAccessLogPath('/Users/me/.agent-session-pack');
 * ```
 */
export const resolveAccessLogPath = (vaultPath: string): string =>
  join(vaultPath, 'access-log.jsonl');

/**
 * Extracts likely session ids from provider CLI arguments for preflight restore.
 *
 * @param argv - Provider CLI argv (without binary name).
 * @returns Deduplicated session id candidates.
 * @example
 * ```ts
 * import { extractSessionIdsFromArgv } from './sessionAccess.js';
 *
 * extractSessionIdsFromArgv(['resume', '019fe213-8c3a-74a1-96bc-e1a9a02a4047']);
 * ```
 */
export const extractSessionIdsFromArgv = (argv: ReadonlyArray<string>): ReadonlyArray<string> => {
  const found = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }

    const flagTaken = tryTakeFlagSessionId(found, arg, argv[index + 1]);
    if (flagTaken) {
      index += 1;
      continue;
    }

    if (tryTakeInlineSessionId(found, arg)) {
      continue;
    }

    if (!arg.startsWith('-')) {
      addUuidMatches(found, arg);
    }
  }

  return [...found];
};

/**
 * Appends a session access event so maintain can keep hot sessions live.
 *
 * @param request - Access write fields for vault logging.
 * @returns Effect completing after the log append.
 * @example
 * ```ts
 * import { recordSessionAccess } from './sessionAccess.js';
 *
 * await Effect.runPromise(
 *   recordSessionAccess({
 *     vaultPath: '/vault',
 *     provider: 'codex',
 *     sessionId: 'cold',
 *     accessedAt: new Date(),
 *   }),
 * );
 * ```
 */
export const recordSessionAccess = (
  request: RecordSessionAccessRequest,
): Effect.Effect<void, SessionAccessLogError> => {
  const path = resolveAccessLogPath(request.vaultPath);
  const event: SessionAccessEvent = {
    provider: request.provider,
    sessionId: request.sessionId,
    accessedAt: request.accessedAt.toISOString(),
  };

  return Effect.tryPromise({
    try: async () => {
      await mkdir(request.vaultPath, { recursive: true });
      await appendFile(path, `${JSON.stringify(event)}\n`);
    },
    catch: (cause) =>
      new SessionAccessLogError({
        path,
        message: String(cause),
      }),
  });
};

/**
 * Reads recent access events from the vault log (best-effort).
 *
 * @param vaultPath - Vault root path.
 * @returns Effect containing access events (empty when missing).
 * @example
 * ```ts
 * import { readSessionAccessLog } from './sessionAccess.js';
 *
 * const events = await Effect.runPromise(readSessionAccessLog('/vault'));
 * ```
 */
export const readSessionAccessLog = (
  vaultPath: string,
): Effect.Effect<ReadonlyArray<SessionAccessEvent>, SessionAccessLogError> => {
  const path = resolveAccessLogPath(vaultPath);

  return Effect.tryPromise({
    try: async () => readAccessLogLines(path),
    catch: (cause) =>
      new SessionAccessLogError({
        path,
        message: String(cause),
      }),
  });
};

/**
 * Returns true when a session was accessed within the cache window.
 *
 * @param request - Hot-cache check fields.
 * @returns True when the session is still hot.
 * @example
 * ```ts
 * import { wasSessionAccessedSince } from './sessionAccess.js';
 *
 * wasSessionAccessedSince({
 *   events,
 *   provider: 'codex',
 *   sessionId: 'cold',
 *   sinceMs: Date.now() - 7 * 24 * 60 * 60 * 1000,
 * });
 * ```
 */
export const wasSessionAccessedSince = (request: SessionHotCheckRequest): boolean =>
  request.events.some(
    (event) =>
      event.provider === request.provider &&
      event.sessionId === request.sessionId &&
      Date.parse(event.accessedAt) >= request.sinceMs,
  );

const tryTakeFlagSessionId = (
  found: Set<string>,
  arg: string,
  next: string | undefined,
): boolean => {
  if (!FLAG_NAMES.has(arg)) {
    return false;
  }

  if (next !== undefined && !next.startsWith('-') && !isNoiseToken(next)) {
    found.add(next);
  }

  return true;
};

const tryTakeInlineSessionId = (found: Set<string>, arg: string): boolean => {
  const inline = arg.match(/^--(?:session|session-id|resume|id)=(.+)$/i);
  if (inline?.[1] === undefined || isNoiseToken(inline[1])) {
    return false;
  }

  found.add(inline[1]);
  return true;
};

const addUuidMatches = (found: Set<string>, arg: string): void => {
  for (const match of arg.matchAll(SESSION_ID_PATTERN)) {
    if (match[1] !== undefined) {
      found.add(match[1]);
    }
  }
};

const readAccessLogLines = async (path: string): Promise<ReadonlyArray<SessionAccessEvent>> => {
  const content = await readFile(path, 'utf8').catch((cause: unknown) => {
    if (isEnoent(cause)) {
      return '';
    }

    return Promise.reject(cause);
  });

  if (content.length === 0) {
    return [];
  }

  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SessionAccessEvent)
    .filter(
      (parsed) =>
        typeof parsed.provider === 'string' &&
        typeof parsed.sessionId === 'string' &&
        typeof parsed.accessedAt === 'string',
    );
};

const isNoiseToken = (token: string): boolean => {
  const lower = token.toLowerCase();
  return (
    lower === 'true' ||
    lower === 'false' ||
    lower === 'json' ||
    lower === 'apply' ||
    lower === 'yes' ||
    lower === 'resume' ||
    lower === 'session' ||
    lower.endsWith('.json') ||
    lower.endsWith('.jsonl') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.js')
  );
};

const isEnoent = (cause: unknown): boolean =>
  typeof cause === 'object' &&
  cause !== null &&
  'code' in cause &&
  (cause as { code?: string }).code === 'ENOENT';
