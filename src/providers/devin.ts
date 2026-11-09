import { execFile } from 'node:child_process';
import { type Stats, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { DiscoveredSession, ProviderAdapter } from '@/session-model.js';
import { slugifyTitle } from './session-discovery.js';

const execFileAsync = promisify(execFile);

const DEVIN_SESSIONS_SQL = `
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

const DevinSessionRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  modifiedAt: z.number(),
  sizeBytes: z.number(),
});

const DevinSessionRowsSchema = z.array(DevinSessionRowSchema);

type DevinSessionRow = z.infer<typeof DevinSessionRowSchema>;

/**
 * Backup-only provider adapter for Devin CLI sessions.
 */
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

  if (dbStat === null) {
    return [];
  }

  const devinSessionRows = await readDevinSessionRows(dbPath);
  const isSessionListEmpty = devinSessionRows.length === 0;

  if (isSessionListEmpty) {
    return [sessionFromDatabaseSnapshot(dbPath, dbStat.size, dbStat.mtime)];
  }

  return devinSessionRows.map((devinSessionRow) =>
    sessionFromDevinRow(devinSessionRow, dbPath, dbStat.size),
  );
};

const readStatOrNull = async (path: string): Promise<Stats | null> => {
  try {
    return await stat(path);
  } catch {
    // A missing database means no Devin sessions.
    return null;
  }
};

const readDevinSessionRows = async (dbPath: string): Promise<ReadonlyArray<DevinSessionRow>> => {
  try {
    const output = await execFileAsync('sqlite3', ['-json', dbPath, DEVIN_SESSIONS_SQL]);
    const parsed = JSON.parse(output.stdout) as unknown;
    const decodedReply = DevinSessionRowsSchema.safeParse(parsed);
    const isDecodeFailed = !decodedReply.success;

    if (isDecodeFailed) {
      return [];
    }

    return decodedReply.data;
  } catch {
    // An unreadable sqlite database falls back to one snapshot entry, as discovery always did.
    return [];
  }
};

const sessionFromDevinRow = (
  devinSessionRow: DevinSessionRow,
  dbPath: string,
  dbBytes: number,
): DiscoveredSession => {
  const isRowSizeKnown = devinSessionRow.sizeBytes > 0;
  const sizeBytes = isRowSizeKnown ? devinSessionRow.sizeBytes : dbBytes;

  return {
    id: devinSessionRow.id,
    provider: 'devin',
    title: devinSessionRow.title,
    slug: slugifyTitle(devinSessionRow.title),
    originalPath: dbPath,
    createdAt: dateFromDevinTimestamp(devinSessionRow.createdAt),
    modifiedAt: dateFromDevinTimestamp(devinSessionRow.modifiedAt),
    sizeBytes,
    status: 'live',
  };
};

const sessionFromDatabaseSnapshot = (
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

const dateFromDevinTimestamp = (timestamp: number): Date => {
  const isMillisecondTimestamp = timestamp > 9_999_999_999;

  if (isMillisecondTimestamp) {
    return new Date(timestamp);
  }

  return new Date(timestamp * 1000);
};
