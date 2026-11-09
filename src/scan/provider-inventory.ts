import { sumSessionBytes } from '@/byte-savings.js';
import type {
  DiscoveredSession,
  ProviderAdapter,
  ProviderId,
  ProviderMode,
} from '@/session-model.js';
import { isPathPresent } from './stores.js';

/**
 * Readiness status reported for a provider store during inventory.
 */
type ProviderInventoryStatus = 'backup-only' | 'missing' | 'ready';

/**
 * Read-only inventory row summarizing one provider's sessions and bytes.
 */
type ProviderInventoryRow = {
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

/**
 * Aggregated inventory report across all inspected providers.
 */
export type ProviderInventoryReport = {
  readonly rows: ReadonlyArray<ProviderInventoryRow>;
};

/**
 * Inputs required to inspect provider stores for inventory.
 */
export type ProviderInventoryRequest = {
  readonly home: string;
  readonly providers: ReadonlyArray<ProviderAdapter>;
  readonly olderThanMs: number;
  readonly now: Date;
};

/**
 * Inspects provider stores for human-facing setup and pack decisions.
 */
export const inspectProviderInventory = async (
  request: ProviderInventoryRequest,
): Promise<ProviderInventoryReport> => {
  const inventoryRows: ProviderInventoryRow[] = [];
  const cutoffTime = request.now.getTime() - request.olderThanMs;

  for (const provider of request.providers) {
    const discovered = await discoverProviderRoots({
      home: request.home,
      provider,
    });

    const hasExistingRoots = discovered.existingRoots.length > 0;
    inventoryRows.push(
      createInventoryRow({
        cutoffTime,
        paths: hasExistingRoots ? discovered.existingRoots : discovered.roots,
        provider,
        sessions: discovered.sessions,
      }),
    );
  }

  return { rows: inventoryRows };
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
  const discoveredRoots: Array<RootDiscovery | undefined> = [];

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
}): Promise<RootDiscovery | undefined> => {
  const isNotRootPresent = !(await isPathPresent(request.root));

  if (isNotRootPresent) {
    return undefined;
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

const createInventoryRow = (request: {
  readonly cutoffTime: number;
  readonly paths: ReadonlyArray<string>;
  readonly provider: ProviderAdapter;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
}): ProviderInventoryRow => {
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

const isRootDiscovery = (discovery: RootDiscovery | undefined): discovery is RootDiscovery =>
  discovery != null;
