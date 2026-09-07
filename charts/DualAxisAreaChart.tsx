import React, { useCallback, useId, useRef, useState } from 'react';
import { formatNumber } from '../../lib/format';
import { useHorizontalChartScroll } from './useHorizontalChartScroll';
import { segmentAreaPath, segmentLinePath, splitByBaseline } from './baselineSegments';

export interface DualAxisPoint {
  label: string;
  value: number;
}

export interface DualAxisSeries {
  points: DualAxisPoint[];
  color: string;
  label: string;
  valueDigits?: number;
  valuePrefix?: string;
  valueSuffix?: string;
}

/**
 * Dual-axis line combo (chart-style upgrade, Masalah 3 - first checkpoint): a primary series on
 * one scale, a second line on its own independent right-axis scale, a fine dark-theme grid - none
 * of which the shared LineChart does (its optional `secondary` line shares the PRIMARY series' own
 * scale, which is wrong once the two series are different units entirely, e.g. a $ balance sheet
 * next to a % growth rate).
 *
 * Editorial-financial redesign (Bloomberg Terminal reference): despite the name, this no longer
 * fills an area under the primary series - both lines render as flat, solid strokes over an empty
 * dark background, same treatment LineChart got, so a Treasury/M2 combo chart reads the same
 * "serious financial terminal" way as every single-scale chart next to it. The name stays (every
 * caller already imports it as DualAxisAreaChart) since its defining feature is still the
 * independent dual Y-axis scaling, not the area fill it used to draw.
 *
 * Deliberately a new, separate component rather than an extra mode bolted onto LineChart: this is
 * the first of several charts the redesign will move to this treatment one at a time, and
 * LineChart still has 9+ other callers that were not part of this checkpoint - changing its
 * shared behaviour would have moved all of them at once.
 *
 * `secondary` is plotted against its OWN min/max, independent of `primary` - the two series are
 * not resampled onto a shared date grid inside this component; callers with mismatched cadences
 * (e.g. a weekly series next to a monthly one) should align them (forward-fill is usually right)
 * before passing `points`/`secondary.points` in here, same index-for-index contract LineChart's
 * own `secondary` prop already uses.
 *
 * Long series pan/scroll the same way LineChart's do (Poin 1) once they'd render tighter than
 * MIN_POINT_GAP px/point - see useHorizontalChartScroll.
 */
const MIN_POINT_GAP = 18;

