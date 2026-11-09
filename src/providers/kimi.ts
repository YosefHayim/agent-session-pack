import { basename, join } from 'node:path';
import type { ProviderAdapter } from '@/session-model.js';
import { discoverDirectoryProviderSessions, readJsonFile } from './directory-sessions.js';

/**
 * Archive provider adapter for Kimi Code multi-file sessions.
 */
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
  const state = await readJsonFile(join(directory, 'state.json'));

  const isStateMissing = typeof state !== 'object' || state === null;
  if (isStateMissing) {
    return basename(directory);
  }

  const title = (state as { readonly title?: unknown }).title;

  const hasTitleText = typeof title === 'string' && title.trim().length > 0;
  if (hasTitleText) {
    return title.trim();
  }

  return basename(directory);
};
