import { describe, expect, it } from 'vitest';
import { selectNewestSessionWithinSize } from '../src/core/index.js';

describe('session selection', () => {
  it('selects the newest session that fits under the size cap', () => {
    const selected = selectNewestSessionWithinSize(
      [
        { id: 'older-small', modifiedAt: new Date('2026-07-01T10:00:00.000Z'), sizeBytes: 10 },
        { id: 'newer-large', modifiedAt: new Date('2026-07-03T10:00:00.000Z'), sizeBytes: 500 },
        { id: 'newest-small', modifiedAt: new Date('2026-07-02T10:00:00.000Z'), sizeBytes: 20 },
      ],
      100,
    );

    expect(selected?.id).toBe('newest-small');
  });

  it('falls back to the smallest session when every session is over the size cap', () => {
    const selected = selectNewestSessionWithinSize(
      [
        { id: 'huge', modifiedAt: new Date('2026-07-03T10:00:00.000Z'), sizeBytes: 500 },
        { id: 'less-huge', modifiedAt: new Date('2026-07-01T10:00:00.000Z'), sizeBytes: 200 },
      ],
      100,
    );

    expect(selected?.id).toBe('less-huge');
  });
});
