import React, { useEffect, useRef, useState } from 'react';
import { animate } from 'motion/react';

/**
 * Tweened count-up/count-down for any numeric readout (hero metrics, gauge centers, badge
 * values). Replaces the "snap straight to the new text" pattern - a value in a premium terminal
 * should visibly travel to where it's going, the way it does on Bloomberg/TradingView, not jump.
 *
 * First mount renders the value immediately (no count-up from zero on initial paint - that would
 * read as a loading animation, not a data change). Every value AFTER that tweens from the
 * previous number over `durationMs`, respecting prefers-reduced-motion via motion's own handling
 * when wrapped in <MotionConfig reducedMotion="user">.
 */
export const AnimatedNumber: React.FC<{
  value: number | null;
  digits?: number;
  /** Overrides plain toFixed(digits) - e.g. thousands separators, a unit suffix. */
  format?: (rounded: number) => string;
  durationMs?: number;
  className?: string;
  style?: React.CSSProperties;
}> = ({ value, digits = 0, format, durationMs = 700, className = '', style }) => {
  const [display, setDisplay] = useState<number | null>(value);
  const prevRef = useRef<number | null>(value);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevRef.current = value;
      setDisplay(value);
      return;
    }

    const from = prevRef.current;
    prevRef.current = value;

    if (value === null || from === null || from === value) {
      setDisplay(value);
      return;
    }

    const controls = animate(from, value, {
      duration: durationMs / 1000,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [value, durationMs]);

  const shown = display === null ? null : format ? format(display) : display.toFixed(digits);

  return (
    <span className={`tabular-nums ${className}`} style={style}>
      {shown ?? '—'}
    </span>
  );
};
