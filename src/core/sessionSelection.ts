export type SizeBoundSession = {
  readonly modifiedAt: Date;
  readonly sizeBytes: number;
};

/**
 * Selects the newest session that is small enough for local evidence runs.
 *
 * @param sessions - Candidate sessions.
 * @param maxSizeBytes - Maximum preferred source size.
 * @returns Newest eligible session, or the smallest session when all are oversized.
 */
export const selectNewestSessionWithinSize = <Session extends SizeBoundSession>(
  sessions: ReadonlyArray<Session>,
  maxSizeBytes: number,
): Session | undefined => {
  const eligibleSessions = sessions.filter((session) => session.sizeBytes <= maxSizeBytes);

  if (eligibleSessions.length > 0) {
    return selectNewestSession(eligibleSessions);
  }

  return selectSmallestSession(sessions);
};

/**
 * Selects the newest session by modification time.
 *
 * @param sessions - Candidate sessions.
 * @returns Newest session when one exists.
 */
export const selectNewestSession = <Session extends { readonly modifiedAt: Date }>(
  sessions: ReadonlyArray<Session>,
): Session | undefined => {
  const [firstSession, ...remainingSessions] = sessions;

  if (firstSession === undefined) {
    return undefined;
  }

  return remainingSessions.reduce((selected, session) => {
    if (session.modifiedAt > selected.modifiedAt) {
      return session;
    }

    return selected;
  }, firstSession);
};

const selectSmallestSession = <Session extends { readonly sizeBytes: number }>(
  sessions: ReadonlyArray<Session>,
): Session | undefined => {
  const [firstSession, ...remainingSessions] = sessions;

  if (firstSession === undefined) {
    return undefined;
  }

  return remainingSessions.reduce((selected, session) => {
    if (session.sizeBytes < selected.sizeBytes) {
      return session;
    }

    return selected;
  }, firstSession);
};
