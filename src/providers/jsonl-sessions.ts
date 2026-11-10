import type { DiscoveredSession, ProviderId, SessionStore } from '@/session-model.js';
import {
  collectJsonlSessions,
  readSessionIdFromPath,
  readSessionTitle,
  slugifyTitle,
} from './session-discovery.js';

export type JsonlProviderDiscoverySettings = {
  readonly provider: ProviderId;
  readonly store: SessionStore;
  readonly excludePathParts: ReadonlyArray<string>;
};

export const discoverJsonlProviderSessions = async (
  settings: JsonlProviderDiscoverySettings,
): Promise<ReadonlyArray<DiscoveredSession>> => {
  const files = await collectJsonlSessions(settings.store.path, {
    excludePathParts: settings.excludePathParts,
  });
  const sessions: DiscoveredSession[] = [];

  for (const file of files) {
    const title = await readSessionTitle(file.path);
    sessions.push(
      readSessionFromFile({
        provider: settings.provider,
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
