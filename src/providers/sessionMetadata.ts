import { Effect } from 'effect';
import {
  collectJsonlSessions,
  type DiscoveredSession,
  type ProviderAdapter,
  type ProviderDiscoveryError,
  type ProviderId,
  readSessionTitle,
  type SessionStore,
  sessionIdFromPath,
  slugifyTitle,
} from '../core/index.js';

export type JsonlProviderDiscoveryOptions = {
  readonly provider: ProviderId;
  readonly store: SessionStore;
  readonly excludePathParts: ReadonlyArray<string>;
};

/**
 * Discovers JSONL-backed provider sessions.
 *
 * @param options - Provider id, store, and excluded path parts.
 * @returns Effect containing discovered sessions.
 */
export const discoverJsonlProviderSessions = (
  options: JsonlProviderDiscoveryOptions,
): Effect.Effect<ReadonlyArray<DiscoveredSession>, ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const files = yield* collectJsonlSessions(options.store.path, {
      excludePathParts: options.excludePathParts,
    });
    const sessions = yield* Effect.all(
      files.map((file) =>
        Effect.map(readSessionTitle(file.path), (title) =>
          sessionFromFile({
            provider: options.provider,
            path: file.path,
            title,
            sizeBytes: file.sizeBytes,
            modifiedAt: file.modifiedAt,
          }),
        ),
      ),
    );

    return sessions;
  });

/**
 * Builds a provider adapter for JSONL-backed stores.
 *
 * @param adapter - Provider adapter metadata and store behavior.
 * @returns Provider adapter.
 */
export const createJsonlProviderAdapter = (adapter: ProviderAdapter): ProviderAdapter => adapter;

const sessionFromFile = (file: {
  readonly provider: ProviderId;
  readonly path: string;
  readonly title: string;
  readonly sizeBytes: number;
  readonly modifiedAt: Date;
}): DiscoveredSession => ({
  id: sessionIdFromPath(file.path),
  provider: file.provider,
  title: file.title,
  slug: slugifyTitle(file.title),
  originalPath: file.path,
  modifiedAt: file.modifiedAt,
  sizeBytes: file.sizeBytes,
  status: 'live',
});
