import { join } from 'node:path';
import type { ProviderAdapter } from '../core/index.js';
import { createJsonlProviderAdapter, discoverJsonlProviderSessions } from './sessionMetadata.js';

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
