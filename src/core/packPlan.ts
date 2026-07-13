import type { DiscoveredSession, ProviderId, ProviderMode } from './sessionStore.js';

/**
 * Provider identity and mode considered when building a pack plan.
 */
export type PackPlanProvider = {
  readonly id: ProviderId;
  readonly label: string;
  readonly mode: ProviderMode;
};

/**
 * Inputs describing sessions, providers, and the cold threshold for a plan.
 */
export type PackPlanRequest = {
  readonly now: Date;
  readonly olderThan: string;
  readonly olderThanMs: number;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
  readonly providers: ReadonlyArray<PackPlanProvider>;
};

/**
 * Per-provider row summarizing scanned, candidate, and byte totals.
 */
export type PackPlanRow = {
  readonly provider: ProviderId;
  readonly mode: ProviderMode;
  readonly scannedSessions: number;
  readonly candidateSessions: number;
  readonly beforeBytes: number;
  readonly afterDryRunBytes: number;
  readonly cleanupBytes: number;
  readonly applySupport: 'backup-only' | 'ready';
};

/**
 * Complete dry-run pack plan with provider rows and threshold previews.
 */
export type PackPlan = {
  readonly rows: ReadonlyArray<PackPlanRow>;
  readonly thresholdPreviews: ReadonlyArray<PackThresholdPreview>;
};

/**
 * Kind of alternative threshold preview shown as a curiosity tip.
 */
export type PackThresholdPreviewKind = 'broader' | 'max' | 'safer';

/**
 * Aggregate candidate count and byte total for one alternative threshold.
 */
export type PackThresholdPreview = {
  readonly kind: PackThresholdPreviewKind;
  readonly olderThan: string;
  readonly candidateSessions: number;
  readonly beforeBytes: number;
};

/**
 * Sessions and current threshold context used to build curiosity previews.
 */
export type PackThresholdPreviewRequest = {
  readonly now: Date;
  readonly olderThan: string;
  readonly olderThanMs: number;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
};

/**
 * Creates a non-destructive pack plan for cold sessions.
 *
 * @param request - Providers, sessions, and cold threshold.
 * @returns Dry-run pack plan grouped by provider.
 * @example
 * ```ts
 * import { createPackPlan } from './packPlan.js';
 *
 * const plan = createPackPlan({
 *   now: new Date(),
 *   olderThan: '168h',
 *   olderThanMs: 168 * 60 * 60 * 1000,
 *   sessions,
 *   providers,
 * });
 * ```
 */
export const createPackPlan = (request: PackPlanRequest): PackPlan => {
  const cutoffTime = request.now.getTime() - request.olderThanMs;
  const packableProviderIds = request.providers
    .filter((provider) => provider.mode === 'archive')
    .map((provider) => provider.id);
  const packableSessions = request.sessions.filter((session) =>
    packableProviderIds.includes(session.provider),
  );

  return {
    rows: request.providers.map((provider) => {
      const providerSessions = request.sessions.filter(
        (session) => session.provider === provider.id,
      );

      if (provider.mode === 'backup-only') {
        return {
          provider: provider.id,
          mode: provider.mode,
          scannedSessions: providerSessions.length,
          candidateSessions: 0,
          beforeBytes: 0,
          afterDryRunBytes: 0,
          cleanupBytes: 0,
          applySupport: 'backup-only',
        };
      }

      const candidates = providerSessions.filter(
        (session) => session.modifiedAt.getTime() < cutoffTime,
      );
      const beforeBytes = sumSessionBytes(candidates);

      return {
        provider: provider.id,
        mode: provider.mode,
        scannedSessions: providerSessions.length,
        candidateSessions: candidates.length,
        beforeBytes,
        afterDryRunBytes: beforeBytes,
        cleanupBytes: 0,
        applySupport: 'ready',
      };
    }),
    thresholdPreviews: createPackThresholdPreviews({
      now: request.now,
      olderThan: request.olderThan,
      olderThanMs: request.olderThanMs,
      sessions: packableSessions,
    }),
  };
};

