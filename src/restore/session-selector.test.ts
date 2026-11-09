import { describe, expect, it } from 'vitest';
import type { SessionManifest } from '@/archive/manifest-store.js';
import { findSessionSelector, type SessionSelectorRequest } from './session-selector.js';

type SelectorQuery = Omit<SessionSelectorRequest, 'manifests'>;

const readManifest = (
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
  readManifest({
    sessionId: '019a2f10-oly',
    provider: 'codex',
    title: 'Oly App migration',
    slug: 'oly-app-migration',
  }),
  readManifest({
    sessionId: 'c7e4-notes',
    provider: 'claude',
    title: 'Oly App migration notes',
    slug: 'oly-app-migration-notes',
  }),
  readManifest({
    sessionId: 'kiro-1',
    provider: 'kiro',
    title: 'Kiro climb game blueprint',
    slug: 'kiro-climb-game-blueprint',
  }),
  readManifest({ sessionId: 'abc', provider: 'codex', title: 'Short id', slug: 'short-id' }),
  readManifest({ sessionId: 'abcdef', provider: 'codex', title: 'Long id', slug: 'long-id' }),
];

const readSelection = (query: SelectorQuery) =>
  findSessionSelector({ ...query, manifests: MANIFESTS });

describe('session selector', () => {
  it('resolves a provider-prefixed slug', () => {
    const selection = readSelection({
      selector: 'codex:oly-app-migration',
      provider: undefined,
      match: 'fuzzy',
    });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: '019a2f10-oly' } });
  });

  it('resolves an exact session name in any case', () => {
    const selection = readSelection({
      selector: 'kiro CLIMB game blueprint',
      provider: undefined,
      match: 'exact',
    });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: 'kiro-1' } });
  });

  it('resolves a unique session id prefix', () => {
    const selection = readSelection({ selector: '019a', provider: undefined, match: 'fuzzy' });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: '019a2f10-oly' } });
  });

  it('prefers an exact id over longer ids that share it', () => {
    const selection = readSelection({ selector: 'abc', provider: undefined, match: 'fuzzy' });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: 'abc' } });
  });

  it('resolves words found in the session name', () => {
    const selection = readSelection({
      selector: 'climb blueprint',
      provider: undefined,
      match: 'fuzzy',
    });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: 'kiro-1' } });
  });

  it('narrows fuzzy words to the provider flag', () => {
    const selection = readSelection({
      selector: 'oly migration',
      provider: 'claude',
      match: 'fuzzy',
    });

    expect(selection).toMatchObject({ status: 'found', manifest: { sessionId: 'c7e4-notes' } });
  });

  it('returns every candidate when a selector is ambiguous', () => {
    const selection = readSelection({
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
    const idPrefixSelection = readSelection({
      selector: 'abcd',
      provider: undefined,
      match: 'exact',
    });
    const wordSelection = readSelection({
      selector: 'climb blueprint',
      provider: undefined,
      match: 'exact',
    });

    expect(idPrefixSelection).toEqual({ status: 'not-found' });
    expect(wordSelection).toEqual({ status: 'not-found' });
  });

  it('matches nothing for a selector without words', () => {
    const selection = readSelection({
      selector: 'codex: ?? ',
      provider: undefined,
      match: 'fuzzy',
    });

    expect(selection).toEqual({ status: 'not-found' });
  });
});
