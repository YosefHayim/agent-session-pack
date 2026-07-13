import { Effect } from 'effect';
import type { DiscoveredSession } from './sessionStore.js';

/**
 * Discovered session enriched with the time it was indexed.
 */
export type SessionIndexRecord = DiscoveredSession & {
  readonly indexedAt: Date;
};

/**
 * Creates in-memory index records until the SQLite implementation lands.
 *
 * @param sessions - Sessions to index.
 * @returns Effect containing index records.
 * @example
 * ```ts
 * import { indexSessions } from './sessionIndex.js';
 *
 * const records = await Effect.runPromise(indexSessions(sessions));
 * ```
 */
export const indexSessions = (
  sessions: ReadonlyArray<DiscoveredSession>,
): Effect.Effect<ReadonlyArray<SessionIndexRecord>> => {
  const indexedAt = new Date();

  return Effect.succeed(
    sessions.map((session) => ({
      ...session,
      indexedAt,
    })),
  );
};
