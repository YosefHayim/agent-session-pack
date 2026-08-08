import { join } from 'node:path';
import { Effect } from 'effect';
import type { ProviderAdapter } from '../core/sessionStore.js';
import { discoverDirectoryProviderSessions } from './directorySessions.js';
import { discoverJsonlProviderSessions } from './sessionMetadata.js';

/**
 * Archive provider adapter for OpenCode local session stores.
 */
export const opencodeProvider: ProviderAdapter = {
  id: 'opencode',
  label: 'OpenCode',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [
    join(home, '.local', 'share', 'opencode'),
    join(home, '.opencode'),
  ],
  discover: (store) =>
    Effect.gen(function* () {
      const directorySessions = yield* discoverDirectoryProviderSessions({
        provider: 'opencode',
        store,
        markers: ['session.json', 'info.json', 'meta.json'],
        maxDepth: 6,
        excludedNames: ['log', 'logs', 'bin', 'node_modules'],
      });

      if (directorySessions.length > 0) {
        return directorySessions;
      }

      return yield* discoverJsonlProviderSessions({
        provider: 'opencode',
        store,
        excludePathParts: ['log', 'logs', 'node_modules'],
      });
    }),
};
