import { sumSessionBytes } from '@/byte-savings.js';
import type { DiscoveredSession, ProviderId, ProviderMode } from '@/session-model.js';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;
const MILLISECONDS_PER_WEEK = 7 * MILLISECONDS_PER_DAY;

const HOUR_UNIT = 'h';
const DAY_UNIT = 'd';
const WEEK_UNIT = 'w';
const BACKUP_ONLY_MODE = 'backup-only';
const MAX_PREVIEW_KIND = 'max';
const MAX_PREVIEW_OLDER_THAN = '0h';
const SAFER_DURATION_FACTOR = 2;
const BROADER_DURATION_DIVISOR = 2;

export const DEFAULT_COLD_AFTER = '7d';

export const DEFAULT_COLD_AFTER_MS = MILLISECONDS_PER_WEEK;

interface PackPlanProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly mode: ProviderMode;
}

export interface PackPlanRequest {
  readonly now: Date;
  readonly olderThan: string;
  readonly olderThanMs: number;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
  readonly providers: ReadonlyArray<PackPlanProvider>;
}

interface PackPlanSummary {
  readonly provider: ProviderId;
  readonly mode: ProviderMode;
  readonly scannedSessions: number;
  readonly candidateSessions: number;
  readonly beforeBytes: number;
  readonly afterDryRunBytes: number;
  readonly cleanupBytes: number;
  readonly applySupport: typeof BACKUP_ONLY_MODE | 'ready';
}

export interface PackPlan {
  readonly rows: ReadonlyArray<PackPlanSummary>;
  readonly thresholdPreviews: ReadonlyArray<PackThresholdPreview>;
}

type PackThresholdPreviewKind = 'broader' | 'max' | 'safer';

export interface PackThresholdPreview {
  readonly kind: PackThresholdPreviewKind;
  readonly olderThan: string;
  readonly candidateSessions: number;
  readonly beforeBytes: number;
}

export interface PackThresholdPreviewRequest {
  readonly now: Date;
  readonly olderThan: string;
  readonly olderThanMs: number;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}

export function createPackPlan(request: PackPlanRequest): PackPlan {
  const cutoffTime = request.now.getTime() - request.olderThanMs;

  function isArchiveProvider(provider: PackPlanProvider): boolean {
    return provider.mode === 'archive';
  }

  function readProviderId(provider: PackPlanProvider): ProviderId {
    return provider.id;
  }

  const packableProviderIds = request.providers.filter(isArchiveProvider).map(readProviderId);

  function isPackableSession(session: DiscoveredSession): boolean {
    return packableProviderIds.includes(session.provider);
  }

  function isColdSession(session: DiscoveredSession): boolean {
    return session.modifiedAt.getTime() < cutoffTime;
  }

  function createProviderRow(provider: PackPlanProvider): PackPlanSummary {
    function isProviderSession(session: DiscoveredSession): boolean {
      return session.provider === provider.id;
    }

    const providerSessions = request.sessions.filter(isProviderSession);

    const isProviderModeBackupOnly = provider.mode === BACKUP_ONLY_MODE;
    if (isProviderModeBackupOnly) {
      return {
        provider: provider.id,
        mode: provider.mode,
        scannedSessions: providerSessions.length,
        candidateSessions: 0,
        beforeBytes: 0,
        afterDryRunBytes: 0,
        cleanupBytes: 0,
        applySupport: BACKUP_ONLY_MODE,
      };
    }

    const candidates = providerSessions.filter(isColdSession);
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
  }

  const packableSessions = request.sessions.filter(isPackableSession);

  return {
    rows: request.providers.map(createProviderRow),
    thresholdPreviews: createPackThresholdPreviews({
      now: request.now,
      olderThan: request.olderThan,
      olderThanMs: request.olderThanMs,
      sessions: packableSessions,
    }),
  };
}

