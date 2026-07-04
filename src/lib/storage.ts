import type { CareData } from './types';
import { demoData } from './demo-data';
import { getTodayLocalDate } from './date';
import { hydrateUserSettings } from './water';

const STORAGE_KEY = 'thuoc-nhac-care-data-v4';
const LEGACY_KEYS = ['thuoc-nhac-care-data-v3', 'thuoc-nhac-care-data-v2', 'thuoc-nhac-care-data-v1'];

export function loadCareData(): CareData {
  const raw = window.localStorage.getItem(STORAGE_KEY) ?? LEGACY_KEYS.map((key) => window.localStorage.getItem(key)).find(Boolean);
  if (!raw) return normalizeCareData(demoData);

  try {
    return normalizeCareData(JSON.parse(raw) as Partial<CareData>);
  } catch {
    return normalizeCareData(demoData);
  }
}

export function saveCareData(data: CareData) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function resetCareData() {
  window.localStorage.removeItem(STORAGE_KEY);
  LEGACY_KEYS.forEach((key) => window.localStorage.removeItem(key));
}

function normalizeCareData(data: Partial<CareData>): CareData {
  const fallbackCourseId = data.activeCourseId ?? data.treatmentCourses?.[0]?.id ?? 'course-current';
  const fallbackCourse = {
    id: fallbackCourseId,
    name: 'Đợt điều trị 1',
    startedAt: data.medications?.[0]?.startDate ?? getTodayLocalDate(),
    status: 'active' as const,
    source: 'mixed' as const,
    createdAt: data.medications?.[0]?.createdAt ?? new Date().toISOString(),
  };

  const treatmentCourses = data.treatmentCourses?.length ? data.treatmentCourses : [fallbackCourse];
  const activeCourseId = data.activeCourseId ?? treatmentCourses.find((course) => course.status === 'active')?.id ?? treatmentCourses[0]?.id;

  return {
    treatmentCourses,
    activeCourseId,
    medications: (data.medications ?? []).map((medication) => ({
      ...medication,
      courseId: medication.courseId ?? activeCourseId,
    })),
    doseEvents: data.doseEvents ?? [],
    appointments: (data.appointments ?? []).map((appointment) => ({
      ...appointment,
      courseId: appointment.courseId ?? activeCourseId,
    })),
    doctorNotes: (data.doctorNotes ?? []).map((note) => ({
      ...note,
      courseId: note.courseId ?? activeCourseId,
    })),
    userSettings: hydrateUserSettings(data.userSettings),
    healthPhotoEntries: (data.healthPhotoEntries ?? []).map((entry) => ({
      ...entry,
      tags: entry.tags?.filter(Boolean),
    })),
  };
}
