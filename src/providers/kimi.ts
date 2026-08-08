import { basename, join } from 'node:path';
import type { ProviderAdapter } from '../core/sessionStore.js';
import { discoverDirectoryProviderSessions, readJsonFile } from './directorySessions.js';

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
        return name.startsWith('session_') ? name.slice('session_'.length) : name;
      },
    }),
};

const readKimiSessionTitle = async (directory: string): Promise<string> => {
  const state = await readJsonFile(join(directory, 'state.json'));

  if (typeof state === 'object' && state !== null) {
    const title = (state as { readonly title?: unknown }).title;

    if (typeof title === 'string' && title.trim().length > 0) {
      return title.trim();
    }
  }

  return basename(directory);
};
