import { join } from 'node:path';
import type { ProviderAdapter } from '../shared/sessionModel.js';
import { discoverJsonlProviderSessions } from './jsonlSessions.js';

/**
 * Archive provider adapter for Kiro JSONL sessions.
 */
export const kiroProvider: ProviderAdapter = {
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
};
