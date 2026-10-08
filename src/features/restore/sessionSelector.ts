import { Effect, Schema } from 'effect';
import { type ProviderId, ProviderIdSchema } from '../../shared/sessionModel.js';
import { type SessionManifest, SessionManifestSchema } from '../archive/manifestStore.js';

/**
 * How far a selector reaches: `exact` matches id, name, or slug only; `fuzzy` also tries
 * id prefixes and then words found in the name or slug.
 */
export type SelectorMatch = 'exact' | 'fuzzy';

/**
 * Selector text paired with the vault manifests it should resolve against.
 */
export type SessionSelectorRequest = {
  readonly selector: string;
  readonly provider: ProviderId | undefined;
  readonly manifests: ReadonlyArray<SessionManifest>;
  readonly match: SelectorMatch;
};

type ParsedSelector = {
  readonly provider: ProviderId | undefined;
  readonly query: string;
};

/**
 * Typed error raised when a selector matches no session.
 */
export class SessionSelectorNotFoundError extends Schema.TaggedError<SessionSelectorNotFoundError>()(
  'SessionSelectorNotFoundError',
  {
    selector: Schema.String,
  },
) {}

/**
 * Typed error raised when a selector matches more than one session.
 */
export class SessionSelectorAmbiguousError extends Schema.TaggedError<SessionSelectorAmbiguousError>()(
  'SessionSelectorAmbiguousError',
  {
    selector: Schema.String,
    candidates: Schema.Array(SessionManifestSchema),
  },
) {}

/**
 * Union of errors a selector resolution can produce.
 */
export type SessionSelectorError = SessionSelectorNotFoundError | SessionSelectorAmbiguousError;

const isProviderId = Schema.is(ProviderIdSchema);

/**
 * Resolves a human or agent selector to one vault manifest.
 *
 * Exact id, name, or slug matches win. In `fuzzy` mode an id prefix comes next, then
 * sessions whose name or slug contains every word of the selector.
 *
 * @param request - Selector text, optional provider, vault manifests, and match mode.
 * @returns Effect containing the resolved manifest or a typed selector error.
 * @example
 * ```ts
 * import { resolveSessionSelector } from './sessionSelector.js';
 *
 * const manifest = await Effect.runPromise(
 *   resolveSessionSelector({
 *     selector: 'codex:fix-login',
 *     provider: undefined,
 *     manifests,
 *     match: 'fuzzy',
 *   }),
 * );
 * ```
 */
export const resolveSessionSelector = (
  request: SessionSelectorRequest,
): Effect.Effect<SessionManifest, SessionSelectorError> =>
  Effect.gen(function* () {
    const parsed = parseSelector(request.selector);
    const provider = request.provider ?? parsed.provider;
    const candidates = request.manifests.filter(
      (manifest) => provider === undefined || manifest.provider === provider,
    );
    const matches = matchingManifests(parsed.query, candidates, request.match);

    if (matches.length === 0) {
      return yield* Effect.fail(
        new SessionSelectorNotFoundError({
          selector: request.selector,
        }),
      );
    }

    if (matches.length > 1) {
      return yield* Effect.fail(
        new SessionSelectorAmbiguousError({
          selector: request.selector,
          candidates: matches,
        }),
      );
    }

    return matches[0];
  });

const parseSelector = (selector: string): ParsedSelector => {
  const trimmedSelector = selector.trim();
  const separatorIndex = trimmedSelector.indexOf(':');
  const prefix = trimmedSelector.slice(0, separatorIndex).toLowerCase();

  if (separatorIndex === -1 || !isProviderId(prefix)) {
    return {
      provider: undefined,
      query: trimmedSelector.toLowerCase(),
    };
  }

  return {
    provider: prefix,
    query: trimmedSelector
      .slice(separatorIndex + 1)
      .trim()
      .toLowerCase(),
  };
};

const matchingManifests = (
  query: string,
  candidates: ReadonlyArray<SessionManifest>,
  match: SelectorMatch,
): ReadonlyArray<SessionManifest> => {
  if (query.length === 0) {
    return [];
  }

  const exactMatches = candidates.filter((manifest) =>
    [manifest.sessionId, manifest.slug, manifest.title].some(
      (name) => name.toLowerCase() === query,
    ),
  );

  if (exactMatches.length > 0 || match === 'exact') {
    return exactMatches;
  }

  const idPrefixMatches = candidates.filter((manifest) =>
    manifest.sessionId.toLowerCase().startsWith(query),
  );

  if (idPrefixMatches.length > 0) {
    return idPrefixMatches;
  }

  const words = query.split(/[^a-z0-9]+/).filter((word) => word.length > 0);

  return candidates.filter(
    (manifest) =>
      words.length > 0 &&
      words.every(
        (word) => manifest.slug.includes(word) || manifest.title.toLowerCase().includes(word),
      ),
  );
};
