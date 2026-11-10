import { isPathPresent } from '@/archive/file-system.js';
import { sumSessionBytes } from '@/byte-savings.js';
import type {
  DiscoveredSession,
  ProviderAdapter,
  ProviderId,
  ProviderMode,
} from '@/session-model.js';

type ProviderInventoryStatus = 'backup-only' | 'missing' | 'ready';

type ProviderInventorySummary = {
  readonly provider: ProviderId;
  readonly label: string;
  readonly mode: ProviderMode;
  readonly sessions: number;
  readonly coldSessions: number;
  readonly guardedRecentSessions: number;
  readonly totalBytes: number;
  readonly candidateBytes: number;
  readonly paths: ReadonlyArray<string>;
  readonly status: ProviderInventoryStatus;
};

export type ProviderInventoryReport = {
  readonly rows: ReadonlyArray<ProviderInventorySummary>;
};

export type ProviderInventoryRequest = {
  readonly home: string;
  readonly providers: ReadonlyArray<ProviderAdapter>;
  readonly olderThanMs: number;
  readonly now: Date;
};

export const inspectProviderInventory = async (
  request: ProviderInventoryRequest,
): Promise<ProviderInventoryReport> => {
  const inventorySummaries: ProviderInventorySummary[] = [];
  const cutoffTime = request.now.getTime() - request.olderThanMs;

  for (const provider of request.providers) {
    const discovered = await discoverProviderRoots({
      home: request.home,
      provider,
    });

    const hasExistingRoots = discovered.existingRoots.length > 0;
    inventorySummaries.push(
      createInventorySummary({
        cutoffTime,
        paths: hasExistingRoots ? discovered.existingRoots : discovered.roots,
        provider,
        sessions: discovered.sessions,
      }),
    );
  }

  return { rows: inventorySummaries };
};

type ProviderRootDiscovery = {
  readonly roots: ReadonlyArray<string>;
  readonly existingRoots: ReadonlyArray<string>;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
};

type RootDiscovery = {
  readonly root: string;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
};

const discoverProviderRoots = async (request: {
  readonly home: string;
  readonly provider: ProviderAdapter;
}): Promise<ProviderRootDiscovery> => {
  const roots = request.provider.defaultRoots(request.home);
  const discoveredRoots: Array<RootDiscovery | null> = [];

  for (const root of roots) {
    const rootDiscovery = await discoverProviderRoot({
      provider: request.provider,
      root,
    });
    discoveredRoots.push(rootDiscovery);
  }

  const existingRoots = discoveredRoots.filter(isRootDiscovery);

  return {
    roots,
    existingRoots: existingRoots.map((root) => root.root),
    sessions: existingRoots.flatMap((root) => root.sessions),
  };
};

const discoverProviderRoot = async (request: {
  readonly provider: ProviderAdapter;
  readonly root: string;
}): Promise<RootDiscovery | null> => {
  const isRootPresent = await isPathPresent(request.root);
  const isRootAbsent = !isRootPresent;

  if (isRootAbsent) {
    return null;
  }

  const sessions = await request.provider.discover({
    provider: request.provider.id,
    path: request.root,
  });

  return {
    root: request.root,
    sessions,
  };
};

const createInventorySummary = (request: {
  readonly cutoffTime: number;
  readonly paths: ReadonlyArray<string>;
  readonly provider: ProviderAdapter;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}): ProviderInventorySummary => {
  const isNothingToScan = request.paths.length === 0 || request.sessions.length === 0;
  if (isNothingToScan) {
    const isRequestSessionsEmpty = request.sessions.length === 0;
    return {
      provider: request.provider.id,
      label: request.provider.label,
      mode: request.provider.mode,
      sessions: request.sessions.length,
      coldSessions: 0,
      guardedRecentSessions: 0,
      totalBytes: sumSessionBytes(request.sessions),
      candidateBytes: 0,
      paths: request.paths,
      status: isRequestSessionsEmpty ? 'missing' : 'ready',
    };
  }

  const isProviderModeBackupOnly = request.provider.mode === 'backup-only';
  if (isProviderModeBackupOnly) {
    return {
      provider: request.provider.id,
      label: request.provider.label,
      mode: request.provider.mode,
      sessions: request.sessions.length,
      coldSessions: 0,
      guardedRecentSessions: 0,
      totalBytes: sumSessionBytes(request.sessions),
      candidateBytes: 0,
      paths: request.paths,
      status: 'backup-only',
    };
  }

  const coldSessions = request.sessions.filter(
    (session) => session.modifiedAt.getTime() < request.cutoffTime,
  );

  return {
    provider: request.provider.id,
    label: request.provider.label,
    mode: request.provider.mode,
    sessions: request.sessions.length,
    coldSessions: coldSessions.length,
    guardedRecentSessions: request.sessions.length - coldSessions.length,
    totalBytes: sumSessionBytes(request.sessions),
    candidateBytes: sumSessionBytes(coldSessions),
    paths: request.paths,
    status: 'ready',
  };
};

const isRootDiscovery = (discovery: RootDiscovery | null): discovery is RootDiscovery =>
  discovery != null;
