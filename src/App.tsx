import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import {
  ArrowLeftRight,
  Bell,
  BookOpen,
  Calendar,
  CalendarRange,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Columns2,
  Droplets,
  FileText,
  Home,
  Images,
  Loader2,
  LogIn,
  Mail,
  Pill,
  Plus,
  PencilLine,
  RefreshCw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase } from './lib/supabase';
import { demoExtractionDraft } from './lib/demo-data';
import { addDays, formatDateParts, formatShortDateTime, formatTime, formatWeekday, getTodayLocalDate, getMsUntilMidnightVN, toDateInputValue } from './lib/date';
import {
  buildDoseInstances,
  eventKey,
  getDoseEventsNeedingRemoteSync,
  isMedicationTrackedByActiveCourse,
  mergeDoseEvents,
  normalizeDurationDays,
  normalizeTimes,
  summarizeDoses,
} from './lib/schedule';
import { loadCareData, resetCareData, saveCareData } from './lib/storage';
import { disablePushSubscriptions, getInstallState, subscribeToNotifications } from './lib/pwa';
import { calculateDailyWaterGoal, generateWaterReminders, getNextWaterReminder, hydrateUserSettings, hydrateWaterConfig } from './lib/water';
import { deleteTrackingImage, getTrackingImageUrl, saveTrackingImage } from './lib/tracking-images';
import {
  getCompareByDaysAgo,
  getFirstVsLatest,
  getPreviousVsLatest,
  getTimelineBetween,
  normalizeComparePair,
  sortPhotosByDate,
} from './lib/photo-comparison';
import type { ComparisonType, PhotoComparePair } from './lib/photo-comparison';
import { TodayView, CabinetView, isUnitForm, DoctorNotesSheet } from './components/Views';
import type {
  Appointment,
  CareData,
  DayStreak,
  DoctorNote,
  DoseEvent,
  DoseInstance,
  DoseStatus,
  ExtractionDraft,
  HealthPhotoEntry,
  ManualMedicationInput,
  Medication,
  TrackingBodyArea,
  TreatmentCourse,
  UserSettings,
  WaterReminderConfig,
} from './lib/types';

type View = 'today' | 'cabinet' | 'tracking' | 'add' | 'settings';
type SyncMode = 'local' | 'remote';
type CourseAddMode = 'current' | 'new';
type ComparisonOptionId = 'first_vs_latest' | 'previous_vs_latest' | 'days_7' | 'days_14' | 'days_30' | 'custom';
type CompareViewMode = 'side_by_side' | 'slider' | 'carousel';
type TrackingComparisonOption = {
  id: ComparisonOptionId;
  type: ComparisonType;
  title: string;
  eyebrow: string;
  description: string;
  unavailable: string;
  icon: LucideIcon;
  pair: PhotoComparePair<HealthPhotoEntry> | null;
};
type CoursePlan = {
  data: CareData;
  courseId: string;
  createdCourse?: TreatmentCourse;
  archivedCourses: TreatmentCourse[];
};

const blankManualInput: ManualMedicationInput = {
  patientName: 'Trang',
  name: '',
  genericName: '',
  strength: '',
  instructions: '',
  form: 'viên',
  startDate: getTodayLocalDate(),
  endDate: '',
  scheduleTimes: ['08:30'],
  durationDays: 30,
  quantity: undefined,
  remaining: undefined,
  doctorNotes: '',
};