/**
 * Creates aggregate threshold previews for human curiosity tips.
 *
 * @param request - Sessions and current threshold context.
 * @returns Safer, broader, and max preview summaries.
 * @example
 * ```ts
 * import { createPackThresholdPreviews } from './packPlan.js';
 *
 * const previews = createPackThresholdPreviews({
 *   now: new Date(),
 *   olderThan: '168h',
 *   olderThanMs: 168 * 60 * 60 * 1000,
 *   sessions,
 * });
 * ```
 */
export const createPackThresholdPreviews = (
  request: PackThresholdPreviewRequest,
): ReadonlyArray<PackThresholdPreview> => {
  const duration = parseDuration(request.olderThan);

  if (duration === undefined || duration.value === 0) {
    return [
      createThresholdPreview({
        kind: 'max',
        olderThan: '0h',
        olderThanMs: 0,
        now: request.now,
        sessions: request.sessions,
      }),
    ];
  }

  const safer = multiplyDuration(duration, 2);
  const broader = halveDuration(duration);

  return [
    createThresholdPreview({
      kind: 'safer',
      olderThan: formatDuration(safer),
      olderThanMs: durationMs(safer),
      now: request.now,
      sessions: request.sessions,
    }),
    createThresholdPreview({
      kind: 'broader',
      olderThan: formatDuration(broader),
      olderThanMs: durationMs(broader),
      now: request.now,
      sessions: request.sessions,
    }),
    createThresholdPreview({
      kind: 'max',
      olderThan: '0h',
      olderThanMs: 0,
      now: request.now,
      sessions: request.sessions,
    }),
  ];
};

const sumSessionBytes = (sessions: ReadonlyArray<DiscoveredSession>): number =>
  sessions.reduce((totalBytes, session) => totalBytes + session.sizeBytes, 0);

type DurationUnit = 'd' | 'h' | 'w';

type Duration = {
  readonly value: number;
  readonly unit: DurationUnit;
};

const createThresholdPreview = (request: {
  readonly kind: PackThresholdPreviewKind;
  readonly olderThan: string;
  readonly olderThanMs: number;
  readonly now: Date;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}): PackThresholdPreview => {
  const cutoffTime = request.now.getTime() - request.olderThanMs;
  const candidates = request.sessions.filter(
    (session) => session.modifiedAt.getTime() < cutoffTime,
  );

  return {
    kind: request.kind,
    olderThan: request.olderThan,
    candidateSessions: candidates.length,
    beforeBytes: sumSessionBytes(candidates),
  };
};

const parseDuration = (duration: string): Duration | undefined => {
  const match = duration.match(/^(\d+)(h|d|w)$/);

  if (match === null) {
    return undefined;
  }

  return {
    value: Number(match[1]),
    unit: match[2] as DurationUnit,
  };
};

const multiplyDuration = (duration: Duration, factor: number): Duration => ({
  value: duration.value * factor,
  unit: duration.unit,
});

const halveDuration = (duration: Duration): Duration => {
  if (duration.unit === 'h') {
    return {
      value: Math.max(0, Math.floor(duration.value / 2)),
      unit: 'h',
    };
  }

  if (duration.unit === 'd' && duration.value <= 1) {
    return {
      value: 12,
      unit: 'h',
    };
  }

  if (duration.unit === 'w' && duration.value <= 1) {
    return {
      value: 3,
      unit: 'd',
    };
  }

  return {
    value: Math.floor(duration.value / 2),
    unit: duration.unit,
  };
};

const durationMs = (duration: Duration): number => {
  if (duration.unit === 'h') {
    return duration.value * 60 * 60 * 1000;
  }

  if (duration.unit === 'w') {
    return duration.value * 7 * 24 * 60 * 60 * 1000;
  }

  return duration.value * 24 * 60 * 60 * 1000;
};

const formatDuration = (duration: Duration): string => `${duration.value}${duration.unit}`;
