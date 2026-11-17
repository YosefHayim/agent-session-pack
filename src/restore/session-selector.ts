import type { SessionManifest } from '@/archive/manifest-store.js';
import { type ProviderId, ProviderIdSchema } from '@/session-model.js';

const SEPARATOR_NOT_FOUND = -1;

export type SelectorMode = 'exact' | 'fuzzy';

export interface SessionSelectorRequest {
  readonly selector: string;
  readonly provider: ProviderId | undefined;
  readonly manifests: ReadonlyArray<SessionManifest>;
  readonly match: SelectorMode;
}

export type SessionSelection =
  | { readonly status: 'found'; readonly manifest: SessionManifest }
  | { readonly status: 'not-found' }
  | { readonly status: 'ambiguous'; readonly candidates: ReadonlyArray<SessionManifest> };

interface ParsedSelector {
  readonly provider: ProviderId | undefined;
  readonly query: string;
}

export function findSessionSelector(request: SessionSelectorRequest): SessionSelection {
  const parsed = parseSelector(request.selector);
  const provider = request.provider ?? parsed.provider;

  function isRequestedProvider(manifest: SessionManifest): boolean {
    const isAnyProviderAllowed = provider == null;
    if (isAnyProviderAllowed) {
      return true;
    }

    return manifest.provider === provider;
  }

  const candidates = request.manifests.filter(isRequestedProvider);
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
}

function isProviderId(candidate: string): candidate is ProviderId {
  return ProviderIdSchema.safeParse(candidate).success;
}

function parseSelector(selector: string): ParsedSelector {
  const trimmedSelector = selector.trim();
  const separatorIndex = trimmedSelector.indexOf(':');
  const prefix = trimmedSelector.slice(0, separatorIndex).toLowerCase();

  const plainSelector = {
    provider: undefined,
    query: trimmedSelector.toLowerCase(),
  };

  const isSeparatorMissing = separatorIndex === SEPARATOR_NOT_FOUND;
  if (isSeparatorMissing) {
    return plainSelector;
  }

  const isPrefixNotProvider = !isProviderId(prefix);
  if (isPrefixNotProvider) {
    return plainSelector;
  }

  return {
    provider: prefix,
    query: trimmedSelector
      .slice(separatorIndex + 1)
      .trim()
      .toLowerCase(),
  };
}

function listMatchingManifests(
  query: string,
  candidates: ReadonlyArray<SessionManifest>,
  selectorMode: SelectorMode,
): ReadonlyArray<SessionManifest> {
  const isQueryEmpty = query.length === 0;
  if (isQueryEmpty) {
    return [];
  }

  function isExactNameHit(manifest: SessionManifest): boolean {
    function isQueryName(name: string): boolean {
      return name.toLowerCase() === query;
    }

    return [manifest.sessionId, manifest.slug, manifest.title].some(isQueryName);
  }

  const exactHits = candidates.filter(isExactNameHit);

  const hasAnyExactHit = exactHits.length > 0;
  const isExactModeRequested = selectorMode === 'exact';
  const hasExactHit = hasAnyExactHit || isExactModeRequested;
  if (hasExactHit) {
    return exactHits;
  }

  function isIdPrefixHit(manifest: SessionManifest): boolean {
    return manifest.sessionId.toLowerCase().startsWith(query);
  }

  const idPrefixHits = candidates.filter(isIdPrefixHit);

  const hasIdPrefixHit = idPrefixHits.length > 0;
  if (hasIdPrefixHit) {
    return idPrefixHits;
  }

  // Splits the query on every run of characters that are not lowercase letters or digits.
  const nonAlphanumericRun = /[^a-z0-9]+/;

  function isNonEmptyWord(word: string): boolean {
    return word.length > 0;
  }

  const words = query.split(nonAlphanumericRun).filter(isNonEmptyWord);

  const hasNoWords = words.length === 0;
  if (hasNoWords) {
    return [];
  }

  function matchesEveryWord(manifest: SessionManifest): boolean {
    function matchesWord(word: string): boolean {
      const isInSlug = manifest.slug.includes(word);
      const isInTitle = manifest.title.toLowerCase().includes(word);
      return isInSlug || isInTitle;
    }

    return words.every(matchesWord);
  }

  return candidates.filter(matchesEveryWord);
}
