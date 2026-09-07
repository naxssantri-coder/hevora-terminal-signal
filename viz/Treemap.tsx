import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export interface TreemapBlock {
  id: string;
  label: string;
  /** Real magnitude - drives block AREA (proportional, Coinglass-style), never a fixed decorative
   *  size. Blocks are laid out by a squarified treemap (both width AND height vary with value), so
   *  the reader sees size AS the read, not a number they have to look up separately. */
  value: number;
  tone?: 'up' | 'down' | 'neutral';
  /** How saturated `tone`'s up/down color should render (0 = barely tinted, 1 = the full fixed
   *  .hev-tblock.long/.short gradient this component always used before this prop existed) -
   *  callers with a real continuous magnitude behind the tone (e.g. per-exchange price-change %,
   *  Fix Warna Heatmap) pass this so the biggest movers read as the most saturated blocks, same
   *  "darker = more extreme" gradient CoinGlass's own reference heatmap uses. Omitted (every
   *  existing caller) keeps the fixed full-saturation look exactly as before - only 'up'/'down'
   *  tones use it, 'neutral' is unaffected. */
  intensity?: number;
  sublabel?: string;
  /** Optional small mark (e.g. an ExchangeIcon) rendered inside the block once it's large enough
   *  to hold one without crowding the label/value - omitted entirely on a cramped block rather
   *  than shrunk past legibility. */
  icon?: React.ReactNode;
}

/** Maps this component's tone to the pasted .hev-tblock modifier classes (.long/.short). The
 *  pasted CSS has no 'neutral' variant - 'hev-tblock-neutral' below is a contextual addition
 *  (same gradient+border technique, brand colour) for callers whose blocks aren't a long/short
 *  read, e.g. a magnitude-only series with no bullish/bearish meaning. */
const TONE_CLASS: Record<'up' | 'down' | 'neutral', string> = {
  up: 'long',
  down: 'short',
  neutral: 'hev-tblock-neutral',
};

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Worst (largest) aspect-ratio deviation from square a row of `areas` would produce if laid out
 *  along a strip of the given fixed `length` - the classic Bruls/Huizing/van Wijk squarify metric.
 *  An empty row has no ratio yet, so it always loses to (is beaten by) adding the first item. */
const worstAspect = (areas: number[], length: number): number => {
  if (areas.length === 0 || length <= 0) return Infinity;
  const sum = areas.reduce((a, b) => a + b, 0);
  if (sum <= 0) return Infinity;
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const sqLen = length * length;
  const sqSum = sum * sum;
  return Math.max((sqLen * max) / sqSum, sqSum / (sqLen * min));
};

/**
 * Squarified treemap layout over pre-scaled area values (`sum(areas) === rect.w * rect.h`, the
 * invariant the algorithm's row-thickness maths relies on). Each step lays a row of one or more
 * items along the rectangle's current SHORTER side (spanning it in full), sized to keep that row's
 * items as close to square as adding one more item allows, then shrinks the remaining rectangle by
 * that row's thickness and repeats - the standard technique behind every real "biggest box = biggest
 * number, still roughly square" treemap, replacing this component's previous flex-wrap-by-width
 * layout (which forced every block to the same fixed height regardless of value).
 */
function squarify(areas: number[], rect: Rect): Rect[] {
  const result: Rect[] = new Array(areas.length);
  let remaining = areas.map((v, i) => ({ v: Math.max(v, 0), i })).filter((item) => item.v > 0);
  let cur: Rect = { ...rect };

  while (remaining.length > 0) {
    if (cur.w <= 0.5 || cur.h <= 0.5) {
      for (const item of remaining) result[item.i] = { x: cur.x, y: cur.y, w: 0, h: 0 };
      break;
    }
    // A row spans the shorter side of the remaining rect in full ("rowSpansWidth" = true lays a
    // horizontal band across the full width, stacking rows downward; false lays a vertical band
    // across the full height, stacking columns rightward).
    const rowSpansWidth = cur.w < cur.h;
    const length = rowSpansWidth ? cur.w : cur.h;

    let row: typeof remaining = [];
    let rowAreas: number[] = [];
    for (let i = 0; i < remaining.length; i++) {
      const nextAreas = [...rowAreas, remaining[i].v];
      if (rowAreas.length === 0 || worstAspect(rowAreas, length) >= worstAspect(nextAreas, length)) {
        rowAreas = nextAreas;
        row.push(remaining[i]);
      } else {
        break;
      }
    }

    const rowSum = rowAreas.reduce((a, b) => a + b, 0);
    const thickness = rowSum / length;

    let offset = 0;
    row.forEach((item, k) => {
      const side = thickness > 0 ? rowAreas[k] / thickness : 0;
      result[item.i] = rowSpansWidth
        ? { x: cur.x + offset, y: cur.y, w: side, h: thickness }
        : { x: cur.x, y: cur.y + offset, w: thickness, h: side };
      offset += side;
    });

    cur = rowSpansWidth
      ? { x: cur.x, y: cur.y + thickness, w: cur.w, h: cur.h - thickness }
      : { x: cur.x + thickness, y: cur.y, w: cur.w - thickness, h: cur.h };
    remaining = remaining.slice(row.length);
  }
  return result;
}

