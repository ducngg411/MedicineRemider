import { describe, expect, it } from 'vitest';
import { buildDoseInstances, inferStatus, normalizeTimes } from './schedule';
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

  it('normalizes duplicate times', () => {
    expect(normalizeTimes(['08:00', '08:00', '20:30'])).toEqual(['08:00', '20:30']);
  });
});
