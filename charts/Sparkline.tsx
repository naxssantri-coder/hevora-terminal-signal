import React, { useId } from 'react';

/**
 * Mini series for inside a card (§4) - never a full chart. Draws nothing when there are too few
 * points to form a line, rather than a flat placeholder that would read as "no movement".
 *
 * The line is a Catmull-Rom spline converted to cubic beziers, not a raw polyline (Bagian D
 * self-audit: at this size - a handful of points across ~64px - straight polyline segments read
 * as a visibly jagged zig-zag rather than a trend line). Area fill fades to transparent under a
 * clipped gradient and the stroke draws in once on mount via the shared .hev-draw-in class, same
 * language as the full LineChart.
 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export const Sparkline: React.FC<{
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}> = ({ values, width = 96, height = 24, color }) => {
  const gradientId = useId();

  if (values.length < 2) {
    return <span className="text-[9px] text-[var(--text-muted)] font-mono">—</span>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  // A little vertical inset keeps a curve's control points from clipping the viewBox edge on a
  // strictly monotonic series, where the raw min/max points sit exactly on top and bottom.
  const inset = height * 0.12;
  const plotH = height - inset * 2;

  const points = values.map((value, i) => ({
    x: i * step,
    y: inset + plotH - ((value - min) / span) * plotH,
  }));

  const stroke = color ?? (values[values.length - 1] >= values[0] ? 'var(--color-up)' : 'var(--color-down)');
  const line = smoothPath(points);
  const area = `${line} L ${points[points.length - 1].x.toFixed(2)} ${height} L ${points[0].x.toFixed(2)} ${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="overflow-visible">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.32} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} stroke="none" />
      <path
        className="hev-draw-in"
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ ['--hev-draw-length' as string]: '400' }}
      />
    </svg>
  );
};
