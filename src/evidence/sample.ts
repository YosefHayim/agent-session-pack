export type SizeBoundSession = {
  readonly modifiedAt: Date;
  readonly sizeBytes: number;
};

export const selectNewestSessionWithinSize = <Session extends SizeBoundSession>(
  sessions: ReadonlyArray<Session>,
  maxSizeBytes: number,
): Session | undefined => {
  const eligibleSessions = sessions.filter((session) => session.sizeBytes <= maxSizeBytes);

  const hasEligibleSessions = eligibleSessions.length > 0;
  if (hasEligibleSessions) {
    return selectNewestSession(eligibleSessions);
  }

  return selectSmallestSession(sessions);
};

const selectNewestSession = <Session extends { readonly modifiedAt: Date }>(
  sessions: ReadonlyArray<Session>,
): Session | undefined => {
  const [firstSession, ...remainingSessions] = sessions;

  const isFirstSessionMissing = firstSession == null;
  if (isFirstSessionMissing) {
    return undefined;
  }

  return remainingSessions.reduce((selected, session) => {
    const isModifiedLater = session.modifiedAt > selected.modifiedAt;
    if (isModifiedLater) {
      return session;
    }

    return selected;
  }, firstSession);
};

const selectSmallestSession = <Session extends { readonly sizeBytes: number }>(
  sessions: ReadonlyArray<Session>,
): Session | undefined => {
  const [firstSession, ...remainingSessions] = sessions;

  const isFirstSessionMissing = firstSession == null;
  if (isFirstSessionMissing) {
    return undefined;
  }

  return remainingSessions.reduce((selected, session) => {
    const isSmallerThanSelected = session.sizeBytes < selected.sizeBytes;
    if (isSmallerThanSelected) {
      return session;
    }

    return selected;
  }, firstSession);
};
