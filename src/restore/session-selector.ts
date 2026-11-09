import type { SessionManifest } from '@/archive/manifest-store.js';
import { type ProviderId, ProviderIdSchema } from '@/session-model.js';

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

/**
 * Outcome of resolving a selector: one session, no session, or several candidates.
 */
export type SessionSelection =
  | { readonly status: 'found'; readonly manifest: SessionManifest }
  | { readonly status: 'not-found' }
  | { readonly status: 'ambiguous'; readonly candidates: ReadonlyArray<SessionManifest> };

type ParsedSelector = {
  readonly provider: ProviderId | undefined;
  readonly query: string;
};

/**
 * Resolves a human or agent selector to one vault manifest.
 *
 * Exact id, name, or slug matches win. In `fuzzy` mode an id prefix comes next, then
 * sessions whose name or slug contains every word of the selector.
 */
export const findSessionSelector = (request: SessionSelectorRequest): SessionSelection => {
  const parsed = parseSelector(request.selector);
  const provider = request.provider ?? parsed.provider;
  const candidates = request.manifests.filter(
    (manifest) => provider === undefined || manifest.provider === provider,
  );
  const matches = listMatchingManifests(parsed.query, candidates, request.match);
  const isNoMatch = matches.length === 0;
  const isAmbiguous = matches.length > 1;

  if (isNoMatch) {
    return { status: 'not-found' };
  }

  if (isAmbiguous) {
    return { status: 'ambiguous', candidates: matches };
  }

  return { status: 'found', manifest: matches[0] };
};

const isProviderId = (value: string): value is ProviderId =>
  ProviderIdSchema.safeParse(value).success;

const parseSelector = (selector: string): ParsedSelector => {
  const trimmedSelector = selector.trim();
  const separatorIndex = trimmedSelector.indexOf(':');
  const prefix = trimmedSelector.slice(0, separatorIndex).toLowerCase();

  const isNotPrefixProvider = separatorIndex === -1 || !isProviderId(prefix);

  if (isNotPrefixProvider) {
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

const listMatchingManifests = (
  query: string,
  candidates: ReadonlyArray<SessionManifest>,
  match: SelectorMatch,
): ReadonlyArray<SessionManifest> => {
  const isQueryEmpty = query.length === 0;
  if (isQueryEmpty) {
    return [];
  }

  const exactMatches = candidates.filter((manifest) =>
    [manifest.sessionId, manifest.slug, manifest.title].some(
      (name) => name.toLowerCase() === query,
    ),
  );

  const hasExactMatch = exactMatches.length > 0 || match === 'exact';
  if (hasExactMatch) {
    return exactMatches;
  }

  const idPrefixMatches = candidates.filter((manifest) =>
    manifest.sessionId.toLowerCase().startsWith(query),
  );

  const hasIdPrefixMatch = idPrefixMatches.length > 0;
  if (hasIdPrefixMatch) {
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
