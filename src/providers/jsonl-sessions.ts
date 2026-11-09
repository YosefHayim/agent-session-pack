import type { DiscoveredSession, ProviderId, SessionStore } from '@/session-model.js';
import {
  collectJsonlSessions,
  readSessionIdFromPath,
  readSessionTitle,
  slugifyTitle,
} from './session-discovery.js';

/**
 * Options for discovering JSONL-backed provider sessions.
 */
export type JsonlProviderDiscoveryOptions = {
  readonly provider: ProviderId;
  readonly store: SessionStore;
  readonly excludePathParts: ReadonlyArray<string>;
};

/**
 * Discovers JSONL-backed provider sessions, reading one title at a time.
 */
export const discoverJsonlProviderSessions = async (
  options: JsonlProviderDiscoveryOptions,
): Promise<ReadonlyArray<DiscoveredSession>> => {
  const files = await collectJsonlSessions(options.store.path, {
    excludePathParts: options.excludePathParts,
  });
  const sessions: DiscoveredSession[] = [];

  for (const file of files) {
    const title = await readSessionTitle(file.path);
    sessions.push(
      readSessionFromFile({
        provider: options.provider,
        path: file.path,
        title,
        sizeBytes: file.sizeBytes,
        modifiedAt: file.modifiedAt,
      }),
    );
  }

  return sessions;
};

const readSessionFromFile = (file: {
  readonly provider: ProviderId;
  readonly path: string;
  readonly title: string;
  readonly sizeBytes: number;
  readonly modifiedAt: Date;
}): DiscoveredSession => ({
  id: readSessionIdFromPath(file.path),
  provider: file.provider,
  title: file.title,
  slug: slugifyTitle(file.title),
  originalPath: file.path,
  modifiedAt: file.modifiedAt,
  sizeBytes: file.sizeBytes,
  sourceKind: 'file',
  status: 'live',
});
