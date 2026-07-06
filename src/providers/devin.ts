import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Effect, Schema } from 'effect';
import {
  type DiscoveredSession,
  type ProviderAdapter,
  ProviderDiscoveryError,
  type SessionStore,
  slugifyTitle,
} from '../core/index.js';

const execFileAsync = promisify(execFile);

const DevinSessionRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  createdAt: Schema.Number,
  modifiedAt: Schema.Number,
  sizeBytes: Schema.Number,
});

const DevinSessionRowsSchema = Schema.Array(DevinSessionRowSchema);

type DevinSessionRow = typeof DevinSessionRowSchema.Type;

const devinSessionsSql = `
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

export const devinProvider: ProviderAdapter = {
  id: 'devin',
  label: 'Devin',
  mode: 'backup-only',
  defaultRoots: (home: string): ReadonlyArray<string> => [
    join(home, '.local', 'share', 'devin', 'cli'),
  ],
  discover: (store) => discoverDevinProviderSessions(store),
};

/**
 * Discovers Devin CLI sessions from the local SQLite session store.
 *
 * @param store - Devin CLI storage root.
 * @returns Effect containing backup-only Devin session metadata.
 */
export const discoverDevinProviderSessions = (
  store: SessionStore,
): Effect.Effect<ReadonlyArray<DiscoveredSession>, ProviderDiscoveryError> =>
  Effect.tryPromise({
    try: () => discoverDevinSessions(store.path),
    catch: (cause) =>
      new ProviderDiscoveryError({
        provider: 'devin',
        path: store.path,
        message: String(cause),
      }),
  });

const discoverDevinSessions = async (root: string): Promise<ReadonlyArray<DiscoveredSession>> => {
  const dbPath = join(root, 'sessions.db');
  const dbStat = await stat(dbPath).catch(() => undefined);

  if (dbStat === undefined) {
    return [];
  }

  const rows = await readDevinSessionRows(dbPath).catch(() => []);

  if (rows.length === 0) {
    return [sessionFromDatabaseSnapshot(dbPath, dbStat.size, dbStat.mtime)];
  }

  return rows.map((row) => sessionFromDevinRow(row, dbPath, dbStat.size));
};

const readDevinSessionRows = async (dbPath: string): Promise<ReadonlyArray<DevinSessionRow>> => {
  const output = await execFileAsync('sqlite3', ['-json', dbPath, devinSessionsSql]);
  const parsed = JSON.parse(output.stdout) as unknown;
  const decoded = Schema.decodeUnknownEither(DevinSessionRowsSchema)(parsed);

  if (decoded._tag === 'Left') {
    return [];
  }

  return decoded.right;
};

const sessionFromDevinRow = (
  row: DevinSessionRow,
  dbPath: string,
  dbBytes: number,
): DiscoveredSession => {
  const sizeBytes = row.sizeBytes > 0 ? row.sizeBytes : dbBytes;

  return {
    id: row.id,
    provider: 'devin',
    title: row.title,
    slug: slugifyTitle(row.title),
    originalPath: dbPath,
    createdAt: dateFromDevinTimestamp(row.createdAt),
    modifiedAt: dateFromDevinTimestamp(row.modifiedAt),
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
  if (timestamp > 9_999_999_999) {
    return new Date(timestamp);
  }

  return new Date(timestamp * 1000);
};
