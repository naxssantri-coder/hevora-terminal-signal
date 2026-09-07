import React, { useCallback, useId, useRef, useState } from 'react';
import { formatNumber } from '../../lib/format';
import { useHorizontalChartScroll } from './useHorizontalChartScroll';
import { segmentAreaPath, segmentLinePath, splitByBaseline } from './baselineSegments';

export interface LinePoint {
  label: string;
  value: number;
}

/**
 * Time-series line (§4, expanded §9) for macro and flow series - the shared chart used everywhere
 * a single-scale series needs to be drawn (root-cause fix, "Sistem chart tidak konsisten": this
 * used to fill at a flat constant opacity with no grid, which is the reason half the app's charts
 * read as a generic template while the newer DualAxisAreaChart looked modern. Fine dark-theme grid
 * with axis labels and typography now, one visual system instead of two).
 *
 * Editorial-financial redesign (Bloomberg Terminal reference, replacing the earlier "AI dashboard"
 * gradient-fill look): the area fill under the line is gone entirely - a flat, solid stroke over an
 * empty dark background, exactly like the reference. Grid lines are thin and dashed at low opacity
 * rather than solid, so the handful of Y-axis reference levels read without competing with the
 * line itself. Draws in once on first render via the shared .hev-draw-in class; subsequent data
 * refreshes update the path without re-animating.
 *
 * §9 interactivity: a crosshair follows the pointer (mouse, touch or arrow keys once the chart is
 * focused) and a tooltip prints the exact value at that point - reading the underlying number
 * used to require eyeballing a position against the min/max line, which is not "the number", only
 * a guess at it. The tooltip appears and disappears instantly, no easing curve: this is a value
 * read, not a decorative flourish, so it sits outside the animation rules that ban hover-bounce.
 *
 * `secondary` overlays a second series on the SAME price scale as `points` - built for a moving
 * average or comparable line, not an independent-axis series (which needs its own scale - see
 * DualAxisAreaChart). Both existing and new callers stay compatible: every prop below is
 * optional.
 *
 * Long series (Poin 1 - "chart yang datanya panjang harus bisa digeser/scroll horizontal") stop
 * being squeezed into a fixed viewBox once they'd render tighter than MIN_POINT_GAP px/point:
 * past that point the chart renders at its natural pixel width inside a horizontally-scrollable
 * wrapper instead, pannable by drag or mouse wheel (useHorizontalChartScroll). Short series are
 * unaffected - they still scale to 100% of the container exactly as before.
 *
 * `areaFill`/`highlightLast` (round 3, "chart Riwayat Positioning kelihatan terlalu polos"): both
 * opt-in, default off - the flat-stroke Bloomberg look above stays the default for every existing
 * caller. A caller can turn on a thin gradient fill under the line and/or a persistent marker on
 * the most recent sample without affecting any other chart built on this component.
 *
 * `interpolation` (round 2, Poin 3 - "chart Riwayat Effective Rate masih terlihat kotak-kotak"):
 * default `'linear'` draws a straight segment between consecutive points, correct for series that
 * genuinely move every sample (yields, spreads). A policy rate like EFFR instead holds a constant
 * value for long stretches then jumps once - connecting those sparse points with a diagonal line
 * reads as a jagged, broken staircase, when a real step chart (flat, then a vertical jump exactly
 * at the change) is the standard, deliberate-looking way institutional terminals render this kind
 * of data. `'step'` draws that: horizontal-then-vertical (SVG `H`/`V`) between points instead of a
 * diagonal `L`. Opt-in only - every other existing caller keeps its current diagonal line.
 */
const MIN_POINT_GAP = 18;