export const DualAxisAreaChart: React.FC<{
  primary: DualAxisSeries;
  secondary?: DualAxisSeries;
  height?: number;
  /** Opt-in (default off, so the flat-stroke editorial look every existing caller - PolicyRatesHub,
   *  GoldIntelligenceHub, MarketCapChart - keeps is untouched): fills the area under the PRIMARY
   *  series with a thin gradient of its own colour, same technique LineChart's own `areaFill`
   *  already uses. Institutional Detail Page's Futures Data Analysis charts (funding/OI/volume,
   *  CoinGlass reference) are the first caller that wants this alongside an independent-axis price
   *  overlay, which is exactly what this component (and not LineChart) is built for. */
  areaFill?: boolean;
  /** Fix Warna Dua-Nada (opt-in, default off): a reference VALUE in `primary`'s own units (0 for a
   *  funding rate) - once set, `primary`'s line/area becomes a two-tone baseline chart (green at/
   *  above this value, red below, flipping at every real crossing - see LineChart's own `baseline`
   *  prop, same technique, same shared helper). `primary.color` is then unused for the line/area
   *  (kept only as the grid's left-axis tick-label color). `secondary` (the price overlay) is
   *  never affected - it always stays its own single `secondary.color`. */
  baseline?: number;
  /** Opt-in (default off, every existing caller keeps its line/area): renders the PRIMARY series
   *  as vertical bars/histogram instead of a line - CoinGlass's own "Volume" tab reference is bars
   *  while Funding Rate/Open Interest stay a smooth line, so FuturesDataAnalysis's volume tab is
   *  the only caller that sets this. Crosshair, tooltip and the `secondary` price overlay line are
   *  unaffected - only the primary series' own shape changes. Not combined with `baseline`
   *  (volume-shaped data - the caller's own metric - never goes negative, so there's no crossing to
   *  two-tone). */
  barMode?: boolean;
}> = ({ primary, secondary, height = 220, areaFill = false, baseline, barMode = false }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // Whether the tooltip should sit to the right of the crosshair - tracked against the container's
  // currently VISIBLE viewport (not the full, possibly-scrolled-off content width) so it never
  // picks the side that runs the tooltip off the edge of what's actually on screen (Bug 2: it used
  // to be derived from the point's position in the full content width, so deep into a scrolled
  // chart it could still say "plenty of room to the right" when the visible edge was right there).
  const [hoverOnRight, setHoverOnRight] = useState(true);
  const { containerRef, containerHandlers } = useHorizontalChartScroll<HTMLDivElement>();
  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      outerRef.current = node;
      containerRef(node);
    },
    [containerRef]
  );
  const gradientId = useId();

  const points = primary.points;
  const baseWidth = 600;
  const padding = { top: 12, right: 44, bottom: 22, left: 52 };
  const naturalWidth = padding.left + padding.right + (points.length - 1) * MIN_POINT_GAP;
  const scrollable = naturalWidth > baseWidth;
  const width = scrollable ? naturalWidth : baseWidth;
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const hasSecondary = Boolean(secondary && secondary.points.length === points.length);

  const setIndexFromClientX = useCallback(
    (clientX: number) => {
      const svg = svgRef.current;
      if (!svg || points.length < 2) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return;
      const xInViewBox = ((clientX - rect.left) / rect.width) * width;
      const step = plotW / (points.length - 1);
      const raw = (xInViewBox - padding.left) / step;
      setHoverIndex(Math.min(points.length - 1, Math.max(0, Math.round(raw))));
    },
    [points.length, plotW, width]
  );

  if (points.length < 2) {
    return (
      <div className="h-24 flex items-center justify-center text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
        —
      </div>
    );
  }

  // A genuinely flat series (every value identical - e.g. a monthly reading forward-filled across
  // a stretch of a weekly series with no newer reading yet) used to fall back to an arbitrary
  // span of 1: the line pinned to the bottom edge of the plot while the grid/tick labels still
  // showed a fake value-to-value-minus-1 range that didn't correspond to the real, constant value
  // anywhere on the chart - a real bug found via a mocked forward-fill test, not a hypothetical.
  // Centring flat data with a small symmetric pad keeps both the line and its labels honest: the
  // line sits in the middle of the plot and every label clusters near the true value instead of
  // one of them coincidentally matching it.
  const hasBaseline = typeof baseline === 'number' && Number.isFinite(baseline);
  // Fold the baseline (0 for a funding rate) into the range so its reference line stays visible
  // even when this window's samples happen to sit all on one side of it - same reasoning as
  // LineChart's own `baseline` handling.
  const rawPrimaryMin = Math.min(...points.map((p) => p.value), ...(hasBaseline ? [baseline as number] : []));
  const rawPrimaryMax = Math.max(...points.map((p) => p.value), ...(hasBaseline ? [baseline as number] : []));
  const primaryPad = rawPrimaryMax === rawPrimaryMin ? (Math.abs(rawPrimaryMax) || 1) * 0.1 : 0;
  const primaryMin = rawPrimaryMin - primaryPad;
  const primaryMax = rawPrimaryMax + primaryPad;
  const primarySpan = primaryMax - primaryMin || 1;
  const step = plotW / (points.length - 1);

  const secondaryPoints = hasSecondary ? (secondary as DualAxisSeries).points : null;
  const rawSecondaryMin = secondaryPoints ? Math.min(...secondaryPoints.map((p) => p.value)) : 0;
  const rawSecondaryMax = secondaryPoints ? Math.max(...secondaryPoints.map((p) => p.value)) : 1;
  const secondaryPad = rawSecondaryMax === rawSecondaryMin ? (Math.abs(rawSecondaryMax) || 1) * 0.1 : 0;
  const secondaryMin = rawSecondaryMin - secondaryPad;
  const secondaryMax = rawSecondaryMax + secondaryPad;
  const secondarySpan = secondaryMax - secondaryMin || 1;

  const yFor = (value: number, min: number, span: number) => padding.top + plotH - ((value - min) / span) * plotH;

  const primaryCoords = points.map((p, i) => ({ x: padding.left + i * step, y: yFor(p.value, primaryMin, primarySpan) }));
  const secondaryCoords = secondaryPoints
    ? secondaryPoints.map((p, i) => ({ x: padding.left + i * step, y: yFor(p.value, secondaryMin, secondarySpan) }))
    : null;

  const toPath = (c: { x: number; y: number }[]) =>
    c.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

  const primaryLine = toPath(primaryCoords);
  const secondaryLine = secondaryCoords ? toPath(secondaryCoords) : null;
  const baselineY = hasBaseline ? yFor(baseline as number, primaryMin, primarySpan) : null;
  const baselineSegments =
    hasBaseline && baselineY !== null ? splitByBaseline(primaryCoords, points.map((p) => p.value), baseline as number, baselineY) : null;
  const baselineToneColor = (side: 'up' | 'down') => (side === 'up' ? 'var(--color-up)' : 'var(--color-down)');
  // Same "close down to the plot floor, back to the first point's x" technique LineChart's own
  // areaFill uses - independent of interpolation/scale, just closes the primary stroke into a
  // fillable shape. Skipped when baseline mode (below) fills each segment to the BASELINE instead.
  const primaryAreaPath = areaFill && !baselineSegments
    ? `${primaryLine} L ${primaryCoords[primaryCoords.length - 1].x.toFixed(2)} ${(padding.top + plotH).toFixed(2)} L ${primaryCoords[0].x.toFixed(2)} ${(padding.top + plotH).toFixed(2)} Z`
    : null;

  // CoinGlass parity (Bagian B upgrade, Volume tab): bar width capped at 70% of the point spacing
  // so bars never touch/overlap even at the tightest MIN_POINT_GAP; floor is the plot's bottom
  // edge since this mode is only ever used for volume-shaped data (never negative).
  const barWidth = barMode ? Math.max(1, Math.min(step * 0.7, 18)) : 0;
  const barFloorY = padding.top + plotH;

  // Fine grid (§ reference: "grid halus, dark professional styling") - 4 evenly-spaced horizontal
  // reference lines with the primary axis's own value at each, not a decorative fixed count
  // unrelated to the data.
  const gridLines = 4;
  const gridRows = Array.from({ length: gridLines + 1 }, (_, i) => {
    const t = i / gridLines;
    return { y: padding.top + t * plotH, value: primaryMax - t * primarySpan };
  });
  const secondaryTickValues = hasSecondary
    ? Array.from({ length: gridLines + 1 }, (_, i) => secondaryMax - (i / gridLines) * secondarySpan)
    : [];
  // Full grid (editorial-financial redesign round 2), same reasoning as LineChart's own
  // gridColXs: vertical reference lines spanning the whole plot height, evenly spaced since this
  // component has no interior x-axis tick concept to align to.
  const gridColXs = Array.from({ length: gridLines + 1 }, (_, i) => padding.left + (i / gridLines) * plotW);

  const hoverPrimary = hoverIndex !== null ? primaryCoords[hoverIndex] : null;
  const hoverSecondary = hoverIndex !== null && secondaryCoords ? secondaryCoords[hoverIndex] : null;
  const tooltipOnRight = hoverOnRight;
  const hoverPrimaryColor =
    hoverIndex !== null && hasBaseline
      ? baselineToneColor(points[hoverIndex].value >= (baseline as number) ? 'up' : 'down')
      : primary.color;

  const fmt = (series: DualAxisSeries, value: number) =>
    `${series.valuePrefix ?? ''}${formatNumber(value, series.valueDigits ?? 2)}${series.valueSuffix ?? ''}`;

  return (
    <div
      ref={setContainerRef}
      className={scrollable ? 'w-full overflow-x-auto no-scrollbar relative' : 'w-full overflow-hidden relative'}
      {...(scrollable ? containerHandlers : {})}
    >
      <div style={{ width: scrollable ? width : '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width={scrollable ? width : '100%'}
        height={height}
        preserveAspectRatio="none"
        role="img"
        tabIndex={0}
        onPointerMove={(e) => {
          // Bug 1 fix: the crosshair/tooltip must keep following the pointer while dragging/panning
          // a scrollable chart - that's the only way to read history on a long series. It used to
          // null the hover out here, which stranded a stale tooltip mid-drag until the next
          // pointermove after the drag stopped.
          setIndexFromClientX(e.clientX);
          const el = outerRef.current;
          if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0) setHoverOnRight((e.clientX - rect.left) / rect.width < 0.7);
          }
        }}
        onPointerLeave={() => setHoverIndex(null)}
        onBlur={() => setHoverIndex(null)}
        className={scrollable ? 'outline-none cursor-grab active:cursor-grabbing' : 'cursor-crosshair outline-none'}
      >
        {areaFill && !baselineSegments && (
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primary.color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={primary.color} stopOpacity={0} />
            </linearGradient>
          </defs>
        )}
        {/* Editorial-financial redesign: thin dashed reference lines - see LineChart's own grid
            comment for the measured-contrast reasoning behind --border-strong at full opacity
            (--border-subtle was empirically near-invisible against this panel's background),
            shared verbatim here. */}
        {gridRows.map((row, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              y1={row.y}
              x2={width - padding.right}
              y2={row.y}
              stroke="var(--border-strong)"
              strokeWidth={1}
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
            <text x={padding.left - 6} y={row.y + 3} textAnchor="end" fontSize={8.5} fill="var(--text-muted)" fontFamily="var(--font-mono, monospace)">
              {fmt(primary, row.value)}
            </text>
            {hasSecondary && (
              <text x={width - padding.right + 6} y={row.y + 3} textAnchor="start" fontSize={8.5} fill={(secondary as DualAxisSeries).color} fontFamily="var(--font-mono, monospace)">
                {fmt(secondary as DualAxisSeries, secondaryTickValues[i])}
              </text>
            )}
          </g>
        ))}
        {gridColXs.map((x, i) => (
          <line
            key={`col-${i}`}
            x1={x}
            y1={padding.top}
            x2={x}
            y2={padding.top + plotH}
            stroke="var(--border-strong)"
            strokeWidth={1}
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Fix Warna Dua-Nada: dashed reference line at the baseline (0% for funding rate), same
            "garis acuan" the CoinGlass reference draws the two-tone crossings against. */}
        {baselineSegments && baselineY !== null && (
          <line
            x1={padding.left}
            y1={baselineY}
            x2={width - padding.right}
            y2={baselineY}
            stroke="var(--text-muted)"
            strokeWidth={1}
            strokeDasharray="3 3"
            strokeOpacity={0.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {barMode ? (
          <>
            {primaryCoords.map((c, i) => (
              <rect
                key={`bar-${i}`}
                x={c.x - barWidth / 2}
                y={Math.min(c.y, barFloorY)}
                width={barWidth}
                height={Math.max(1, Math.abs(barFloorY - c.y))}
                fill={primary.color}
                fillOpacity={hoverIndex === null || hoverIndex === i ? 0.85 : 0.45}
              />
            ))}
          </>
        ) : baselineSegments ? (
          <>
            {areaFill &&
              baselineSegments.map((seg, i) => (
                <path
                  key={`area-${i}`}
                  d={segmentAreaPath(seg.points, baselineY as number)}
                  fill={baselineToneColor(seg.side)}
                  fillOpacity={0.16}
                  stroke="none"
                />
              ))}
            {baselineSegments.map((seg, i) => (
              <path
                key={`line-${i}`}
                className={i === 0 ? 'hev-draw-in' : undefined}
                d={segmentLinePath(seg.points)}
                fill="none"
                stroke={baselineToneColor(seg.side)}
                strokeWidth={1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
                style={i === 0 ? { ['--hev-draw-length' as string]: '2000' } : undefined}
              />
            ))}
          </>
        ) : (
          <>
            {primaryAreaPath && <path d={primaryAreaPath} fill={`url(#${gradientId})`} stroke="none" />}
            <path
              className="hev-draw-in"
              d={primaryLine}
              fill="none"
              stroke={primary.color}
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ ['--hev-draw-length' as string]: '2000' }}
            />
          </>
        )}
        {secondaryLine && (
          <path
            d={secondaryLine}
            fill="none"
            stroke={(secondary as DualAxisSeries).color}
            strokeWidth={1.4}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {hoverPrimary && (
          <>
            <line
              x1={hoverPrimary.x}
              y1={padding.top}
              x2={hoverPrimary.x}
              y2={padding.top + plotH}
              stroke="var(--border-strong)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {/* CoinGlass parity (Bagian B upgrade): horizontal crosshair - dashed, at the hovered
                sample's own y for each series (own left/right axis), with a value label pinned to
                that series' axis at that height. Two separate lines (not one shared cursor-y line)
                since primary/secondary each have their own independent scale - a single shared
                height would put the wrong value label on whichever axis doesn't match the cursor's
                nearest series. */}
            <line
              x1={padding.left}
              y1={hoverPrimary.y}
              x2={width - padding.right}
              y2={hoverPrimary.y}
              stroke="var(--border-strong)"
              strokeWidth={1}
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
            {/* Solid backing chip behind the dynamic label - without it, whenever the hovered value
               sits close to one of the 4 fixed gridRows, this label and that row's own static tick
               label land almost exactly on top of each other and both become illegible. */}
            {(() => {
              const label = fmt(primary, points[hoverIndex as number].value);
              const w = label.length * 5.3 + 4;
              return (
                <rect x={padding.left - 6 - w} y={hoverPrimary.y - 6.5} width={w} height={11} fill="var(--bg-panel)" />
              );
            })()}
            <text x={padding.left - 6} y={hoverPrimary.y + 3} textAnchor="end" fontSize={8.5} fontWeight="bold" fill={hoverPrimaryColor} fontFamily="var(--font-mono, monospace)">
              {fmt(primary, points[hoverIndex as number].value)}
            </text>
            <circle cx={hoverPrimary.x} cy={hoverPrimary.y} r={3} fill={hoverPrimaryColor} />
            {hoverSecondary && (
              <>
                <line
                  x1={padding.left}
                  y1={hoverSecondary.y}
                  x2={width - padding.right}
                  y2={hoverSecondary.y}
                  stroke="var(--border-strong)"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                  vectorEffect="non-scaling-stroke"
                />
                {(() => {
                  const label = fmt(secondary as DualAxisSeries, (secondaryPoints as DualAxisPoint[])[hoverIndex as number].value);
                  const w = label.length * 5.3 + 4;
                  return (
                    <rect x={width - padding.right + 6} y={hoverSecondary.y - 6.5} width={w} height={11} fill="var(--bg-panel)" />
                  );
                })()}
                <text
                  x={width - padding.right + 6}
                  y={hoverSecondary.y + 3}
                  textAnchor="start"
                  fontSize={8.5}
                  fontWeight="bold"
                  fill={(secondary as DualAxisSeries).color}
                  fontFamily="var(--font-mono, monospace)"
                >
                  {fmt(secondary as DualAxisSeries, (secondaryPoints as DualAxisPoint[])[hoverIndex as number].value)}
                </text>
                <circle cx={hoverSecondary.x} cy={hoverSecondary.y} r={3} fill={(secondary as DualAxisSeries).color} />
              </>
            )}
          </>
        )}
      </svg>

      {hoverIndex !== null && hoverPrimary && (
        <div
          className="absolute top-1 pointer-events-none rounded border border-[var(--border-strong)] bg-[var(--bg-panel)] px-2 py-1 font-mono text-[9px] shadow-sm whitespace-nowrap z-10"
          style={
            scrollable
              ? tooltipOnRight
                ? { left: hoverPrimary.x + 6 }
                : { left: hoverPrimary.x, transform: 'translateX(calc(-100% - 6px))' }
              : tooltipOnRight
                ? { left: `${(hoverPrimary.x / width) * 100}%`, transform: 'translateX(6px)' }
                : { right: `${100 - (hoverPrimary.x / width) * 100}%`, transform: 'translateX(-6px)' }
          }
        >
          <div className="text-[var(--text-muted)] uppercase tracking-wider">{points[hoverIndex].label}</div>
          <div className="flex items-center gap-1 font-bold tabular-nums" style={{ color: hoverPrimaryColor }}>
            <span className="inline-block rounded-full shrink-0" style={{ width: 6, height: 6, background: hoverPrimaryColor }} />
            {primary.label}: {fmt(primary, points[hoverIndex].value)}
          </div>
          {hasSecondary && secondaryPoints && (
            <div className="flex items-center gap-1 tabular-nums" style={{ color: (secondary as DualAxisSeries).color }}>
              <span
                className="inline-block rounded-full shrink-0"
                style={{ width: 6, height: 6, background: (secondary as DualAxisSeries).color }}
              />
              {(secondary as DualAxisSeries).label}: {fmt(secondary as DualAxisSeries, secondaryPoints[hoverIndex].value)}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between font-mono text-[9px] text-[var(--text-muted)] tabular-nums px-1 mt-0.5">
        <span>{points[0].label}</span>
        <span>{points[points.length - 1].label}</span>
      </div>
      </div>
    </div>
  );
};
