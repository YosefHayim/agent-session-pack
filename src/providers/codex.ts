import { join } from 'node:path';
import type { ProviderAdapter } from '../shared/sessionModel.js';
import { discoverJsonlProviderSessions } from './jsonlSessions.js';

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
