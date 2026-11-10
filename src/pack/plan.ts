import { sumSessionBytes } from '@/byte-savings.js';
import type { DiscoveredSession, ProviderId, ProviderMode } from '@/session-model.js';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;
const MILLISECONDS_PER_WEEK = 7 * MILLISECONDS_PER_DAY;

export const DEFAULT_COLD_AFTER = '7d';

export const DEFAULT_COLD_AFTER_MS = MILLISECONDS_PER_WEEK;

type PackPlanProvider = {
  readonly id: ProviderId;
  readonly label: string;
  readonly mode: ProviderMode;
};

export type PackPlanRequest = {
  readonly now: Date;
  readonly olderThan: string;
  readonly olderThanMs: number;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
  readonly providers: ReadonlyArray<PackPlanProvider>;
};

type PackPlanSummary = {
  readonly provider: ProviderId;
  readonly mode: ProviderMode;
  readonly scannedSessions: number;
  readonly candidateSessions: number;
  readonly beforeBytes: number;
  readonly afterDryRunBytes: number;
  readonly cleanupBytes: number;
  readonly applySupport: 'backup-only' | 'ready';
};

export type PackPlan = {
  readonly rows: ReadonlyArray<PackPlanSummary>;
  readonly thresholdPreviews: ReadonlyArray<PackThresholdPreview>;
};

type PackThresholdPreviewKind = 'broader' | 'max' | 'safer';

export type PackThresholdPreview = {
  readonly kind: PackThresholdPreviewKind;
  readonly olderThan: string;
  readonly candidateSessions: number;
  readonly beforeBytes: number;
};

export type PackThresholdPreviewRequest = {
  readonly now: Date;
  readonly olderThan: string;
  readonly olderThanMs: number;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
};

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

      const isProviderModeBackupOnly = provider.mode === 'backup-only';
      if (isProviderModeBackupOnly) {
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

export const createPackThresholdPreviews = (
  request: PackThresholdPreviewRequest,
): ReadonlyArray<PackThresholdPreview> => {
  const duration = parseDuration(request.olderThan);

  const isDurationZeroOrUnset = duration == null || duration.value === 0;
  if (isDurationZeroOrUnset) {
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
      olderThan: describeDuration(safer),
      olderThanMs: convertDurationToMilliseconds(safer),
      now: request.now,
      sessions: request.sessions,
    }),
    createThresholdPreview({
      kind: 'broader',
      olderThan: describeDuration(broader),
      olderThanMs: convertDurationToMilliseconds(broader),
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

type DurationUnit = 'd' | 'h' | 'w';

type Duration = {
  readonly value: number;
  readonly unit: DurationUnit;
};

export const parseDurationMs = (duration: string): number => {
  const parsed = parseDuration(duration);

  const isParsedMissing = parsed == null;
  if (isParsedMissing) {
    return DEFAULT_COLD_AFTER_MS;
  }

  return convertDurationToMilliseconds(parsed);
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

const parseDuration = (duration: string): Duration | null => {
  const hit = duration.match(/^(\d+)(h|d|w)$/);

  const isHitMissing = hit == null;
  if (isHitMissing) {
    return null;
  }

  return {
    value: Number(hit[1]),
    unit: hit[2] as DurationUnit,
  };
};

const multiplyDuration = (duration: Duration, factor: number): Duration => ({
  value: duration.value * factor,
  unit: duration.unit,
});

const halveDuration = (duration: Duration): Duration => {
  const isDurationInHours = duration.unit === 'h';
  if (isDurationInHours) {
    return {
      value: Math.max(0, Math.floor(duration.value / 2)),
      unit: 'h',
    };
  }

  const isDurationAtMostOneDay = duration.unit === 'd' && duration.value <= 1;
  if (isDurationAtMostOneDay) {
    const halfDayPreviewHours = 12;
    return {
      value: halfDayPreviewHours,
      unit: 'h',
    };
  }

  const isDurationAtMostOneWeek = duration.unit === 'w' && duration.value <= 1;
  if (isDurationAtMostOneWeek) {
    const weekPreviewDays = 3;
    return {
      value: weekPreviewDays,
      unit: 'd',
    };
  }

  return {
    value: Math.floor(duration.value / 2),
    unit: duration.unit,
  };
};

const convertDurationToMilliseconds = (duration: Duration): number => {
  const isDurationInHours = duration.unit === 'h';
  if (isDurationInHours) {
    return duration.value * MILLISECONDS_PER_HOUR;
  }

  const isDurationUnitW = duration.unit === 'w';
  if (isDurationUnitW) {
    return duration.value * MILLISECONDS_PER_WEEK;
  }

  return duration.value * MILLISECONDS_PER_DAY;
};

const describeDuration = (duration: Duration): string => `${duration.value}${duration.unit}`;
