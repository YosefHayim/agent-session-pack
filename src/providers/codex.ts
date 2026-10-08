import { join } from 'node:path';
import { discoverJsonlProviderSessions } from '../core/jsonlProviderDiscovery.js';
import type { ProviderAdapter } from '../core/sessionStore.js';

/**
 * Archive provider adapter for Codex JSONL sessions.
 */
export const codexProvider: ProviderAdapter = {
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
};
