import { join } from 'node:path';
import type { ProviderAdapter } from '@/session-model.js';
import { discoverDirectoryProviderSessions } from './directory-sessions.js';
import { discoverJsonlProviderSessions } from './jsonl-sessions.js';

export const opencodeProvider: ProviderAdapter = {
  id: 'opencode',
  label: 'OpenCode',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [
    join(home, '.local', 'share', 'opencode'),
    join(home, '.opencode'),
  ],
  discover: async (store) => {
    const directorySessions = await discoverDirectoryProviderSessions({
      provider: 'opencode',
      store,
      markers: ['session.json', 'info.json', 'meta.json'],
      maxDepth: 6,
      excludedNames: ['log', 'logs', 'bin', 'node_modules'],
    });

    const isDirectorySessionFound = directorySessions.length > 0;

    if (isDirectorySessionFound) {
      return directorySessions;
    }

    return discoverJsonlProviderSessions({
      provider: 'opencode',
      store,
      excludePathParts: ['log', 'logs', 'node_modules'],
    });
  },
};
