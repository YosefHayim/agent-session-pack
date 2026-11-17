export interface SizeBoundSession {
  readonly modifiedAt: Date;
  readonly sizeBytes: number;
}

export function selectNewestSessionWithinSize<Session extends SizeBoundSession>(
  sessions: ReadonlyArray<Session>,
  maxSizeBytes: number,
): Session | undefined {
  function isWithinMaxSize(session: Session): boolean {
    return session.sizeBytes <= maxSizeBytes;
  }

  const eligibleSessions = sessions.filter(isWithinMaxSize);

  const hasEligibleSessions = eligibleSessions.length > 0;
  if (hasEligibleSessions) {
    return selectNewestSession(eligibleSessions) ?? undefined;
  }

  return selectSmallestSession(sessions) ?? undefined;
}

function selectNewestSession<Session extends { readonly modifiedAt: Date }>(
  sessions: ReadonlyArray<Session>,
): Session | null {
  const [firstSession, ...remainingSessions] = sessions;

  const isFirstSessionMissing = firstSession == null;
  if (isFirstSessionMissing) {
    return null;
  }

  function pickLaterModified(selected: Session, session: Session): Session {
    const isModifiedLater = session.modifiedAt > selected.modifiedAt;
    if (isModifiedLater) {
      return session;
    }

    return selected;
  }

  return remainingSessions.reduce(pickLaterModified, firstSession);
}

function selectSmallestSession<Session extends { readonly sizeBytes: number }>(
  sessions: ReadonlyArray<Session>,
): Session | null {
  const [firstSession, ...remainingSessions] = sessions;

  const isFirstSessionMissing = firstSession == null;
  if (isFirstSessionMissing) {
    return null;
  }

  function pickSmaller(selected: Session, session: Session): Session {
    const isSmallerThanSelected = session.sizeBytes < selected.sizeBytes;
    if (isSmallerThanSelected) {
      return session;
    }

    return selected;
  }

  return remainingSessions.reduce(pickSmaller, firstSession);
}
