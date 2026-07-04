export type ComparisonType = 'first_vs_latest' | 'previous_vs_latest' | 'range' | 'custom';

export interface PhotoEntryForComparison {
  id: string;
  takenAt: string;
}

export interface PhotoComparePair<T extends PhotoEntryForComparison> {
  before: T;
  after: T;
}

export function sortPhotosByDate<T extends PhotoEntryForComparison>(photos: T[]) {
  return [...photos].sort((a, b) => {
    const timeDiff = getPhotoTime(a) - getPhotoTime(b);
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });
}

export function getFirstVsLatest<T extends PhotoEntryForComparison>(photos: T[]): PhotoComparePair<T> | null {
  const sorted = sortPhotosByDate(photos);
  if (sorted.length < 2) return null;

  return {
    before: sorted[0],
    after: sorted[sorted.length - 1],
  };
}

export function getPreviousVsLatest<T extends PhotoEntryForComparison>(photos: T[]): PhotoComparePair<T> | null {
  const sorted = sortPhotosByDate(photos);
  if (sorted.length < 2) return null;

  return {
    before: sorted[sorted.length - 2],
    after: sorted[sorted.length - 1],
  };
}

export function getClosestPhotoBeforeDate<T extends PhotoEntryForComparison>(photos: T[], targetDate: Date) {
  const targetTime = targetDate.getTime();
  const beforeTarget = photos.filter((photo) => getPhotoTime(photo) <= targetTime);
  if (beforeTarget.length === 0) return null;

  return sortPhotosByDate(beforeTarget)[beforeTarget.length - 1];
}

export function getCompareByDaysAgo<T extends PhotoEntryForComparison>(photos: T[], daysAgo: number): PhotoComparePair<T> | null {
  const sorted = sortPhotosByDate(photos);
  if (sorted.length < 2) return null;

  const latest = sorted[sorted.length - 1];
  const targetDate = new Date(latest.takenAt);
  targetDate.setDate(targetDate.getDate() - daysAgo);

  const before = getClosestPhotoBeforeDate(photos, targetDate);
  if (!before || before.id === latest.id) return null;

  return {
    before,
    after: latest,
  };
}

export function normalizeComparePair<T extends PhotoEntryForComparison>(photoA: T, photoB: T): PhotoComparePair<T> | null {
  if (photoA.id === photoB.id) return null;
  return getPhotoTime(photoA) <= getPhotoTime(photoB)
    ? { before: photoA, after: photoB }
    : { before: photoB, after: photoA };
}

export function getTimelineBetween<T extends PhotoEntryForComparison>(photos: T[], pair: PhotoComparePair<T>) {
  const start = Math.min(getPhotoTime(pair.before), getPhotoTime(pair.after));
  const end = Math.max(getPhotoTime(pair.before), getPhotoTime(pair.after));
  const entries = photos.filter((photo) => {
    const time = getPhotoTime(photo);
    return time >= start && time <= end;
  });

  return sortPhotosByDate(entries);
}

function getPhotoTime(photo: PhotoEntryForComparison) {
  const time = new Date(photo.takenAt).getTime();
  return Number.isFinite(time) ? time : 0;
}
