import type { DoseEvent, DoseInstance, DoseStatus, Medication } from './types';
import { dateFromLocalDateAndTime, formatDateParts } from './date';

/** How long after scheduled time a dose is still "due" (not yet late) */
export const DUE_WINDOW_MIN = 30;
/** How long before scheduled time a dose may be recorded early */
export const EARLY_WINDOW_MIN = 30;
/** How long after scheduled time a dose is still "late" (not yet missed) */
export const LATE_WINDOW_MIN = 4 * 60; // 4 hours

export function getDoseEffectiveAt(scheduledAt: Date, event?: DoseEvent): Date {
  if (event?.status !== 'snoozed' || !event.snoozedUntil) return scheduledAt;
  const snoozedUntil = new Date(event.snoozedUntil);
  if (Number.isNaN(snoozedUntil.getTime())) return scheduledAt;
  return snoozedUntil;
}

export function inferStatus(scheduledAt: Date, event?: DoseEvent, now = new Date()): DoseStatus {
  if (event && event.status !== 'due' && event.status !== 'snoozed') {
    return event.status;
  }
  const effectiveAt = getDoseEffectiveAt(scheduledAt, event);
  if (event?.status === 'snoozed' && effectiveAt.getTime() > now.getTime()) return 'snoozed';

  const minutesUntil = (effectiveAt.getTime() - now.getTime()) / 60000;
  if (minutesUntil > EARLY_WINDOW_MIN) return 'upcoming';
  if (minutesUntil > 0) return 'soon';

  const minutesLate = (now.getTime() - effectiveAt.getTime()) / 60000;
  if (minutesLate > LATE_WINDOW_MIN) return 'missed';
  if (minutesLate > DUE_WINDOW_MIN)  return 'late';
  return 'due';
}

export function isMedicationActiveOn(medication: Medication, localDate: string) {
  if (medication.startDate > localDate) return false;
  const endDate = medication.endDate && medication.endDate >= medication.startDate ? medication.endDate : undefined;
  if (endDate && endDate < localDate) return false;
  return true;
}

export function normalizeDurationDays(value: number | undefined | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value && value > 0 ? Math.floor(value) : undefined;
}

export function isMedicationTrackedByActiveCourse(
  medication: Pick<Medication, 'courseId'>,
  activeCourseId: string | undefined,
  knownCourseIds: Set<string>,
) {
  if (!medication.courseId) return true;
  if (!knownCourseIds.has(medication.courseId)) return true;
  return medication.courseId === activeCourseId;
}

export function buildDoseInstances(
  medications: Medication[],
  events: DoseEvent[],
  day = new Date(),
  now = new Date(),
): DoseInstance[] {
  const localDate = formatDateParts(day).date;
  const eventByKey = new Map(events.map((event) => [eventKey(event.medicationId, event.scheduledAt), event]));

  return medications
    .filter((medication) => isMedicationActiveOn(medication, localDate))
    .flatMap((medication) =>
      medication.scheduleTimes.map((time) => {
        const scheduledAt = dateFromLocalDateAndTime(localDate, time);
        const event = eventByKey.get(eventKey(medication.id, scheduledAt.toISOString()));
        const effectiveAt = getDoseEffectiveAt(scheduledAt, event);
        return {
          id: `${medication.id}-${time}`,
          medication,
          scheduledAt,
          effectiveAt,
          status: inferStatus(scheduledAt, event, now),
          event,
        };
      }),
    )
    .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());
}

export function eventKey(medicationId: string, scheduledAt: string) {
  return `${medicationId}:${new Date(scheduledAt).toISOString()}`;
}

export function summarizeDoses(instances: DoseInstance[]) {
  return {
    total: instances.length,
    taken: instances.filter((d) => d.status === 'taken' || d.status === 'taken_late').length,
    pending: instances.filter((d) => d.status === 'upcoming' || d.status === 'soon' || d.status === 'due' || d.status === 'snoozed').length,
    upcoming: instances.filter((d) => d.status === 'upcoming').length,
    soon: instances.filter((d) => d.status === 'soon').length,
    due: instances.filter((d) => d.status === 'due').length,
    late: instances.filter((d) => d.status === 'late').length,
    missed: instances.filter((d) => d.status === 'missed').length,
  };
}


export function normalizeTimes(times: string[]) {
  return [...new Set(times.map((time) => time.trim()).filter(Boolean))]
    .map((time) => (time.length === 5 ? time : `${time}:00`.slice(0, 5)))
    .sort();
}
