import React, { useEffect, useRef, useState } from 'react';

/**
 * Wraps a rendered value (number, formatted string, whatever the caller already computed) and
 * flashes the shared .hev-flash-up/.hev-flash-down wash for one tick whenever `value` changes -
 * the same 300ms green/red pull-the-eye pattern the terminal's CSS already defines for price
 * ticks, just applied consistently across every live figure instead of ad hoc per module.
 *
 * Direction is inferred from a numeric comparison when `value` is a number; callers with a
 * pre-formatted string (e.g. "62%") can pass `direction` explicitly instead. No flash fires on
 * the first render - only on an actual change once a previous value exists, so a module's initial
 * paint never looks like data already moved.
 */
export const LiveValue: React.FC<{
  value: number | string | null;
  render: (value: number | string | null) => React.ReactNode;
  /** Overrides the up/down inference - use when `value` is a formatted string, not a number. */
  direction?: 'up' | 'down' | null;
  className?: string;
  as?: 'span' | 'div';
}> = ({ value, render, direction, className = '', as = 'span' }) => {
  const prevRef = useRef<number | string | null>(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (prev === value || prev === null || value === null) return;

    const inferred =
      direction ?? (typeof value === 'number' && typeof prev === 'number' ? (value > prev ? 'up' : value < prev ? 'down' : null) : null);
    if (!inferred) return;

    setFlash(inferred);
    const timer = setTimeout(() => setFlash(null), 320);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const Tag = as;
  return (
    <Tag
      className={`rounded-sm ${flash === 'up' ? 'hev-flash-up' : flash === 'down' ? 'hev-flash-down' : ''} ${className}`}
    >
      {render(value)}
    </Tag>
  );
};
