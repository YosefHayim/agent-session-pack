import { join } from 'node:path';
import { Effect } from 'effect';
import type { ProviderAdapter } from '../core/index.js';

export const cursorProvider: ProviderAdapter = {
  id: 'cursor',
  label: 'Cursor',
  mode: 'backup-only',
  defaultRoots: (home: string): ReadonlyArray<string> => [
    join(home, 'Library', 'Application Support', 'Cursor'),
  ],
  discover: () => Effect.succeed([]),
};
