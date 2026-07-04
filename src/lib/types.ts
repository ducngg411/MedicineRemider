export type DoseStatus = 'upcoming' | 'soon' | 'due' | 'late' | 'taken' | 'taken_late' | 'skipped' | 'snoozed' | 'missed';

export type MedicationSource = 'manual' | 'gemini' | 'demo';

export interface TreatmentCourse {
  id: string;
  name: string;
  startedAt: string;
  endedAt?: string;
  status: 'active' | 'archived';
  source: MedicationSource | 'mixed';
  createdAt: string;
}

export interface Medication {
  id: string;
  courseId?: string;
  patientName: string;
  name: string;
  genericName?: string;
  strength?: string;
  instructions: string;
  form?: string;
  source: MedicationSource;
  startDate: string;
  endDate?: string;
  scheduleTimes: string[];
  durationDays?: number;
  quantity?: number;
  remaining?: number;
  doctorNotes?: string;
  createdAt: string;
}

export interface DoseEvent {
  id: string;
  medicationId: string;
  scheduledAt: string;
  status: DoseStatus;
  actedAt?: string;
  note?: string;
}

export interface Appointment {
  id: string;
  courseId?: string;
  title: string;
  clinic?: string;
  appointmentAt: string;
  notes?: string;
  createdAt: string;
}

export interface DoctorNote {
  id: string;
  courseId?: string;
  note: string;
  category: 'warning' | 'care' | 'recheck' | 'other';
  pinned: boolean;
  createdAt: string;
}

export interface WaterReminderConfig {
  enabled: boolean;
  weightKg?: number;
  heightCm?: number;
  autoCalculateGoal: boolean;
  dailyGoalMl: number;
  startTime: string;
  endTime: string;
  intervalMinutes: number;
}

export interface UserSettings {
  onboardingCompleted: boolean;
  notificationEnabled: boolean;
  displayName?: string;
  waterReminder: WaterReminderConfig;
}

export interface WaterReminder {
  time: string;
  amountMl: number;
}

export type TrackingBodyArea =
  | 'face'
  | 'forehead'
  | 'left_cheek'
  | 'right_cheek'
  | 'chin'
  | 'back'
  | 'chest'
  | 'arm'
  | 'other';

export interface HealthPhotoEntry {
  id: string;
  courseId?: string;
  imageLocalKey: string;
  imageMimeType: string;
  imageSize: number;
  bodyArea: TrackingBodyArea;
  note?: string;
  tags?: string[];
  takenAt: string;
  createdAt: string;
}

export interface DoseInstance {
  id: string;
  medication: Medication;
  scheduledAt: Date;
  status: DoseStatus;
  event?: DoseEvent;
}

export interface ExtractionDraft {
  patientName?: string;
  medicines: Array<{
    name: string;
    rawNameLine?: string;
    genericName?: string;
    brandName?: string;
    strength?: string;
    form?: string;
    instructions: string;
    scheduleTimes?: string[];
    durationDays?: number;
    quantity?: number;
    confidence?: number;
    needsReview?: string[];
  }>;
  doctorNotes: string[];
  appointments: Array<{
    title: string;
    appointmentAt?: string;
    notes?: string;
  }>;
  warnings: string[];
}

export interface CareData {
  treatmentCourses: TreatmentCourse[];
  activeCourseId?: string;
  medications: Medication[];
  doseEvents: DoseEvent[];
  appointments: Appointment[];
  doctorNotes: DoctorNote[];
  userSettings: UserSettings;
  healthPhotoEntries: HealthPhotoEntry[];
}

export type ManualMedicationInput = Omit<Medication, 'id' | 'source' | 'createdAt'> & {
  source?: MedicationSource;
};

export interface DayStreak {
  dateStr: string;
  label: string;
  isToday: boolean;
  status: 'done' | 'missed' | 'pending' | 'empty';
  totalCount: number;
  takenCount: number;
}
