import { join } from 'node:path';
import type { ProviderAdapter } from '@/session-model.js';
import { discoverJsonlProviderSessions } from './jsonl-sessions.js';

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
