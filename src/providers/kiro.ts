import { join } from 'node:path';
import {
  createJsonlProviderAdapter,
  discoverJsonlProviderSessions,
} from '../core/jsonlProviderDiscovery.js';
import type { ProviderAdapter } from '../core/sessionStore.js';

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
