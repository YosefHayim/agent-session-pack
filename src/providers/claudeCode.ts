import { join } from 'node:path';
import type { ProviderAdapter } from '../core/index.js';
import { createJsonlProviderAdapter, discoverJsonlProviderSessions } from './sessionMetadata.js';

/**
 * Archive provider adapter for Claude Code JSONL sessions.
 */
export const claudeCodeProvider: ProviderAdapter = createJsonlProviderAdapter({
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
});
