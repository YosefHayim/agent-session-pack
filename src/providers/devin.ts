import { execFile } from 'node:child_process';
import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { DiscoveredSession, ProviderAdapter } from '@/session-model.js';
import { slugifyTitle } from './session-discovery.js';

const execFileAsync = promisify(execFile);

const devinSessionsQuery = `
SELECT
  s.id AS id,
  COALESCE(NULLIF(TRIM(s.title), ''), s.id) AS title,
  s.created_at AS createdAt,
  s.last_activity_at AS modifiedAt,
  CAST(
    COALESCE((SELECT SUM(LENGTH(content)) FROM prompt_history WHERE session_id = s.id), 0) +
    COALESCE((SELECT SUM(LENGTH(chat_message) + LENGTH(COALESCE(metadata, ''))) FROM message_nodes WHERE session_id = s.id), 0) +
    COALESCE((SELECT SUM(LENGTH(rendered_html)) FROM rendered_commits WHERE session_id = s.id), 0) +
    COALESCE((SELECT SUM(LENGTH(COALESCE(tool_call_json, '')) + LENGTH(COALESCE(tool_call_update_json, ''))) FROM tool_call_state WHERE session_id = s.id), 0)
    AS INTEGER
  ) AS sizeBytes
FROM sessions s
WHERE s.hidden = 0
ORDER BY s.last_activity_at DESC
`;

const DevinSessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  modifiedAt: z.number(),
  sizeBytes: z.number(),
});

const DevinSessionSummariesSchema = z.array(DevinSessionSummarySchema);

type DevinSessionSummary = z.infer<typeof DevinSessionSummarySchema>;

export const devinProvider: ProviderAdapter = {
  id: 'devin',
  label: 'Devin',
  mode: 'backup-only',
  defaultRoots: (home: string): ReadonlyArray<string> => [
    join(home, '.local', 'share', 'devin', 'cli'),
  ],
  discover: (store) => discoverDevinSessions(store.path),
};

const discoverDevinSessions = async (root: string): Promise<ReadonlyArray<DiscoveredSession>> => {
  const dbPath = join(root, 'sessions.db');
  const dbStat = await readStatOrNull(dbPath);

  const isDatabaseFileMissing = dbStat === null;
  if (isDatabaseFileMissing) {
    return [];
  }

  const devinSessionSummaries = await readDevinSessions(dbPath);

  const isSessionListEmpty = devinSessionSummaries.length === 0;

  if (isSessionListEmpty) {
    return [readSessionFromDatabaseSnapshot(dbPath, dbStat.size, dbStat.mtime)];
  }

  return devinSessionSummaries.map((devinSessionSummary) =>
    readSessionFromDevin(devinSessionSummary, dbPath, dbStat.size),
  );
};

const readStatOrNull = async (path: string): Promise<Stats | null> => {
  try {
    return await stat(path);
  } catch {
    return null;
  }
};

const readDevinSessions = async (dbPath: string): Promise<ReadonlyArray<DevinSessionSummary>> => {
  try {
    const printout = await execFileAsync('sqlite3', ['-json', dbPath, devinSessionsQuery]);
    const parsed = JSON.parse(printout.stdout) as unknown;
    const decodedReply = DevinSessionSummariesSchema.safeParse(parsed);

    const isDecodeFailed = !decodedReply.success;

    if (isDecodeFailed) {
      return [];
    }

    return decodedReply.data;
  } catch {
    return [];
  }
};

const readSessionFromDevin = (
  devinSessionSummary: DevinSessionSummary,
  dbPath: string,
  dbBytes: number,
): DiscoveredSession => {
  const isStoredSizeKnown = devinSessionSummary.sizeBytes > 0;
  const sizeBytes = isStoredSizeKnown ? devinSessionSummary.sizeBytes : dbBytes;

  return {
    id: devinSessionSummary.id,
    provider: 'devin',
    title: devinSessionSummary.title,
    slug: slugifyTitle(devinSessionSummary.title),
    originalPath: dbPath,
    createdAt: readDateFromDevinTimestamp(devinSessionSummary.createdAt),
    modifiedAt: readDateFromDevinTimestamp(devinSessionSummary.modifiedAt),
    sizeBytes,
    status: 'live',
  };
};

const readSessionFromDatabaseSnapshot = (
  dbPath: string,
  dbBytes: number,
  modifiedAt: Date,
): DiscoveredSession => ({
  id: 'sessions-db',
  provider: 'devin',
  title: 'Devin sessions database',
  slug: 'devin-sessions-database',
  originalPath: dbPath,
  modifiedAt,
  sizeBytes: dbBytes,
  status: 'live',
});

const readDateFromDevinTimestamp = (timestamp: number): Date => {
  const largestUnixSecondsTimestamp = 9_999_999_999;
  const isMillisecondTimestamp = timestamp > largestUnixSecondsTimestamp;

  if (isMillisecondTimestamp) {
    return new Date(timestamp);
  }

  const millisecondsPerSecond = 1000;
  return new Date(timestamp * millisecondsPerSecond);
};
