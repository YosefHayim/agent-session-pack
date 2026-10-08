import { join } from 'node:path';
import { discoverJsonlProviderSessions } from '../core/jsonlProviderDiscovery.js';
import type { ProviderAdapter } from '../core/sessionStore.js';

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
