export const VI_TIME_ZONE = 'Asia/Ho_Chi_Minh';
/** UTC offset for Vietnam = +7 hours in milliseconds */
const VI_OFFSET_MS = 7 * 60 * 60 * 1000;

export function toDateInputValue(date = new Date()) {
  return formatDateParts(date).date;
}

export function formatShortDateTime(date: Date) {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: VI_TIME_ZONE,
  }).format(date);
}

export function formatTime(date: Date) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: VI_TIME_ZONE,
  }).format(date);
}

export function formatWeekday(date: Date) {
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    timeZone: VI_TIME_ZONE,
  }).format(date);
}

export function formatDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: VI_TIME_ZONE,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    date: `${values.year}-${values.month}-${values.day}`,
  };
}

export function getTodayLocalDate() {
  return formatDateParts(new Date()).date;
}

/**
 * Build a Date that represents yyyy-MM-dd HH:mm:00 in UTC+7.
 * Uses UTC math so it is timezone-agnostic regardless of the
 * browser/server's local timezone setting.
 */
export function dateFromLocalDateAndTime(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  // UTC+7 → UTC: subtract 7 h
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - VI_OFFSET_MS);
}

export function addDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  // Work in UTC noon to avoid DST edge cases (VN has no DST but keeps UTC math clean)
  const value = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  value.setUTCDate(value.getUTCDate() + days);
  return toDateInputValue(value);
}

/**
 * Return the start-of-day (00:00:00) in UTC+7 for "today".
 * Used for reset timers.
 */
export function getStartOfTodayVN(): Date {
  const { year, month, day } = formatDateParts(new Date());
  return dateFromLocalDateAndTime(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, '00:00');
}

/**
 * Return the start-of-tomorrow in UTC+7. Use this to schedule midnight resets.
 */
export function getMsUntilMidnightVN(): number {
  const { year, month, day } = formatDateParts(new Date());
  const todayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const tomorrowStr = addDays(todayStr, 1);
  const midnight = dateFromLocalDateAndTime(tomorrowStr, '00:00');
  return Math.max(0, midnight.getTime() - Date.now());
}