export function createPackThresholdPreviews(
  request: PackThresholdPreviewRequest,
): ReadonlyArray<PackThresholdPreview> {
  const duration = parseDuration(request.olderThan);

  const maxPreview = createThresholdPreview({
    kind: MAX_PREVIEW_KIND,
    olderThan: MAX_PREVIEW_OLDER_THAN,
    olderThanMs: 0,
    now: request.now,
    sessions: request.sessions,
  });

  const isDurationUnset = duration == null;
  if (isDurationUnset) {
    return [maxPreview];
  }

  const isDurationZero = duration.value === 0;
  if (isDurationZero) {
    return [maxPreview];
  }

  const safer = multiplyDuration(duration, SAFER_DURATION_FACTOR);
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
    maxPreview,
  ];
}

type DurationUnit = typeof DAY_UNIT | typeof HOUR_UNIT | typeof WEEK_UNIT;

interface Duration {
  readonly value: number;
  readonly unit: DurationUnit;
}

export function parseDurationMs(duration: string): number {
  const parsed = parseDuration(duration);

  const isParsedMissing = parsed == null;
  if (isParsedMissing) {
    return DEFAULT_COLD_AFTER_MS;
  }

  return convertDurationToMilliseconds(parsed);
}

function createThresholdPreview(request: {
  readonly kind: PackThresholdPreviewKind;
  readonly olderThan: string;
  readonly olderThanMs: number;
  readonly now: Date;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}): PackThresholdPreview {
  const cutoffTime = request.now.getTime() - request.olderThanMs;

  function isColdSession(session: DiscoveredSession): boolean {
    return session.modifiedAt.getTime() < cutoffTime;
  }

  const candidates = request.sessions.filter(isColdSession);

  return {
    kind: request.kind,
    olderThan: request.olderThan,
    candidateSessions: candidates.length,
    beforeBytes: sumSessionBytes(candidates),
  };
}

function parseDuration(duration: string): Duration | null {
  // Catches a whole number followed by one unit letter, such as 12h, 7d or 2w.
  const durationPattern = /^(\d+)(h|d|w)$/;
  const durationParts = duration.match(durationPattern);

  const isDurationUnreadable = durationParts == null;
  if (isDurationUnreadable) {
    return null;
  }

  const knownUnits: ReadonlyArray<DurationUnit> = [HOUR_UNIT, DAY_UNIT, WEEK_UNIT];

  function isMatchingUnit(knownUnit: DurationUnit): boolean {
    return knownUnit === durationParts?.[2];
  }

  const unit = knownUnits.find(isMatchingUnit);

  const isUnitUnknown = unit == null;
  if (isUnitUnknown) {
    return null;
  }

  return {
    value: Number(durationParts[1]),
    unit,
  };
}

function multiplyDuration(duration: Duration, factor: number): Duration {
  return {
    value: duration.value * factor,
    unit: duration.unit,
  };
}

function halveDuration(duration: Duration): Duration {
  const isDurationInHours = duration.unit === HOUR_UNIT;
  if (isDurationInHours) {
    return {
      value: Math.max(0, Math.floor(duration.value / BROADER_DURATION_DIVISOR)),
      unit: HOUR_UNIT,
    };
  }

  const isDurationInDays = duration.unit === DAY_UNIT;
  const isDurationAtMostOneDay = isDurationInDays && duration.value <= 1;
  if (isDurationAtMostOneDay) {
    const halfDayPreviewHours = 12;
    return {
      value: halfDayPreviewHours,
      unit: HOUR_UNIT,
    };
  }

  const isDurationInWeeks = duration.unit === WEEK_UNIT;
  const isDurationAtMostOneWeek = isDurationInWeeks && duration.value <= 1;
  if (isDurationAtMostOneWeek) {
    const weekPreviewDays = 3;
    return {
      value: weekPreviewDays,
      unit: DAY_UNIT,
    };
  }

  return {
    value: Math.floor(duration.value / BROADER_DURATION_DIVISOR),
    unit: duration.unit,
  };
}

function convertDurationToMilliseconds(duration: Duration): number {
  const isDurationInHours = duration.unit === HOUR_UNIT;
  if (isDurationInHours) {
    return duration.value * MILLISECONDS_PER_HOUR;
  }

  const isDurationUnitW = duration.unit === WEEK_UNIT;
  if (isDurationUnitW) {
    return duration.value * MILLISECONDS_PER_WEEK;
  }

  return duration.value * MILLISECONDS_PER_DAY;
}

function describeDuration(duration: Duration): string {
  return `${duration.value}${duration.unit}`;
}
