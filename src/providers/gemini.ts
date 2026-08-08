import { join } from 'node:path';
import { Effect } from 'effect';
import { discoverJsonlProviderSessions } from '../core/jsonlProviderDiscovery.js';
import type { ProviderAdapter } from '../core/sessionStore.js';
import { discoverDirectoryProviderSessions } from './directorySessions.js';

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
  discover: (store) =>
    Effect.gen(function* () {
      const directorySessions = yield* discoverDirectoryProviderSessions({
        provider: 'gemini',
        store,
        markers: ['checkpoint.json', 'chat.json', 'session.json', 'history.json'],
        maxDepth: 5,
        excludedNames: ['bin', 'node_modules', 'extensions'],
      });

      if (directorySessions.length > 0) {
        return directorySessions;
      }

      return yield* discoverJsonlProviderSessions({
        provider: 'gemini',
        store,
        excludePathParts: ['bin', 'node_modules', 'extensions'],
      });
    }),
};
