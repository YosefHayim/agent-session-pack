import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  type DiscoveredSession,
  resolveSessionSelector,
  SessionSelectorAmbiguousError,
} from '../src/core/index.js';

const sessions: ReadonlyArray<DiscoveredSession> = [
  {
    id: 'codex-1',
    provider: 'codex',
    title: 'Oly App migration',
    slug: 'oly-app-migration',
    originalPath: '/tmp/codex/oly.jsonl',
    modifiedAt: new Date('2026-05-04T03:05:27.000Z'),
    sizeBytes: 104_229,
  },
  {
    id: 'claude-1',
    provider: 'claude',
    title: 'Oly App migration notes',
    slug: 'oly-app-migration-notes',
    originalPath: '/tmp/claude/oly.jsonl',
    modifiedAt: new Date('2026-05-05T03:05:27.000Z'),
    sizeBytes: 6_470_568,
  },
  {
    id: 'kiro-1',
    provider: 'kiro',
    title: 'Kiro climb game blueprint',
    slug: 'kiro-climb-game-blueprint',
    originalPath: '/tmp/kiro/game.jsonl',
    modifiedAt: new Date('2026-05-06T03:05:27.000Z'),
    sizeBytes: 1_160_471,
  },
];

describe('session selector', () => {
  it('resolves a provider-prefixed slug', async () => {
    const session = await Effect.runPromise(
      resolveSessionSelector({
        selector: 'codex:oly-app-migration',
        sessions,
      }),
    );

    expect(session.id).toBe('codex-1');
  });

  it('resolves an exact session name with spaces', async () => {
    const session = await Effect.runPromise(
      resolveSessionSelector({
        selector: 'Kiro climb game blueprint',
        sessions,
      }),
    );

    expect(session.id).toBe('kiro-1');
  });

  it('returns candidates when a fuzzy selector is ambiguous', async () => {
    const failure = await Effect.runPromise(
      Effect.either(
        resolveSessionSelector({
          selector: 'oly migration',
          sessions,
        }),
      ),
    );

    expect(Either.isLeft(failure)).toBe(true);
    if (Either.isRight(failure)) {
      expect.fail('expected selector to be ambiguous');
    }
    expect(failure.left).toMatchObject({
      _tag: 'SessionSelectorAmbiguousError',
      candidates: [
        expect.objectContaining({ id: 'codex-1' }),
        expect.objectContaining({ id: 'claude-1' }),
      ],
    });
  });

  it('uses typed selector errors', async () => {
    const failure = await Effect.runPromise(
      Effect.either(
        resolveSessionSelector({
          selector: 'oly migration',
          sessions,
        }),
      ),
    );

    expect(Either.isLeft(failure)).toBe(true);
    if (Either.isRight(failure)) {
      expect.fail('expected typed selector failure');
    }
    expect(failure.left).toBeInstanceOf(SessionSelectorAmbiguousError);
  });
});
