import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ProviderAdapter } from '@/session-model.js';
import { discoverDirectoryProviderSessions, readJsonFile } from './directory-sessions.js';

/**
 * Archive provider adapter for Grok Build multi-file sessions.
 */
export const grokProvider: ProviderAdapter = {
  id: 'grok',
  label: 'Grok',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [join(home, '.grok', 'sessions')],
  discover: async (store) => {
    const activeSessionIds = await readActiveGrokSessionIds(
      join(store.path, '..', 'active_sessions.json'),
    );

    return discoverDirectoryProviderSessions({
      provider: 'grok',
      store,
      markers: ['summary.json', 'updates.jsonl', 'events.jsonl'],
      maxDepth: 3,
      activeSessionIds,
      titleFromDirectory: readGrokSessionTitle,
      sessionIdFromDirectory: (path) => basename(path),
    });
  },
};

const readActiveGrokSessionIds = async (path: string): Promise<ReadonlySet<string>> => {
  try {
    const content = await readFile(path, 'utf8');
    const parsed = JSON.parse(content) as unknown;

    const isNotParsedArray = !Array.isArray(parsed);
    if (isNotParsedArray) {
      return new Set();
    }

    const ids = parsed
      .map((entry) => {
        const isEntryNotObject = typeof entry !== 'object' || entry === null;
        if (isEntryNotObject) {
          return undefined;
        }

        const sessionId = (entry as { readonly session_id?: unknown }).session_id;
        const isSessionIdTypeString = typeof sessionId === 'string';
        return isSessionIdTypeString ? sessionId : undefined;
      })
      .filter((sessionId): sessionId is string => sessionId != null);

    return new Set(ids);
  } catch {
    return new Set();
  }
};

const readGrokSessionTitle = async (directory: string): Promise<string> => {
  const summary = await readJsonFile(join(directory, 'summary.json'));

  const isSummaryMissing = typeof summary !== 'object' || summary === null;
  if (isSummaryMissing) {
    return basename(directory);
  }

  const record = summary as {
    readonly session_summary?: unknown;
    readonly info?: { readonly cwd?: unknown; readonly id?: unknown };
    readonly agent_name?: unknown;
  };

  const hasSessionSummary =
    typeof record.session_summary === 'string' && record.session_summary.trim().length > 0;
  if (hasSessionSummary) {
    return record.session_summary.trim();
  }

  const hasAgentName = typeof record.agent_name === 'string' && record.agent_name.trim().length > 0;
  if (hasAgentName) {
    const isInfoCwdText = typeof record.info?.cwd === 'string';
    const cwd = isInfoCwdText ? basename(record.info.cwd) : basename(directory);
    return `${record.agent_name} @ ${cwd}`;
  }

  const hasInfoCwd = typeof record.info?.cwd === 'string' && record.info.cwd.trim().length > 0;
  if (hasInfoCwd) {
    return basename(record.info.cwd);
  }

  return basename(directory);
};
