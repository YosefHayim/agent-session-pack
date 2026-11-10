import type { SessionManifest } from '@/archive/manifest-store.js';
import { type ProviderId, ProviderIdSchema } from '@/session-model.js';

export type SelectorMode = 'exact' | 'fuzzy';

export type SessionSelectorRequest = {
  readonly selector: string;
  readonly provider: ProviderId | undefined;
  readonly manifests: ReadonlyArray<SessionManifest>;
  readonly match: SelectorMode;
};

export type SessionSelection =
  | { readonly status: 'found'; readonly manifest: SessionManifest }
  | { readonly status: 'not-found' }
  | { readonly status: 'ambiguous'; readonly candidates: ReadonlyArray<SessionManifest> };

type ParsedSelector = {
  readonly provider: ProviderId | undefined;
  readonly query: string;
};

export const findSessionSelector = (request: SessionSelectorRequest): SessionSelection => {
  const parsed = parseSelector(request.selector);
  const provider = request.provider ?? parsed.provider;
  const candidates = request.manifests.filter(
    (manifest) => provider == null || manifest.provider === provider,
  );
  const hits = listMatchingManifests(parsed.query, candidates, request.match);
  const isNoHit = hits.length === 0;
  const isAmbiguous = hits.length > 1;

  if (isNoHit) {
    return { status: 'not-found' };
  }

  if (isAmbiguous) {
    return { status: 'ambiguous', candidates: hits };
  }

  return { status: 'found', manifest: hits[0] };
};

const isProviderId = (candidate: string): candidate is ProviderId =>
  ProviderIdSchema.safeParse(candidate).success;

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
  hit: SelectorMode,
): ReadonlyArray<SessionManifest> => {
  const isQueryEmpty = query.length === 0;
  if (isQueryEmpty) {
    return [];
  }

  const exactHits = candidates.filter((manifest) =>
    [manifest.sessionId, manifest.slug, manifest.title].some(
      (name) => name.toLowerCase() === query,
    ),
  );

  const hasExactHit = exactHits.length > 0 || hit === 'exact';
  if (hasExactHit) {
    return exactHits;
  }

  const idPrefixHits = candidates.filter((manifest) =>
    manifest.sessionId.toLowerCase().startsWith(query),
  );

  const hasIdPrefixHit = idPrefixHits.length > 0;
  if (hasIdPrefixHit) {
    return idPrefixHits;
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