/**
 * Proportional block map (§ Liquidity & Flow, reused for any "size = value" read - liquidity
 * zones, the per-exchange/per-coin volume heatmaps). `height` is now the TOTAL container height
 * (rows within it vary in thickness with their contents' value), not a fixed per-block height -
 * every existing caller already just wants a compact area to fill, so this only changes how
 * blocks are placed inside it.
 *
 * Blocks pulse (.hev-tblock.pulse, pasted design-system class) for one cycle when their value
 * moves by more than `pulseThreshold` (fraction of the previous value) since the last render -
 * "something here just changed materially" - never on first mount (no "previous" to compare
 * against yet) and never continuously (the pasted keyframe loops infinitely while the class is
 * present, so this component removes the class again after ~2.4s - long enough for one full
 * pulse cycle - rather than leaving it animating forever, which this app's own animation policy
 * reserves for data that is actually still changing, not a permanent decoration).
 */
export const Treemap: React.FC<{
  blocks: TreemapBlock[];
  height?: number;
  valueFormatter?: (v: number) => string;
  pulseThreshold?: number;
}> = ({ blocks, height = 160, valueFormatter, pulseThreshold = 0.08 }) => {
  const prevValues = useRef<Map<string, number> | null>(null);
  const [pulsingIds, setPulsingIds] = useState<ReadonlySet<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const prev = prevValues.current;
    const next = new Map(blocks.map((b) => [b.id, b.value]));

    if (prev) {
      const changed = new Set<string>();
      for (const b of blocks) {
        const prior = prev.get(b.id);
        if (prior !== undefined && prior > 0 && Math.abs(b.value - prior) / prior >= pulseThreshold) {
          changed.add(b.id);
        }
      }
      if (changed.size > 0) {
        setPulsingIds(changed);
        // hev-block-pulse's keyframe (index.css) loops every 2.2s - hold the class for one full
        // cycle before removing it, rather than cutting the animation off mid-pulse.
        const timer = setTimeout(() => setPulsingIds(new Set()), 2400);
        prevValues.current = next;
        return () => clearTimeout(timer);
      }
    }

    prevValues.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  // Real container pixel width (ResizeObserver, not a fixed virtual coordinate space) - so the
  // squarify pass targets this card's ACTUAL aspect ratio, which is what keeps blocks close to
  // square on both a wide desktop panel and a narrow mobile one instead of only one of the two.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const positive = useMemo(() => blocks.filter((b) => b.value > 0), [blocks]);

  // Bugfix (restate, "heatmap masih terpotong/bolong"): with real exchange-volume-shaped data - a
  // handful of dominant venues (Binance, OKX...) holding most of the value and a long tail of
  // small ones sharing a sliver of it - naive value-proportional scaling starves that tail down
  // toward near-zero area. squarify's own remaining-rect then legitimately shrinks below its
  // degenerate-rect guard (cur.w/cur.h <= 0.5) partway through the tail, and EVERY item still
  // unplaced at that point got dropped to a 0x0 (invisible) box - this is "2-3 big boxes render,
  // the rest is empty space", not a CSS/layout bug (confirmed: this component measures its own
  // container via ResizeObserver and takes an explicit height prop, neither of which depends on
  // any ancestor's padding/overflow/position - the earlier "flat/bare Panel mode broke this"
  // theory didn't hold up under actual audit of this file's own git history, see commit
  // 8d384ff which introduced this exact squarify algorithm well before any flat/bare mode existed).
  //
  // Fix: reserve a small fixed floor area per item BEFORE scaling the rest by real value, capped
  // so the combined floor can never eat more than 35% of the container (however many items there
  // are) - every block still gets a real, visible rect (this treemap's whole reason to exist:
  // "SEMUA item ke-render... mengisi seluruh lebar area tanpa celah"), while blocks above the
  // floor still read as proportionally bigger for a proportionally bigger value.
  const rects = useMemo(() => {
    if (positive.length === 0 || width <= 0) return [];
    const total = positive.reduce((sum, b) => sum + b.value, 0) || 1;
    const totalArea = width * height;
    const n = positive.length;
    const MIN_BLOCK_AREA = 256; // ~16x16px before the GAP inset - enough to hold at least the value text
    const floorPerItem = Math.min(MIN_BLOCK_AREA, (totalArea * 0.35) / n);
    const reserved = floorPerItem * n;
    const scale = reserved < totalArea ? (totalArea - reserved) / total : 0;
    const areas = positive.map((b) => floorPerItem + b.value * scale);
    return squarify(areas, { x: 0, y: 0, w: width, h: height });
  }, [positive, width, height]);

  if (blocks.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]"
        style={{ height }}
      >
        —
      </div>
    );
  }

  // CoinGlass parity ROUND 3 ("cell merapat, radius <=4px, gap 1-2px"): 3px read as a card grid
  // with visible breathing room between tiles; 2px keeps just enough separation to tell blocks
  // apart without looking like a card layout - matches the reference's packed treemap.
  const GAP = 2;

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      {positive.map((block, i) => {
        const rect = rects[i];
        if (!rect || rect.w <= 0 || rect.h <= 0) return null;
        const tone = block.tone ?? 'neutral';
        const isPulsing = pulsingIds.has(block.id);
        const textColor = tone === 'up' ? 'var(--color-up)' : tone === 'down' ? 'var(--color-down)' : 'var(--color-brand)';
        // Intensity-scaled background (Fix Warna Heatmap §3, "gradasi hijau/merah muda/tua"):
        // overrides .hev-tblock.long/.short's own fixed-opacity gradient via inline style (which
        // always wins the cascade regardless of specificity, same technique already used for
        // `position` above) rather than editing that pasted-verbatim shared class. The stop alphas
        // at intensity=1 match .long/.short's own fixed 0.35/0.12 exactly, so a fully-saturated
        // block still looks identical to every caller that never passes `intensity`.
        const hasIntensity = tone !== 'neutral' && typeof block.intensity === 'number' && Number.isFinite(block.intensity);
        // CoinGlass parity ROUND 2 (Bagian C - "warna terlalu gradasi/washy"): the reference
        // heatmap fills each box with a single FLAT color, not a corner-to-corner gradient - a
        // gradient reads as an illustration/marketing texture, flat reads as data-viz. One alpha
        // interpolated straight from intensity (clamped 0.18-0.60) instead of the old two-stop
        // linear-gradient.
        const intensityBackground = hasIntensity
          ? (() => {
              const t = Math.max(0, Math.min(1, block.intensity as number));
              const rgb = tone === 'up' ? '34,197,94' : '239,68,68';
              const alpha = 0.18 + 0.42 * t;
              return `rgba(${rgb},${alpha})`;
            })()
          : undefined;

        const w = Math.max(rect.w - GAP * 2, 1);
        const h = Math.max(rect.h - GAP * 2, 1);
        const minDim = Math.min(w, h);
        // Content density scales down with block size (never overflows a small cell) rather than
        // clipping a fixed-size label/value - a tiny long-tail exchange's block still reads as
        // "small = a small number" instead of a broken layout crammed into a sliver.
        const tier: 'tiny' | 'small' | 'full' = minDim < 30 ? 'tiny' : minDim < 56 ? 'small' : 'full';
        const labelSize = Math.max(7.5, Math.min(10, w / 8));
        const valueSize = Math.max(9, Math.min(19, minDim / 3.2));
        const formatted = valueFormatter ? valueFormatter(block.value) : block.value.toLocaleString();

        return (
          <div
            key={block.id}
            className={`hev-tblock ${TONE_CLASS[tone]} absolute overflow-hidden ${isPulsing ? 'pulse' : ''}`}
            style={{
              // Root cause of the "boxes float far below the card" bug (verified via computed
              // styles, not guessed): .hev-tblock's own CSS (index.css's pasted-verbatim design
              // block) sets `position: relative`. Tailwind's `absolute` utility class above has the
              // SAME specificity (one class each) and index.css puts `@import "tailwindcss"` at
              // the very top of the file, so .hev-tblock's rule - declared hundreds of lines later
              // in the same cascade - wins the tie and silently overrides `absolute` back to
              // `relative`. Every block then stayed in normal document flow: each one's own height
              // pushed the next sibling down the PAGE (not just within this 150px container),
              // which is exactly what stacked "2-3 visible boxes, the rest scrolled far below,
              // overlapping unrelated content" - not a squarify math bug, not a container-width
              // measurement bug (both audited and confirmed correct in isolation first). An inline
              // style always wins over any external stylesheet rule regardless of specificity/
              // order, so this is set here rather than touching .hev-tblock's CSS - that block is
              // pasted verbatim by explicit instruction (see index.css's own comment above it) and
              // is shared by FlowParticles/GaugeRadial/StateBlock too, which never asked for
              // `position: absolute` and must keep their own default `relative` behavior.
              position: 'absolute',
              left: rect.x + GAP,
              top: rect.y + GAP,
              width: w,
              height: h,
              justifyContent: 'flex-start',
              padding: tier === 'tiny' ? '4px 6px' : tier === 'small' ? '6px 8px' : undefined,
              ...(intensityBackground ? { background: intensityBackground } : null),
            }}
            title={`${block.label} - ${formatted}${block.sublabel ? ` (${block.sublabel})` : ''}`}
          >
            {tier !== 'tiny' && (
              <div className="flex items-center gap-1 min-w-0">
                {block.icon && tier === 'full' && <span className="shrink-0">{block.icon}</span>}
                <span
                  className="font-bold uppercase tracking-wide truncate"
                  style={{ color: textColor, fontSize: labelSize }}
                >
                  {block.label}
                </span>
              </div>
            )}
            <div className={tier === 'tiny' ? '' : 'mt-1'}>
              <span
                className="block font-black tabular-nums text-[var(--text-primary)] truncate"
                style={{ fontSize: valueSize }}
              >
                {formatted}
              </span>
              {tier === 'full' && block.sublabel && (
                <span className="block text-[9px] text-[var(--text-muted)] truncate">{block.sublabel}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
