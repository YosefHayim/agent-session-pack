import { describe, expect, it } from 'vitest';
import type { SessionManifest } from '@/archive/manifest-store.js';
import { resolveSessionSelector, type SessionSelectorRequest } from './session-selector.js';

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

const selectionFor = (query: SelectorQuery) =>
  resolveSessionSelector({ ...query, manifests: MANIFESTS });

describe('session selector', () => {
  it('resolves a provider-prefixed slug', () => {
    const selection = selectionFor({
      selector: 'codex:oly-app-migration',
      provider: undefined,
      match: 'fuzzy',
    });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: '019a2f10-oly' } });
  });

  it('resolves an exact session name in any case', () => {
    const selection = selectionFor({
      selector: 'kiro CLIMB game blueprint',
      provider: undefined,
      match: 'exact',
    });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: 'kiro-1' } });
  });

  it('resolves a unique session id prefix', () => {
    const selection = selectionFor({ selector: '019a', provider: undefined, match: 'fuzzy' });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: '019a2f10-oly' } });
  });

  it('prefers an exact id over longer ids that share it', () => {
    const selection = selectionFor({ selector: 'abc', provider: undefined, match: 'fuzzy' });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: 'abc' } });
  });

  it('resolves words found in the session name', () => {
    const selection = selectionFor({
      selector: 'climb blueprint',
      provider: undefined,
      match: 'fuzzy',
    });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: 'kiro-1' } });
  });

  it('narrows fuzzy words to the provider flag', () => {
    const selection = selectionFor({
      selector: 'oly migration',
      provider: 'claude',
      match: 'fuzzy',
    });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: 'c7e4-notes' } });
  });

  it('returns every candidate when a selector is ambiguous', () => {
    const selection = selectionFor({
      selector: 'oly migration',
      provider: undefined,
      match: 'fuzzy',
    });

    expect(selection).toMatchObject({
      status: 'ambiguous',
      candidates: [
        expect.objectContaining({ sessionId: '019a2f10-oly' }),
        expect.objectContaining({ sessionId: 'c7e4-notes' }),
      ],
    });
  });

  it('ignores id prefixes and words in exact mode', () => {
    const idPrefixSelection = selectionFor({
      selector: 'abcd',
      provider: undefined,
      match: 'exact',
    });
    const wordSelection = selectionFor({
      selector: 'climb blueprint',
      provider: undefined,
      match: 'exact',
    });

    expect(idPrefixSelection).toEqual({ status: 'not-found' });
    expect(wordSelection).toEqual({ status: 'not-found' });
  });

  it('matches nothing for a selector without words', () => {
    const selection = selectionFor({
      selector: 'codex: ?? ',
      provider: undefined,
      match: 'fuzzy',
    });

    expect(selection).toEqual({ status: 'not-found' });
  });
});