export function App() {
  const [view, setView] = useState<View>('today');
  const [data, setData] = useState<CareData>(() => loadCareData());
  const [manualInput, setManualInput] = useState<ManualMedicationInput>(blankManualInput);
  const [draft, setDraft] = useState<ExtractionDraft | null>(null);
  const [courseAddMode, setCourseAddMode] = useState<CourseAddMode>('current');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractStep, setExtractStep] = useState(0); // 0=idle 1=reading 2=analysing 3=building
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(!supabase);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkCooldownUntil, setMagicLinkCooldownUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState<SyncMode>('local');
  const [isSyncing, setIsSyncing] = useState(false);
  const [pwaState, setPwaState] = useState(() => (typeof window === 'undefined' ? null : getInstallState()));
  const [showNotesSheet, setShowNotesSheet] = useState(false);
  const pendingDoseEventsRef = useRef<Map<string, DoseEvent>>(new Map());

  const activeCourse = useMemo(() => getActiveCourse(data), [data]);
  const activeCourseId = activeCourse?.id;
  const knownCourseIds = useMemo(() => new Set(data.treatmentCourses.map((course) => course.id)), [data.treatmentCourses]);
  const scheduleNow = useMemo(() => new Date(nowMs), [nowMs]);
  const activeMedications = useMemo(
    () => data.medications.filter((medication) => isMedicationTrackedByActiveCourse(medication, activeCourseId, knownCourseIds)),
    [data.medications, activeCourseId, knownCourseIds],
  );
  const activeDoctorNotes = useMemo(
    () => data.doctorNotes.filter((note) => note.courseId === activeCourseId),
    [data.doctorNotes, activeCourseId],
  );

  const doses = useMemo(
    () => buildDoseInstances(activeMedications, data.doseEvents, scheduleNow, scheduleNow),
    [activeMedications, data.doseEvents, scheduleNow],
  );

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    const resetScroll = () => {
      document.body.classList.remove('keyboard-open');
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      mainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    };

    const frame = window.requestAnimationFrame(resetScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [view]);

  const streak = useMemo(() => {
    const labels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const list: DayStreak[] = [];
    const todayStr = getTodayLocalDate();
    const now = scheduleNow;

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const parts = formatDateParts(d);
      const dateStr = parts.date;
      const label = labels[d.getDay()];
      const isToday = dateStr === todayStr;

      const dayDoses = buildDoseInstances(activeMedications, data.doseEvents, d, now);
      const totalCount = dayDoses.length;

      let status: 'done' | 'missed' | 'pending' | 'empty' = 'empty';
      const takenCount = dayDoses.filter((inst) => inst.status === 'taken' || inst.status === 'taken_late').length;
      
      if (totalCount > 0) {
        if (takenCount === totalCount) {
          status = 'done';
        } else {
          const hasMissed = dayDoses.some((inst) => inst.status === 'missed' || inst.status === 'late');
          // If past day or there are missed/late ones today, it is missed
          if (!isToday || hasMissed) {
            status = 'missed';
          } else {
            status = 'pending';
          }
        }
      }

      list.push({
        dateStr,
        label,
        isToday,
        status,
        totalCount,
        takenCount,
      });
    }
    return list;
  }, [activeMedications, data.doseEvents, scheduleNow]);

  const upcomingAppointments = useMemo(
    () => data.appointments.slice().sort((a, b) => new Date(a.appointmentAt).getTime() - new Date(b.appointmentAt).getTime()),
    [data.appointments],
  );

  useEffect(() => {
    saveCareData(data);
  }, [data]);

  useEffect(() => {
    if (!householdId || pendingDoseEventsRef.current.size === 0) return;
    const pendingDoseEvents = Array.from(pendingDoseEventsRef.current.values());
    void syncDoseEventsToRemote(pendingDoseEvents, householdId);
  }, [householdId, data.doseEvents]);

  // Midnight refresh — rebuild dose list when VN date changes
  useEffect(() => {
    const ms = getMsUntilMidnightVN();
    const t = setTimeout(() => window.location.reload(), ms + 500);
    return () => clearTimeout(t);
  }, []);

  // Auto-dismiss notice after 4 s
  useEffect(() => {
    if (!notice) return;
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
    return () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); };
  }, [notice]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;

    function updateKeyboardState() {
      const activeElement = document.activeElement;
      const isTextField = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLSelectElement;
      const viewportIsShort = viewport ? viewport.height < window.innerHeight - 120 : false;
      document.body.classList.toggle('keyboard-open', Boolean(isTextField && viewportIsShort));
    }

    function keepFocusedFieldVisible() {
      updateKeyboardState();
      const activeElement = document.activeElement;
      if (!(activeElement instanceof HTMLElement)) return;
      if (!activeElement.matches('input, textarea, select')) return;
      window.setTimeout(() => {
        activeElement.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      }, 80);
    }

    window.addEventListener('focusin', keepFocusedFieldVisible);
    window.addEventListener('focusout', updateKeyboardState);
    viewport?.addEventListener('resize', updateKeyboardState);
    viewport?.addEventListener('scroll', updateKeyboardState);

    return () => {
      document.body.classList.remove('keyboard-open');
      window.removeEventListener('focusin', keepFocusedFieldVisible);
      window.removeEventListener('focusout', updateKeyboardState);
      viewport?.removeEventListener('resize', updateKeyboardState);
      viewport?.removeEventListener('scroll', updateKeyboardState);
    };
  }, []);

  useEffect(() => {
    const displayName = data.userSettings.displayName;
    if (!displayName) return;

    setManualInput((current) => {
      if (current.patientName && current.patientName !== blankManualInput.patientName) return current;
      return { ...current, patientName: displayName };
    });
  }, [data.userSettings.displayName]);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data: authData }) => {
      const email = authData.session?.user.email ?? null;
      setSessionEmail(email);
      if (authData.session) {
        void loadRemoteData();
      }
      setAuthChecked(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user.email ?? null);
      setMagicLinkSent(false);
      if (session) {
        void loadRemoteData();
      } else {
        setSyncMode('local');
        setHouseholdId(null);
        setAuthChecked(true);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function loadRemoteData() {
    if (!supabase) return;
    setIsSyncing(true);

    try {
      const { data: household, error: profileError } = await supabase.rpc('ensure_user_profile');
      if (profileError) throw profileError;
      const nextHouseholdId = household as string;
      setHouseholdId(nextHouseholdId);

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

      const [profileResult, coursesResult, medicationsResult, eventsResult, appointmentsResult, notesResult] = await Promise.all([
        supabase.from('profiles').select('display_name, onboarding_completed, notification_enabled, water_reminder').eq('id', userData.user.id).maybeSingle(),
        supabase.from('treatment_courses').select('*').order('started_at', { ascending: false }),
        supabase.from('medications').select('*').order('created_at', { ascending: false }),
        supabase.from('dose_events').select('*').order('scheduled_at', { ascending: false }),
        supabase.from('appointments').select('*').order('appointment_at', { ascending: true }),
        supabase.from('doctor_notes').select('*').order('created_at', { ascending: false }),
      ]);

      if (profileResult.error) throw profileResult.error;
      if (coursesResult.error) throw coursesResult.error;
      if (medicationsResult.error) throw medicationsResult.error;
      if (eventsResult.error) throw eventsResult.error;
      if (appointmentsResult.error) throw appointmentsResult.error;
      if (notesResult.error) throw notesResult.error;

      const courseRows = (coursesResult.data ?? []) as Array<Record<string, unknown>>;
      const medicationRows = (medicationsResult.data ?? []) as Array<Record<string, unknown>>;
      const appointmentRows = (appointmentsResult.data ?? []) as Array<Record<string, unknown>>;
      const noteRows = (notesResult.data ?? []) as Array<Record<string, unknown>>;
      const eventRows = (eventsResult.data ?? []) as Array<Record<string, unknown>>;
      const courses = courseRows.map(mapTreatmentCourseFromDb);
      const remoteActiveCourseId = courses.find((course) => course.status === 'active')?.id ?? courses[0]?.id;
      const remoteCourseIds = new Set(courses.map((course) => course.id));
      const remoteMedications = medicationRows
        .map(mapMedicationFromDb)
        .map((medication) => attachFallbackCourse(medication, remoteActiveCourseId, remoteCourseIds));
      const remoteMedicationIds = new Set(remoteMedications.map((medication) => medication.id));
      const remoteDoseEvents = eventRows.map(mapDoseEventFromDb);
      const localDoseEventsForRepair = [
        ...data.doseEvents,
        ...Array.from(pendingDoseEventsRef.current.values()),
      ];
      const repairedDoseEvents = mergeDoseEvents(remoteDoseEvents, localDoseEventsForRepair, remoteMedicationIds);
      const doseEventsToRepair = getDoseEventsNeedingRemoteSync(remoteDoseEvents, repairedDoseEvents, remoteMedicationIds);

      setData((current) => {
        const localDoseEvents = [
          ...current.doseEvents,
          ...Array.from(pendingDoseEventsRef.current.values()),
        ];
        const doseEvents = mergeDoseEvents(remoteDoseEvents, localDoseEvents, remoteMedicationIds);

        return {
          treatmentCourses: courses,
          activeCourseId: remoteActiveCourseId,
          medications: remoteMedications,
          doseEvents,
          appointments: appointmentRows
            .map(mapAppointmentFromDb)
            .map((appointment) => attachFallbackCourse(appointment, remoteActiveCourseId, remoteCourseIds)),
          doctorNotes: noteRows
            .map(mapDoctorNoteFromDb)
            .map((note) => attachFallbackCourse(note, remoteActiveCourseId, remoteCourseIds)),
          userSettings: mapUserSettingsFromDb(profileResult.data),
          healthPhotoEntries: current.healthPhotoEntries,
        };
      });
      void repairRemoteCourseLinks(remoteActiveCourseId, medicationRows, appointmentRows, noteRows);
      if (doseEventsToRepair.length) {
        void syncDoseEventsToRemote(doseEventsToRepair, nextHouseholdId);
      }
      setSyncMode('remote');
      // sync success is silent — no user-facing notice needed
    } catch (error) {
      console.error(error);
      setNotice('Không kết nối được Supabase, đang dùng dữ liệu cục bộ.');
    } finally {
      setIsSyncing(false);
    }
  }

  async function sendMagicLink() {
    if (!supabase || !authEmail) return;
    if (Date.now() < magicLinkCooldownUntil) {
      setNotice('Đợi một chút rồi gửi lại link đăng nhập nhé.');
      return;
    }

    setMagicLinkCooldownUntil(Date.now() + 60_000);
    const { error } = await supabase.auth.signInWithOtp({
      email: authEmail,
      options: { emailRedirectTo: window.location.origin },
    });

    if (!error) setMagicLinkSent(true);
    if (error) {
      const message = getAuthNotice(error);
      setNotice(message);
      if (!isAuthRateLimitError(error)) setMagicLinkCooldownUntil(0);
      return;
    }

    setNotice('Đã gửi link đăng nhập vào email.');
  }

  async function signInWithGoogle() {
    if (!supabase) return;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      setNotice(error.message);
    }
  }

  async function updateUserSettings(nextSettings: UserSettings) {
    const normalized = hydrateUserSettings(nextSettings);
    setData((current) => ({
      ...current,
      userSettings: normalized,
    }));

    if (!supabase || syncMode !== 'remote') return;
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return;

    const { error } = await supabase
      .from('profiles')
      .update(mapUserSettingsToDb(normalized))
      .eq('id', authData.user.id);

    if (error) {
      console.error(error);
      setNotice('Đã lưu trên máy này, nhưng Supabase chưa nhận được cài đặt.');
    }
  }

  async function updateWaterReminder(nextConfig: WaterReminderConfig) {
    await updateUserSettings({
      ...data.userSettings,
      waterReminder: hydrateWaterConfig(nextConfig),
    });
  }

  async function addMedication(input: ManualMedicationInput) {
    const targetCourseMode = data.medications.length > 0 ? courseAddMode : 'current';
    const coursePlan = prepareCourseForAdd(data, targetCourseMode, input.source ?? 'manual');
    const normalizedTimes = normalizeTimes(input.scheduleTimes);
    const endDate =
      input.endDate || (input.durationDays ? addDays(input.startDate, Math.max(input.durationDays - 1, 0)) : undefined);

    const medication: Medication = {
      ...input,
      id: crypto.randomUUID(),
      courseId: coursePlan.courseId,
      source: input.source ?? 'manual',
      scheduleTimes: normalizedTimes.length ? normalizedTimes : ['08:30'],
      endDate,
      createdAt: new Date().toISOString(),
    };

    setData({
      ...coursePlan.data,
      medications: [medication, ...coursePlan.data.medications],
    });

    await persistCoursePlan(coursePlan);
    await persistMedication(medication);
    setManualInput(blankManualInput);
    setCourseAddMode('current');
    setNotice('Đã thêm lịch nhắc mới.');
    setView('today');
  }

  async function persistMedication(medication: Medication) {
    if (!supabase || syncMode !== 'remote' || !householdId) return;
    const { error } = await supabase.from('medications').insert(mapMedicationToDb(medication, householdId));
    if (error) {
      console.error(error);
      setNotice('Đã lưu cục bộ, nhưng Supabase chưa nhận được bản ghi.');
    }
  }

  async function persistCoursePlan(plan: CoursePlan) {
    const client = supabase;
    if (!client || syncMode !== 'remote' || !householdId) return;
    const writes = [
      ...(plan.createdCourse ? [client.from('treatment_courses').upsert(mapTreatmentCourseToDb(plan.createdCourse, householdId))] : []),
      ...plan.archivedCourses.map((course) => client.from('treatment_courses').upsert(mapTreatmentCourseToDb(course, householdId))),
    ];

    if (!writes.length) return;
    const results = await Promise.all(writes);
    const error = results.find((result) => result.error)?.error;
    if (error) {
      console.error(error);
      setNotice('Đã lưu cục bộ, nhưng Supabase chưa nhận được đợt điều trị.');
    }
  }

  async function syncDoseEventToRemote(event: DoseEvent, targetHouseholdId = householdId, nextRemaining?: number) {
    if (!supabase || !targetHouseholdId) return false;
    const client = supabase;

    const saveEvent = async (doseEvent: DoseEvent) => client.from('dose_events').upsert(mapDoseEventToDb(doseEvent, targetHouseholdId), {
      onConflict: 'medication_id,scheduled_at',
    });

    let eventToSave = event;
    let eventResult = await saveEvent(eventToSave);

    if (eventResult.error && event.status === 'taken_late' && isTakenLateEnumError(eventResult.error)) {
      eventToSave = { ...event, status: 'taken' };
      eventResult = await saveEvent(eventToSave);
      if (!eventResult.error) {
        setNotice('Server chưa hỗ trợ nhãn uống muộn, đã lưu tạm là đã uống.');
      }
    }

    const stockResult = nextRemaining !== undefined
      ? await client.from('medications').update({ remaining: nextRemaining }).eq('id', event.medicationId)
      : { error: null };
    const error = eventResult.error ?? stockResult.error;

    if (error) {
      console.error(error);
      setNotice('Đã lưu trên máy này, nhưng chưa đồng bộ được Supabase.');
      return false;
    }

    pendingDoseEventsRef.current.delete(eventKey(event.medicationId, event.scheduledAt));
    return true;
  }

  async function syncDoseEventsToRemote(events: DoseEvent[], targetHouseholdId = householdId) {
    await Promise.all(events.map((event) => syncDoseEventToRemote(event, targetHouseholdId)));
  }

  async function updateDose(instance: DoseInstance, status: DoseStatus, options?: { snoozedUntil?: Date }) {
    // Prevent double-marking: if already taken/skipped, ignore
    if (instance.status === 'taken' || instance.status === 'taken_late' || instance.status === 'skipped') return;

    // If marking a late dose as "taken", record it as "taken_late" for accurate history
    const savedStatus: DoseStatus = (status === 'taken' && instance.status === 'late') ? 'taken_late' : status;
    const shouldDecrementStock =
      (status === 'taken' || status === 'taken_late') &&
      typeof instance.medication.remaining === 'number' &&
      isUnitForm(instance.medication.form);
    const nextRemaining = shouldDecrementStock ? Math.max(instance.medication.remaining! - 1, 0) : undefined;

    const event: DoseEvent = {
      id: instance.event?.id ?? crypto.randomUUID(),
      medicationId: instance.medication.id,
      scheduledAt: instance.scheduledAt.toISOString(),
      status: savedStatus,
      actedAt: new Date().toISOString(),
      snoozedUntil: status === 'snoozed' ? options?.snoozedUntil?.toISOString() : undefined,
    };
    pendingDoseEventsRef.current.set(eventKey(event.medicationId, event.scheduledAt), event);
    const nextEventKey = eventKey(event.medicationId, event.scheduledAt);

    setData((current) => ({
      ...current,
      doseEvents: [
        event,
        ...current.doseEvents.filter((item) => item.id !== event.id && eventKey(item.medicationId, item.scheduledAt) !== nextEventKey),
      ],
      medications: current.medications.map((medication) => {
        if (medication.id !== instance.medication.id) return medication;
        if (status !== 'taken' && status !== 'taken_late') return medication;
        if (typeof medication.remaining !== 'number') return medication;
        if (!isUnitForm(medication.form)) return medication;
        return { ...medication, remaining: Math.max(medication.remaining - 1, 0) };
      }),
    }));

    await syncDoseEventToRemote(event, householdId, nextRemaining);
  }

  async function extractPrescription(file?: File) {
    setIsExtracting(true);
    setExtractStep(1);
    setDraft(null);

    try {
      if (!file) {
        setExtractStep(2);
        await wait(600);
        setExtractStep(3);
        await wait(600);
        setDraft(demoExtractionDraft);
        setNotice('Chưa chọn ảnh, mình mở bản OCR demo để bạn test flow.');
        return;
      }

      if (!supabase) {
        setExtractStep(2);
        await wait(600);
        setExtractStep(3);
        await wait(600);
        setDraft(demoExtractionDraft);
        setNotice('Chưa cấu hình Supabase trong .env.local, mình mở bản OCR demo để bạn test flow.');
        return;
      }

      const { data: authData } = await supabase.auth.getSession();
      if (!authData.session) {
        throw new Error('Bạn cần đăng nhập ở tab Cài đặt trước khi dùng Gemini OCR.');
      }

      setExtractStep(2);
      const base64 = await fileToBase64(file);
      setExtractStep(3);
      const { data: result, error } = await supabase.functions.invoke<ExtractionDraft>('extract-prescription', {
        body: { image: { mimeType: file.type, data: base64 } },
      });

      if (error) throw error;
      if (!result?.medicines?.length) throw new Error('Gemini không trả về danh sách thuốc.');

      setDraft(result);
      setNotice(`Gemini tìm thấy ${result.medicines.length} dòng thuốc. Kiểm tra lại trước khi lưu nhé.`);
    } catch (error) {
      console.error(error);
      setDraft(null);
      const message = await getReadableError(error);
      setNotice(`Gemini chưa đọc được đơn: ${message}`);
    } finally {
      setIsExtracting(false);
      setExtractStep(0);
    }
  }

  async function confirmDraft() {
    if (!draft) return;
    const startDate = getTodayLocalDate();
    const targetCourseMode = data.medications.length > 0 ? courseAddMode : 'current';
    const coursePlan = prepareCourseForAdd(data, targetCourseMode, 'gemini', draft.patientName);
    const meds: Medication[] = draft.medicines.filter((medicine) => medicine.name.trim() && medicine.instructions.trim()).map((medicine) => {
      const form = inferMedicineForm(medicine.form, medicine.name, medicine.instructions);
      const durationDays = normalizeDurationDays(medicine.durationDays) ?? (isUnitForm(form) ? 30 : undefined);
      const reviewNotes = getActionableReviewNotes(medicine.needsReview);
      return {
        id: crypto.randomUUID(),
        patientName: draft.patientName || 'Người dùng',
        courseId: coursePlan.courseId,
        name: medicine.name,
        genericName: medicine.genericName,
        strength: medicine.strength,
        form,
        instructions: medicine.instructions,
        source: 'gemini',
        startDate,
        endDate: durationDays ? addDays(startDate, durationDays - 1) : undefined,
        scheduleTimes: normalizeTimes(medicine.scheduleTimes?.length ? medicine.scheduleTimes : ['08:30']),
        durationDays,
        quantity: medicine.quantity,
        remaining: medicine.quantity,
        doctorNotes: reviewNotes.length ? reviewNotes.join(', ') : undefined,
        createdAt: new Date().toISOString(),
      };
    });

    const draftNotes = draft.doctorNotes.map((note) => note.trim()).filter(Boolean);
    const draftWarnings = draft.warnings.map((note) => note.trim()).filter(Boolean);
    const notes: DoctorNote[] = [...draftNotes, ...draftWarnings].map((note, index) => ({
      id: crypto.randomUUID(),
      courseId: coursePlan.courseId,
      note,
      category: index >= draftNotes.length ? 'warning' : categorizeDoctorNote(note),
      pinned: true,
      createdAt: new Date().toISOString(),
    }));

    const appointments: Appointment[] = draft.appointments.map((appointment) => ({
      id: crypto.randomUUID(),
      courseId: coursePlan.courseId,
      title: appointment.title,
      appointmentAt: appointment.appointmentAt ?? `${addDays(startDate, 30)}T09:00:00+07:00`,
      notes: appointment.notes,
      createdAt: new Date().toISOString(),
    }));

    setData({
      ...coursePlan.data,
      medications: [...meds, ...coursePlan.data.medications],
      doctorNotes: [...notes, ...coursePlan.data.doctorNotes],
      appointments: [...appointments, ...coursePlan.data.appointments],
    });

    const client = supabase;
    if (client && syncMode === 'remote' && householdId) {
      await persistCoursePlan(coursePlan);
      await Promise.all([
        ...meds.map((medication) => client.from('medications').insert(mapMedicationToDb(medication, householdId))),
        ...notes.map((note) => client.from('doctor_notes').insert(mapDoctorNoteToDb(note, householdId))),
        ...appointments.map((appointment) => client.from('appointments').insert(mapAppointmentToDb(appointment, householdId))),
      ]);
    }

    setDraft(null);
    setCourseAddMode('current');
    setNotice('Đã tạo lịch từ đơn thuốc. Nhớ đối chiếu với đơn gốc nhé.');
    setView('today');
  }

  async function enableNotifications() {
    try {
      const subscription = await subscribeToNotifications();
      setPwaState(getInstallState());
      await updateUserSettings({
        ...data.userSettings,
        notificationEnabled: true,
      });
      const name = data.userSettings.displayName;
      setNotice(subscription ? `Đã bật nhắc cho ${name ?? 'bạn'} trên thiết bị này.` : 'Đã gửi yêu cầu bật notification.');
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Chưa bật được notification.');
      return false;
    }
  }

  async function disableNotifications() {
    try {
      await updateUserSettings({
        ...data.userSettings,
        notificationEnabled: false,
      });
      await disablePushSubscriptions();
      setPwaState(getInstallState());
      setNotice('Đã tắt nhắc uống thuốc và nhắc nước trong app.');
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Chưa tắt được notification.');
      return false;
    }
  }

  async function setNotificationsEnabled(enabled: boolean) {
    return enabled ? enableNotifications() : disableNotifications();
  }

  async function deleteMedication(id: string) {
    setData((current) => ({
      ...current,
      medications: current.medications.filter((m) => m.id !== id),
      doseEvents: current.doseEvents.filter((event) => event.medicationId !== id),
    }));
    if (supabase && syncMode === 'remote' && householdId) {
      await supabase.from('medications').delete().eq('id', id);
    }
    setNotice('Đã xóa thuốc.');
  }

  async function updateMedication(medication: Medication) {
    setData((current) => ({
      ...current,
      medications: current.medications.map((m) => (m.id === medication.id ? medication : m)),
    }));
    if (supabase && syncMode === 'remote' && householdId) {
      const { error } = await supabase
        .from('medications')
        .update(mapMedicationToDb(medication, householdId))
        .eq('id', medication.id);
      if (error) {
        console.error(error);
        setNotice('Đã lưu cục bộ, nhưng Supabase chưa cập nhật được.');
        return;
      }
    }
    setNotice('Đã cập nhật thuốc.');
  }

  async function deleteCourseMedications(courseId: string) {
    const ids = data.medications.filter((medication) => medication.courseId === courseId).map((medication) => medication.id);
    if (!ids.length) return;
    if (!window.confirm('Xóa tất cả thuốc trong đợt này? Lịch sử uống của các thuốc này cũng sẽ bị xóa.')) return;

    setData((current) => ({
      ...current,
      medications: current.medications.filter((medication) => medication.courseId !== courseId),
      doseEvents: current.doseEvents.filter((event) => !ids.includes(event.medicationId)),
    }));

    if (supabase && syncMode === 'remote' && householdId) {
      await supabase.from('medications').delete().eq('course_id', courseId);
    }
    setNotice('Đã xóa thuốc của đợt này.');
  }

  async function deleteAllMedications() {
    if (!data.medications.length) return;
    if (!window.confirm('Xóa TẤT CẢ thuốc và lịch sử uống? Dặn dò bác sĩ và các đợt điều trị vẫn được giữ.')) return;

    setData((current) => ({
      ...current,
      medications: [],
      doseEvents: [],
    }));

    if (supabase && syncMode === 'remote' && householdId) {
      await supabase.from('medications').delete().eq('household_id', householdId);
    }
    setNotice('Đã xóa tất cả thuốc.');
  }

  async function deleteDoctorNote(id: string) {
    setData((current) => ({
      ...current,
      doctorNotes: current.doctorNotes.filter((note) => note.id !== id),
    }));

    if (supabase && syncMode === 'remote' && householdId) {
      await supabase.from('doctor_notes').delete().eq('id', id);
    }
    setNotice('Đã xóa dặn dò.');
  }

  async function toggleDoctorNotePinned(id: string) {
    let nextPinned = true;
    setData((current) => ({
      ...current,
      doctorNotes: current.doctorNotes.map((note) => {
        if (note.id !== id) return note;
        nextPinned = !note.pinned;
        return { ...note, pinned: nextPinned };
      }),
    }));

    if (supabase && syncMode === 'remote' && householdId) {
      await supabase.from('doctor_notes').update({ pinned: nextPinned }).eq('id', id);
    }
  }

  async function addTrackingEntry(input: { file: File; bodyArea: TrackingBodyArea; note: string; tags: string[]; takenAt: string }) {
    const id = crypto.randomUUID();
    const imageLocalKey = `tracking-${id}`;
    const imageRecord = await saveTrackingImage(input.file, imageLocalKey);
    const entry: HealthPhotoEntry = {
      id,
      courseId: activeCourseId,
      imageLocalKey,
      imageMimeType: imageRecord.mimeType,
      imageSize: imageRecord.size,
      bodyArea: input.bodyArea,
      note: input.note.trim() || undefined,
      tags: input.tags.length ? input.tags : undefined,
      takenAt: input.takenAt,
      createdAt: new Date().toISOString(),
    };

    setData((current) => ({
      ...current,
      healthPhotoEntries: [entry, ...current.healthPhotoEntries],
    }));
    setNotice('Đã lưu ảnh theo dõi trên thiết bị này.');
  }

  async function deleteTrackingEntry(entry: HealthPhotoEntry) {
    if (!window.confirm('Xóa ảnh theo dõi này khỏi thiết bị?')) return;
    await deleteTrackingImage(entry.imageLocalKey);
    setData((current) => ({
      ...current,
      healthPhotoEntries: current.healthPhotoEntries.filter((item) => item.id !== entry.id),
    }));
    setNotice('Đã xóa ảnh theo dõi.');
  }

  async function activateCourse(courseId: string) {
    const nextCourses = data.treatmentCourses.map((course) =>
      course.id === courseId
        ? { ...course, status: 'active' as const, endedAt: undefined }
        : { ...course, status: 'archived' as const, endedAt: course.endedAt ?? getTodayLocalDate() },
    );

    setData((current) => ({
      ...current,
      activeCourseId: courseId,
      treatmentCourses: nextCourses,
    }));

    const client = supabase;
    if (client && syncMode === 'remote' && householdId) {
      await Promise.all(nextCourses.map((course) => client.from('treatment_courses').upsert(mapTreatmentCourseToDb(course, householdId))));
    }
    setNotice('Đã chuyển đợt đang theo dõi.');
  }

  function resetLocal() {
    resetCareData();
    setData(loadCareData());
    setNotice('Đã khôi phục dữ liệu demo.');
  }

  if (!authChecked) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <Loader2 className="spin" size={24} />
          <p className="muted">Đang kiểm tra phiên đăng nhập...</p>
        </div>
      </div>
    );
  }

  if (!sessionEmail) {
    return (
      <AuthGate
        authEmail={authEmail}
        magicLinkSent={magicLinkSent}
        cooldownSeconds={Math.max(0, Math.ceil((magicLinkCooldownUntil - nowMs) / 1000))}
        canUseAuth={Boolean(supabase)}
        onAuthEmail={setAuthEmail}
        onSendMagicLink={sendMagicLink}
        onGoogleSignIn={signInWithGoogle}
      />
    );
  }

  if (!data.userSettings.displayName || !data.userSettings.onboardingCompleted) {
    return (
      <OnboardingFlow
        settings={data.userSettings}
        pwaState={pwaState}
        onEnableNotifications={enableNotifications}
        onUpdateSettings={updateUserSettings}
      />
    );
  }

  return (
    <div className="app-shell">
      <TopChrome
        syncMode={syncMode}
        sessionEmail={sessionEmail}
        displayName={data.userSettings.displayName}
        isSyncing={isSyncing}
        onOpenNotes={() => setShowNotesSheet(true)}
        notesCount={activeDoctorNotes.length}
      />

      <main className="app-main" ref={mainRef}>
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button className="icon-button small" onClick={() => setNotice(null)} aria-label="Đóng thông báo">
              <X size={16} />
            </button>
          </div>
        )}

        {view === 'today' && (
          <TodayView
            doses={doses}
            streak={streak}
            notes={activeDoctorNotes}
            displayName={data.userSettings.displayName}
            notificationBanner={!data.userSettings.notificationEnabled ? (
              <NotificationNudge displayName={data.userSettings.displayName} onNotify={enableNotifications} />
            ) : null}
            waterCard={data.userSettings.waterReminder.enabled ? (
              <WaterReminderCard config={data.userSettings.waterReminder} onEdit={() => setView('settings')} />
            ) : null}
            onDoseAction={updateDose}
            onAdd={() => setView('add')}
            onOpenNotes={() => setShowNotesSheet(true)}
          />
        )}



        {view === 'cabinet' && (
          <CabinetView
            medications={data.medications}
            doseEvents={data.doseEvents}
            appointments={upcomingAppointments}
            notes={data.doctorNotes}
            courses={data.treatmentCourses}
            activeCourseId={activeCourseId}
            onActivateCourse={activateCourse}
            onDelete={deleteMedication}
            onEdit={updateMedication}
            onDeleteCourseMedications={deleteCourseMedications}
            onDeleteAllMedications={deleteAllMedications}
            onDeleteNote={deleteDoctorNote}
            onToggleNotePinned={toggleDoctorNotePinned}
          />
        )}

        {view === 'tracking' && (
          <TrackingView
            entries={data.healthPhotoEntries}
            courses={data.treatmentCourses}
            activeCourseId={activeCourseId}
            onAddEntry={addTrackingEntry}
            onDeleteEntry={deleteTrackingEntry}
          />
        )}

        {view === 'add' && (
          <AddView
            input={manualInput}
            draft={draft}
            isExtracting={isExtracting}
            extractStep={extractStep}
            courseAddMode={courseAddMode}
            hasExistingCourse={data.medications.length > 0}
            onInputChange={setManualInput}
            onCourseAddMode={setCourseAddMode}
            onDraftChange={setDraft}
            onCancelDraft={() => setDraft(null)}
            onSubmit={() => addMedication(manualInput)}
            onExtract={extractPrescription}
            onConfirmDraft={confirmDraft}
          />
        )}

        {view === 'settings' && (
          <SettingsView
            authEmail={authEmail}
            sessionEmail={sessionEmail}
            syncMode={syncMode}
            pwaState={pwaState}
            onAuthEmail={setAuthEmail}
            onSendMagicLink={sendMagicLink}
            onSync={loadRemoteData}
            onNotificationsChange={setNotificationsEnabled}
            userSettings={data.userSettings}
            onUserSettingsChange={updateUserSettings}
            onWaterConfigChange={updateWaterReminder}
            onReset={resetLocal}
          />
        )}
      </main>

      <BottomNav view={view} onView={setView} />

      <DoctorNotesSheet
        isOpen={showNotesSheet}
        onClose={() => setShowNotesSheet(false)}
        notes={activeDoctorNotes}
      />
    </div>
  );
}

