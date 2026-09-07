import React, { useEffect, useRef, useState } from 'react';
import { animate } from 'motion/react';

/**
 * Small circular progress ring for a single 0-100 score shown inline in a card (e.g. a signal's
 * AI confidence score) - the full-circle counterpart to GaugeRadial's semicircle, sized to sit
 * next to a label rather than anchor a whole panel.
 *
 * The ring sweeps in from empty the first time a real value arrives (a card that renders before
 * its data has loaded, then gets a score, should visibly fill rather than snap to its final
 * state) and tweens smoothly between values after that - it never resets and re-sweeps on a poll
 * that returns the same number, only on an actual change.
 */
export const ProgressRing: React.FC<{
  value: number | null;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
}> = ({ value, size = 44, strokeWidth = 4, color = 'var(--color-up)', trackColor = 'var(--border-subtle)' }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const [display, setDisplay] = useState<number | null>(null);
  const prevRef = useRef<number | null>(null);

  useEffect(() => {
    const from = prevRef.current ?? 0;
    const to = value === null ? 0 : Math.max(0, Math.min(100, value));
    prevRef.current = to;

    if (value === null) {
      setDisplay(null);
      return;
    }

    const controls = animate(from, to, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const dash = display === null ? 0 : (display / 100) * circumference;

  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="score">
        <circle cx={center} cy={center} r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        {display !== null && (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform={`rotate(-90 ${center} ${center})`}
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-black tabular-nums" style={{ color }}>
        {value === null ? '—' : Math.round(value)}
      </span>
    </span>
  );
};
