import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderId } from '@/session-model.js';

interface SessionAccessEvent {
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly accessedAt: string;
}

export interface SaveSessionAccessRequest {
  readonly vaultPath: string;
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly accessedAt: Date;
}

export interface SessionHotCheckRequest {
  readonly events: ReadonlyArray<SessionAccessEvent>;
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly sinceMs: number;
}

// Catches a UUID or a long hex id standing alone in an argument.
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

// Catches --session=, --session-id=, --resume= or --id= and captures the id after the equals sign.
const inlineSessionFlagPattern = /^--(?:session|session-id|resume|id)=(.+)$/i;

const NOISE_TOKENS = new Set(['true', 'false', 'json', 'apply', 'yes', 'resume', 'session']);
const NOISE_SUFFIXES = ['.json', '.jsonl', '.ts', '.js'];

export function createWrappersBinPath(vaultPath: string): string {
  return join(vaultPath, 'bin');
}

export function createAccessLogPath(vaultPath: string): string {
  return join(vaultPath, 'access-log.jsonl');
}

export function extractSessionIdsFromArgv(argv: ReadonlyArray<string>): ReadonlyArray<string> {
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
}

export async function saveSessionAccess(request: SaveSessionAccessRequest): Promise<void> {
  const path = createAccessLogPath(request.vaultPath);
  const event: SessionAccessEvent = {
    provider: request.provider,
    sessionId: request.sessionId,
    accessedAt: request.accessedAt.toISOString(),
  };

  try {
    await mkdir(request.vaultPath, { recursive: true });
    await appendFile(path, `${JSON.stringify(event)}\n`);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

export function isSessionAccessedSince(request: SessionHotCheckRequest): boolean {
  function isMatchingRecentEvent(event: SessionAccessEvent): boolean {
    const isSameProvider = event.provider === request.provider;
    const isSameSession = event.sessionId === request.sessionId;
    const isRecent = Date.parse(event.accessedAt) >= request.sinceMs;

    return isSameProvider && isSameSession && isRecent;
  }

  return request.events.some(isMatchingRecentEvent);
}

function tryTakeFlagSessionId(found: Set<string>, arg: string, next: string | undefined): boolean {
  const isUnknownFlag = !knownSessionFlagNames.has(arg);
  if (isUnknownFlag) {
    return false;
  }

  const isNextMissing = next == null;
  if (isNextMissing) {
    return true;
  }

  const isNextFlag = next.startsWith('-');
  const isNextNoise = isNoiseToken(next);

  const isSessionIdCandidate = !isNextFlag && !isNextNoise;
  if (isSessionIdCandidate) {
    found.add(next);
  }

  return true;
}

function tryTakeInlineSessionId(found: Set<string>, arg: string): boolean {
  const inlineFlagMatch = arg.match(inlineSessionFlagPattern);
  const inlineId = inlineFlagMatch?.[1];

  const isInlineIdMissing = inlineId == null;
  if (isInlineIdMissing) {
    return false;
  }

  const isInlineIdNoise = isNoiseToken(inlineId);
  if (isInlineIdNoise) {
    return false;
  }

  found.add(inlineId);
  return true;
}

function addUuidHits(found: Set<string>, arg: string): void {
  for (const hit of arg.matchAll(sessionIdPattern)) {
    const matchedId = hit[1];

    const hasMatchedId = matchedId != null;
    if (hasMatchedId) {
      found.add(matchedId);
    }
  }
}

function isNoiseToken(token: string): boolean {
  const lowerToken = token.toLowerCase();

  function endsWithNoiseSuffix(suffix: string): boolean {
    return lowerToken.endsWith(suffix);
  }

  const isNoiseWord = NOISE_TOKENS.has(lowerToken);

  return isNoiseWord || NOISE_SUFFIXES.some(endsWithNoiseSuffix);
}
