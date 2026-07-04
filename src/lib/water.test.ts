import { describe, expect, it } from 'vitest';
import { calculateDailyWaterGoal, generateWaterReminders, hydrateUserSettings, hydrateWaterConfig } from './water';

describe('water reminders', () => {
  it('calculates a rounded daily goal from weight', () => {
    expect(calculateDailyWaterGoal({ weightKg: 60 })).toBe(2100);
    expect(calculateDailyWaterGoal({ weightKg: 50 })).toBe(1750);
  });

  it('caps daily goal to the UX bounds', () => {
    expect(calculateDailyWaterGoal({ weightKg: 20 })).toBe(1200);
    expect(calculateDailyWaterGoal({ weightKg: 120 })).toBe(3500);
    expect(calculateDailyWaterGoal({})).toBe(2000);
  });

  it('generates the default reminder cadence', () => {
    const config = hydrateWaterConfig({ enabled: true, dailyGoalMl: 2100 });
    const reminders = generateWaterReminders(config);

    expect(reminders.map((item) => item.time)).toEqual(['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00']);
    expect(reminders[0].amountMl).toBe(300);
  });

  it('normalizes the display name used by greetings and reminders', () => {
    expect(hydrateUserSettings({ displayName: '  Minh   Anh  ' }).displayName).toBe('Minh Anh');
    expect(hydrateUserSettings({ displayName: '   ' }).displayName).toBeUndefined();
  });
});
