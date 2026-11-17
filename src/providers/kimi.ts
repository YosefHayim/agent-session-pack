import { basename, join } from 'node:path';
import type { ProviderAdapter } from '@/session-model.js';
import { discoverDirectoryProviderSessions, readDocumentFile } from './directory-sessions.js';
import { isJsonObject } from './session-discovery.js';

const KIMI_PROVIDER_ID = 'kimi';
const STATE_FILE_NAME = 'state.json';
const SESSION_DIRECTORY_PREFIX = 'session_';
const kimiMaxDepth = 3;

export const kimiProvider: ProviderAdapter = {
  id: KIMI_PROVIDER_ID,
  label: 'Kimi Code',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [join(home, '.kimi-code', 'sessions')],
  discover: (store) =>
    discoverDirectoryProviderSessions({
      provider: KIMI_PROVIDER_ID,
      store,
      markers: [STATE_FILE_NAME],
      maxDepth: kimiMaxDepth,
      titleFromDirectory: readKimiSessionTitle,
      sessionIdFromDirectory: readKimiSessionId,
    }),
};

function readKimiSessionId(path: string): string {
  const name = basename(path);
  const isNameStartsWithSession = name.startsWith(SESSION_DIRECTORY_PREFIX);

  return isNameStartsWithSession ? name.slice(SESSION_DIRECTORY_PREFIX.length) : name;
}

async function readKimiSessionTitle(directory: string): Promise<string> {
  const kimiSessionDocument = await readDocumentFile(join(directory, STATE_FILE_NAME));

  const isKimiSessionDocumentMissing = !isJsonObject(kimiSessionDocument);
  if (isKimiSessionDocumentMissing) {
    return basename(directory);
  }

  const title = kimiSessionDocument.title;
  const isTitleNotString = typeof title !== 'string';
  if (isTitleNotString) {
    return basename(directory);
  }

  const trimmedTitle = title.trim();
  const hasTitleText = trimmedTitle.length > 0;
  if (hasTitleText) {
    return trimmedTitle;
  }

  return basename(directory);
}
