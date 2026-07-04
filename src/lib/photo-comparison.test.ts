import { describe, expect, it } from 'vitest';
import {
  getCompareByDaysAgo,
  getFirstVsLatest,
  getPreviousVsLatest,
  normalizeComparePair,
} from './photo-comparison';

const photos = [
  { id: 'latest', takenAt: '2026-07-04T08:00:00.000Z' },
  { id: 'first', takenAt: '2026-06-20T08:00:00.000Z' },
  { id: 'near-seven-days', takenAt: '2026-06-27T08:00:00.000Z' },
  { id: 'previous', takenAt: '2026-07-01T08:00:00.000Z' },
];

describe('photo comparison helpers', () => {
  it('returns the first and latest photos by taken date', () => {
    expect(getFirstVsLatest(photos)).toMatchObject({
      before: { id: 'first' },
      after: { id: 'latest' },
    });
  });

  it('returns the previous photo compared with the latest photo', () => {
    expect(getPreviousVsLatest(photos)).toMatchObject({
      before: { id: 'previous' },
      after: { id: 'latest' },
    });
  });

  it('uses the closest photo before a days-ago target', () => {
    expect(getCompareByDaysAgo(photos, 7)).toMatchObject({
      before: { id: 'near-seven-days' },
      after: { id: 'latest' },
    });
  });

  it('does not create a custom pair from the same photo', () => {
    expect(normalizeComparePair(photos[0], photos[0])).toBeNull();
  });
});
