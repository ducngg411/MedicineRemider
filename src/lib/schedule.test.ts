import { describe, expect, it } from 'vitest';
import { dateFromLocalDateAndTime } from './date';
import {
  buildDoseInstances,
  getDoseEventsNeedingRemoteSync,
  inferStatus,
  isMedicationTrackedByActiveCourse,
  mergeDoseEvents,
  normalizeDurationDays,
  normalizeTimes,
  summarizeDoses,
} from './schedule';
import type { DoseEvent, Medication } from './types';

const medication: Medication = {
  id: 'med-1',
  patientName: 'Trang',
  name: 'Thuốc A',
  instructions: 'Uống sau ăn',
  source: 'manual',
  startDate: '2026-07-03',
  endDate: '2026-07-05',
  scheduleTimes: ['08:00', '20:00'],
  createdAt: '2026-07-03T00:00:00.000Z',
};

describe('schedule helpers', () => {
  it('builds active doses for the selected local day', () => {
    const doses = buildDoseInstances(
      [medication],
      [],
      new Date(2026, 6, 3, 9),
      new Date(2026, 6, 3, 9),
    );

    expect(doses).toHaveLength(2);
    expect(doses[0].medication.name).toBe('Thuốc A');
  });

  it('marks far future doses as upcoming', () => {
    const status = inferStatus(new Date(2026, 6, 3, 14), undefined, new Date(2026, 6, 3, 8, 30));
    expect(status).toBe('upcoming');
  });

  it('marks doses inside the early window as soon', () => {
    const status = inferStatus(new Date(2026, 6, 3, 14), undefined, new Date(2026, 6, 3, 13, 45));
    expect(status).toBe('soon');
  });

  it('marks current doses as due', () => {
    const status = inferStatus(new Date(2026, 6, 3, 14), undefined, new Date(2026, 6, 3, 14, 10));
    expect(status).toBe('due');
  });

  it('marks doses as late after the due window', () => {
    const status = inferStatus(new Date(2026, 6, 3, 8), undefined, new Date(2026, 6, 3, 10));
    expect(status).toBe('late');
  });

  it('marks doses as missed after the late window', () => {
    const status = inferStatus(new Date(2026, 6, 3, 8), undefined, new Date(2026, 6, 3, 13));
    expect(status).toBe('missed');
  });

  it('does not let a persisted due event freeze the runtime status', () => {
    const event: DoseEvent = {
      id: 'event-1',
      medicationId: 'med-1',
      scheduledAt: new Date(2026, 6, 3, 8).toISOString(),
      status: 'due',
    };
    const status = inferStatus(new Date(2026, 6, 3, 8), event, new Date(2026, 6, 3, 10));
    expect(status).toBe('late');
  });

  it('keeps a dose snoozed until the selected reminder time', () => {
    const event: DoseEvent = {
      id: 'event-snooze',
      medicationId: 'med-1',
      scheduledAt: new Date(2026, 6, 3, 8).toISOString(),
      status: 'snoozed',
      snoozedUntil: new Date(2026, 6, 3, 8, 25).toISOString(),
    };

    expect(inferStatus(new Date(2026, 6, 3, 8), event, new Date(2026, 6, 3, 8, 10))).toBe('snoozed');
    expect(inferStatus(new Date(2026, 6, 3, 8), event, new Date(2026, 6, 3, 8, 26))).toBe('due');
    expect(inferStatus(new Date(2026, 6, 3, 8), event, new Date(2026, 6, 3, 9))).toBe('late');
  });

  it('sorts snoozed doses by their reminder time and keeps them pending', () => {
    const event: DoseEvent = {
      id: 'event-snooze',
      medicationId: 'med-1',
      scheduledAt: new Date(2026, 6, 3, 8).toISOString(),
      status: 'snoozed',
      snoozedUntil: new Date(2026, 6, 3, 20, 10).toISOString(),
    };
    const doses = buildDoseInstances([medication], [event], new Date(2026, 6, 3, 9), new Date(2026, 6, 3, 9));

    expect(doses[1].status).toBe('snoozed');
    expect(doses[1].effectiveAt.toISOString()).toBe(event.snoozedUntil);
    expect(summarizeDoses(doses).pending).toBe(2);
  });

  it('normalizes duplicate times', () => {
    expect(normalizeTimes(['08:00', '08:00', '20:30'])).toEqual(['08:00', '20:30']);
  });

  it('builds today doses for topical medicines', () => {
    const topical: Medication = {
      ...medication,
      id: 'tube-1',
      name: 'Adalcream plus 15g',
      form: 'tuýp',
      startDate: '2026-07-05',
      endDate: '2026-08-03',
      scheduleTimes: ['20:55'],
    };

    const doses = buildDoseInstances(
      [topical],
      [],
      dateFromLocalDateAndTime('2026-07-05', '12:00'),
      dateFromLocalDateAndTime('2026-07-05', '20:59'),
    );

    expect(doses).toHaveLength(1);
    expect(doses[0].medication.name).toBe('Adalcream plus 15g');
    expect(doses[0].status).toBe('due');
  });

  it('ignores impossible end dates caused by missing duration', () => {
    const topical: Medication = {
      ...medication,
      id: 'tube-invalid-end',
      name: 'Adalcream plus 15g',
      form: 'tuýp',
      startDate: '2026-07-04',
      endDate: '2026-07-03',
      durationDays: 0,
      scheduleTimes: ['20:55'],
    };

    const doses = buildDoseInstances(
      [topical],
      [],
      dateFromLocalDateAndTime('2026-07-05', '12:00'),
      dateFromLocalDateAndTime('2026-07-05', '20:59'),
    );

    expect(doses).toHaveLength(1);
  });

  it('normalizes duration days to positive integers only', () => {
    expect(normalizeDurationDays(undefined)).toBeUndefined();
    expect(normalizeDurationDays(0)).toBeUndefined();
    expect(normalizeDurationDays(-1)).toBeUndefined();
    expect(normalizeDurationDays(10.8)).toBe(10);
  });

  it('keeps orphan course medications visible in the active schedule', () => {
    const knownCourseIds = new Set(['course-active', 'course-old']);

    expect(isMedicationTrackedByActiveCourse({ courseId: undefined }, 'course-active', knownCourseIds)).toBe(true);
    expect(isMedicationTrackedByActiveCourse({ courseId: 'missing-course' }, 'course-active', knownCourseIds)).toBe(true);
    expect(isMedicationTrackedByActiveCourse({ courseId: 'course-old' }, 'course-active', knownCourseIds)).toBe(false);
    expect(isMedicationTrackedByActiveCourse({ courseId: 'course-active' }, 'course-active', knownCourseIds)).toBe(true);
  });

  it('keeps a local taken-late action when remote still has the due event', () => {
    const scheduledAt = dateFromLocalDateAndTime('2026-07-03', '08:00').toISOString();
    const remoteEvent: DoseEvent = {
      id: 'event-remote',
      medicationId: 'med-1',
      scheduledAt,
      status: 'due',
    };
    const localEvent: DoseEvent = {
      id: 'event-local',
      medicationId: 'med-1',
      scheduledAt,
      status: 'taken_late',
      actedAt: dateFromLocalDateAndTime('2026-07-03', '08:45').toISOString(),
    };

    const merged = mergeDoseEvents([remoteEvent], [localEvent], new Set(['med-1']));

    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('taken_late');
    expect(getDoseEventsNeedingRemoteSync([remoteEvent], merged, new Set(['med-1']))).toEqual([localEvent]);
  });

  it('does not let an old local action overwrite an already-synced remote action', () => {
    const scheduledAt = dateFromLocalDateAndTime('2026-07-03', '08:00').toISOString();
    const actedAt = dateFromLocalDateAndTime('2026-07-03', '08:45').toISOString();
    const remoteEvent: DoseEvent = {
      id: 'event-remote',
      medicationId: 'med-1',
      scheduledAt,
      status: 'taken',
      actedAt,
    };
    const localEvent: DoseEvent = {
      id: 'event-local',
      medicationId: 'med-1',
      scheduledAt,
      status: 'taken_late',
      actedAt,
    };

    const merged = mergeDoseEvents([remoteEvent], [localEvent], new Set(['med-1']));

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(remoteEvent);
    expect(getDoseEventsNeedingRemoteSync([remoteEvent], merged, new Set(['med-1']))).toEqual([]);
  });

  it('ignores local dose events for medications missing from the remote set', () => {
    const scheduledAt = dateFromLocalDateAndTime('2026-07-03', '08:00').toISOString();
    const localEvent: DoseEvent = {
      id: 'event-local',
      medicationId: 'missing-med',
      scheduledAt,
      status: 'taken_late',
      actedAt: dateFromLocalDateAndTime('2026-07-03', '08:45').toISOString(),
    };

    expect(mergeDoseEvents([], [localEvent], new Set(['med-1']))).toEqual([]);
  });
});
