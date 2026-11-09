import { join } from 'node:path';
import type { ProviderAdapter } from '@/session-model.js';
import { discoverDirectoryProviderSessions } from './directory-sessions.js';
import { discoverJsonlProviderSessions } from './jsonl-sessions.js';

/**
 * Archive provider adapter for Gemini CLI local session stores.
 */
export const geminiProvider: ProviderAdapter = {
  id: 'gemini',
  label: 'Gemini CLI',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [
    join(home, '.gemini'),
    join(home, '.gemini', 'tmp'),
  ],
  discover: async (store) => {
    const directorySessions = await discoverDirectoryProviderSessions({
      provider: 'gemini',
      store,
      markers: ['checkpoint.json', 'chat.json', 'session.json', 'history.json'],
      maxDepth: 5,
      excludedNames: ['bin', 'node_modules', 'extensions'],
    });

    const isDirectorySessionFound = directorySessions.length > 0;

    if (isDirectorySessionFound) {
      return directorySessions;
    }

    return discoverJsonlProviderSessions({
      provider: 'gemini',
      store,
      excludePathParts: ['bin', 'node_modules', 'extensions'],
    });
  },
};
