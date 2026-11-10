import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderId } from '@/session-model.js';

type SessionAccessEvent = {
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly accessedAt: string;
};

export type SaveSessionAccessRequest = {
  readonly vaultPath: string;
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly accessedAt: Date;
};

export type SessionHotCheckRequest = {
  readonly events: ReadonlyArray<SessionAccessEvent>;
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly sinceMs: number;
};

const sessionIdPattern =
  /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{26,})\b/gi;

const knownSessionFlagNames = new Set([
  '--session',
  '--session-id',
  '--resume',
  'resume',
  '-s',
  '--id',
]);

export const createWrappersBinPath = (vaultPath: string): string => join(vaultPath, 'bin');

export const createAccessLogPath = (vaultPath: string): string =>
  join(vaultPath, 'access-log.jsonl');

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
      addUuidHits(found, arg);
    }
  }

  return [...found];
};

export const saveSessionAccess = async (request: SaveSessionAccessRequest): Promise<void> => {
  const path = createAccessLogPath(request.vaultPath);
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

export const isSessionAccessedSince = (request: SessionHotCheckRequest): boolean =>
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
  const isUnknownFlag = !knownSessionFlagNames.has(arg);
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

const addUuidHits = (found: Set<string>, arg: string): void => {
  for (const hit of arg.matchAll(sessionIdPattern)) {
    const matchedId = hit[1];

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
