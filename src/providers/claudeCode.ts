import { join } from 'node:path';
import type { ProviderAdapter } from '../shared/sessionStore.js';
import { discoverJsonlProviderSessions } from './jsonlSessions.js';

/**
 * Archive provider adapter for Claude Code JSONL sessions.
 */
export const claudeCodeProvider: ProviderAdapter = {
  id: 'claude',
  label: 'Claude Code',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [join(home, '.claude', 'projects')],
  discover: (store) =>
    discoverJsonlProviderSessions({
      provider: 'claude',
      store,
      excludePathParts: ['subagents'],
    }),
};