function AuthGate({
  authEmail,
  magicLinkSent,
  cooldownSeconds,
  canUseAuth,
  onAuthEmail,
  onSendMagicLink,
  onGoogleSignIn,
}: {
  authEmail: string;
  magicLinkSent: boolean;
  cooldownSeconds: number;
  canUseAuth: boolean;
  onAuthEmail: (email: string) => void;
  onSendMagicLink: () => void;
  onGoogleSignIn: () => void;
}) {
  const isCoolingDown = cooldownSeconds > 0;

  return (
    <div className="auth-shell">
      <form
        className="auth-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSendMagicLink();
        }}
      >
        <span className="badge forest">
          <Pill size={14} />
          PWA nhắc thuốc
        </span>
        <div className="auth-title">
          <h1>Ê! Thuốc chưa?</h1>
          <p>Nhập email để lưu lịch thuốc và nhắc bạn đúng giờ.</p>
        </div>

        {magicLinkSent ? (
          <div className="auth-mail-state">
            <Mail size={22} />
            <div>
              <strong>Kiểm tra email nha</strong>
              <p>Bấm link đăng nhập trong email để vào app.</p>
            </div>
          </div>
        ) : (
          <label>
            Email
            <input
              value={authEmail}
              type="email"
              placeholder="email của bạn"
              autoComplete="email"
              onChange={(event) => onAuthEmail(event.target.value)}
            />
          </label>
        )}

        {!canUseAuth && (
          <p className="muted">Chưa cấu hình Supabase trong .env.local nên chưa gửi magic link được.</p>
        )}

        <button className="secondary-button wide google-auth-button" type="button" disabled={!canUseAuth} onClick={onGoogleSignIn}>
          <span aria-hidden="true">G</span>
          Tiếp tục với Google
        </button>

        <button className="primary-button wide" type="submit" disabled={!canUseAuth || !authEmail || magicLinkSent || isCoolingDown}>
          <LogIn size={18} />
          {isCoolingDown ? `Gửi lại sau ${cooldownSeconds}s` : 'Tiếp tục'}
        </button>
      </form>
    </div>
  );
}

