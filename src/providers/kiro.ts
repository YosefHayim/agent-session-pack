import { join } from 'node:path';
import type { ProviderAdapter } from '../core/sessionStore.js';
import { createJsonlProviderAdapter, discoverJsonlProviderSessions } from './sessionMetadata.js';

/**
 * Archive provider adapter for Kiro JSONL sessions.
 */
export const kiroProvider: ProviderAdapter = createJsonlProviderAdapter({
  id: 'kiro',
  label: 'Kiro',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [join(home, '.kiro', 'sessions')],
  discover: (store) =>
    discoverJsonlProviderSessions({
      provider: 'kiro',
      store,
      excludePathParts: [],
    }),
});
