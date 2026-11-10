import { basename, join } from 'node:path';
import type { ProviderAdapter } from '@/session-model.js';
import { discoverDirectoryProviderSessions, readDocumentFile } from './directory-sessions.js';

export const kimiProvider: ProviderAdapter = {
  id: 'kimi',
  label: 'Kimi Code',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [join(home, '.kimi-code', 'sessions')],
  discover: (store) =>
    discoverDirectoryProviderSessions({
      provider: 'kimi',
      store,
      markers: ['state.json'],
      maxDepth: 3,
      titleFromDirectory: readKimiSessionTitle,
      sessionIdFromDirectory: (path) => {
        const name = basename(path);
        const isNameStartsWithSession = name.startsWith('session_');
        return isNameStartsWithSession ? name.slice('session_'.length) : name;
      },
    }),
};

const readKimiSessionTitle = async (directory: string): Promise<string> => {
  const kimiSessionDocument = await readDocumentFile(join(directory, 'state.json'));

  const isKimiSessionDocumentMissing =
    typeof kimiSessionDocument !== 'object' || kimiSessionDocument === null;
  if (isKimiSessionDocumentMissing) {
    return basename(directory);
  }

  const title = (kimiSessionDocument as { readonly title?: unknown }).title;

  const hasTitleString = typeof title === 'string' && title.trim().length > 0;
  if (hasTitleString) {
    return title.trim();
  }

  return basename(directory);
};
