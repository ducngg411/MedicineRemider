import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Edit2,
  Eye,
  Heart,
  Info,
  Minus,
  Moon,
  Pill,
  Plus,
  Save,
  SkipForward,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { formatShortDateTime, formatTime } from '../lib/date';
import type { Appointment, DoctorNote, DoseEvent, DoseInstance, DoseStatus, Medication, TreatmentCourse, DayStreak } from '../lib/types';
import { summarizeDoses, normalizeTimes } from '../lib/schedule';
import { ProgressRing } from './ProgressRing';

/* ───── constants ───── */

/** Forms that are counted per-unit (decrement on take) */
const UNIT_FORMS = new Set(['viên', 'vien', 'viãªn', 'tablet', 'capsule', 'cap', 'pill', 'gói', 'goi', 'packet', 'tab']);

/** Returns true if the medication's form is countable per dose */
export function isUnitForm(form?: string): boolean {
  if (!form) return true; // default assume countable (viên)
  const raw = form.toLowerCase().trim();
  const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll('đ', 'd');
  return UNIT_FORMS.has(raw) || UNIT_FORMS.has(normalized);
}

/** Safely parse a date string – returns null when invalid */
function safeDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Live clock — ticks every second */
function useLiveClock() {
  const [tick, setTick] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTick(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

/* ───── helpers ───── */

function noteCategoryLabel(cat: DoctorNote['category']) {
  return ({ warning: 'Lưu ý', care: 'Chăm sóc', recheck: 'Tái khám', other: 'Khác' })[cat];
}

function noteCategoryIcon(cat: DoctorNote['category']) {
  if (cat === 'warning') return <AlertTriangle size={13} />;
  if (cat === 'recheck') return <CalendarDays size={13} />;
  return <BookOpen size={13} />;
}

/** Dose is close enough to deserve visual emphasis */
function isImminent(dose: DoseInstance, now = new Date()) {
  if (dose.status !== 'soon' && dose.status !== 'due' && dose.status !== 'snoozed') return false;
  const diff = dose.scheduledAt.getTime() - now.getTime();
  return diff >= -5 * 60 * 1000 && diff <= 60 * 60 * 1000; // -5min to +60min window
}

type Period = { key: string; label: string; icon: React.ReactNode; range: [number, number] };

const PERIODS: Period[] = [
  { key: 'morning',   label: 'Buổi sáng',   icon: <Sunrise size={14} />, range: [0, 12] },
  { key: 'afternoon', label: 'Buổi chiều',   icon: <Sun size={14} />,     range: [12, 18] },
  { key: 'evening',   label: 'Buổi tối',     icon: <Moon size={14} />,    range: [18, 24] },
];

function getPeriodKey(date: Date): string {
  const h = date.getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

/** Next upcoming dose group at the same time */
function getNextDoseGroup(doses: DoseInstance[], now: Date): DoseInstance[] {
  const pending = doses
    .filter((d) => d.status === 'upcoming' || d.status === 'soon' || d.status === 'due' || d.status === 'snoozed')
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const next = pending[0];
  if (!next) return [];
  const nextTime = next.scheduledAt.getTime();
  return pending.filter((dose) => dose.scheduledAt.getTime() === nextTime);
}

function formatCountdown(target: Date, now: Date) {
  const diffMin = Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 60000));
  if (diffMin < 60) return `Còn ${diffMin} phút`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `Còn ${h}h${m > 0 ? ` ${m}p` : ''}`;
}

function getDonePraise(total: number) {
  const messages = [
    'Bạn đang tự chăm sóc bản thân rất tốt đấy!',
    'Lịch trình hôm nay đã hoàn thành xuất sắc.',
    'Nhớ duy trì nhịp độ này cho những ngày tiếp theo nhé.',
    'Ngày hôm nay trọn vẹn rồi, nghỉ ngơi thôi nào!',
  ];
  return messages[Math.max(0, total - 1) % messages.length];
}

function getCourseTime(course: TreatmentCourse) {
  return new Date(course.startedAt || course.createdAt).getTime() || 0;
}

function getTreatmentCourseLabel(course: TreatmentCourse, courses: TreatmentCourse[]) {
  const ordered = [...courses].sort((a, b) => {
    const startedDiff = getCourseTime(a) - getCourseTime(b);
    if (startedDiff !== 0) return startedDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  const index = ordered.findIndex((item) => item.id === course.id);
  return `Đợt điều trị ${index >= 0 ? index + 1 : ordered.length + 1}`;
}

function sortCoursesForDisplay(courses: TreatmentCourse[], activeCourseId?: string) {
  return [...courses].sort((a, b) => {
    if (a.id === activeCourseId) return -1;
    if (b.id === activeCourseId) return 1;
    const startedDiff = getCourseTime(b) - getCourseTime(a);
    if (startedDiff !== 0) return startedDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/* ───── Today View ───── */

export function TodayView({
  doses,
  streak,
  notes,
  displayName,
  notificationBanner,
  waterCard,
  onDoseAction,
  onAdd,
  onOpenNotes,
}: {
  doses: DoseInstance[];
  streak: DayStreak[];
  notes: DoctorNote[];
  displayName?: string;
  notificationBanner?: ReactNode;
  waterCard?: ReactNode;
  onDoseAction: (dose: DoseInstance, status: DoseStatus) => void;
  onAdd: () => void;
  onOpenNotes: () => void;
}) {


  const summary = summarizeDoses(doses);
  const greetingName = displayName?.trim();
  const allDone = summary.total > 0 && summary.pending === 0 && summary.late === 0 && summary.missed === 0;
  const donePraise = allDone ? getDonePraise(summary.total) : '';
  const now = new Date();
  const nextDoseGroup = getNextDoseGroup(doses, now);
  const nextDose = nextDoseGroup[0] ?? null;

  // Late doses (0-4h overdue, still actionable)
  const lateDoses = doses.filter((d) => d.status === 'late');
  const firstLateDose = lateDoses[0] ?? null;
  const hasLateDose = lateDoses.length > 0;
  const lateMin = firstLateDose
    ? Math.round((now.getTime() - firstLateDose.scheduledAt.getTime()) / 60000)
    : 0;

  // Hero eyebrow — priority: late > next due > missed > done
  const heroEyebrow = allDone ? '🎉 Hoàn thành hôm nay'
    : hasLateDose ? 'Liều đang trễ'
    : nextDose ? 'Liều tiếp theo'
    : summary.missed > 0 ? 'Có liều bị bỏ lỡ'
    : 'Hôm nay';

  // ── Group by period (morning / afternoon / evening) ──
  const periodGroups = PERIODS.map((p) => ({
    ...p,
    doses: doses.filter((d) => getPeriodKey(d.scheduledAt) === p.key),
  })).filter((g) => g.doses.length > 0);

  // Compute countdown string separately for hero sub-label
  const nextMedName = nextDoseGroup.length === 1
    ? nextDoseGroup[0].medication.name
    : nextDoseGroup.length > 1
      ? `${nextDoseGroup[0].medication.name} +${nextDoseGroup.length - 1}`
      : null;

  const diffMin = nextDose ? Math.round((nextDose.scheduledAt.getTime() - now.getTime()) / 60000) : null;
  let countdownText = '';
  if (diffMin !== null) {
    if (diffMin <= 0) countdownText = 'Đến giờ uống rồi!';
    else countdownText = formatCountdown(nextDose.scheduledAt, now);
  }

  const liveClock = useLiveClock();

  // Format live clock as HH:MM:SS GMT+7
  const liveTimeStr = liveClock.toLocaleTimeString('vi-VN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'Asia/Ho_Chi_Minh',
  });

  const [successDialog, setSuccessDialog] = useState<ActionSuccess | null>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showDoseSuccess(status: DoseStatus) {
    const isLateAction = status === 'taken_late';
    const messages = isLateAction ? LATE_SUCCESS_MESSAGES : ON_TIME_SUCCESS_MESSAGES;
    setSuccessDialog({
      ...messages[Math.floor(Math.random() * messages.length)],
      late: isLateAction,
    });
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setSuccessDialog(null), 3600);
  }

  useEffect(() => () => { if (successTimer.current) clearTimeout(successTimer.current); }, []);

  return (
    <section className="view-stack">
      {/* ── progress hero ── */}
      <div className={`progress-hero${allDone ? ' hero--done' : ''}${hasLateDose ? ' hero--late' : ''}`}>

        {/* ── TOP: live clock ── */}
        <div className="hero-clock-section">
          <span className="hero-clock">{liveTimeStr}</span>
          <span className="hero-clock-tz">GMT+7</span>
        </div>

        <hr className="hero-divider" />

        {/* ── BOTTOM: dose info ── */}
        <div className="hero-dose-section">
          <div className="hero-main-content">
            <div className="hero-left-col">
              <p className={`hero-eyebrow${hasLateDose ? ' hero-eyebrow--late' : ''}`}>{heroEyebrow}</p>
              
              {/* Big time */}
              {hasLateDose && <h2 className="hero-time hero-time--late">{formatTime(firstLateDose!.scheduledAt)}</h2>}
              {!hasLateDose && nextDose && !allDone && <h2 className="hero-time">{formatTime(nextDose.scheduledAt)}</h2>}
              {allDone && <h2 className="hero-time hero-time--done">Ngon luôn!</h2>}
              {!hasLateDose && !nextDose && !allDone && summary.missed > 0 && (
                <h2 className="hero-time hero-time--missed">{summary.missed} bỏ lỡ</h2>
              )}
              {!hasLateDose && !nextDose && !allDone && summary.missed === 0 && summary.total === 0 && (
                <p className="hero-empty-sub">{greetingName ? `Hôm nay của ${greetingName} đang nhẹ tênh.` : 'Chưa có lịch hôm nay'}</p>
              )}

              {/* Med name row */}
              {hasLateDose && (
                <div className="hero-med-row">
                  <span className="hero-med-name">{firstLateDose!.medication.name}</span>
                  <span className="hero-countdown hero-countdown--late">Trễ {lateMin} phút</span>
                </div>
              )}
              {!hasLateDose && nextMedName && !allDone && (
                <div className="hero-med-row">
                  <span className="hero-med-name">{nextMedName}</span>
                  {countdownText && <span className="hero-countdown">{countdownText}</span>}
                </div>
              )}
              {allDone && (
                <div className="hero-done-copy">
                  <p className="hero-done-sub">{greetingName ? `${greetingName} đã uống đủ thuốc hôm nay.` : 'Bạn đã uống đủ thuốc hôm nay.'}</p>
                  <p className="hero-done-praise">{donePraise}</p>
                </div>
              )}
            </div>

            {summary.total > 0 && (
              <div className="hero-right-col">
                <ProgressRing done={summary.taken} total={summary.total} size={allDone ? 64 : 76} />
              </div>
            )}
          </div>


          {/* Footer */}
          <div className="hero-footer">
            {summary.total > 0 && (
              <div className="progress-stats">
                {summary.taken > 0 && <span className="stat-done"><Check size={11} /> {summary.taken} xong</span>}
                {summary.pending > 0 && <span className="stat-pending"><Clock3 size={11} /> {summary.pending} chờ</span>}
                {summary.late > 0 && <span className="stat-late"><AlertTriangle size={11} /> {summary.late} trễ</span>}
                {summary.missed > 0 && <span className="stat-missed"><AlertTriangle size={11} /> {summary.missed} bỏ lỡ</span>}
              </div>
            )}
            {!hasLateDose && (
              <button className="hero-add-btn" onClick={onAdd} aria-label="Thêm đơn thuốc">
                <Plus size={15} /> Thêm thuốc
              </button>
            )}
          </div>
        </div>
      </div>

      {notificationBanner}

      {(waterCard || notes.length > 0) && (
        <div className="dashboard-widgets">
          {waterCard}
          {notes.length > 0 && (
            <div className="doctor-notes-card" onClick={onOpenNotes}>
              <div className="notes-card-icon">
                <BookOpen size={20} />
              </div>
              <div className="notes-card-body">
                <h4>Dặn dò từ bác sĩ</h4>
                <p>{notes.length} lưu ý quan trọng</p>
              </div>
              <button className="icon-button note-view-btn" aria-label="Xem dặn dò bác sĩ">
                <Eye size={17} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── streak tracker ── */}
      <div className="streak-card">
        <h4 className="streak-title">7 ngày gần đây</h4>
        <div className="streak-days-row">
          {streak.map((day) => {
            let statusClass = '';
            let iconElement: React.ReactNode = null;
            if (day.status === 'done') {
              statusClass = 'streak-day--done';
              iconElement = <Check size={14} strokeWidth={3.5} />;
            } else if (day.status === 'missed') {
              statusClass = 'streak-day--missed';
              iconElement = <AlertTriangle size={13} strokeWidth={3.5} />;
            } else if (day.status === 'pending') {
              statusClass = 'streak-day--pending';
              iconElement = <Clock3 size={13} strokeWidth={3.5} />;
            } else {
              statusClass = 'streak-day--empty';
              iconElement = <Minus size={13} strokeWidth={3.5} />;
            }

            return (
              <div key={day.dateStr} className={`streak-day-col${day.isToday ? ' streak-day--today' : ''}`}>
                <span className="streak-day-label">{day.label}</span>
                <div className={`streak-day-circle ${statusClass}`} title={day.totalCount > 0 ? `Đã uống ${day.takenCount}/${day.totalCount} liều` : 'Không có lịch uống'}>
                  {iconElement}
                </div>
              </div>
            );
          })}
        </div>
      </div>



      {/* ── celebration ── */}
      {allDone && (
        <div className="celebration-card">
          <Sparkles size={26} />
          <h3>Tuyệt vời!</h3>
          <p>Bạn đã hoàn thành tất cả lần uống thuốc hôm nay.</p>
        </div>
      )}

      {/* ── empty state ── */}
      {summary.total === 0 && (
        <div className="empty-state">
          <Pill size={32} />
          <p>Chưa có lịch thuốc hôm nay.</p>
          <button className="primary-button" onClick={onAdd}>Thêm đơn đầu tiên</button>
        </div>
      )}

      {/* ── grouped by sáng / chiều / tối ── */}
      {periodGroups.map((group) => {
        const groupDone = group.doses.every((d) => d.status === 'taken' || d.status === 'taken_late' || d.status === 'skipped');
        const hasMissed = group.doses.some((d) => d.status === 'missed');
        const hasLate = group.doses.some((d) => d.status === 'late');
        return (
          <div
            key={group.key}
            className={`time-group${groupDone ? ' group-all-done' : ''}${hasMissed ? ' group-has-missed' : ''}`}
          >
            <div className="time-group-label">
              {group.icon}
              <span>{group.label}</span>
              {groupDone && <span className="group-done"><Check size={12} /> Xong</span>}
              {hasMissed && !groupDone && <span className="group-missed"><AlertTriangle size={12} /> Có bỏ lỡ</span>}
              {hasLate && !groupDone && !hasMissed && <span className="group-late"><AlertTriangle size={12} /> Đang trễ</span>}
            </div>
            <div className="dose-grid">
              {group.doses.map((dose) => (
                <DoseCard key={dose.id} dose={dose} now={now} onAction={onDoseAction} onSuccess={showDoseSuccess} />
              ))}
            </div>
          </div>
        );
      })}


      {successDialog && <DoseSuccessDialog success={successDialog} onDismiss={() => setSuccessDialog(null)} />}
    </section>
  );
}

/* ───── Dose Card ───── */

function DoseCard({
  dose,
  now,
  onAction,
  onSuccess,
}: {
  dose: DoseInstance;
  now: Date;
  onAction: (dose: DoseInstance, status: DoseStatus) => void;
  onSuccess: (status: DoseStatus) => void;
}) {
  const isDone = dose.status === 'taken' || dose.status === 'taken_late' || dose.status === 'skipped';
  const isMissed = dose.status === 'missed';
  const isLate = dose.status === 'late';
  const isDue = dose.status === 'due';
  const isSoon = dose.status === 'soon';
  const isUpcoming = dose.status === 'upcoming';
  const [detailsOpen, setDetailsOpen] = useState(false);

  const imminent = isImminent(dose, now);
  const isTopical = !isUnitForm(dose.medication.form);

  function handleAction(status: DoseStatus) {
    if (status === 'taken' && isSoon) {
      const minutesEarly = Math.max(1, Math.ceil((dose.scheduledAt.getTime() - now.getTime()) / 60000));
      const ok = window.confirm(`Bạn đang ghi nhận uống sớm ${minutesEarly} phút. Tiếp tục?`);
      if (!ok) return;
    }

    if (status === 'taken' || status === 'taken_late') {
      onSuccess(status);
    }
    onAction(dose, status);
  }

  const lateMin = Math.round((now.getTime() - dose.scheduledAt.getTime()) / 60000);
  const countdownText = (isUpcoming || isSoon) ? formatCountdown(dose.scheduledAt, now) : '';

  return (
    <article className={[
      'dose-card',
      isDone ? 'done' : '',
      isMissed ? 'missed-active' : '',
      isLate ? 'late-active' : '',
      imminent && !isLate && !isMissed ? 'upcoming-highlight' : '',
    ].filter(Boolean).join(' ')}>
      <div className="dose-time">
        <Clock3 size={15} />
        <span>{formatTime(dose.scheduledAt)}</span>
      </div>
      <div className="dose-copy">
        <h3>
          {dose.medication.name}
          {isTopical && <span className="form-tag">{dose.medication.form}</span>}
          {isLate && <span className="overdue-tag tag--late">Trễ {lateMin}p</span>}
          {isMissed && <span className="overdue-tag tag--missed">Bỏ lỡ</span>}
        </h3>
        {!isUpcoming && <p>{dose.medication.instructions}</p>}
        
        {isMissed && (
          <p className="missed-warning-text">⚠️ Kiểm tra hướng dẫn dùng thuốc trước khi uống bù</p>
        )}
        {(isUpcoming || isSoon) && (
          <p className="dose-countdown">{countdownText}</p>
        )}

        <div className="dose-meta">
          <span>{dose.medication.patientName}</span>
          {typeof dose.medication.remaining === 'number' && isUnitForm(dose.medication.form) && (
            <span className={dose.medication.remaining <= 5 ? 'stock-warn' : ''}>
              còn {dose.medication.remaining} {dose.medication.form || 'viên'}
            </span>
          )}
          {typeof dose.medication.remaining === 'number' && !isUnitForm(dose.medication.form) && (
            <span>{dose.medication.remaining} {dose.medication.form}</span>
          )}
        </div>
        {detailsOpen && (
          <div className="dose-extra-detail">
            <span>{dose.medication.instructions}</span>
            <span>Giờ hẹn: {formatTime(dose.scheduledAt)}</span>
            {dose.medication.doctorNotes && <span>{dose.medication.doctorNotes}</span>}
          </div>
        )}
      </div>

      {isDone ? (
        <div className="dose-status-done">
          {dose.status === 'taken' || dose.status === 'taken_late' ? <Check size={13} /> : <SkipForward size={13} />}
          {dose.status === 'taken' ? (isTopical ? 'Đã dùng' : 'Đã uống') : dose.status === 'taken_late' ? (isTopical ? 'Đã dùng muộn' : 'Đã uống muộn') : 'Bỏ qua'}
        </div>
      ) : (
        <div className={`dose-actions${isLate ? ' three-btns' : ''}${isUpcoming ? ' upcoming-actions' : ''}`}>
          {isUpcoming && (
            <button className="icon-button skip-btn" onClick={() => setDetailsOpen((open) => !open)}>
              Chi tiết
            </button>
          )}
          {isSoon && (
            <>
              <button className="icon-button taken-btn early-btn" onClick={() => handleAction('taken')}>
                <Check size={15} /> Uống sớm
              </button>
              <button className="icon-button skip-btn snooze-btn" onClick={() => window.alert('App vẫn sẽ nhắc theo giờ đã đặt.')}>
                <Clock3 size={15} /> Nhắc tôi
              </button>
            </>
          )}
          {isDue && (
            <>
              <button className="icon-button taken-btn" onClick={() => handleAction('taken')}>
                <Check size={15} /> {isTopical ? 'Đã dùng' : 'Đã uống'}
              </button>
              <button className="icon-button skip-btn snooze-btn" onClick={() => handleAction('snoozed')}>
                <Clock3 size={15} /> Nhắc lại 10p
              </button>
            </>
          )}
          {isLate && (
            <>
              <button className="icon-button taken-btn late-btn" onClick={() => handleAction('taken_late')}>
                <Check size={15} /> Uống muộn
              </button>
              <button className="icon-button skip-btn snooze-btn" onClick={() => handleAction('snoozed')}>
                <Clock3 size={15} /> Nhắc lại
              </button>
              <button className="icon-button skip-btn" onClick={() => handleAction('skipped')}>
                <SkipForward size={15} /> Bỏ qua
              </button>
            </>
          )}
          {isMissed && (
            <>
              <button className="icon-button taken-btn late-btn" onClick={() => handleAction('taken_late')}>
                <Check size={15} /> Uống bù
              </button>
              <button className="icon-button skip-btn" onClick={() => handleAction('skipped')}>
                <SkipForward size={15} /> Bỏ qua
              </button>
            </>
          )}
        </div>
      )}

    </article>
  );
}

type ActionSuccess = {
  title: string;
  text: string;
  late: boolean;
};

const ON_TIME_SUCCESS_MESSAGES: Array<Omit<ActionSuccess, 'late'>> = [
  { title: 'Xong một liều rồi', text: 'Ghi nhận thành công. Giữ nhịp thế này là rất ổn.' },
  { title: 'Đã hoàn thành', text: 'Một việc nhỏ nhưng đáng kể. Lịch hôm nay nhẹ đi rồi.' },
  { title: 'Đúng giờ đẹp luôn', text: 'Thuốc đã được đánh dấu. Tiếp tục giữ nhịp nhé.' },
];

const LATE_SUCCESS_MESSAGES: Array<Omit<ActionSuccess, 'late'>> = [
  { title: 'Đã xử lý liều trễ', text: 'Ok sự cố nhỏ. Ngày mai mình bắt đầu lại tốt hơn nhé.' },
  { title: 'Muộn nhưng đã xong', text: 'Ghi nhận rồi. Tốt hơn là để trôi mất liều này.' },
  { title: 'Đã uống bù', text: 'Một bước quay lại đúng lộ trình. Nhẹ người hơn rồi.' },
];

function DoseSuccessDialog({ success, onDismiss }: { success: ActionSuccess; onDismiss: () => void }) {
  return (
    <div className="success-dialog-backdrop" role="status" aria-live="polite">
      <div className={`success-dialog${success.late ? ' late' : ''}`}>
        <div className="confetti-burst" aria-hidden="true">
          {Array.from({ length: 14 }).map((_, index) => (
            <span key={index} />
          ))}
        </div>
        <button className="success-dialog-close" type="button" onClick={onDismiss} aria-label="Đóng">
          <X size={15} />
        </button>
        <div className="success-mark">
          <Check size={32} />
        </div>
        <h3>{success.title}</h3>
        <p>{success.text}</p>
      </div>
    </div>
  );
}

/* ───── Cabinet View ───── */

export function CabinetView({
  medications,
  doseEvents,
  appointments,
  notes,
  courses,
  activeCourseId,
  onActivateCourse,
  onDelete,
  onEdit,
  onDeleteCourseMedications,
  onDeleteAllMedications,
  onDeleteNote,
  onToggleNotePinned,
}: {
  medications: Medication[];
  doseEvents: DoseEvent[];
  appointments: Appointment[];
  notes: DoctorNote[];
  courses: TreatmentCourse[];
  activeCourseId?: string;
  onActivateCourse: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (medication: Medication) => void;
  onDeleteCourseMedications: (id: string) => void;
  onDeleteAllMedications: () => void;
  onDeleteNote: (id: string) => void;
  onToggleNotePinned: (id: string) => void;
}) {
  const [selectedCourseId, setSelectedCourseId] = useState(activeCourseId ?? courses[0]?.id ?? 'all');
  const displayCourses = sortCoursesForDisplay(courses, activeCourseId);
  const selectedCourse = courses.find((course) => course.id === selectedCourseId);
  const visibleMedications = selectedCourseId === 'all'
    ? medications
    : medications.filter((medication) => medication.courseId === selectedCourseId);
  const visibleNotes = selectedCourseId === 'all'
    ? notes
    : notes.filter((note) => note.courseId === selectedCourseId);
  const visibleAppointments = selectedCourseId === 'all'
    ? appointments
    : appointments.filter((appointment) => appointment.courseId === selectedCourseId);

  useEffect(() => {
    if (activeCourseId) setSelectedCourseId(activeCourseId);
  }, [activeCourseId]);

  return (
    <section className="view-stack">
      <div className="section-heading">
        <span className="badge">Tủ thuốc</span>
        <h2>Quản lí thuốc</h2>
      </div>

      <div className="content-card course-manager">
        <div className="course-tabs">
          {displayCourses.map((course) => (
            <button
              type="button"
              key={course.id}
              className={selectedCourseId === course.id ? 'active' : ''}
              onClick={() => setSelectedCourseId(course.id)}
            >
              {getTreatmentCourseLabel(course, courses)}
              {course.id === activeCourseId && <span>Đang theo dõi</span>}
            </button>
          ))}
          <button
            type="button"
            className={`all-filter ${selectedCourseId === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedCourseId('all')}
          >
            Tất cả
          </button>
        </div>

        {selectedCourse && (
          <div className="course-actions">
            {selectedCourse.id !== activeCourseId && (
              <button className="secondary-button" type="button" onClick={() => onActivateCourse(selectedCourse.id)}>
                Theo dõi đợt này
              </button>
            )}
            <button className="secondary-button" type="button" onClick={() => onDeleteCourseMedications(selectedCourse.id)}>
              Xóa thuốc đợt này
            </button>
            <button className="secondary-button danger" type="button" onClick={onDeleteAllMedications}>
              Xóa tất cả thuốc
            </button>
          </div>
        )}
        {!selectedCourse && (
          <div className="course-actions">
            <button className="secondary-button danger" type="button" onClick={onDeleteAllMedications}>
              Xóa tất cả thuốc
            </button>
          </div>
        )}
      </div>

      {visibleMedications.length === 0 && (
        <div className="empty-state">
          <Pill size={32} />
          <p>Chưa có thuốc nào trong tủ.</p>
        </div>
      )}

      <div className="cabinet-list">
        {visibleMedications.map((med) => (
          <MedicationCard
            key={med.id}
            medication={med}
            events={doseEvents.filter((e) => e.medicationId === med.id)}
            onDelete={onDelete}
            onEdit={onEdit}
          />
        ))}
      </div>

      {visibleNotes.length > 0 && (
        <>
          <div className="section-heading">
            <span className="badge">Dặn dò</span>
            <h3>Quản lí lưu ý</h3>
          </div>
          <div className="note-manage-list">
            {visibleNotes.map((note) => (
              <article className="content-card note-manage-card" key={note.id}>
                <div>
                  <span className="note-manage-label">{noteCategoryIcon(note.category)} {noteCategoryLabel(note.category)}</span>
                  <p>{note.note}</p>
                </div>
                <div className="note-actions">
                  <button className="secondary-button" type="button" onClick={() => onToggleNotePinned(note.id)}>
                    {note.pinned ? 'Ẩn khỏi Hôm nay' : 'Ghim lại'}
                  </button>
                  <button className="secondary-button danger" type="button" onClick={() => onDeleteNote(note.id)}>
                    <Trash2 size={14} /> Xóa
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {visibleAppointments.length > 0 && (
        <>
          <div className="section-heading">
            <span className="badge">Lịch khám</span>
            <h3>Sắp tới</h3>
          </div>
          <div className="card-list">
            {visibleAppointments.slice(0, 5).map((apt) => {
              const d = safeDate(apt.appointmentAt);
              if (!d) return null;
              return (
                <article className="content-card compact" key={apt.id}>
                  <CalendarDays size={18} />
                  <div>
                    <strong>{apt.title}</strong>
                    <p>{formatShortDateTime(d)}</p>
                    {apt.clinic && <small>{apt.clinic}</small>}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/* ───── Medication Card ───── */

function MedicationCard({
  medication,
  events,
  onDelete,
  onEdit,
}: {
  medication: Medication;
  events: DoseEvent[];
  onDelete: (id: string) => void;
  onEdit: (medication: Medication) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<Medication>(medication);
  const [editTimeText, setEditTimeText] = useState(medication.scheduleTimes.join(', '));

  // Keep edit draft in sync if parent medication changes (e.g. remaining decremented)
  useEffect(() => {
    if (!editing) {
      setEditDraft(medication);
      setEditTimeText(medication.scheduleTimes.join(', '));
    }
  }, [medication, editing]);

  const unitForm = isUnitForm(medication.form);
  const hasStock = typeof medication.quantity === 'number' && typeof medication.remaining === 'number';
  const stockPct = hasStock ? Math.round((medication.remaining! / medication.quantity!) * 100) : null;
  const isLow = hasStock && unitForm && medication.remaining! <= 5;

  const history = [...events]
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
    .slice(0, 14);

  function handleSaveEdit() {
    const times = normalizeTimes(editTimeText.split(','));
    onEdit({ ...editDraft, scheduleTimes: times.length ? times : editDraft.scheduleTimes });
    setEditing(false);
  }

  function handleCancelEdit() {
    setEditDraft(medication);
    setEditTimeText(medication.scheduleTimes.join(', '));
    setEditing(false);
  }

  return (
    <div className="med-card">
      <div className="med-header" onClick={() => !editing && setOpen(!open)}>
        <div className="med-header-content">
          <div>
            <h3 className="med-title">
              {medication.name}
              {!unitForm && <span className="form-tag">{medication.form}</span>}
            </h3>
            <p className="med-sub">
              {[medication.genericName, medication.strength].filter(Boolean).join(' · ') || 'Thuốc'}
            </p>
            <div className="med-schedule">
              {medication.scheduleTimes.map((t) => (
                <span className="med-time-chip" key={t}><Clock3 size={11} />{t}</span>
              ))}
            </div>
          </div>
          {hasStock && unitForm && (
            <div className="stock-row">
              <div className="stock-bar">
                <div className={`stock-fill ${isLow ? 'low' : ''}`} style={{ width: `${stockPct}%` }} />
              </div>
              <span className={`stock-label ${isLow ? 'low' : ''}`}>
                {isLow && <AlertTriangle size={12} />}
                {medication.remaining}/{medication.quantity} {medication.form || 'viên'}
              </span>
            </div>
          )}
          {hasStock && !unitForm && (
            <div className="stock-row">
              <span className="stock-label">
                <Pill size={12} />
                {medication.remaining} {medication.form} còn lại
              </span>
            </div>
          )}
        </div>
        <div className={`med-expand-icon ${open && !editing ? 'open' : ''}`}>
          <ChevronDown size={18} />
        </div>
      </div>

      {open && !editing && (
        <div className="med-detail">
          <div className="med-detail-section">
            <h4><BookOpen size={12} /> Cách dùng</h4>
            <p>{medication.instructions}</p>
          </div>

          {!unitForm && (
            <div className="med-detail-section">
              <h4><AlertTriangle size={12} /> Lưu ý về dạng dùng</h4>
              <p style={{ color: 'var(--color-fog)' }}>
                Dạng <strong>{medication.form}</strong> — số lượng không tự trừ khi đánh dấu đã dùng.
                Bạn tự theo dõi lượng còn lại trong tủ thuốc.
              </p>
            </div>
          )}

          {medication.doctorNotes && (
            <div className="med-detail-section">
              <h4><AlertTriangle size={12} /> Ghi chú bác sĩ</h4>
              <p>{medication.doctorNotes}</p>
            </div>
          )}

          <div className="med-detail-section">
            <h4><CalendarDays size={12} /> Thời gian dùng</h4>
            <p>
              {medication.startDate} → {medication.endDate || 'khi dừng'}
              {medication.durationDays ? ` · ${medication.durationDays} ngày` : ''}
            </p>
          </div>

          <div className="med-detail-section">
            <h4><Sunset size={12} /> Lịch sử {history.length > 0 ? `(${history.length} gần nhất)` : ''}</h4>
            {history.length > 0 ? (
              <div className="history-list">
                {history.map((ev) => (
                  <div className="history-row" key={ev.id}>
                    <span>{formatShortDateTime(new Date(ev.scheduledAt))}</span>
                    <span className={`history-status ${ev.status}`}>
                      {ev.status === 'taken'
                        ? <><Check size={12} /> {unitForm ? 'Đã uống' : 'Đã dùng'}</>
                        : ev.status === 'taken_late'
                        ? <><Check size={12} /> {unitForm ? 'Đã uống muộn' : 'Đã dùng muộn'}</>
                        : ev.status === 'skipped'
                        ? <><SkipForward size={12} /> Bỏ qua</>
                        : <><AlertTriangle size={12} /> Trễ</>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--color-fog)' }}>Chưa có lần dùng nào.</p>
            )}
          </div>

          <div className="med-footer-actions">
            <button className="med-edit-btn" onClick={(e) => { e.stopPropagation(); setEditing(true); setOpen(true); }}>
              <Edit2 size={14} /> Chỉnh sửa
            </button>
            <button className="med-delete" onClick={() => onDelete(medication.id)}>
              <Trash2 size={14} /> Xóa
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="med-edit-panel">
          <div className="med-edit-header">
            <strong>Chỉnh sửa thuốc</strong>
            <button className="icon-button small" onClick={handleCancelEdit} aria-label="Hủy chỉnh sửa">
              <X size={15} />
            </button>
          </div>

          <label className="med-edit-label">
            Tên thuốc
            <input
              value={editDraft.name}
              placeholder="VD: Dokreal 25mg"
              onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
            />
          </label>

          <label className="med-edit-label">
            Cách dùng
            <textarea
              value={editDraft.instructions}
              placeholder="VD: Uống 1 viên sau ăn tối"
              onChange={(e) => setEditDraft({ ...editDraft, instructions: e.target.value })}
            />
          </label>

          <div className="med-edit-two-cols">
            <label className="med-edit-label">
              Giờ nhắc
              <input
                value={editTimeText}
                placeholder="08:30, 20:30"
                onChange={(e) => setEditTimeText(e.target.value)}
                onBlur={(e) => setEditTimeText(normalizeTimes(e.target.value.split(',')).join(', '))}
              />
            </label>
            <label className="med-edit-label">
              Dạng thuốc
              <input
                value={editDraft.form ?? ''}
                placeholder="VD: viên, lọ, tuýp"
                onChange={(e) => setEditDraft({ ...editDraft, form: e.target.value })}
              />
            </label>
          </div>

          <div className="med-edit-two-cols">
            <label className="med-edit-label">
              Bắt đầu
              <input type="date" value={editDraft.startDate} onChange={(e) => setEditDraft({ ...editDraft, startDate: e.target.value })} />
            </label>
            <label className="med-edit-label">
              Kết thúc
              <input type="date" value={editDraft.endDate ?? ''} onChange={(e) => setEditDraft({ ...editDraft, endDate: e.target.value || undefined })} />
            </label>
          </div>

          <div className="med-edit-two-cols">
            <label className="med-edit-label">
              Số lượng
              <input
                type="number" min="0"
                value={editDraft.quantity ?? ''}
                placeholder="VD: 30"
                onChange={(e) => {
                  const q = Number(e.target.value) || undefined;
                  setEditDraft({ ...editDraft, quantity: q });
                }}
              />
            </label>
            <label className="med-edit-label">
              Còn lại
              <input
                type="number" min="0"
                value={editDraft.remaining ?? ''}
                placeholder="VD: 30"
                onChange={(e) => setEditDraft({ ...editDraft, remaining: Number(e.target.value) || undefined })}
              />
            </label>
          </div>

          <label className="med-edit-label">
            Ghi chú bác sĩ
            <textarea
              value={editDraft.doctorNotes ?? ''}
              placeholder="VD: Tránh nắng, tái khám sau 1 tháng"
              onChange={(e) => setEditDraft({ ...editDraft, doctorNotes: e.target.value || undefined })}
            />
          </label>

          <div className="med-edit-actions">
            <button className="secondary-button" onClick={handleCancelEdit}>
              Hủy
            </button>
            <button className="primary-button" onClick={handleSaveEdit}>
              <Save size={16} /> Lưu thay đổi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DoctorNotesSheet({
  isOpen,
  onClose,
  notes,
}: {
  isOpen: boolean;
  onClose: () => void;
  notes: DoctorNote[];
}) {
  const [activeCategory, setActiveCategory] = useState<'all' | 'warning' | 'care' | 'recheck' | 'other'>('all');

  useEffect(() => {
    if (!isOpen) return;

    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;

    html.classList.add('modal-open');
    body.classList.add('modal-open');
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';

    return () => {
      html.classList.remove('modal-open');
      body.classList.remove('modal-open');
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredNotes = activeCategory === 'all'
    ? notes
    : notes.filter(n => n.category === activeCategory);

  const warnings = notes.filter(n => n.category === 'warning');
  const cares = notes.filter(n => n.category === 'care');
  const rechecks = notes.filter(n => n.category === 'recheck');
  const others = notes.filter(n => n.category === 'other');

  return (
    <div className="bottom-sheet-overlay" onClick={onClose}>
      <div className="bottom-sheet-content" onClick={(e) => e.stopPropagation()}>
        <header className="bottom-sheet-header">
          <div className="sheet-header-title">
            <BookOpen size={20} className="sheet-header-icon" />
            <h3>Dặn dò từ bác sĩ</h3>
          </div>
          <button className="sheet-close-btn" onClick={onClose} aria-label="Đóng">
            <X size={20} />
          </button>
        </header>

        <div className="bottom-sheet-body">
          {/* Quick Category filter tabs */}
          <div className="sheet-tabs">
            <button className={`sheet-tab ${activeCategory === 'all' ? 'active' : ''}`} onClick={() => setActiveCategory('all')}>
              <span>Tất cả ({notes.length})</span>
            </button>
            {warnings.length > 0 && (
              <button className={`sheet-tab tab--warning ${activeCategory === 'warning' ? 'active' : ''}`} onClick={() => setActiveCategory('warning')}>
                <AlertTriangle size={13} />
                <span>Tránh ({warnings.length})</span>
              </button>
            )}
            {cares.length > 0 && (
              <button className={`sheet-tab tab--care ${activeCategory === 'care' ? 'active' : ''}`} onClick={() => setActiveCategory('care')}>
                <Heart size={13} />
                <span>Chăm sóc ({cares.length})</span>
              </button>
            )}
            {rechecks.length > 0 && (
              <button className={`sheet-tab tab--recheck ${activeCategory === 'recheck' ? 'active' : ''}`} onClick={() => setActiveCategory('recheck')}>
                <CalendarDays size={13} />
                <span>Tái khám ({rechecks.length})</span>
              </button>
            )}
            {others.length > 0 && (
              <button className={`sheet-tab tab--other ${activeCategory === 'other' ? 'active' : ''}`} onClick={() => setActiveCategory('other')}>
                <Info size={13} />
                <span>Khác ({others.length})</span>
              </button>
            )}
          </div>

          <div className="sheet-notes-list">
            {activeCategory === 'all' ? (
              <>
                {warnings.length > 0 && (
                  <div className="note-group-section group--warning">
                    <h4>
                      <AlertTriangle size={13} />
                      <span>KHÔNG NÊN / TRÁNH</span>
                    </h4>
                    <ul>
                      {warnings.map(n => <li key={n.id}>{n.note}</li>)}
                    </ul>
                  </div>
                )}
                {cares.length > 0 && (
                  <div className="note-group-section group--care">
                    <h4>
                      <Heart size={13} />
                      <span>CHĂM SÓC</span>
                    </h4>
                    <ul>
                      {cares.map(n => <li key={n.id}>{n.note}</li>)}
                    </ul>
                  </div>
                )}
                {rechecks.length > 0 && (
                  <div className="note-group-section group--recheck">
                    <h4>
                      <CalendarDays size={13} />
                      <span>TÁI KHÁM</span>
                    </h4>
                    <ul>
                      {rechecks.map(n => <li key={n.id}>{n.note}</li>)}
                    </ul>
                  </div>
                )}
                {others.length > 0 && (
                  <div className="note-group-section group--other">
                    <h4>
                      <Info size={13} />
                      <span>LƯU Ý KHÁC</span>
                    </h4>
                    <ul>
                      {others.map(n => <li key={n.id}>{n.note}</li>)}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className={`note-group-section group--${activeCategory}`}>
                <ul>
                  {filteredNotes.map(n => <li key={n.id}>{n.note}</li>)}
                </ul>
              </div>
            )}

            {filteredNotes.length === 0 && (
              <p className="sheet-empty-text">Không có dặn dò nào trong mục này.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
