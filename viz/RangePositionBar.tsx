import React, { useId } from 'react';

/**
 * Compact "where does today's price sit in its own real range" bar - the Bloomberg-style
 * per-instrument range indicator, built entirely from real fields already on MarketPrice
 * (high24h/low24h/price), never a fabricated range. A flat grey line said nothing about where in
 * the day's range the current print actually sits; this shows it as a position, not just a number.
 *
 * Multi-layer like this app's other core viz primitives (GaugeRadial, FlowParticles): a gradient
 * track, a glow filter on the marker only, and a marker whose horizontal position tweens smoothly
 * (CSS transition on `left`) rather than snapping when price ticks.
 */
export const RangePositionBar: React.FC<{
  low: number;
  high: number;
  value: number;
  width?: number;
  height?: number;
}> = ({ low, high, value, width = 84, height = 14 }) => {
  const glowId = useId();
  const span = high - low;
  const pct = span > 0 ? Math.max(0, Math.min(100, ((value - low) / span) * 100)) : 50;

  return (
    <span className="inline-flex flex-col items-stretch" style={{ width }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="24h range position">
        <defs>
          <linearGradient id={glowId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--color-down)" />
            <stop offset="50%" stopColor="var(--color-warn)" />
            <stop offset="100%" stopColor="var(--color-up)" />
          </linearGradient>
          <filter x="-200%" y="-200%" width="500%" height="500%" id={`${glowId}-blur`}>
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <line
          x1={2}
          y1={height / 2}
          x2={width - 2}
          y2={height / 2}
          stroke={`url(#${glowId})`}
          strokeWidth={2.5}
          strokeLinecap="round"
          opacity={0.55}
        />

        <circle
          cx={2 + (pct / 100) * (width - 4)}
          cy={height / 2}
          r={3}
          fill="var(--text-primary)"
          filter={`url(#${glowId}-blur)`}
          style={{ transition: 'cx 500ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>
    </span>
  );
};
