import { isPathPresent } from '@/archive/file-system.js';
import { sumSessionBytes } from '@/byte-savings.js';
import type {
  DiscoveredSession,
  ProviderAdapter,
  ProviderId,
  ProviderMode,
} from '@/session-model.js';

type ProviderInventoryStatus = 'backup-only' | 'missing' | 'ready';

interface ProviderInventorySummary {
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
}

export interface ProviderInventoryReport {
  readonly rows: ReadonlyArray<ProviderInventorySummary>;
}

export interface ProviderInventoryRequest {
  readonly home: string;
  readonly providers: ReadonlyArray<ProviderAdapter>;
  readonly olderThanMs: number;
  readonly now: Date;
}

export async function inspectProviderInventory(
  request: ProviderInventoryRequest,
): Promise<ProviderInventoryReport> {
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
}

interface ProviderRootDiscovery {
  readonly roots: ReadonlyArray<string>;
  readonly existingRoots: ReadonlyArray<string>;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}

interface RootDiscovery {
  readonly root: string;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}

async function discoverProviderRoots(request: {
  readonly home: string;
  readonly provider: ProviderAdapter;
}): Promise<ProviderRootDiscovery> {
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
    existingRoots: existingRoots.map(getRootPath),
    sessions: existingRoots.flatMap(getRootSessions),
  };
}

async function discoverProviderRoot(request: {
  readonly provider: ProviderAdapter;
  readonly root: string;
}): Promise<RootDiscovery | null> {
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
}

interface InventorySummaryRequest {
  readonly cutoffTime: number;
  readonly paths: ReadonlyArray<string>;
  readonly provider: ProviderAdapter;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}

function createUncountedInventorySummary(
  request: InventorySummaryRequest,
  status: ProviderInventoryStatus,
): ProviderInventorySummary {
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
    status,
  };
}

function createInventorySummary(request: InventorySummaryRequest): ProviderInventorySummary {
  const isPathsEmpty = request.paths.length === 0;
  const isSessionsEmpty = request.sessions.length === 0;

  if (isPathsEmpty) {
    return createUncountedInventorySummary(request, isSessionsEmpty ? 'missing' : 'ready');
  }

  if (isSessionsEmpty) {
    return createUncountedInventorySummary(request, 'missing');
  }

  const isProviderModeBackupOnly = request.provider.mode === 'backup-only';

  if (isProviderModeBackupOnly) {
    return createUncountedInventorySummary(request, 'backup-only');
  }

  function isColdSession(session: DiscoveredSession): boolean {
    return session.modifiedAt.getTime() < request.cutoffTime;
  }

  const coldSessions = request.sessions.filter(isColdSession);

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
}

function getRootPath(discovery: RootDiscovery): string {
  return discovery.root;
}

function getRootSessions(discovery: RootDiscovery): ReadonlyArray<DiscoveredSession> {
  return discovery.sessions;
}

function isRootDiscovery(discovery: RootDiscovery | null): discovery is RootDiscovery {
  return discovery != null;
}