export const LineChart: React.FC<{
  points: LinePoint[];
  height?: number;
  valueDigits?: number;
  /** Prepended to every formatted value (grid labels, tooltip, `endLabel`) - e.g. '$'. Mirrors
   *  DualAxisSeries' own valuePrefix; LineChart never had one since no caller needed it until the
   *  Institutional Detail Page's own price/market-cap chart did. Default '' - every existing
   *  caller's output is byte-for-byte unchanged. */
  valuePrefix?: string;
  valueSuffix?: string;
  color?: string;
  /** Overlay series on the same scale as `points` - e.g. a moving average. Same length/order. */
  secondary?: LinePoint[];
  secondaryLabel?: string;
  secondaryColor?: string;
  /** 'linear' (default) connects points with a diagonal line; 'step' holds each value flat until
   *  the next sample, then jumps - for policy-rate-shaped data. Applies to the primary series
   *  only; `secondary` (typically a smooth moving average) always stays linear. */
  interpolation?: 'linear' | 'step';
  /** Opt-in: draws this many evenly-spaced tick labels along the x-axis, inside the plot itself,
   *  instead of only the first/last labels shown below every chart by default. Undefined (every
   *  existing caller) keeps that first/last-only footer exactly as it was - this only changes
   *  rendering for a caller that explicitly asks for more ticks (e.g. a multi-year daily series,
   *  where "first and last" alone reads as two dates with nothing to anchor the months between
   *  them). */
  xAxisTicks?: number;
  /** Opt-in (default off, so the Bloomberg-reference flat-stroke look every existing caller was
   *  deliberately moved to stays untouched): fills the area under the primary series with a thin
   *  vertical gradient of its own stroke color, fading to transparent at the plot floor. For a
   *  single-panel detail card (e.g. COT positioning history) sitting next to denser, more visual
   *  UI, a bare stroke on an empty background reads as an unfinished placeholder rather than a
   *  deliberately minimal terminal chart - the gradient gives it the same "real chart" weight
   *  without going back to the pre-redesign flat-opacity fill this component moved away from. */
  areaFill?: boolean;
  /** Opt-in (default off): marks the most recent sample with a persistent dot (outer static ring +
   *  inner pulsing core, same `animate-subtle-pulse` language as the LIVE badge elsewhere in the
   *  terminal) instead of only ever showing a point on hover. Anchors the eye on "where is 'now'
   *  on this line" at a glance, the way the main price chart's live-price dot does. */
  highlightLast?: boolean;
  /** Opt-in: always scales to 100% of the container instead of switching to the natural-width
   *  horizontal-scroll layout once points would render tighter than MIN_POINT_GAP. That threshold
   *  is right for a daily multi-year series (individual samples need to stay legibly spaced apart
   *  to scrub through), but wrong for a compact card showing a full year of WEEKLY data (e.g. a
   *  detail panel's 52-point history) - there the whole series should read at a glance as one
   *  shape, not need a scroll/drag gesture the caller has no other cue to invite. Default off so
   *  every existing long-series caller keeps its scrollable behaviour unchanged. */
  fitToContainer?: boolean;
  /** Opt-in (default off): a small persistent value badge pinned to the right edge of the plot at
   *  the last point's y-position - e.g. a live "79.59K" tag - instead of only ever showing the
   *  last value via hover. Institutional Detail Page's price/market-cap chart (CoinGlass
   *  reference always shows this) is the first caller; every other chart keeps its current
   *  hover-only reveal. */
  endLabel?: boolean;
  /** Fix Warna Dua-Nada (opt-in, default off - every existing caller's single-`color` stroke is
   *  untouched): a reference VALUE in the same units as `points` (a period's open price, 0 for a
   *  rate) - once set, the primary line/area switches to a two-tone baseline chart, green
   *  (`--color-up`) where the value is at/above this baseline and red (`--color-down`) where it's
   *  below, flipping color exactly at each real crossing point rather than once for the whole
   *  series (`color` above only ever picked ONE color for the entire line). A thin dashed
   *  reference line is drawn at the baseline itself, same "garis acuan putus-putus" the CoinGlass
   *  reference shows. `secondary` (a moving average, when used alongside this) is unaffected -
   *  only the primary series two-tones. */
  baseline?: number;
}> = ({
  points,
  height = 140,
  valueDigits = 2,
  valuePrefix = '',
  valueSuffix = '',
  color = 'var(--color-up)',
  secondary,
  secondaryLabel,
  secondaryColor = 'var(--text-muted)',
  interpolation = 'linear',
  xAxisTicks,
  areaFill = false,
  highlightLast = false,
  fitToContainer = false,
  endLabel = false,
  baseline,
}) => {
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

  const baseWidth = 600;
  // Extra left padding when a valuePrefix is set (e.g. '$79,952.23' vs '79,952.23') - the default
  // 44px budget was sized for every existing caller's shorter, unprefixed labels; only widened
  // for the new opt-in prefix case, so nothing already using this component shifts.
  const padding = { top: 12, right: 12, bottom: 22, left: valuePrefix ? 54 : 44 };
  const naturalWidth = padding.left + padding.right + (points.length - 1) * MIN_POINT_GAP;
  const scrollable = !fitToContainer && naturalWidth > baseWidth;
  const width = scrollable ? naturalWidth : baseWidth;
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const hasSecondary = Boolean(secondary && secondary.length === points.length);

  const setIndexFromClientX = useCallback(
    (clientX: number) => {
      const svg = svgRef.current;
      if (!svg || points.length < 2) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return;
      // Client pixels -> viewBox units (1:1 in scrollable mode, scaled in responsive mode), then
      // viewBox units -> nearest sample index.
      const xInViewBox = ((clientX - rect.left) / rect.width) * width;
      const step = plotW / (points.length - 1);
      const raw = (xInViewBox - padding.left) / step;
      const index = Math.min(points.length - 1, Math.max(0, Math.round(raw)));
      setHoverIndex(index);
    },
    [points.length, plotW, width]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<SVGSVGElement>) => {
      if (points.length < 2) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setHoverIndex((prev) => Math.min(points.length - 1, (prev ?? -1) + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setHoverIndex((prev) => Math.max(0, (prev ?? points.length) - 1));
      } else if (e.key === 'Escape') {
        setHoverIndex(null);
      }
    },
    [points.length]
  );

  if (points.length < 2) {
    return (
      <div className="h-24 flex items-center justify-center text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
        —
      </div>
    );
  }

  const values = points.map((p) => p.value).concat(hasSecondary ? (secondary as LinePoint[]).map((p) => p.value) : []);
  const hasBaseline = typeof baseline === 'number' && Number.isFinite(baseline);
  // The baseline itself (a period's open price, or 0 for a rate) is folded into the value range so
  // its reference line is always visible even when every sample happens to sit on one side of it -
  // e.g. a funding-rate series that stayed all-positive this window still shows the 0% line.
  const rawMin = Math.min(...values, ...(hasBaseline ? [baseline as number] : []));
  const rawMax = Math.max(...values, ...(hasBaseline ? [baseline as number] : []));
  // A flat/near-flat series used to pin the line to the bottom edge with a fake span of 1 - a
  // small symmetric pad keeps both the line and the grid's own value labels honest (same fix
  // DualAxisAreaChart carries for the same reason).
  const pad = rawMax === rawMin ? (Math.abs(rawMax) || 1) * 0.1 : 0;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const span = max - min || 1;
  const step = plotW / (points.length - 1);

  const toCoords = (series: LinePoint[]) =>
    series.map((point, i) => ({
      x: padding.left + i * step,
      y: padding.top + plotH - ((point.value - min) / span) * plotH,
    }));

  const coords = toCoords(points);
  const secondaryCoords = hasSecondary ? toCoords(secondary as LinePoint[]) : null;
  const baselineY = hasBaseline ? padding.top + plotH - (((baseline as number) - min) / span) * plotH : null;
  const baselineSegments = hasBaseline && baselineY !== null ? splitByBaseline(coords, points.map((p) => p.value), baseline as number, baselineY) : null;

  const toPath = (c: { x: number; y: number }[]) =>
    c.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

  // Step-after: hold the previous value flat (H, horizontal-only lineto) out to the next sample's
  // x, then jump (V, vertical-only lineto) to its actual value - never a diagonal between two
  // real readings.
  const toStepPath = (c: { x: number; y: number }[]) =>
    c
      .map((p, i) => (i === 0 ? `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}` : `H ${p.x.toFixed(2)} V ${p.y.toFixed(2)}`))
      .join(' ');

  const line = interpolation === 'step' ? toStepPath(coords) : toPath(coords);
  const secondaryLine = secondaryCoords ? toPath(secondaryCoords) : null;
  // Close the stroke path down to the plot floor and back to the first point's x - fills "under
  // the line" regardless of interpolation mode or whether the series crosses zero. Baseline mode
  // (below) fills each segment down/up to the BASELINE instead, so this single flat-color path is
  // skipped entirely when `baseline` is set.
  const areaPath = areaFill && !baselineSegments
    ? `${line} L ${coords[coords.length - 1].x.toFixed(2)} ${(padding.top + plotH).toFixed(2)} L ${coords[0].x.toFixed(2)} ${(padding.top + plotH).toFixed(2)} Z`
    : null;
  const baselineToneColor = (side: 'up' | 'down') => (side === 'up' ? 'var(--color-up)' : 'var(--color-down)');
  const hoverSide: 'up' | 'down' | null = hoverIndex !== null && hasBaseline ? (points[hoverIndex].value >= (baseline as number) ? 'up' : 'down') : null;

  // Fine grid, same treatment as DualAxisAreaChart: 4 evenly-spaced horizontal reference lines
  // with the series' own value at each, not a decorative fixed count unrelated to the data.
  const gridLines = 4;
  const gridRows = Array.from({ length: gridLines + 1 }, (_, i) => {
    const t = i / gridLines;
    return { y: padding.top + t * plotH, value: max - t * span };
  });

  // Evenly-spaced sample indices for the opt-in interior x-axis ticks (always includes the first
  // and last point, so the default footer row below is redundant and hidden once this is set).
  const tickIndices: number[] =
    xAxisTicks && xAxisTicks >= 2 && points.length >= 2
      ? Array.from(
          new Set(
            Array.from({ length: Math.min(xAxisTicks, points.length) }, (_, i) =>
              Math.round((i / (Math.min(xAxisTicks, points.length) - 1)) * (points.length - 1))
            )
          )
        )
      : [];

  // Full grid (editorial-financial redesign round 2 - "gridline harus grid penuh, bukan cuma
  // dekat label"): vertical reference lines spanning the whole plot height, not just the
  // horizontal rows. Aligned to the caller's own interior x-axis ticks when it opted into them
  // (xAxisTicks); otherwise falls back to the same evenly-spaced count the horizontal rows use, so
  // every chart gets a real crosshatch grid even when it only shows a first/last-label footer.
  const gridColXs: number[] =
    tickIndices.length >= 2
      ? tickIndices.map((idx) => coords[idx].x)
      : Array.from({ length: gridLines + 1 }, (_, i) => padding.left + (i / gridLines) * plotW);

  const hover = hoverIndex !== null ? coords[hoverIndex] : null;
  const hoverSecondary = hoverIndex !== null && secondaryCoords ? secondaryCoords[hoverIndex] : null;
  // Flip the tooltip to the left of the crosshair once the pointer is in the right third of the
  // currently visible viewport (hoverOnRight, tracked in onPointerMove), so it never runs off the
  // edge of a narrow card or off the edge of what's currently scrolled into view.
  const tooltipOnRight = hoverOnRight;

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
            // Bug 1 fix: keep the crosshair/tooltip following the pointer while dragging/panning a
            // scrollable chart - previously nulled the hover here, stranding a stale tooltip mid-drag.
            setIndexFromClientX(e.clientX);
            const el = outerRef.current;
            if (el) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0) setHoverOnRight((e.clientX - rect.left) / rect.width < 0.7);
            }
          }}
          onPointerLeave={() => setHoverIndex(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setHoverIndex(null)}
          className={scrollable ? 'outline-none cursor-grab active:cursor-grabbing' : 'cursor-crosshair outline-none'}
        >
          {areaFill && !baselineSegments && (
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
          )}
          {/* Editorial-financial redesign: thin dashed reference lines at the same handful of Y
              values the grid already used - a Bloomberg-style chart reads value levels off thin
              dashed rules, not a solid grid. --border-strong (not the fainter --border-subtle):
              measured empirically (screenshot pixel-sampling, not eyeballing) that
              --border-subtle at any reasonable opacity against this panel's near-black background
              produced only a ~5-8/255 difference - technically rendered but functionally invisible
              at normal viewing size. --border-strong at full opacity reads as a real but still
              thin/dashed, non-solid reference line instead of a bold grid. */}
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
                {valuePrefix}
                {formatNumber(row.value, valueDigits)}
                {valueSuffix}
              </text>
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

          {/* Fix Warna Dua-Nada: a thin dashed reference line at the baseline itself (period-open
              price, or 0% for a rate), same "garis acuan" the CoinGlass reference draws the
              two-tone crossings against. */}
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
          {baselineSegments ? (
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
              {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />}
              <path
                className="hev-draw-in"
                d={line}
                fill="none"
                stroke={color}
                strokeWidth={1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
                style={{ ['--hev-draw-length' as string]: '2000' }}
              />
            </>
          )}
          {highlightLast && (
            <g style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
              <circle
                cx={coords[coords.length - 1].x}
                cy={coords[coords.length - 1].y}
                r={5}
                fill="none"
                stroke={baselineSegments ? baselineToneColor(baselineSegments[baselineSegments.length - 1].side) : color}
                strokeWidth={1}
                strokeOpacity={0.4}
              />
              <circle
                cx={coords[coords.length - 1].x}
                cy={coords[coords.length - 1].y}
                r={2.75}
                fill={baselineSegments ? baselineToneColor(baselineSegments[baselineSegments.length - 1].side) : color}
                className="animate-subtle-pulse"
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              />
            </g>
          )}
          {secondaryLine && (
            <path
              d={secondaryLine}
              fill="none"
              stroke={secondaryColor}
              strokeWidth={1.25}
              strokeDasharray="4 3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {hover && (
            <>
              <line
                x1={hover.x}
                y1={padding.top}
                x2={hover.x}
                y2={padding.top + plotH}
                stroke="var(--border-strong)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={hover.x} cy={hover.y} r={3} fill={hoverSide ? baselineToneColor(hoverSide) : color} />
              {hoverSecondary && <circle cx={hoverSecondary.x} cy={hoverSecondary.y} r={3} fill={secondaryColor} />}
            </>
          )}

          {tickIndices.map((idx) => (
            <text
              key={idx}
              x={coords[idx].x}
              y={height - padding.bottom + 14}
              textAnchor={idx === 0 ? 'start' : idx === points.length - 1 ? 'end' : 'middle'}
              fontSize={8}
              fill="var(--text-muted)"
              fontFamily="var(--font-mono, monospace)"
            >
              {points[idx].label}
            </text>
          ))}
        </svg>

        {hoverIndex !== null && hover && (
          <div
            className="absolute top-1 pointer-events-none rounded border border-[var(--border-strong)] bg-[var(--bg-panel)] px-2 py-1 font-mono text-[9px] shadow-sm whitespace-nowrap z-10"
            style={
              scrollable
                ? tooltipOnRight
                  ? { left: hover.x + 6 }
                  : { left: hover.x, transform: 'translateX(calc(-100% - 6px))' }
                : tooltipOnRight
                  ? { left: `${(hover.x / width) * 100}%`, transform: 'translateX(6px)' }
                  : { right: `${100 - (hover.x / width) * 100}%`, transform: 'translateX(-6px)' }
            }
          >
            <div className="text-[var(--text-muted)] uppercase tracking-wider">{points[hoverIndex].label}</div>
            <div className="font-bold tabular-nums" style={{ color: hoverSide ? baselineToneColor(hoverSide) : color }}>
              {valuePrefix}
              {formatNumber(points[hoverIndex].value, valueDigits)}
              {valueSuffix}
            </div>
            {hasSecondary && (
              <div className="tabular-nums" style={{ color: secondaryColor }}>
                {secondaryLabel ? `${secondaryLabel} ` : ''}
                {valuePrefix}
                {formatNumber((secondary as LinePoint[])[hoverIndex].value, valueDigits)}
                {valueSuffix}
              </div>
            )}
          </div>
        )}

        {/* endLabel (opt-in): a persistent value tag at the last point's y-position, pinned to the
            plot's right edge - CoinGlass's own price chart always shows this, not only on hover. */}
        {endLabel && (
          <div
            className="absolute pointer-events-none rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tabular-nums text-white shadow-sm z-10"
            style={{
              top: `${(coords[coords.length - 1].y / height) * 100}%`,
              right: scrollable ? undefined : 0,
              left: scrollable ? coords[coords.length - 1].x + 4 : undefined,
              transform: 'translateY(-50%)',
              backgroundColor: baselineSegments ? baselineToneColor(baselineSegments[baselineSegments.length - 1].side) : color,
            }}
          >
            {valuePrefix}
            {formatNumber(points[points.length - 1].value, valueDigits)}
            {valueSuffix}
          </div>
        )}

        {tickIndices.length === 0 && (
          <div className="flex items-center justify-between font-mono text-[9px] text-[var(--text-muted)] tabular-nums px-1 mt-0.5">
            <span>{points[0].label}</span>
            <span>{points[points.length - 1].label}</span>
          </div>
        )}
      </div>
    </div>
  );
};