function OnboardingFlow({
  settings,
  pwaState,
  onEnableNotifications,
  onUpdateSettings,
}: {
  settings: UserSettings;
  pwaState: ReturnType<typeof getInstallState> | null;
  onEnableNotifications: () => Promise<boolean>;
  onUpdateSettings: (settings: UserSettings) => Promise<void>;
}) {
  const [step, setStep] = useState<'name' | 'notify' | 'water' | 'water-setup'>('name');
  const [isBusy, setIsBusy] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState(settings.displayName ?? '');
  const [waterDraft, setWaterDraft] = useState<WaterReminderConfig>(() =>
    hydrateWaterConfig({
      ...settings.waterReminder,
      enabled: true,
      autoCalculateGoal: true,
      dailyGoalMl: calculateDailyWaterGoal({ weightKg: settings.waterReminder.weightKg }),
    }),
  );
  const displayName = displayNameDraft.trim().replace(/\s+/g, ' ');

  async function saveAndEnterApp(nextWater: WaterReminderConfig) {
    setIsBusy(true);
    await onUpdateSettings({
      ...settings,
      displayName: settings.displayName ?? displayName,
      onboardingCompleted: true,
      waterReminder: hydrateWaterConfig(nextWater),
    });
    setIsBusy(false);
  }

  async function saveNameAndContinue() {
    if (!displayName) return;
    setIsBusy(true);
    await onUpdateSettings({
      ...settings,
      displayName,
    });
    setIsBusy(false);
    if (settings.onboardingCompleted) return;
    setStep('notify');
  }

  function patchWater(patch: Partial<WaterReminderConfig>) {
    setWaterDraft((current) => hydrateWaterConfig({ ...current, ...patch }));
  }

  const reminders = generateWaterReminders(waterDraft);

  return (
    <div className="auth-shell">
      <section className="onboarding-card">
        <span className="badge dark">Thiết lập lần đầu</span>

        {step === 'name' && (
          <>
            <div className="auth-title">
              <h1>App nên gọi bạn là gì?</h1>
              <p>Tên thật, biệt danh, hay cách gọi thân quen đều được.</p>
            </div>
            <label>
              Tên hiển thị
              <input
                value={displayNameDraft}
                maxLength={48}
                placeholder="Ví dụ: Trang, Mèo, chị Minh..."
                autoComplete="nickname"
                autoFocus
                onChange={(event) => setDisplayNameDraft(event.target.value)}
              />
            </label>
            <div className="onboarding-fact">
              <Sparkles size={20} />
              <span>{displayName ? `Mình sẽ gọi bạn là ${displayName}.` : 'Tên này dùng cho lời chào và nội dung nhắc.'}</span>
            </div>
            <div className="stack-actions">
              <button className="primary-button wide" disabled={isBusy || !displayName} onClick={saveNameAndContinue}>
                {isBusy ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
                Tiếp tục
              </button>
            </div>
          </>
        )}

        {step === 'notify' && (
          <>
            <div className="auth-title">
              <h1>Bật thông báo</h1>
              <p>App cần thông báo để nhắc {settings.displayName ?? (displayName || 'bạn')} uống thuốc đúng giờ.</p>
            </div>
            <div className="onboarding-fact">
              <Bell size={20} />
              <span>Quyền hiện tại: {notificationPermissionLabel(pwaState?.permission)}</span>
            </div>
            <div className="stack-actions">
              <button
                className="primary-button wide"
                disabled={isBusy}
                onClick={async () => {
                  setIsBusy(true);
                  const ok = await onEnableNotifications();
                  setIsBusy(false);
                  if (ok) setStep('water');
                }}
              >
                {isBusy ? <Loader2 className="spin" size={18} /> : <Bell size={18} />}
                Cho phép thông báo
              </button>
              <button
                className="secondary-button wide"
                disabled={isBusy}
                onClick={async () => {
                  await onUpdateSettings({ ...settings, notificationEnabled: false });
                  setStep('water');
                }}
              >
                Để sau
              </button>
            </div>
          </>
        )}

        {step === 'water' && (
          <>
            <div className="auth-title">
              <h1>Nhắc uống nước</h1>
              <p>Ngoài thuốc, app có thể nhắc bạn uống nước nhẹ nhàng trong ngày.</p>
            </div>
            <div className="water-preview-strip">
              <Droplets size={21} />
              <span>08:00 - 21:00 · mỗi 2 giờ · mặc định 2.000ml/ngày</span>
            </div>
            <div className="stack-actions">
              <button className="primary-button wide" onClick={() => setStep('water-setup')}>
                <Droplets size={18} />
                Bật nhắc nước
              </button>
              <button
                className="secondary-button wide"
                disabled={isBusy}
                onClick={() => saveAndEnterApp({ ...settings.waterReminder, enabled: false })}
              >
                Không cần
              </button>
            </div>
          </>
        )}

        {step === 'water-setup' && (
          <>
            <div className="auth-title">
              <h1>Thiết lập nước</h1>
              <p>Mục tiêu gợi ý là {waterDraft.dailyGoalMl.toLocaleString('vi-VN')}ml / ngày.</p>
            </div>
            <div className="two-cols">
              <label>
                Cân nặng
                <input
                  type="number"
                  min="30"
                  max="180"
                  value={waterDraft.weightKg ?? ''}
                  placeholder="60"
                  onChange={(event) => patchWater({ weightKg: Number(event.target.value) || undefined })}
                />
              </label>
              <label>
                Chiều cao
                <input
                  type="number"
                  min="120"
                  max="220"
                  value={waterDraft.heightCm ?? ''}
                  placeholder="170"
                  onChange={(event) => patchWater({ heightCm: Number(event.target.value) || undefined })}
                />
              </label>
            </div>
            <WaterConfigFields config={waterDraft} onChange={patchWater} />
            <div className="water-preview-strip">
              <Droplets size={21} />
              <span>{reminders.length} lần/ngày · khoảng {reminders[0]?.amountMl ?? 0}ml mỗi lần</span>
            </div>
            <div className="stack-actions">
              <button className="primary-button wide" disabled={isBusy} onClick={() => saveAndEnterApp(waterDraft)}>
                {isBusy ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
                Bắt đầu nhắc nước
              </button>
              <button
                className="secondary-button wide"
                disabled={isBusy}
                onClick={() => saveAndEnterApp({ ...waterDraft, enabled: true, autoCalculateGoal: false, dailyGoalMl: 2000 })}
              >
                Bỏ qua, dùng mặc định 2.000ml/ngày
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function NotificationNudge({ displayName, onNotify }: { displayName?: string; onNotify: () => Promise<boolean> }) {
  const name = displayName?.trim() || 'bạn';

  return (
    <div className="notification-nudge">
      <div>
        <span className="badge forest">
          <Bell size={14} />
          Thông báo
        </span>
        <h3>Chưa bật thông báo</h3>
        <p>Bật thông báo để nhắc {name} đúng giờ uống thuốc.</p>
      </div>
      <button className="secondary-button" onClick={onNotify}>
        Bật ngay
      </button>
    </div>
  );
}

function WaterReminderCard({ config, onEdit }: { config: WaterReminderConfig; onEdit: () => void }) {
  const reminders = generateWaterReminders(config);
  const next = getNextWaterReminder(config);
  const intervalHours = config.intervalMinutes % 60 === 0
    ? `${config.intervalMinutes / 60} giờ`
    : `${config.intervalMinutes} phút`;

  return (
    <div className="water-card">
      <div className="water-card-icon">
        <Droplets size={22} />
      </div>
      <div className="water-card-copy">
        <h3>Nhắc uống nước</h3>
        <p>{config.dailyGoalMl.toLocaleString('vi-VN')}ml/ngày · mỗi {intervalHours}</p>
        <span>Lần nhắc tiếp theo: {next?.time ?? reminders[0]?.time ?? '--:--'}</span>
      </div>
      <button className="icon-button" onClick={onEdit} aria-label="Chỉnh nhắc uống nước">
        <Settings size={17} />
      </button>
    </div>
  );
}

function TopChrome({
  syncMode,
  sessionEmail,
  displayName,
  isSyncing,
  onOpenNotes,
  notesCount,
}: {
  syncMode: SyncMode;
  sessionEmail: string | null;
  displayName?: string;
  isSyncing: boolean;
  onOpenNotes: () => void;
  notesCount: number;
}) {
  const greetingName = displayName?.trim();

  return (
    <div className="header-layer">
      <header className="app-header">
        <div className="header-top-row">
          <p className="eyebrow">{greetingName ? `Ê, ${greetingName}!` : 'Ê!'}</p>
          <div className="header-actions">
            {notesCount > 0 && (
              <button className="chrome-notes-btn" onClick={onOpenNotes} aria-label="Xem dặn dò bác sĩ">
                <BookOpen size={16} />
                <span className="notes-badge">{notesCount}</span>
              </button>
            )}
            <div className="status-pill">
              {isSyncing ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />}
              <span>{sessionEmail ? syncModeLabel(syncMode) : 'cục bộ'}</span>
            </div>
          </div>
        </div>
        <h1>Uống chưa?</h1>
      </header>
    </div>
  );
}



function AddView({
  input,
  draft,
  isExtracting,
  extractStep,
  courseAddMode,
  hasExistingCourse,
  onInputChange,
  onCourseAddMode,
  onDraftChange,
  onCancelDraft,
  onSubmit,
  onExtract,
  onConfirmDraft,
}: {
  input: ManualMedicationInput;
  draft: ExtractionDraft | null;
  isExtracting: boolean;
  extractStep: number;
  courseAddMode: CourseAddMode;
  hasExistingCourse: boolean;
  onInputChange: (input: ManualMedicationInput) => void;
  onCourseAddMode: (mode: CourseAddMode) => void;
  onDraftChange: (draft: ExtractionDraft) => void;
  onCancelDraft: () => void;
  onSubmit: () => void;
  onExtract: (file?: File) => void;
  onConfirmDraft: () => void;
}) {
  const [selectedFile, setSelectedFile] = useState<File | undefined>();
  const [timeText, setTimeText] = useState(input.scheduleTimes.join(', '));

  useEffect(() => {
    setTimeText(input.scheduleTimes.join(', '));
  }, [input.scheduleTimes]);

  return (
    <section className="view-stack">
      <div className="section-heading">
        <span className="badge">Thêm lịch</span>
        <h2>Nhập tay hoặc đọc đơn thuốc</h2>
      </div>

      {hasExistingCourse && (
        <div className="content-card course-choice">
          <div>
            <strong>Gắn đơn này vào đâu?</strong>
            <p className="muted">
              Đơn này sẽ được gắn vào đợt đang theo dõi, hoặc tạo hẳn một đợt điều trị mới.
            </p>
          </div>
          <div className="segmented-control">
            <button
              type="button"
              className={courseAddMode === 'current' ? 'active' : ''}
              onClick={() => onCourseAddMode('current')}
            >
              Đợt đang theo dõi
            </button>
            <button
              type="button"
              className={courseAddMode === 'new' ? 'active' : ''}
              onClick={() => onCourseAddMode('new')}
            >
              Đợt mới
            </button>
          </div>
        </div>
      )}

      <div className="dark-chamber upload-chamber">
        <div>
          <div className="section-heading light tight">
            <span className="badge forest">
              <Sparkles size={14} />
              Gemini
            </span>
            <h3>Đọc ảnh đơn thuốc</h3>
          </div>
          <p className="muted light-text">
            AI chỉ tạo bản nháp. Bạn phải duyệt từng dòng trước khi app bắt đầu nhắc.
          </p>
        </div>

        {isExtracting ? (
          <div className="extract-skeleton">
            <div className="extract-step-row">
              <div className={`extract-step ${extractStep >= 1 ? 'active' : ''} ${extractStep > 1 ? 'done' : ''}`}>
                <div className="step-dot" />
                <span>Đọc ảnh</span>
              </div>
              <div className="extract-step-line" />
              <div className={`extract-step ${extractStep >= 2 ? 'active' : ''} ${extractStep > 2 ? 'done' : ''}`}>
                <div className="step-dot" />
                <span>Phân tích</span>
              </div>
              <div className="extract-step-line" />
              <div className={`extract-step ${extractStep >= 3 ? 'active' : ''}`}>
                <div className="step-dot" />
                <span>Tạo danh sách</span>
              </div>
            </div>
            <div className="skeleton-bar"><div className="skeleton-fill" style={{ width: `${Math.round((extractStep / 3) * 100)}%` }} /></div>
            <p className="skeleton-hint">
              {extractStep === 1 && 'Đang đọc hình ảnh...'}
              {extractStep === 2 && 'Gemini đang phân tích đơn thuốc...'}
              {extractStep === 3 && 'Đang tổng hợp kết quả...'}
            </p>
          </div>
        ) : (
          <>
            <label className="upload-drop">
              <Camera size={26} />
              <span>{selectedFile ? selectedFile.name : 'Chụp ảnh / tải ảnh đơn thuốc'}</span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setSelectedFile(event.target.files?.[0])}
              />
            </label>
            <button className="cream-button" disabled={isExtracting} onClick={() => onExtract(selectedFile)}>
              <Upload size={18} />
              Phân tích đơn
            </button>
          </>
        )}
      </div>

      {draft && <DraftReview draft={draft} onChange={onDraftChange} onCancel={onCancelDraft} onConfirm={onConfirmDraft} />}

      <form
        className="content-card form-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="section-heading tight">
          <span className="badge">Nhập tay</span>
          <h3>Thuốc mới</h3>
        </div>

        <label>
          Tên thuốc
          <input
            required
            value={input.name}
            placeholder="VD: Dokreal 25mg"
            onChange={(event) => onInputChange({ ...input, name: event.target.value })}
          />
        </label>

        <label>
          Cách dùng
          <textarea
            required
            value={input.instructions}
            placeholder="VD: Uống 1 viên sau ăn tối"
            onChange={(event) => onInputChange({ ...input, instructions: event.target.value })}
          />
        </label>

        <div className="two-cols">
          <label>
            Bắt đầu
            <input
              type="date"
              value={input.startDate}
              onChange={(event) => onInputChange({ ...input, startDate: event.target.value })}
            />
          </label>
          <label>
            Số ngày
            <input
              type="number"
              min="1"
              value={input.durationDays ?? ''}
              placeholder="VD: 30"
              onChange={(event) => onInputChange({ ...input, durationDays: Number(event.target.value) || undefined })}
            />
          </label>
        </div>

        <label>
          Giờ nhắc
          <input
            value={timeText}
            placeholder="08:30, 20:30"
            onBlur={() => onInputChange({ ...input, scheduleTimes: normalizeTimes(timeText.split(',')) })}
            onChange={(event) => setTimeText(event.target.value)}
          />
        </label>

        <div className="two-cols">
          <label>
            Số lượng
            <input
              type="number"
              min="0"
              value={input.quantity ?? ''}
              placeholder="VD: 30"
              onChange={(event) => {
                const quantity = Number(event.target.value) || undefined;
                onInputChange({ ...input, quantity, remaining: quantity });
              }}
            />
          </label>
          <label>
            Dạng thuốc
            <input
              value={input.form ?? ''}
              placeholder="VD: viên, lọ, tuýp"
              onChange={(event) => onInputChange({ ...input, form: event.target.value })}
            />
          </label>
        </div>

        <button className="primary-button wide" type="submit">
          <Pill size={18} />
          Lưu lịch nhắc
        </button>
      </form>
    </section>
  );
}

function DraftReview({
  draft,
  onChange,
  onCancel,
  onConfirm,
}: {
  draft: ExtractionDraft;
  onChange: (draft: ExtractionDraft) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const canConfirm = draft.medicines.some((medicine) => medicine.name.trim() && medicine.instructions.trim());

  function updateMedicine(index: number, patch: Partial<ExtractionDraft['medicines'][number]>) {
    onChange({
      ...draft,
      medicines: draft.medicines.map((medicine, itemIndex) => (itemIndex === index ? { ...medicine, ...patch } : medicine)),
    });
  }

  function removeMedicine(index: number) {
    onChange({
      ...draft,
      medicines: draft.medicines.filter((_, itemIndex) => itemIndex !== index),
    });
  }

  function updateDoctorNote(index: number, note: string) {
    onChange({
      ...draft,
      doctorNotes: draft.doctorNotes.map((item, itemIndex) => (itemIndex === index ? note : item)),
    });
  }

  function removeDoctorNote(index: number) {
    onChange({
      ...draft,
      doctorNotes: draft.doctorNotes.filter((_, itemIndex) => itemIndex !== index),
    });
  }

  return (
    <div className="draft-review-wrapper">
      {/* ── Sticky header ── */}
      <div className="draft-review-topbar">
        <div className="draft-review-title">
          <span className="badge dark">Cần duyệt</span>
          <strong>{draft.medicines.length} dòng thuốc tìm thấy</strong>
        </div>
        <p className="draft-review-hint">
          Sửa trực tiếp các dòng Gemini đọc sai. Chỉ xác nhận khi danh sách đã khớp với đơn gốc.
        </p>
      </div>

      {/* ── Scrollable medicine list ── */}
      <div className="draft-scroll-area">
        <div className="draft-list editable">
          {draft.medicines.map((medicine, index) => (
            <article key={`${medicine.name}-${index}`} className="draft-edit-item">
              <div className="draft-edit-header">
                <strong>Thuốc {index + 1}</strong>
                <span>{Math.round((medicine.confidence ?? 0.75) * 100)}%</span>
                <button className="icon-button small" type="button" onClick={() => removeMedicine(index)} aria-label="Xóa dòng thuốc">
                  <X size={15} />
                </button>
              </div>

              <label>
                Tên thuốc đầy đủ
                <input
                  value={medicine.name}
                  placeholder="VD: Isotretinoin 25mg (Dokreal 25mg)"
                  onChange={(event) => updateMedicine(index, { name: event.target.value })}
                />
              </label>

              {medicine.rawNameLine && (
                <p className="draft-source-line">Dòng OCR tên thuốc: {medicine.rawNameLine}</p>
              )}

              {!!medicine.needsReview?.length && (
                <div className="draft-source-line">
                  {medicine.needsReview.map((item) => (
                    <span key={item}>• {item}</span>
                  ))}
                </div>
              )}

              <label>
                Cách dùng
                <textarea
                  value={medicine.instructions}
                  placeholder="VD: Uống 1 viên sau ăn tối"
                  onChange={(event) => updateMedicine(index, { instructions: event.target.value })}
                />
              </label>

              <div className="two-cols">
                <label>
                  Dạng thuốc
                  <input
                    value={medicine.form ?? ''}
                    placeholder="viên, lọ, tuýp"
                    onChange={(event) => updateMedicine(index, { form: event.target.value })}
                  />
                </label>
                <label>
                  Số lượng
                  <input
                    type="number"
                    min="0"
                    value={medicine.quantity ?? ''}
                    placeholder="VD: 30"
                    onChange={(event) => updateMedicine(index, { quantity: Number(event.target.value) || undefined })}
                  />
                </label>
              </div>

              <div className="two-cols">
                <label>
                  Giờ nhắc
                  <input
                    value={medicine.scheduleTimes?.join(', ') ?? ''}
                    placeholder="08:00, 20:00"
                    onChange={(event) =>
                      updateMedicine(index, {
                        scheduleTimes: event.target.value.split(',').map((time) => time.trim()).filter(Boolean),
                      })
                    }
                    onBlur={(event) => updateMedicine(index, { scheduleTimes: normalizeTimes(event.target.value.split(',')) })}
                  />
                </label>
                <label>
                  Số ngày
                  <input
                    type="number"
                    min="1"
                    value={medicine.durationDays ?? ''}
                    placeholder="VD: 30"
                    onChange={(event) => updateMedicine(index, { durationDays: Number(event.target.value) || undefined })}
                  />
                </label>
              </div>
            </article>
          ))}
        </div>

        {draft.doctorNotes.length > 0 && (
          <div className="draft-notes">
            <strong>Dặn dò bác sĩ</strong>
            {draft.doctorNotes.map((note, index) => (
              <label key={`${note}-${index}`} className="draft-note-edit">
                <textarea
                  value={note}
                  placeholder="VD: Tránh nắng, uống nhiều nước, tái khám sau 1 tháng"
                  onChange={(event) => updateDoctorNote(index, event.target.value)}
                />
                <button className="secondary-button danger" type="button" onClick={() => removeDoctorNote(index)}>
                  <X size={14} />
                  Xóa lưu ý
                </button>
              </label>
            ))}
          </div>
        )}

        {draft.warnings.map((warning) => (
          <p className="warning-copy" key={warning}>{warning}</p>
        ))}
      </div>

      {/* ── Sticky action bar ── */}
      <div className="draft-sticky-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>
          Hủy kết quả
        </button>
        <button className="primary-button" type="button" disabled={!canConfirm} onClick={onConfirm}>
          <Check size={18} />
          Xác nhận và tạo lịch
        </button>
      </div>
    </div>
  );
}



function WaterConfigFields({
  config,
  onChange,
}: {
  config: WaterReminderConfig;
  onChange: (patch: Partial<WaterReminderConfig>) => void;
}) {
  const reminders = generateWaterReminders(config);

  return (
    <div className="water-fields">
      <label className="toggle-row">
        <span>
          <strong>Tự tính theo cân nặng</strong>
          <small>{config.autoCalculateGoal ? 'Dùng công thức 35ml/kg' : 'Bạn nhập mục tiêu thủ công'}</small>
        </span>
        <input
          type="checkbox"
          checked={config.autoCalculateGoal}
          onChange={(event) => onChange({ autoCalculateGoal: event.target.checked })}
        />
      </label>

      {!config.autoCalculateGoal && (
        <label>
          Mục tiêu mỗi ngày
          <input
            type="number"
            min="1200"
            max="3500"
            step="50"
            value={config.dailyGoalMl}
            placeholder="VD: 2000"
            onChange={(event) => onChange({ dailyGoalMl: Number(event.target.value) || 2000 })}
          />
        </label>
      )}

      <div className="two-cols">
        <label>
          Giờ bắt đầu
          <input type="time" value={config.startTime} aria-label="Giờ bắt đầu" onChange={(event) => onChange({ startTime: event.target.value })} />
        </label>
        <label>
          Giờ kết thúc
          <input type="time" value={config.endTime} aria-label="Giờ kết thúc" onChange={(event) => onChange({ endTime: event.target.value })} />
        </label>
      </div>

      <label>
        Tần suất
        <input
          type="number"
          min="30"
          max="360"
          step="30"
          value={config.intervalMinutes}
          placeholder="VD: 120"
          onChange={(event) => onChange({ intervalMinutes: Number(event.target.value) || 120 })}
        />
      </label>
      <p className="water-field-hint">
        {config.dailyGoalMl.toLocaleString('vi-VN')}ml/ngày · {reminders.length} lần · khoảng {reminders[0]?.amountMl ?? 0}ml mỗi lần
      </p>
    </div>
  );
}

const BODY_AREAS: Array<{ id: TrackingBodyArea; label: string }> = [
  { id: 'face', label: 'Mặt' },
  { id: 'forehead', label: 'Trán' },
  { id: 'left_cheek', label: 'Má trái' },
  { id: 'right_cheek', label: 'Má phải' },
  { id: 'chin', label: 'Cằm' },
  { id: 'back', label: 'Lưng' },
  { id: 'chest', label: 'Ngực' },
  { id: 'arm', label: 'Tay' },
  { id: 'other', label: 'Khác' },
];

const TRACKING_TAG_OPTIONS = ['Đỏ hơn', 'Đỡ viêm', 'Khô hơn', 'Bong da', 'Mụn viêm', 'Không rõ'];
const COMPARISON_PROMPT_TAGS = ['Đỏ hơn', 'Đỡ viêm', 'Khô hơn', 'Bong da', 'Không rõ'];
const COMPARISON_NOTES_STORAGE_KEY = 'thuoc-nhac-comparison-notes-v1';

function ImageCropper({
  file,
  onCropComplete,
  onCancel,
}: {
  file: File;
  onCropComplete: (croppedFile: File) => void;
  onCancel: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [imgSrc, setImgSrc] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handleStart(clientX: number, clientY: number) {
    isDragging.current = true;
    startPos.current = { x: clientX - offset.x, y: clientY - offset.y };
  }

  function handleMove(clientX: number, clientY: number) {
    if (!isDragging.current) return;
    setOffset({
      x: clientX - startPos.current.x,
      y: clientY - startPos.current.y,
    });
  }

  function handleEnd() {
    isDragging.current = false;
  }

  function handleCrop() {
    const viewport = containerRef.current;
    const img = imageRef.current;
    if (!viewport || !img) return;

    const viewportRect = viewport.getBoundingClientRect();
    const rect = img.getBoundingClientRect();
    const cropScale = 400 / 240;

    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dx = (rect.left - viewportRect.left) * cropScale;
    const dy = (rect.top - viewportRect.top) * cropScale;
    const dw = rect.width * cropScale;
    const dh = rect.height * cropScale;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 400, 400);
    ctx.drawImage(img, dx, dy, dw, dh);

    canvas.toBlob((blob) => {
      if (blob) {
        const croppedFile = new File([blob], file.name, { type: 'image/jpeg' });
        onCropComplete(croppedFile);
      }
    }, 'image/jpeg', 0.9);
  }

  return (
    <div className="cropper-wrapper">
      <div className="cropper-instructions">
        <span>Kéo để di chuyển, dùng thanh trượt để phóng to:</span>
      </div>
      <div
        className="cropper-viewport"
        ref={containerRef}
        onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
        onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          if (touch) handleStart(touch.clientX, touch.clientY);
        }}
        onTouchMove={(e) => {
          const touch = e.touches[0];
          if (touch) handleMove(touch.clientX, touch.clientY);
        }}
        onTouchEnd={handleEnd}
      >
        <img
          ref={imageRef}
          src={imgSrc}
          alt="To crop"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        />
        <div className="cropper-overlay-grid" />
      </div>

      <div className="cropper-controls">
        <div className="zoom-control">
          <span>Zoom</span>
          <input
            type="range"
            min="1"
            max="3"
            step="0.02"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
          />
        </div>
        <div className="cropper-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Hủy
          </button>
          <button className="primary-button" type="button" onClick={handleCrop}>
            <Check size={16} /> Cắt & Dùng
          </button>
        </div>
      </div>
    </div>
  );
}

function TrackingView({
  entries,
  courses,
  activeCourseId,
  onAddEntry,
  onDeleteEntry,
}: {
  entries: HealthPhotoEntry[];
  courses: TreatmentCourse[];
  activeCourseId?: string;
  onAddEntry: (input: { file: File; bodyArea: TrackingBodyArea; note: string; tags: string[]; takenAt: string }) => Promise<void>;
  onDeleteEntry: (entry: HealthPhotoEntry) => Promise<void>;
}) {
  const [filterArea, setFilterArea] = useState<TrackingBodyArea | 'all'>('all');
  const [showComposer, setShowComposer] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  const [bodyArea, setBodyArea] = useState<TrackingBodyArea>('face');
  const [note, setNote] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [takenAt, setTakenAt] = useState(() => toLocalDateTimeInputValue());
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<HealthPhotoEntry | null>(null);
  const [selectedComparisonId, setSelectedComparisonId] = useState<ComparisonOptionId | null>(null);
  const [compareMode, setCompareMode] = useState<CompareViewMode>('side_by_side');
  const [customBeforeId, setCustomBeforeId] = useState('');
  const [customAfterId, setCustomAfterId] = useState('');
  const [comparisonNotes, setComparisonNotes] = useState<Record<string, string>>(() => loadComparisonNotes());

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  const visibleEntries = useMemo(
    () => entries
      .filter((entry) => filterArea === 'all' || entry.bodyArea === filterArea),
    [entries, filterArea],
  );

  const sortedVisibleEntries = useMemo(() => sortPhotosByDate(visibleEntries), [visibleEntries]);

  const entriesByArea = useMemo(() => {
    const groups = new Map<TrackingBodyArea, HealthPhotoEntry[]>();
    entries.forEach((entry) => {
      groups.set(entry.bodyArea, [...(groups.get(entry.bodyArea) ?? []), entry]);
    });
    return Array.from(groups.entries())
      .map(([areaId, areaEntries]) => [
        areaId,
        [...areaEntries].sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime()),
      ] as const)
      .sort(([, aEntries], [, bEntries]) => {
        const aLatest = new Date(aEntries[aEntries.length - 1]?.takenAt ?? 0).getTime();
        const bLatest = new Date(bEntries[bEntries.length - 1]?.takenAt ?? 0).getTime();
        return bLatest - aLatest;
      });
  }, [entries]);

  const progressGroups = useMemo(
    () => (filterArea === 'all' ? [] : entriesByArea.filter(([areaId]) => areaId === filterArea)),
    [entriesByArea, filterArea],
  );

  useEffect(() => {
    const ids = new Set(sortedVisibleEntries.map((entry) => entry.id));
    setCustomBeforeId((current) => (current && ids.has(current) ? current : sortedVisibleEntries[0]?.id ?? ''));
    setCustomAfterId((current) => (current && ids.has(current) ? current : sortedVisibleEntries[sortedVisibleEntries.length - 1]?.id ?? ''));
  }, [sortedVisibleEntries]);

  const customPair = useMemo(() => {
    const before = sortedVisibleEntries.find((entry) => entry.id === customBeforeId);
    const after = sortedVisibleEntries.find((entry) => entry.id === customAfterId);
    if (!before || !after) return null;
    return normalizeComparePair(before, after);
  }, [customAfterId, customBeforeId, sortedVisibleEntries]);

  const comparisonOptions = useMemo<TrackingComparisonOption[]>(() => {
    const notEnoughMessage = 'Cần ít nhất 2 ảnh để so sánh. Hãy chụp thêm sau vài ngày để nhìn rõ tiến triển.';
    const daysUnavailable = (days: number) =>
      `Chưa có ảnh đủ xa để so sánh ${days} ngày. Bạn có thể so với lần chụp trước.`;

    return [
      {
        id: 'first_vs_latest',
        type: 'first_vs_latest',
        title: 'Ngày đầu → Mới nhất',
        eyebrow: 'So sánh nhanh',
        description: 'Nhìn toàn bộ hành trình từ lúc bắt đầu đến hiện tại.',
        unavailable: notEnoughMessage,
        icon: CalendarRange,
        pair: getFirstVsLatest(sortedVisibleEntries),
      },
      {
        id: 'previous_vs_latest',
        type: 'previous_vs_latest',
        title: 'Lần trước → Mới nhất',
        eyebrow: 'Ngắn hạn',
        description: 'Xem lần chụp gần nhất thay đổi thế nào so với hôm nay.',
        unavailable: notEnoughMessage,
        icon: Clock3,
        pair: getPreviousVsLatest(sortedVisibleEntries),
      },
      {
        id: 'days_7',
        type: 'range',
        title: '7 ngày trước',
        eyebrow: 'Mốc thời gian',
        description: 'Lấy ảnh gần nhất trước mốc 7 ngày so với ảnh mới nhất.',
        unavailable: daysUnavailable(7),
        icon: Calendar,
        pair: getCompareByDaysAgo(sortedVisibleEntries, 7),
      },
      {
        id: 'days_14',
        type: 'range',
        title: '14 ngày trước',
        eyebrow: 'Mốc thời gian',
        description: 'Theo dõi thay đổi qua khoảng hai tuần điều trị.',
        unavailable: daysUnavailable(14),
        icon: Calendar,
        pair: getCompareByDaysAgo(sortedVisibleEntries, 14),
      },
      {
        id: 'days_30',
        type: 'range',
        title: '30 ngày trước',
        eyebrow: 'Mốc thời gian',
        description: 'Phù hợp để nhìn tiến triển dài hơn của vùng đang theo dõi.',
        unavailable: daysUnavailable(30),
        icon: Calendar,
        pair: getCompareByDaysAgo(sortedVisibleEntries, 30),
      },
      {
        id: 'custom',
        type: 'custom',
        title: 'Tự chọn 2 ảnh',
        eyebrow: 'Tùy chọn',
        description: 'Chọn hai lần chụp bất kỳ để xem một giai đoạn cụ thể.',
        unavailable: customBeforeId === customAfterId ? 'Hãy chọn 2 ảnh khác nhau để so sánh.' : notEnoughMessage,
        icon: ArrowLeftRight,
        pair: customPair,
      },
    ];
  }, [customAfterId, customBeforeId, customPair, sortedVisibleEntries]);

  const activeComparison = useMemo(() => {
    const option = comparisonOptions.find((item) => item.id === selectedComparisonId);
    if (!option?.pair) return null;
    return { ...option, pair: option.pair };
  }, [comparisonOptions, selectedComparisonId]);

  const activeTimelineEntries = useMemo(
    () => (activeComparison ? getTimelineBetween(sortedVisibleEntries, activeComparison.pair) : []),
    [activeComparison, sortedVisibleEntries],
  );

  const activeComparisonNoteKey = activeComparison ? comparisonNoteKey(activeComparison.id, activeComparison.pair) : '';
  const activeComparisonNote = activeComparisonNoteKey ? comparisonNotes[activeComparisonNoteKey] ?? '' : '';

  useEffect(() => {
    if (!selectedComparisonId) return;
    const stillAvailable = comparisonOptions.some((option) => option.id === selectedComparisonId && option.pair);
    if (!stillAvailable) setSelectedComparisonId(null);
  }, [comparisonOptions, selectedComparisonId]);

  function toggleSelectedTag(tag: string) {
    setSelectedTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
  }

  function updateComparisonNote(noteValue: string) {
    if (!activeComparisonNoteKey) return;
    setComparisonNotes((current) => {
      const next = { ...current };
      if (noteValue.trim()) {
        next[activeComparisonNoteKey] = noteValue;
      } else {
        delete next[activeComparisonNoteKey];
      }
      saveComparisonNotes(next);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedFile) return;
    setIsSaving(true);
    await onAddEntry({
      file: selectedFile,
      bodyArea,
      note,
      tags: selectedTags,
      takenAt: new Date(takenAt).toISOString(),
    });
    setIsSaving(false);
    setSelectedFile(null);
    setRawFile(null);
    setBodyArea('face');
    setNote('');
    setSelectedTags([]);
    setTakenAt(toLocalDateTimeInputValue());
    setShowComposer(false);
  }

  return (
    <section className="view-stack">
      <div className="section-heading">
        <span className="badge">Theo dõi</span>
        <h2>Hành trình phục hồi</h2>
      </div>

      {entries.length > 0 && !showComposer && (
        <div className="content-card tracking-controls-card">
          <div className="tracking-privacy-card">
            <ShieldCheck size={18} />
            <p>Ảnh mặc định được lưu trên thiết bị này và không tự động tải lên cloud.</p>
          </div>

          <div className="tracking-action-row">
            <button
              className="primary-button tracking-add-cta"
              onClick={() => {
                setComparisonOpen(false);
                setShowComposer(true);
              }}
            >
              <Camera size={18} />
              Thêm ảnh
            </button>
            <button
              type="button"
              className={`secondary-button tracking-compare-trigger${comparisonOpen ? ' active' : ''}`}
              aria-expanded={comparisonOpen}
              onClick={() => setComparisonOpen((current) => !current)}
            >
              <ArrowLeftRight size={18} />
              {comparisonOpen ? 'Ẩn so sánh' : 'So sánh'}
              <span>{visibleEntries.length}</span>
            </button>
          </div>

          <div className="area-filter-row">
            <button className={filterArea === 'all' ? 'active' : ''} onClick={() => setFilterArea('all')}>
              Tất cả
            </button>
            {entriesByArea.map(([areaId, areaEntries]) => (
              <button
                key={areaId}
                className={filterArea === areaId ? 'active' : ''}
                onClick={() => setFilterArea(areaId)}
              >
                {trackingAreaLabel(areaId)} ({areaEntries.length})
              </button>
            ))}
          </div>
        </div>
      )}

      {showComposer && (
        <form className="content-card form-card tracking-form" onSubmit={handleSubmit}>
          <div className="section-heading tight">
            <span className="badge dark">
              <Camera size={14} />
              Ảnh mới
            </span>
            <h3>Thêm ảnh tình trạng</h3>
          </div>

          {rawFile && !selectedFile ? (
            <ImageCropper
              file={rawFile}
              onCropComplete={(croppedFile) => {
                setSelectedFile(croppedFile);
                setRawFile(null);
              }}
              onCancel={() => {
                setRawFile(null);
              }}
            />
          ) : (
            <label className={`tracking-upload ${previewUrl ? 'has-preview' : ''}`}>
              {previewUrl ? (
                <div className="cropped-preview-container">
                  <img src={previewUrl} alt="Ảnh đã cắt" />
                  <button
                    type="button"
                    className="change-photo-btn"
                    onClick={() => {
                      setSelectedFile(null);
                      setRawFile(null);
                    }}
                  >
                    Thay ảnh khác
                  </button>
                </div>
              ) : (
                <span>
                  <Upload size={22} />
                  Chụp ảnh hoặc chọn từ thư viện
                </span>
              )}
              {!previewUrl && (
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setRawFile(event.target.files?.[0] ?? null)}
                />
              )}
            </label>
          )}

          <div className="area-chip-grid">
            {BODY_AREAS.map((area) => (
              <button
                type="button"
                key={area.id}
                className={bodyArea === area.id ? 'active' : ''}
                onClick={() => setBodyArea(area.id)}
              >
                {area.label}
              </button>
            ))}
          </div>

          <label>
            Ghi chú triệu chứng
            <textarea
              value={note}
              placeholder="Ví dụ: Da khô hơn, hơi bong quanh môi"
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          <div className="tracking-tag-field">
            <span>Gắn nhãn nhanh</span>
            <div className="tag-chip-row">
              {TRACKING_TAG_OPTIONS.map((tag) => (
                <button
                  type="button"
                  key={tag}
                  className={selectedTags.includes(tag) ? 'active' : ''}
                  onClick={() => toggleSelectedTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <label>
            Ngày ghi nhận
            <input
              type="datetime-local"
              value={takenAt}
              aria-label="Ngày giờ ghi nhận"
              onChange={(event) => setTakenAt(event.target.value)}
            />
          </label>

          <div className="tracking-form-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setShowComposer(false);
                setSelectedFile(null);
                setRawFile(null);
                setSelectedTags([]);
              }}
            >
              Hủy
            </button>
            <button className="primary-button" type="submit" disabled={!selectedFile || isSaving}>
              {isSaving ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
              Lưu nhật ký
            </button>
          </div>
        </form>
      )}

      {entries.length === 0 && !showComposer && (
        <div className="empty-state tracking-empty">
          <Camera size={34} />
          <h3>Chưa có ảnh theo dõi</h3>
          <p>Chụp lại tình trạng để dựng bản đồ hành trình phục hồi của bạn.</p>
          <button
            className="primary-button"
            onClick={() => {
              setComparisonOpen(false);
              setShowComposer(true);
            }}
          >
            Thêm ảnh đầu tiên
          </button>
        </div>
      )}

      {entries.length > 0 && (
        <>

          {comparisonOpen && !showComposer && (
          <div className="comparison-center">
            <div className="comparison-center-header">
              <div className="section-heading tight">
                <span className="badge forest">So sánh</span>
                <h3>So sánh tình trạng</h3>
              </div>
              <div className="comparison-header-actions">
                <span className="comparison-count">{visibleEntries.length} ảnh</span>
                <button
                  type="button"
                  className="icon-button small comparison-close"
                  aria-label="Đóng so sánh"
                  onClick={() => setComparisonOpen(false)}
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {visibleEntries.length < 2 ? (
              <div className="comparison-empty">
                <Camera size={22} />
                <strong>Cần ít nhất 2 ảnh để so sánh</strong>
                <p>Hãy chụp thêm sau vài ngày để nhìn rõ tiến triển.</p>
                <button
                  className="primary-button"
                  onClick={() => {
                    setComparisonOpen(false);
                    setShowComposer(true);
                  }}
                >
                  <Plus size={18} />
                  Thêm ảnh mới
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="compare-hero-card"
                  disabled={!comparisonOptions[0].pair}
                  onClick={() => {
                    setSelectedComparisonId('first_vs_latest');
                    setCompareMode('side_by_side');
                  }}
                >
                  <div className="compare-hero-copy">
                    <span>{comparisonOptions[0].eyebrow}</span>
                    <strong>{comparisonOptions[0].title}</strong>
                    <small>
                      {comparisonOptions[0].pair
                        ? `${formatShortDate(comparisonOptions[0].pair.before.takenAt)} → ${formatShortDate(comparisonOptions[0].pair.after.takenAt)}`
                        : comparisonOptions[0].unavailable}
                    </small>
                  </div>
                  {comparisonOptions[0].pair && (
                    <div className="compare-grid compact">
                      <ComparePhoto label="Ngày đầu" entry={comparisonOptions[0].pair.before} courses={courses} compact />
                      <ComparePhoto label="Mới nhất" entry={comparisonOptions[0].pair.after} courses={courses} compact />
                    </div>
                  )}
                </button>

                <div className="comparison-shortcuts">
                  {comparisonOptions.slice(1, 5).map((option) => (
                    <ComparisonOptionButton
                      key={option.id}
                      option={option}
                      onOpen={() => {
                        setSelectedComparisonId(option.id);
                        setCompareMode('side_by_side');
                      }}
                    />
                  ))}
                </div>

                <div className="custom-compare-card">
                  <div className="custom-compare-heading">
                    <ArrowLeftRight size={18} />
                    <span>
                      <strong>Tự chọn 2 ảnh</strong>
                      <small>Phù hợp khi muốn xem một giai đoạn cụ thể.</small>
                    </span>
                  </div>
                  <div className="custom-compare-selects">
                    <label>
                      Ảnh A
                      <select value={customBeforeId} onChange={(event) => setCustomBeforeId(event.target.value)}>
                        {sortedVisibleEntries.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {formatPhotoOptionLabel(entry)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Ảnh B
                      <select value={customAfterId} onChange={(event) => setCustomAfterId(event.target.value)}>
                        {sortedVisibleEntries.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {formatPhotoOptionLabel(entry)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    className="secondary-button wide"
                    disabled={!customPair}
                    onClick={() => {
                      setSelectedComparisonId('custom');
                      setCompareMode('side_by_side');
                    }}
                  >
                    <ArrowLeftRight size={18} />
                    So sánh
                  </button>
                  {!customPair && <p className="comparison-unavailable">Hãy chọn 2 ảnh khác nhau để so sánh.</p>}
                </div>
              </>
            )}
          </div>
          )}

          {filterArea === 'all' ? (
            <div className="area-overview-strip" aria-label="Chọn vùng theo dõi">
              {entriesByArea.map(([areaId, areaEntries]) => {
                const firstEntry = areaEntries[0];
                const latestEntry = areaEntries[areaEntries.length - 1];

                return (
                  <button
                    type="button"
                    className="area-overview-card"
                    key={areaId}
                    onClick={() => setFilterArea(areaId)}
                  >
                    <span className="area-overview-thumb">
                      <TrackingImage imageKey={latestEntry.imageLocalKey} alt={`Ảnh mới nhất ${trackingAreaLabel(areaId)}`} />
                    </span>
                    <span className="area-overview-copy">
                      <strong>{trackingAreaLabel(areaId)}</strong>
                      <small>{areaEntries.length} ảnh</small>
                      <em>
                        {formatShortDate(firstEntry.takenAt)} → {formatShortDate(latestEntry.takenAt)}
                      </em>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                );
              })}
            </div>
          ) : (
          <div className="area-paths-list">
            {progressGroups.map(([areaId, areaEntries]) => {
              const sortedAreaEntries = [...areaEntries].sort(
                (a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime()
              );

              const H = 140;
              const areaNodes = sortedAreaEntries.map((entry, index) => {
                const angle = index * (Math.PI / 2);
                const x = Math.sin(angle) * 70;
                const y = index * H + 90;
                return { entry, x, y };
              });

              let areaPathD = '';
              if (areaNodes.length > 0) {
                areaPathD = `M ${180 + areaNodes[0].x} ${areaNodes[0].y}`;
                for (let i = 1; i < areaNodes.length; i++) {
                  const prev = areaNodes[i - 1];
                  const curr = areaNodes[i];
                  const cpY1 = prev.y + H / 2;
                  const cpY2 = curr.y - H / 2;
                  areaPathD += ` C ${180 + prev.x} ${cpY1}, ${180 + curr.x} ${cpY2}, ${180 + curr.x} ${curr.y}`;
                }
              }

              return (
                <div className="area-path-section" key={areaId}>
                  <div className="area-path-header">
                    <span className="badge forest">{trackingAreaLabel(areaId)}</span>
                    <h3>Hành trình vùng {trackingAreaLabel(areaId).toLowerCase()}</h3>
                  </div>

                  <div className="tracking-path-wrapper">
                    <div className="path-background-indicator">
                      <span>{trackingAreaLabel(areaId).toUpperCase()} PROGRESS</span>
                    </div>

                    {areaNodes.length > 0 && (
                      <svg className="tracking-path-svg" style={{ height: areaNodes.length * H + 120 }}>
                        <path d={areaPathD} />
                      </svg>
                    )}

                    <div className="tracking-path-nodes" style={{ height: areaNodes.length * H + 120 }}>
                      {areaNodes.map(({ entry, x, y }, index) => {
                        const isNewest = index === areaNodes.length - 1;
                        const isStart = index === 0;
                        const labelSide = x > 15 ? 'left' : 'right';

                        return (
                          <div
                            key={entry.id}
                            className={`path-node-wrapper ${isNewest ? 'newest-node' : ''} ${isStart ? 'start-node' : ''}`}
                            style={{
                              left: `calc(50% + ${x}px)`,
                              top: `${y}px`,
                            }}
                            onClick={() => setSelectedEntry(entry)}
                          >
                            {isStart && <div className="start-speech-bubble">BẮT ĐẦU</div>}
                            {isNewest && !isStart && <div className="start-speech-bubble newest-bubble">MỚI NHẤT</div>}

                            <div className="path-node-circle">
                              <TrackingImage imageKey={entry.imageLocalKey} alt="Tracking node" />
                            </div>

                            <div className={`path-node-label label-${labelSide}`}>
                              <span className="node-date">{formatShortDate(entry.takenAt)}</span>
                              <span className="node-area">{trackingAreaLabel(entry.bodyArea)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </>
      )}

      {activeComparison && (
        <CompareDetailModal
          comparison={activeComparison}
          courses={courses}
          mode={compareMode}
          note={activeComparisonNote}
          timelineEntries={activeTimelineEntries}
          onClose={() => setSelectedComparisonId(null)}
          onModeChange={setCompareMode}
          onNoteChange={updateComparisonNote}
        />
      )}

      {selectedEntry && (
        <div className="tracking-modal-overlay" onClick={() => setSelectedEntry(null)}>
          <div className="tracking-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setSelectedEntry(null)} aria-label="Đóng">
              <X size={20} />
            </button>
            
            <div className="modal-image-wrapper">
              <TrackingImage imageKey={selectedEntry.imageLocalKey} alt="Chi tiết ảnh" />
            </div>

            <div className="modal-body">
              <div className="modal-header-row">
                <span className="badge forest">{trackingAreaLabel(selectedEntry.bodyArea)}</span>
                {selectedEntry.courseId && (
                  <span className="course-badge">{courseDisplayName(selectedEntry.courseId, courses)}</span>
                )}
              </div>
              
              <div className="modal-meta-row">
                <Calendar size={14} />
                <span>{formatShortDateTime(new Date(selectedEntry.takenAt))}</span>
              </div>

              {selectedEntry.note && (
                <div className="modal-note-box">
                  <h4>Ghi chú:</h4>
                  <p>{selectedEntry.note}</p>
                </div>
              )}

              <div className="modal-actions">
                <button
                  className="secondary-button delete-action"
                  onClick={async () => {
                    if (confirm('Bạn có chắc chắn muốn xóa ảnh này khỏi nhật ký?')) {
                      const keyToDelete = selectedEntry.imageLocalKey;
                      await onDeleteEntry(selectedEntry);
                      const cachedUrl = trackingImageCache.get(keyToDelete);
                      if (cachedUrl) {
                        URL.revokeObjectURL(cachedUrl);
                        trackingImageCache.delete(keyToDelete);
                      }
                      setSelectedEntry(null);
                    }
                  }}
                >
                  <Trash2 size={16} />
                  Xóa ảnh
                </button>
                <button className="primary-button" onClick={() => setSelectedEntry(null)}>
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ComparisonOptionButton({ option, onOpen }: { option: TrackingComparisonOption; onOpen: () => void }) {
  const Icon = option.icon;
  const disabled = !option.pair;

  return (
    <button type="button" className="comparison-option-card" disabled={disabled} onClick={onOpen}>
      <span className="comparison-option-icon">
        <Icon size={17} />
      </span>
      <span className="comparison-option-copy">
        <small>{option.eyebrow}</small>
        <strong>{option.title}</strong>
        {option.pair ? (
          <span>
            {formatShortDate(option.pair.before.takenAt)} → {formatShortDate(option.pair.after.takenAt)}
          </span>
        ) : (
          <em>{option.unavailable}</em>
        )}
      </span>
    </button>
  );
}

function ComparePhoto({
  label,
  entry,
  courses,
  compact = false,
}: {
  label: string;
  entry: HealthPhotoEntry;
  courses: TreatmentCourse[];
  compact?: boolean;
}) {
  return (
    <div className={`compare-photo ${compact ? 'compact' : ''}`}>
      <TrackingImage imageKey={entry.imageLocalKey} alt={`${label} theo dõi`} />
      <strong>{label}</strong>
      <span>{formatShortDateTime(new Date(entry.takenAt))}</span>
      <small>{trackingAreaLabel(entry.bodyArea)} · {courseDisplayName(entry.courseId, courses)}</small>
      {!!entry.tags?.length && (
        <div className="entry-tag-row">
          {entry.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
      {!compact && entry.note && <p>{entry.note}</p>}
    </div>
  );
}

function CompareDetailModal({
  comparison,
  courses,
  mode,
  note,
  timelineEntries,
  onClose,
  onModeChange,
  onNoteChange,
}: {
  comparison: TrackingComparisonOption & { pair: PhotoComparePair<HealthPhotoEntry> };
  courses: TreatmentCourse[];
  mode: CompareViewMode;
  note: string;
  timelineEntries: HealthPhotoEntry[];
  onClose: () => void;
  onModeChange: (mode: CompareViewMode) => void;
  onNoteChange: (note: string) => void;
}) {
  const { before, after } = comparison.pair;
  const viewModes: Array<{ id: CompareViewMode; label: string; icon: LucideIcon }> = [
    { id: 'side_by_side', label: 'Cạnh nhau', icon: Columns2 },
    { id: 'slider', label: 'Slider', icon: SlidersHorizontal },
    { id: 'carousel', label: 'Timeline', icon: Images },
  ];

  return (
    <div className="tracking-modal-overlay compare-detail-overlay" onClick={onClose}>
      <div className="tracking-modal-content compare-detail-modal" onClick={(event) => event.stopPropagation()}>
        <button className="close-btn" onClick={onClose} aria-label="Đóng">
          <X size={20} />
        </button>

        <div className="compare-detail-body">
          <div className="compare-detail-header">
            <span className="badge forest">{comparison.eyebrow}</span>
            <h3>{comparison.title}</h3>
            <p>
              {formatShortDateTime(new Date(before.takenAt))} → {formatShortDateTime(new Date(after.takenAt))}
            </p>
          </div>

          <div className="compare-view-tabs" role="tablist" aria-label="Chế độ xem so sánh">
            {viewModes.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={mode === item.id ? 'active' : ''}
                  onClick={() => onModeChange(item.id)}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              );
            })}
          </div>

          {mode === 'side_by_side' && (
            <div className="compare-grid detail">
              <ComparePhoto label="Ảnh cũ" entry={before} courses={courses} />
              <ComparePhoto label="Ảnh mới" entry={after} courses={courses} />
            </div>
          )}

          {mode === 'slider' && <BeforeAfterSlider before={before} after={after} />}

          {mode === 'carousel' && <CompareCarousel entries={timelineEntries} courses={courses} />}

          <div className="comparison-note-panel">
            <div className="comparison-note-heading">
              <PencilLine size={17} />
              <strong>Nhận xét của bạn</strong>
            </div>
            <div className="tag-chip-row comparison-prompts">
              {COMPARISON_PROMPT_TAGS.map((tag) => (
                <button type="button" key={tag} onClick={() => onNoteChange(appendComparisonTag(note, tag))}>
                  {tag}
                </button>
              ))}
            </div>
            <textarea
              value={note}
              placeholder="Bạn thấy thay đổi gì? Ví dụ: Mụn viêm giảm, da khô hơn quanh môi."
              onChange={(event) => onNoteChange(event.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function BeforeAfterSlider({ before, after }: { before: HealthPhotoEntry; after: HealthPhotoEntry }) {
  const [position, setPosition] = useState(50);
  const sliderStyle = { '--split-position': `${position}%` } as CSSProperties;

  return (
    <div className="before-after-slider" style={sliderStyle}>
      <div className="before-after-image before">
        <TrackingImage imageKey={before.imageLocalKey} alt="Ảnh trước" />
        <span>{formatShortDate(before.takenAt)}</span>
      </div>
      <div className="before-after-image after">
        <TrackingImage imageKey={after.imageLocalKey} alt="Ảnh sau" />
        <span>{formatShortDate(after.takenAt)}</span>
      </div>
      <div className="before-after-divider" aria-hidden="true">
        <span />
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={position}
        aria-label="Kéo để so sánh ảnh trước và sau"
        onChange={(event) => setPosition(Number(event.target.value))}
      />
    </div>
  );
}

function CompareCarousel({ entries, courses }: { entries: HealthPhotoEntry[]; courses: TreatmentCourse[] }) {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, entries.length - 1)));
  }, [entries.length]);

  const entry = entries[index] ?? entries[0];
  if (!entry) return null;

  function move(delta: number) {
    setIndex((current) => Math.min(entries.length - 1, Math.max(0, current + delta)));
  }

  return (
    <div className="compare-carousel">
      <div
        className="compare-carousel-stage"
        onTouchStart={(event) => {
          touchStartX.current = event.changedTouches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const start = touchStartX.current;
          touchStartX.current = null;
          if (start === null) return;
          const end = event.changedTouches[0]?.clientX ?? start;
          const distance = end - start;
          if (Math.abs(distance) < 42) return;
          move(distance < 0 ? 1 : -1);
        }}
      >
        <button
          type="button"
          className="carousel-nav previous"
          aria-label="Ảnh trước"
          disabled={index === 0}
          onClick={() => move(-1)}
        >
          <ChevronLeft size={20} />
        </button>
        <ComparePhoto label={`${index + 1}/${entries.length}`} entry={entry} courses={courses} />
        <button
          type="button"
          className="carousel-nav next"
          aria-label="Ảnh sau"
          disabled={index === entries.length - 1}
          onClick={() => move(1)}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="compare-carousel-strip" aria-label="Timeline ảnh">
        {entries.map((item, itemIndex) => (
          <button
            type="button"
            key={item.id}
            className={itemIndex === index ? 'active' : ''}
            onClick={() => setIndex(itemIndex)}
          >
            <TrackingImage imageKey={item.imageLocalKey} alt={`Mốc ${itemIndex + 1}`} />
            <span>{formatShortDate(item.takenAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const trackingImageCache = new Map<string, string>();

function TrackingImage({ imageKey, alt }: { imageKey: string; alt: string }) {
  const [imageState, setImageState] = useState<{ imageKey: string; src: string | null }>(() => ({
    imageKey,
    src: trackingImageCache.get(imageKey) ?? null,
  }));

  const src = imageState.imageKey === imageKey ? imageState.src : null;

  useEffect(() => {
    const cachedUrl = trackingImageCache.get(imageKey);
    if (cachedUrl) {
      setImageState({ imageKey, src: cachedUrl });
      return;
    }

    let cancelled = false;
    setImageState({ imageKey, src: null });
    getTrackingImageUrl(imageKey).then((url) => {
      if (cancelled) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      if (url) {
        trackingImageCache.set(imageKey, url);
        setImageState({ imageKey, src: url });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [imageKey]);

  if (!src) {
    return (
      <div className="tracking-image-placeholder">
        <Camera size={20} />
      </div>
    );
  }

  return <img className="tracking-image" src={src} alt={alt} decoding="sync" />;
}

function SettingsView({
  authEmail,
  sessionEmail,
  syncMode,
  pwaState,
  userSettings,
  onAuthEmail,
  onSendMagicLink,
  onSync,
  onNotificationsChange,
  onUserSettingsChange,
  onWaterConfigChange,
  onReset,
}: {
  authEmail: string;
  sessionEmail: string | null;
  syncMode: SyncMode;
  pwaState: ReturnType<typeof getInstallState> | null;
  userSettings: UserSettings;
  onAuthEmail: (email: string) => void;
  onSendMagicLink: () => void;
  onSync: () => void;
  onNotificationsChange: (enabled: boolean) => Promise<boolean>;
  onUserSettingsChange: (settings: UserSettings) => Promise<void>;
  onWaterConfigChange: (config: WaterReminderConfig) => Promise<void>;
  onReset: () => void;
}) {
  const waterConfig = userSettings.waterReminder;
  const [displayNameDraft, setDisplayNameDraft] = useState(userSettings.displayName ?? '');
  const [isChangingNotifications, setIsChangingNotifications] = useState(false);
  const normalizedDisplayNameDraft = displayNameDraft.trim().replace(/\s+/g, ' ');
  const hasDisplayNameChange = normalizedDisplayNameDraft !== (userSettings.displayName ?? '');

  useEffect(() => {
    setDisplayNameDraft(userSettings.displayName ?? '');
  }, [userSettings.displayName]);

  function patchWaterConfig(patch: Partial<WaterReminderConfig>) {
    void onWaterConfigChange(hydrateWaterConfig({ ...waterConfig, ...patch }));
  }

  function saveDisplayName() {
    if (!normalizedDisplayNameDraft) return;
    void onUserSettingsChange({ ...userSettings, displayName: normalizedDisplayNameDraft });
  }

  async function handleNotificationToggle(enabled: boolean) {
    setIsChangingNotifications(true);
    try {
      await onNotificationsChange(enabled);
    } finally {
      setIsChangingNotifications(false);
    }
  }

  return (
    <section className="view-stack">
      <div className="section-heading">
        <span className="badge">Cài đặt</span>
        <h2>Đồng bộ và thông báo</h2>
      </div>

      <div className="content-card form-card">
        <div className="section-heading tight">
          <span className="badge dark">
            <LogIn size={14} />
            Tài khoản
          </span>
          <h3>{sessionEmail ? 'Đã đăng nhập' : 'Đăng nhập bằng email'}</h3>
        </div>
        <p className="muted">
          {sessionEmail
            ? `${sessionEmail} · Đang ${syncModeLabel(syncMode)}`
            : 'Nhập email để nhận link đăng nhập. Không cần mật khẩu. App vẫn dùng được khi chưa đăng nhập.'}
        </p>
        {!sessionEmail && (
          <div className="inline-form">
            <input value={authEmail} type="email" placeholder="email của bạn" onChange={(event) => onAuthEmail(event.target.value)} />
            <button className="secondary-button" onClick={onSendMagicLink}>
              Gửi link
            </button>
          </div>
        )}
        <button className="secondary-button wide" onClick={onSync}>
          <RefreshCw size={18} />
          Đồng bộ lại
        </button>
      </div>

      <div className="content-card form-card">
        <div className="section-heading tight">
          <span className="badge">
            <Sparkles size={14} />
            Tên gọi
          </span>
          <h3>App gọi bạn là gì?</h3>
        </div>
        <label>
          Tên hoặc biệt danh
          <input
            value={displayNameDraft}
            maxLength={48}
            placeholder="Ví dụ: Trang, Mèo, chị Minh..."
            autoComplete="nickname"
            onChange={(event) => setDisplayNameDraft(event.target.value)}
          />
        </label>
        <p className="muted">
          Tên này dùng cho lời chào trong app và nội dung nhắc thuốc, nhắc nước.
        </p>
        <button className="secondary-button wide" disabled={!normalizedDisplayNameDraft || !hasDisplayNameChange} onClick={saveDisplayName}>
          <Check size={18} />
          Lưu tên gọi
        </button>
      </div>

      <div className="dark-chamber">
        <div className="section-heading light tight">
          <span className="badge forest">
            <Bell size={14} />
            Thông báo
          </span>
          <h3>Nhắc uống thuốc & uống nước</h3>
        </div>
        <label className="toggle-row notification-toggle-row">
          <span>
            <strong>Thông báo trong app</strong>
            <small>
              {isChangingNotifications
                ? 'Đang cập nhật...'
                : userSettings.notificationEnabled
                  ? 'Đang bật. App sẽ gửi nhắc thuốc và nhắc nước khi đến giờ.'
                  : 'Đang tắt. Lịch vẫn giữ nguyên, chỉ không gửi notification.'}
            </small>
          </span>
          <input
            type="checkbox"
            checked={userSettings.notificationEnabled}
            disabled={isChangingNotifications || (!userSettings.notificationEnabled && pwaState?.canNotify === false)}
            aria-label="Bật tắt thông báo"
            onChange={(event) => void handleNotificationToggle(event.target.checked)}
          />
        </label>
        <div className="settings-grid">
          <InfoRow label="Trạng thái" value={userSettings.notificationEnabled ? 'Đang bật' : 'Đang tắt'} />
          <InfoRow label="Màn hình chính" value={pwaState?.isStandalone ? 'Đã thêm' : 'Cần thêm vào Màn hình chính'} />
          <InfoRow label="Quyền" value={notificationPermissionLabel(pwaState?.permission)} />
          <InfoRow label="Hỗ trợ thông báo" value={pwaState?.canNotify ? 'Hỗ trợ' : 'Không hỗ trợ'} />
        </div>
        <button
          className="cream-button wide"
          disabled={isChangingNotifications || pwaState?.canNotify === false}
          onClick={() => void handleNotificationToggle(true)}
        >
          {isChangingNotifications ? <Loader2 className="spin" size={18} /> : <Bell size={18} />}
          {userSettings.notificationEnabled ? 'Đăng ký lại thiết bị này' : 'Bật nhắc trên thiết bị này'}
        </button>
      </div>

      <div className="content-card form-card">
        <div className="section-heading tight">
          <span className="badge">
            <Droplets size={14} />
            Nước
          </span>
          <h3>Nhắc uống nước</h3>
        </div>
        <label className="toggle-row">
          <span>
            <strong>Bật nhắc uống nước</strong>
            <small>{waterConfig.enabled ? 'Đang nhắc trong ngày' : 'Đang tắt, không hiện trên dashboard'}</small>
          </span>
          <input
            type="checkbox"
            checked={waterConfig.enabled}
            onChange={(event) => patchWaterConfig({ enabled: event.target.checked })}
          />
        </label>

        <div className="two-cols">
          <label>
            Cân nặng
            <input
              type="number"
              min="30"
              max="180"
              value={waterConfig.weightKg ?? ''}
              placeholder="60"
              onChange={(event) => patchWaterConfig({ weightKg: Number(event.target.value) || undefined })}
            />
          </label>
          <label>
            Chiều cao
            <input
              type="number"
              min="120"
              max="220"
              value={waterConfig.heightCm ?? ''}
              placeholder="170"
              onChange={(event) => patchWaterConfig({ heightCm: Number(event.target.value) || undefined })}
            />
          </label>
        </div>

        <WaterConfigFields config={waterConfig} onChange={patchWaterConfig} />
        <button
          className="secondary-button wide"
          onClick={() => onUserSettingsChange({ ...userSettings, onboardingCompleted: false })}
        >
          Chạy lại onboarding
        </button>
      </div>

      <button className="secondary-button wide" onClick={onReset}>
        Khôi phục demo cục bộ
      </button>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BottomNav({ view, onView }: { view: View; onView: (view: View) => void }) {
  const items: Array<{ id: View; label: string; icon: typeof Home }> = [
    { id: 'today', label: 'Hôm nay', icon: Home },
    { id: 'cabinet', label: 'Tủ thuốc', icon: Pill },
    { id: 'tracking', label: 'Theo dõi', icon: Camera },
    { id: 'add', label: 'Thêm đơn', icon: FileText },
    { id: 'settings', label: 'Cài đặt', icon: Settings },
  ];

  return (
    <nav className="bottom-nav" aria-label="Điều hướng chính">
      <div className="nav-pill">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => onView(item.id)}>
              <Icon size={19} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function attachFallbackCourse<T extends { courseId?: string }>(
  item: T,
  activeCourseId: string | undefined,
  knownCourseIds: Set<string>,
): T {
  if (!activeCourseId) return item;
  if (item.courseId && knownCourseIds.has(item.courseId)) return item;
  return { ...item, courseId: activeCourseId };
}

function getActionableReviewNotes(notes: string[] | undefined) {
  return (notes ?? []).map((note) => note.trim()).filter((note) => note && !isMissingDurationReview(note));
}

function isMissingDurationReview(note: string) {
  const normalized = note.toLowerCase();
  return (
    normalized.includes('duration not explicitly') ||
    normalized.includes('duration not stated') ||
    normalized.includes('duration missing') ||
    normalized.includes('không thấy thời gian dùng') ||
    normalized.includes('khong thay thoi gian dung') ||
    normalized.includes('chưa rõ thời gian dùng') ||
    normalized.includes('chua ro thoi gian dung')
  );
}

function getRowsMissingCourse(rows: Array<Record<string, unknown>>) {
  return rows
    .filter((row) => !row.course_id)
    .map((row) => String(row.id ?? ''))
    .filter(Boolean);
}

function toDbDateString(value: unknown) {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

function getRowsWithInvalidMedicationDuration(rows: Array<Record<string, unknown>>) {
  return rows
    .filter((row) => {
      const startDate = toDbDateString(row.start_date);
      const endDate = toDbDateString(row.end_date);
      if (startDate && endDate && endDate < startDate) return true;
      if (row.duration_days == null || row.duration_days === '') return false;
      const durationDays = Number(row.duration_days);
      return Number.isFinite(durationDays) && durationDays <= 0;
    })
    .map((row) => String(row.id ?? ''))
    .filter(Boolean);
}

async function repairRemoteCourseLinks(
  activeCourseId: string | undefined,
  medicationRows: Array<Record<string, unknown>>,
  appointmentRows: Array<Record<string, unknown>>,
  noteRows: Array<Record<string, unknown>>,
) {
  const client = supabase;
  if (!client || !activeCourseId) return;

  const medicationIds = getRowsMissingCourse(medicationRows);
  const appointmentIds = getRowsMissingCourse(appointmentRows);
  const noteIds = getRowsMissingCourse(noteRows);
  const invalidDurationMedicationIds = getRowsWithInvalidMedicationDuration(medicationRows);
  const writes = [];
  if (medicationIds.length) writes.push(client.from('medications').update({ course_id: activeCourseId }).in('id', medicationIds));
  if (appointmentIds.length) writes.push(client.from('appointments').update({ course_id: activeCourseId }).in('id', appointmentIds));
  if (noteIds.length) writes.push(client.from('doctor_notes').update({ course_id: activeCourseId }).in('id', noteIds));
  if (invalidDurationMedicationIds.length) {
    writes.push(client.from('medications').update({ end_date: null, duration_days: null }).in('id', invalidDurationMedicationIds));
  }

  if (!writes.length) return;
  const results = await Promise.all(writes);
  const error = results.find((result) => result.error)?.error;
  if (error) console.error(error);
}

function mapTreatmentCourseFromDb(row: Record<string, unknown>): TreatmentCourse {
  return {
    id: String(row.id),
    name: String(row.name ?? 'Đợt điều trị'),
    startedAt: String(row.started_at),
    endedAt: row.ended_at ? String(row.ended_at) : undefined,
    status: row.status === 'archived' ? 'archived' : 'active',
    source: (row.source as TreatmentCourse['source']) ?? 'mixed',
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

function mapTreatmentCourseToDb(course: TreatmentCourse, householdId: string) {
  return {
    id: course.id,
    household_id: householdId,
    name: course.name,
    started_at: course.startedAt,
    ended_at: course.endedAt || null,
    status: course.status,
    source: course.source,
    created_at: course.createdAt,
  };
}

function mapMedicationFromDb(row: Record<string, unknown>): Medication {
  const startDate = String(row.start_date);
  const endDate = row.end_date ? String(row.end_date) : undefined;
  const durationDays = normalizeDurationDays(row.duration_days == null ? undefined : Number(row.duration_days));
  return {
    id: String(row.id),
    courseId: row.course_id ? String(row.course_id) : undefined,
    patientName: String(row.patient_name ?? ''),
    name: String(row.name ?? ''),
    genericName: row.generic_name ? String(row.generic_name) : undefined,
    strength: row.strength ? String(row.strength) : undefined,
    instructions: String(row.instructions ?? ''),
    form: row.form ? String(row.form) : undefined,
    source: (row.source as Medication['source']) ?? 'manual',
    startDate,
    endDate: endDate && endDate >= startDate ? endDate : undefined,
    scheduleTimes: Array.isArray(row.schedule_times) ? row.schedule_times.map((time) => String(time).slice(0, 5)) : [],
    durationDays,
    quantity: row.quantity == null ? undefined : Number(row.quantity),
    remaining: row.remaining == null ? undefined : Number(row.remaining),
    doctorNotes: row.doctor_notes ? String(row.doctor_notes) : undefined,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

function mapMedicationToDb(medication: Medication, householdId: string) {
  return {
    id: medication.id,
    household_id: householdId,
    course_id: medication.courseId || null,
    patient_name: medication.patientName,
    name: medication.name,
    generic_name: medication.genericName || null,
    strength: medication.strength || null,
    instructions: medication.instructions,
    form: medication.form || null,
    source: medication.source,
    start_date: medication.startDate,
    end_date: medication.endDate || null,
    schedule_times: medication.scheduleTimes,
    duration_days: medication.durationDays || null,
    quantity: medication.quantity ?? null,
    remaining: medication.remaining ?? null,
    doctor_notes: medication.doctorNotes || null,
    created_at: medication.createdAt,
  };
}

function mapDoseEventFromDb(row: Record<string, unknown>): DoseEvent {
  return {
    id: String(row.id),
    medicationId: String(row.medication_id),
    scheduledAt: String(row.scheduled_at),
    status: row.status as DoseStatus,
    actedAt: row.acted_at ? String(row.acted_at) : undefined,
    snoozedUntil: row.snoozed_until ? String(row.snoozed_until) : undefined,
    note: row.note ? String(row.note) : undefined,
  };
}

function mapDoseEventToDb(event: DoseEvent, householdId: string) {
  return {
    id: event.id,
    household_id: householdId,
    medication_id: event.medicationId,
    scheduled_at: event.scheduledAt,
    status: event.status,
    acted_at: event.actedAt || null,
    snoozed_until: event.snoozedUntil || null,
    note: event.note || null,
  };
}

function mapAppointmentFromDb(row: Record<string, unknown>): Appointment {
  return {
    id: String(row.id),
    courseId: row.course_id ? String(row.course_id) : undefined,
    title: String(row.title),
    clinic: row.clinic ? String(row.clinic) : undefined,
    appointmentAt: String(row.appointment_at),
    notes: row.notes ? String(row.notes) : undefined,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

function mapAppointmentToDb(appointment: Appointment, householdId: string) {
  return {
    id: appointment.id,
    household_id: householdId,
    course_id: appointment.courseId || null,
    title: appointment.title,
    clinic: appointment.clinic || null,
    appointment_at: appointment.appointmentAt,
    notes: appointment.notes || null,
    created_at: appointment.createdAt,
  };
}

function mapDoctorNoteFromDb(row: Record<string, unknown>): DoctorNote {
  return {
    id: String(row.id),
    courseId: row.course_id ? String(row.course_id) : undefined,
    note: String(row.note),
    category: (row.category as DoctorNote['category']) ?? 'other',
    pinned: Boolean(row.pinned),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

function mapDoctorNoteToDb(note: DoctorNote, householdId: string) {
  return {
    id: note.id,
    household_id: householdId,
    course_id: note.courseId || null,
    note: note.note,
    category: note.category,
    pinned: note.pinned,
    created_at: note.createdAt,
  };
}

function mapUserSettingsFromDb(row: Record<string, unknown> | null): UserSettings {
  return hydrateUserSettings({
    onboardingCompleted: Boolean(row?.onboarding_completed),
    notificationEnabled: Boolean(row?.notification_enabled),
    displayName: typeof row?.display_name === 'string' ? row.display_name : undefined,
    waterReminder: row?.water_reminder && typeof row.water_reminder === 'object'
      ? (row.water_reminder as Partial<WaterReminderConfig>)
      : undefined,
  });
}

function mapUserSettingsToDb(settings: UserSettings) {
  return {
    display_name: settings.displayName?.trim() || null,
    onboarding_completed: settings.onboardingCompleted,
    notification_enabled: settings.notificationEnabled,
    water_reminder: settings.waterReminder,
  };
}

async function fileToBase64(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  return dataUrl.split(',')[1] ?? dataUrl;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getActiveCourse(data: CareData) {
  return (
    data.treatmentCourses.find((course) => course.id === data.activeCourseId) ??
    data.treatmentCourses.find((course) => course.status === 'active') ??
    data.treatmentCourses[0]
  );
}

function prepareCourseForAdd(
  current: CareData,
  mode: CourseAddMode,
  source: TreatmentCourse['source'],
  _patientName?: string,
): CoursePlan {
  const activeCourse = getActiveCourse(current);
  if (mode === 'current' && activeCourse) {
    return { data: current, courseId: activeCourse.id, archivedCourses: [] };
  }

  const today = getTodayLocalDate();
  const createdAt = new Date().toISOString();
  const courseIndex = current.treatmentCourses.length + 1;
  const createdCourse: TreatmentCourse = {
    id: crypto.randomUUID(),
    name: `Đợt điều trị ${courseIndex}`,
    startedAt: today,
    status: 'active',
    source,
    createdAt,
  };

  const archivedCourses = current.treatmentCourses
    .filter((course) => course.status === 'active')
    .map((course) => ({
      ...course,
      status: 'archived' as const,
      endedAt: course.endedAt ?? today,
    }));

  const nextCourses = [
    createdCourse,
    ...current.treatmentCourses.map((course) => archivedCourses.find((archived) => archived.id === course.id) ?? course),
  ];

  return {
    data: {
      ...current,
      activeCourseId: createdCourse.id,
      treatmentCourses: nextCourses,
    },
    courseId: createdCourse.id,
    createdCourse,
    archivedCourses,
  };
}

function inferMedicineForm(form: string | undefined, name: string, instructions: string) {
  if (form?.trim()) return form.trim().toLowerCase();
  const text = `${name} ${instructions}`.toLowerCase();
  if (text.includes('sữa rửa mặt') || text.includes('sua rua mat') || text.includes('cleanser')) return 'chai';
  if (text.includes('tuýp') || text.includes('tuyp') || text.includes('cream') || text.includes('kem')) return 'tuýp';
  if (text.includes('lọ') || text.includes('lo ') || text.includes('ml') || text.includes('solution')) return 'lọ';
  if (text.includes('chai')) return 'chai';
  if (text.includes('gói') || text.includes('goi')) return 'gói';
  if (text.includes('ống') || text.includes('ong ')) return 'ống';
  if (text.includes('gel')) return 'gel';
  if (text.includes('bôi')) return 'tuýp';
  return 'viên';
}

async function getReadableError(error: unknown) {
  const context = (error as { context?: unknown })?.context;

  if (context instanceof Response) {
    try {
      const payload = await context.clone().json();
      if (typeof payload?.error === 'string') return payload.error;
      if (typeof payload?.message === 'string') return payload.message;
      return JSON.stringify(payload);
    } catch {
      try {
        const text = await context.clone().text();
        if (text) return text;
      } catch {
        // Fall through to the generic branch below.
      }
    }
  }

  if (error instanceof Error) return error.message;
  return 'Lỗi không xác định';
}

function getAuthNotice(error: unknown) {
  if (isAuthRateLimitError(error)) {
    return 'Supabase đang chặn gửi email vì gửi quá nhiều lần. Đợi ít nhất 60 giây rồi thử lại; nếu vẫn 429 thì vào Supabase Auth > Rate Limits hoặc cấu hình SMTP riêng.';
  }

  return error instanceof Error ? error.message : 'Không gửi được link đăng nhập.';
}

function isAuthRateLimitError(error: unknown) {
  const candidate = error as { status?: number; code?: string; message?: string };
  const message = candidate.message?.toLowerCase() ?? '';
  return candidate.status === 429 || candidate.code === 'over_email_send_rate_limit' || message.includes('rate limit');
}

function isTakenLateEnumError(error: unknown) {
  const candidate = error as { code?: string; message?: string; details?: string; hint?: string };
  const text = [candidate.code, candidate.message, candidate.details, candidate.hint].filter(Boolean).join(' ').toLowerCase();
  return text.includes('taken_late') && (candidate.code === '22P02' || text.includes('dose_status') || text.includes('enum'));
}

function syncModeLabel(syncMode: SyncMode) {
  return syncMode === 'remote' ? 'đồng bộ' : 'cục bộ';
}

function noteCategoryLabel(category: DoctorNote['category']) {
  const labels: Record<DoctorNote['category'], string> = {
    warning: 'Lưu ý',
    care: 'Chăm sóc',
    recheck: 'Tái khám',
    other: 'Khác',
  };

  return labels[category];
}

function trackingAreaLabel(area: TrackingBodyArea) {
  return BODY_AREAS.find((item) => item.id === area)?.label ?? 'Khác';
}

function formatPhotoOptionLabel(entry: HealthPhotoEntry) {
  return `${formatShortDateTime(new Date(entry.takenAt))} · ${trackingAreaLabel(entry.bodyArea)}`;
}

function comparisonNoteKey(comparisonId: ComparisonOptionId, pair: PhotoComparePair<HealthPhotoEntry>) {
  return `${comparisonId}:${pair.before.id}:${pair.after.id}`;
}

function loadComparisonNotes(): Record<string, string> {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(COMPARISON_NOTES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string')) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveComparisonNotes(notes: Record<string, string>) {
  window.localStorage.setItem(COMPARISON_NOTES_STORAGE_KEY, JSON.stringify(notes));
}

function appendComparisonTag(note: string, tag: string) {
  const trimmed = note.trim();
  if (!trimmed) return tag;
  if (trimmed.includes(tag)) return note;
  return `${trimmed} · ${tag}`;
}

function formatShortDate(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}

function courseDisplayName(courseId: string | undefined, courses: TreatmentCourse[]) {
  if (!courseId) return 'Chưa gắn đợt';
  const ordered = [...courses].sort((a, b) => {
    const startedDiff = new Date(a.startedAt || a.createdAt).getTime() - new Date(b.startedAt || b.createdAt).getTime();
    if (startedDiff !== 0) return startedDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  const index = ordered.findIndex((item) => item.id === courseId);
  return `Đợt điều trị ${index >= 0 ? index + 1 : ordered.length}`;
}

function formatTrackingDay(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const options = { timeZone: 'Asia/Ho_Chi_Minh' } as const;
  const dateKey = date.toLocaleDateString('vi-VN', options);
  if (dateKey === today.toLocaleDateString('vi-VN', options)) return 'Hôm nay';
  if (dateKey === yesterday.toLocaleDateString('vi-VN', options)) return 'Hôm qua';
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

function toLocalDateTimeInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function categorizeDoctorNote(note: string): DoctorNote['category'] {
  const normalized = note.toLowerCase();
  if (normalized.includes('tái khám') || normalized.includes('khám lại')) return 'recheck';
  if (
    normalized.includes('không') ||
    normalized.includes('tránh') ||
    normalized.includes('hạn chế') ||
    normalized.includes('cấm') ||
    normalized.includes('ngừng')
  ) {
    return 'warning';
  }

  return 'care';
}

function notificationPermissionLabel(permission?: string) {
  if (permission === 'granted') return 'Đã cho phép';
  if (permission === 'denied') return 'Đã chặn';
  if (permission === 'default') return 'Chưa hỏi';
  return 'Không hỗ trợ';
}
