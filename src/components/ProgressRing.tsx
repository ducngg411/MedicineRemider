import { Check } from 'lucide-react';

export function ProgressRing({ done, total, size = 80 }: { done: number; total: number; size?: number }) {
  const stroke = 6;
  const radius = (size - stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? done / total : 0;
  const dashoffset = circumference * (1 - progress);
  const allDone = total > 0 && done >= total;

  return (
    <div className={`progress-ring ${allDone ? 'all-done' : ''}`} style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
        <circle
          className="ring-bg"
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={stroke}
        />
        <circle
          className="ring-fill"
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {/* Label inside ring */}
      <div className="ring-label">
        {allDone ? (
          <Check size={size * 0.38} strokeWidth={3.5} style={{ color: 'var(--color-forest-ink)', display: 'block' }} />
        ) : (
          <>
            <span className="ring-label-count">{done}/{total}</span>
            {size >= 70 && <span className="ring-label-text">hôm nay</span>}
          </>
        )}
      </div>
    </div>
  );
}


