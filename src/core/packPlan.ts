import type { DiscoveredSession, ProviderId, ProviderMode } from './sessionStore.js';

export type PackPlanProvider = {
  readonly id: ProviderId;
  readonly label: string;
  readonly mode: ProviderMode;
};

export type PackPlanRequest = {
  readonly now: Date;
  readonly olderThanMs: number;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
  readonly providers: ReadonlyArray<PackPlanProvider>;
};

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

export type PackPlan = {
  readonly rows: ReadonlyArray<PackPlanRow>;
};

/**
 * Creates a non-destructive pack plan for cold sessions.
 *
 * @param request - Providers, sessions, and cold threshold.
 * @returns Dry-run pack plan grouped by provider.
 */
export const createPackPlan = (request: PackPlanRequest): PackPlan => {
  const cutoffTime = request.now.getTime() - request.olderThanMs;

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
  };
};

const sumSessionBytes = (sessions: ReadonlyArray<DiscoveredSession>): number =>
  sessions.reduce((totalBytes, session) => totalBytes + session.sizeBytes, 0);
