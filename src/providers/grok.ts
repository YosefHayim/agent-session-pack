import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ProviderAdapter } from '@/session-model.js';
import { discoverDirectoryProviderSessions, readDocumentFile } from './directory-sessions.js';
import { isJsonObject } from './session-discovery.js';

const GROK_PROVIDER_ID = 'grok';
const SUMMARY_FILE_NAME = 'summary.json';
const grokMaxDepth = 3;

export const grokProvider: ProviderAdapter = {
  id: GROK_PROVIDER_ID,
  label: 'Grok',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [join(home, '.grok', 'sessions')],
  discover: async (store) => {
    const activeSessionIds = await readActiveGrokSessionIds(
      join(store.path, '..', 'active_sessions.json'),
    );

    return discoverDirectoryProviderSessions({
      provider: GROK_PROVIDER_ID,
      store,
      markers: [SUMMARY_FILE_NAME, 'updates.jsonl', 'events.jsonl'],
      maxDepth: grokMaxDepth,
      activeSessionIds,
      titleFromDirectory: readGrokSessionTitle,
      sessionIdFromDirectory: basename,
    });
  },
};

function readSessionIdOrNull(summaryPart: unknown): string | null {
  const isSummaryPartNotObject = !isJsonObject(summaryPart);
  if (isSummaryPartNotObject) {
    return null;
  }

  const sessionId = summaryPart.session_id;
  const isSessionIdString = typeof sessionId === 'string';

  return isSessionIdString ? sessionId : null;
}

function isSessionIdFound(sessionId: string | null): sessionId is string {
  return sessionId !== null;
}

async function readActiveGrokSessionIds(path: string): Promise<ReadonlySet<string>> {
  try {
    const fileString = await readFile(path, 'utf8');
    const parsedFile = JSON.parse(fileString) as unknown;

    const isNotParsedArray = !Array.isArray(parsedFile);
    if (isNotParsedArray) {
      return new Set();
    }

    const ids = parsedFile.map(readSessionIdOrNull).filter(isSessionIdFound);

    return new Set(ids);
  } catch {
    return new Set();
  }
}

function readNonBlankString(candidate: unknown): string | null {
  const isCandidateNotString = typeof candidate !== 'string';
  if (isCandidateNotString) {
    return null;
  }

  const isCandidateBlank = candidate.trim().length === 0;
  if (isCandidateBlank) {
    return null;
  }

  return candidate;
}

async function readGrokSessionTitle(directory: string): Promise<string> {
  const summary = await readDocumentFile(join(directory, SUMMARY_FILE_NAME));

  const isSummaryNotObject = !isJsonObject(summary);
  if (isSummaryNotObject) {
    return basename(directory);
  }

  const sessionSummary = readNonBlankString(summary.session_summary);
  const hasSessionSummary = sessionSummary !== null;
  if (hasSessionSummary) {
    return sessionSummary.trim();
  }

  const info = summary.info;
  const infoCwd = isJsonObject(info) ? info.cwd : null;
  const agentName = readNonBlankString(summary.agent_name);
  const hasAgentName = agentName !== null;
  if (hasAgentName) {
    const isCwdString = typeof infoCwd === 'string';
    const cwdName = isCwdString ? basename(infoCwd) : basename(directory);
    return `${agentName} @ ${cwdName}`;
  }

  const nonBlankCwd = readNonBlankString(infoCwd);
  const hasCwd = nonBlankCwd !== null;
  if (hasCwd) {
    return basename(nonBlankCwd);
  }

  return basename(directory);
}
