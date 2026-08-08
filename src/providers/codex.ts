import { join } from 'node:path';
import {
  createJsonlProviderAdapter,
  discoverJsonlProviderSessions,
} from '../core/jsonlProviderDiscovery.js';
import type { ProviderAdapter } from '../core/sessionStore.js';

/**
 * Archive provider adapter for Codex JSONL sessions.
 */
export const codexProvider: ProviderAdapter = createJsonlProviderAdapter({
  id: 'codex',
  label: 'Codex',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [join(home, '.codex', 'sessions')],
  discover: (store) =>
    discoverJsonlProviderSessions({
      provider: 'codex',
      store,
      excludePathParts: [],
    }),
});
