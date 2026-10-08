import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { SessionManifest } from '../archive/manifestStore.js';
import {
  resolveSessionSelector,
  SessionSelectorAmbiguousError,
  type SessionSelectorError,
  SessionSelectorNotFoundError,
  type SessionSelectorRequest,
} from './sessionSelector.js';

type SelectorQuery = Omit<SessionSelectorRequest, 'manifests'>;

const manifestFor = (
  fields: Pick<SessionManifest, 'sessionId' | 'provider' | 'title' | 'slug'>,
): SessionManifest => ({
  ...fields,
  originalPath: `/sessions/${fields.sessionId}.jsonl`,
  archivePath: `/vault/${fields.sessionId}.jsonl.zst`,
  sourceSha256: 'sha',
  sourceBytes: 1,
  archivedAt: '2026-07-01T00:00:00.000Z',
});

const MANIFESTS: ReadonlyArray<SessionManifest> = [
  manifestFor({
    sessionId: '019a2f10-oly',
    provider: 'codex',
    title: 'Oly App migration',
    slug: 'oly-app-migration',
  }),
  manifestFor({
    sessionId: 'c7e4-notes',
    provider: 'claude',
    title: 'Oly App migration notes',
    slug: 'oly-app-migration-notes',
  }),
  manifestFor({
    sessionId: 'kiro-1',
    provider: 'kiro',
    title: 'Kiro climb game blueprint',
    slug: 'kiro-climb-game-blueprint',
  }),
  manifestFor({ sessionId: 'abc', provider: 'codex', title: 'Short id', slug: 'short-id' }),
  manifestFor({ sessionId: 'abcdef', provider: 'codex', title: 'Long id', slug: 'long-id' }),
];

const resolvedSessionId = async (query: SelectorQuery): Promise<string> => {
  const resolution = resolveSessionSelector({ ...query, manifests: MANIFESTS });
  const manifest = await Effect.runPromise(resolution);
  return manifest.sessionId;
};

const selectorFailure = (query: SelectorQuery): Promise<SessionSelectorError> => {
  const resolution = resolveSessionSelector({ ...query, manifests: MANIFESTS });
  return Effect.runPromise(Effect.flip(resolution));
};

describe('session selector', () => {
  it('resolves a provider-prefixed slug', async () => {
    await expect(
      resolvedSessionId({
        selector: 'codex:oly-app-migration',
        provider: undefined,
        match: 'fuzzy',
      }),
    ).resolves.toBe('019a2f10-oly');
  });

  it('resolves an exact session name in any case', async () => {
    await expect(
      resolvedSessionId({
        selector: 'kiro CLIMB game blueprint',
        provider: undefined,
        match: 'exact',
      }),
    ).resolves.toBe('kiro-1');
  });

  it('resolves a unique session id prefix', async () => {
    await expect(
      resolvedSessionId({ selector: '019a', provider: undefined, match: 'fuzzy' }),
    ).resolves.toBe('019a2f10-oly');
  });

  it('prefers an exact id over longer ids that share it', async () => {
    await expect(
      resolvedSessionId({ selector: 'abc', provider: undefined, match: 'fuzzy' }),
    ).resolves.toBe('abc');
  });

  it('resolves words found in the session name', async () => {
    await expect(
      resolvedSessionId({ selector: 'climb blueprint', provider: undefined, match: 'fuzzy' }),
    ).resolves.toBe('kiro-1');
  });

  it('narrows fuzzy words to the provider flag', async () => {
    await expect(
      resolvedSessionId({ selector: 'oly migration', provider: 'claude', match: 'fuzzy' }),
    ).resolves.toBe('c7e4-notes');
  });

  it('returns every candidate when a selector is ambiguous', async () => {
    const failure = await selectorFailure({
      selector: 'oly migration',
      provider: undefined,
      match: 'fuzzy',
    });

    expect(failure).toBeInstanceOf(SessionSelectorAmbiguousError);
    expect(failure).toMatchObject({
      candidates: [
        expect.objectContaining({ sessionId: '019a2f10-oly' }),
        expect.objectContaining({ sessionId: 'c7e4-notes' }),
      ],
    });
  });

  it('ignores id prefixes and words in exact mode', async () => {
    await expect(
      selectorFailure({ selector: 'abcd', provider: undefined, match: 'exact' }),
    ).resolves.toBeInstanceOf(SessionSelectorNotFoundError);
    await expect(
      selectorFailure({ selector: 'climb blueprint', provider: undefined, match: 'exact' }),
    ).resolves.toBeInstanceOf(SessionSelectorNotFoundError);
  });

  it('matches nothing for a selector without words', async () => {
    await expect(
      selectorFailure({ selector: 'codex: ?? ', provider: undefined, match: 'fuzzy' }),
    ).resolves.toBeInstanceOf(SessionSelectorNotFoundError);
  });
});
