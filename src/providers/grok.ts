import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Effect } from 'effect';
import type { ProviderAdapter } from '../core/sessionStore.js';
import { discoverDirectoryProviderSessions, readJsonFile } from './directorySessions.js';

/**
 * Archive provider adapter for Grok Build multi-file sessions.
 */
export const grokProvider: ProviderAdapter = {
  id: 'grok',
  label: 'Grok',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [join(home, '.grok', 'sessions')],
  discover: (store) =>
    Effect.gen(function* () {
      const activeSessionIds = yield* Effect.promise(() =>
        readActiveGrokSessionIds(join(store.path, '..', 'active_sessions.json')),
      );

      return yield* discoverDirectoryProviderSessions({
        provider: 'grok',
        store,
        markers: ['summary.json', 'updates.jsonl', 'events.jsonl'],
        maxDepth: 3,
        activeSessionIds,
        titleFromDirectory: readGrokSessionTitle,
        sessionIdFromDirectory: (path) => basename(path),
      });
    }),
};

const readActiveGrokSessionIds = async (path: string): Promise<ReadonlySet<string>> => {
  try {
    const content = await readFile(path, 'utf8');
    const parsed = JSON.parse(content) as unknown;

    if (!Array.isArray(parsed)) {
      return new Set();
    }

    const ids = parsed
      .map((entry) => {
        if (typeof entry !== 'object' || entry === null) {
          return undefined;
        }

        const sessionId = (entry as { readonly session_id?: unknown }).session_id;
        return typeof sessionId === 'string' ? sessionId : undefined;
      })
      .filter((value): value is string => value !== undefined);

    return new Set(ids);
  } catch {
    return new Set();
  }
};

const readGrokSessionTitle = async (directory: string): Promise<string> => {
  const summary = await readJsonFile(join(directory, 'summary.json'));

  if (typeof summary === 'object' && summary !== null) {
    const record = summary as {
      readonly session_summary?: unknown;
      readonly info?: { readonly cwd?: unknown; readonly id?: unknown };
      readonly agent_name?: unknown;
    };

    if (typeof record.session_summary === 'string' && record.session_summary.trim().length > 0) {
      return record.session_summary.trim();
    }

    if (typeof record.agent_name === 'string' && record.agent_name.trim().length > 0) {
      const cwd =
        typeof record.info?.cwd === 'string' ? basename(record.info.cwd) : basename(directory);
      return `${record.agent_name} @ ${cwd}`;
    }

    if (typeof record.info?.cwd === 'string' && record.info.cwd.trim().length > 0) {
      return basename(record.info.cwd);
    }
  }

  return basename(directory);
};
