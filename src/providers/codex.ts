import { join } from 'node:path';
import type { ProviderAdapter } from '@/session-model.js';
import { discoverJsonlProviderSessions } from './jsonl-sessions.js';

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
