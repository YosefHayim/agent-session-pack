import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderId } from '@/session-model.js';

/**
 * One recorded session access used to keep recently opened sessions hot.
 */
type SessionAccessEvent = {
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
 * import { resolveWrappersBinPath } from './session-access.js';
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
 * import { resolveAccessLogPath } from './session-access.js';
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
 * import { extractSessionIdsFromArgv } from './session-access.js';
 *
 * extractSessionIdsFromArgv(['resume', '019fe213-8c3a-74a1-96bc-e1a9a02a4047']);
 * ```
 */
export const extractSessionIdsFromArgv = (argv: ReadonlyArray<string>): ReadonlyArray<string> => {
  const found = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    const isArgMissing = arg == null;
    if (isArgMissing) {
      continue;
    }

    const flagTaken = tryTakeFlagSessionId(found, arg, argv[index + 1]);
    if (flagTaken) {
      index += 1;
      continue;
    }

    const isInlineSessionTaken = tryTakeInlineSessionId(found, arg);
    if (isInlineSessionTaken) {
      continue;
    }

    const isPositionalArgument = !arg.startsWith('-');
    if (isPositionalArgument) {
      addUuidMatches(found, arg);
    }
  }

  return [...found];
};

/**
 * Appends a session access event so maintain can keep hot sessions live.
 *
 * @param request - Access write fields for vault logging.
 */
export const recordSessionAccess = async (request: RecordSessionAccessRequest): Promise<void> => {
  const path = resolveAccessLogPath(request.vaultPath);
  const event: SessionAccessEvent = {
    provider: request.provider,
    sessionId: request.sessionId,
    accessedAt: request.accessedAt.toISOString(),
  };

  try {
    await mkdir(request.vaultPath, { recursive: true });
    await appendFile(path, `${JSON.stringify(event)}\n`);
  } catch (cause) {
    throw new Error(String(cause), { cause });
  }
};

/**
 * Returns true when a session was accessed within the cache window.
 *
 * @param request - Hot-cache check fields.
 * @returns True when the session is still hot.
 * @example
 * ```ts
 * import { wasSessionAccessedSince } from './session-access.js';
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
  const isUnknownFlag = !FLAG_NAMES.has(arg);
  if (isUnknownFlag) {
    return false;
  }

  const isSessionIdCandidate = next != null && !next.startsWith('-') && !isNoiseToken(next);
  if (isSessionIdCandidate) {
    found.add(next);
  }

  return true;
};

const tryTakeInlineSessionId = (found: Set<string>, arg: string): boolean => {
  const inline = arg.match(/^--(?:session|session-id|resume|id)=(.+)$/i);
  const inlineId = inline?.[1];

  const isInlineIdUnusable = inlineId == null || isNoiseToken(inlineId);
  if (isInlineIdUnusable) {
    return false;
  }

  found.add(inlineId);
  return true;
};

const addUuidMatches = (found: Set<string>, arg: string): void => {
  for (const match of arg.matchAll(SESSION_ID_PATTERN)) {
    const matchedId = match[1];

    const hasMatchedId = matchedId != null;
    if (hasMatchedId) {
      found.add(matchedId);
    }
  }
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
