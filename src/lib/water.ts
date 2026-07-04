import type { UserSettings, WaterReminder, WaterReminderConfig } from './types';

export const defaultWaterReminderConfig: WaterReminderConfig = {
  enabled: false,
  autoCalculateGoal: false,
  dailyGoalMl: 2000,
  startTime: '08:00',
  endTime: '21:00',
  intervalMinutes: 120,
};

export const defaultUserSettings: UserSettings = {
  onboardingCompleted: false,
  notificationEnabled: false,
  displayName: undefined,
  waterReminder: defaultWaterReminderConfig,
};

export function roundToNearest50(value: number) {
  return Math.round(value / 50) * 50;
}

export function calculateDailyWaterGoal(profile: { weightKg?: number }) {
  if (!profile.weightKg || profile.weightKg <= 0) return 2000;
  const rawGoal = profile.weightKg * 35;
  const cappedGoal = Math.min(Math.max(rawGoal, 1200), 3500);
  return roundToNearest50(cappedGoal);
}

export function timeToMinutes(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return hour * 60 + minute;
}

export function minutesToTime(totalMinutes: number) {
  const normalized = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function hydrateWaterConfig(partial?: Partial<WaterReminderConfig> | null): WaterReminderConfig {
  const merged: WaterReminderConfig = {
    ...defaultWaterReminderConfig,
    ...(partial ?? {}),
  };

  const weightKg = normalizeOptionalNumber(merged.weightKg);
  const heightCm = normalizeOptionalNumber(merged.heightCm);
  const intervalMinutes = Math.max(30, Math.min(Number(merged.intervalMinutes) || 120, 360));
  const startTime = normalizeTime(merged.startTime, defaultWaterReminderConfig.startTime);
  const endTime = normalizeTime(merged.endTime, defaultWaterReminderConfig.endTime);
  const dailyGoalMl = merged.autoCalculateGoal
    ? calculateDailyWaterGoal({ weightKg })
    : Math.max(1200, Math.min(roundToNearest50(Number(merged.dailyGoalMl) || 2000), 3500));

  return {
    enabled: Boolean(merged.enabled),
    autoCalculateGoal: Boolean(merged.autoCalculateGoal),
    dailyGoalMl,
    startTime,
    endTime,
    intervalMinutes,
    weightKg,
    heightCm,
  };
}

type PartialUserSettings = Partial<Omit<UserSettings, 'waterReminder'>> & {
  waterReminder?: Partial<WaterReminderConfig> | null;
};

export function hydrateUserSettings(partial?: PartialUserSettings | null): UserSettings {
  const displayName = normalizeDisplayName(partial?.displayName);

  return {
    ...defaultUserSettings,
    ...(partial ?? {}),
    displayName,
    waterReminder: hydrateWaterConfig(partial?.waterReminder),
  };
}

export function generateWaterReminders(settings: WaterReminderConfig): WaterReminder[] {
  const hydrated = hydrateWaterConfig(settings);
  if (!hydrated.enabled) return [];

  const start = timeToMinutes(hydrated.startTime);
  const end = timeToMinutes(hydrated.endTime);
  if (end < start) return [];

  const times: string[] = [];
  for (let time = start; time <= end; time += hydrated.intervalMinutes) {
    times.push(minutesToTime(time));
  }

  if (!times.length) return [];
  const amountPerReminder = Math.max(50, roundToNearest50(hydrated.dailyGoalMl / times.length));

  return times.map((time) => ({
    time,
    amountMl: amountPerReminder,
  }));
}

export function getNextWaterReminder(settings: WaterReminderConfig, now = new Date()): WaterReminder | null {
  const reminders = generateWaterReminders(settings);
  if (!reminders.length) return null;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return reminders.find((reminder) => timeToMinutes(reminder.time) >= currentMinutes) ?? reminders[0];
}

function normalizeOptionalNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function normalizeTime(value: string | undefined, fallback: string) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return fallback;
  return value;
}

function normalizeDisplayName(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 48) : undefined;
}
