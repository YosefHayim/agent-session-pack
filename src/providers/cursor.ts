import { join } from 'node:path';
import type { ProviderAdapter } from '@/session-model.js';

export const cursorProvider: ProviderAdapter = {
  id: 'cursor',
  label: 'Cursor',
  mode: 'backup-only',
  defaultRoots: (home: string): ReadonlyArray<string> => [
    join(home, 'Library', 'Application Support', 'Cursor'),
  ],
  discover: async () => [],
};
