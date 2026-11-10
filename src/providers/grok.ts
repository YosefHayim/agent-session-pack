import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ProviderAdapter } from '@/session-model.js';
import { discoverDirectoryProviderSessions, readDocumentFile } from './directory-sessions.js';

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
    const fileString = await readFile(path, 'utf8');
    const parsed = JSON.parse(fileString) as unknown;

    const isNotParsedArray = !Array.isArray(parsed);
    if (isNotParsedArray) {
      return new Set();
    }

    const ids = parsed
      .map((summaryPart) => {
        const isSummaryPartNotObject = typeof summaryPart !== 'object' || summaryPart === null;
        if (isSummaryPartNotObject) {
          return null;
        }

        const sessionId = (summaryPart as { readonly session_id?: unknown }).session_id;
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
  const summary = await readDocumentFile(join(directory, 'summary.json'));

  const isSummaryMissing = typeof summary !== 'object' || summary === null;
  if (isSummaryMissing) {
    return basename(directory);
  }

  const summaryFields = summary as {
    readonly session_summary?: unknown;
    readonly info?: { readonly cwd?: unknown; readonly id?: unknown };
    readonly agent_name?: unknown;
  };

  const hasSessionSummary =
    typeof summaryFields.session_summary === 'string' &&
    summaryFields.session_summary.trim().length > 0;
  if (hasSessionSummary) {
    return summaryFields.session_summary.trim();
  }

  const hasAgentName =
    typeof summaryFields.agent_name === 'string' && summaryFields.agent_name.trim().length > 0;
  if (hasAgentName) {
    const isCwdString = typeof summaryFields.info?.cwd === 'string';
    const cwd = isCwdString ? basename(summaryFields.info.cwd) : basename(directory);
    return `${summaryFields.agent_name} @ ${cwd}`;
  }

  const hasCwd =
    typeof summaryFields.info?.cwd === 'string' && summaryFields.info.cwd.trim().length > 0;
  if (hasCwd) {
    return basename(summaryFields.info.cwd);
  }

  return basename(directory);
};
