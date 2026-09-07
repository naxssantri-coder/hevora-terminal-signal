export interface BaselineSegment {
  side: 'up' | 'down';
  points: { x: number; y: number }[];
}

/**
 * Two-tone baseline chart support (Fix Warna Dua-Nada - Overview price chart vs. its period-open
 * price, Weighted Funding Rate chart vs. 0%): splits an already-projected polyline (`coords`,
 * index-aligned with the real `values` behind them) into contiguous up/down runs relative to
 * `baselineValue`, inserting an exact interpolated crossing point (at `baselineY`, the baseline's
 * own projected y) at every sign change so adjacent segments share an endpoint and render with no
 * gap between colors - the standard technique behind every real baseline/two-tone chart (CoinGlass's
 * own Bitcoin price chart, TradingView Lightweight Charts' BaselineSeries), not a guess.
 */
export function splitByBaseline(
  coords: { x: number; y: number }[],
  values: number[],
  baselineValue: number,
  baselineY: number
): BaselineSegment[] {
  const segments: BaselineSegment[] = [];
  let current: BaselineSegment | null = null;

  for (let i = 0; i < coords.length; i++) {
    const side: 'up' | 'down' = values[i] >= baselineValue ? 'up' : 'down';
    if (!current) {
      current = { side, points: [coords[i]] };
      continue;
    }
    if (current.side === side) {
      current.points.push(coords[i]);
      continue;
    }
    // Sign change since the previous point - insert the exact crossing point (linear interpolation
    // on the real values, not the projected pixels) on both the closing and the new segment.
    const prevValue = values[i - 1];
    const currValue = values[i];
    const prevCoord = coords[i - 1];
    const currCoord = coords[i];
    const denom = currValue - prevValue;
    const t = denom !== 0 ? (baselineValue - prevValue) / denom : 0;
    const crossPoint = { x: prevCoord.x + t * (currCoord.x - prevCoord.x), y: baselineY };

    current.points.push(crossPoint);
    segments.push(current);
    current = { side, points: [crossPoint, coords[i]] };
  }
  if (current) segments.push(current);
  return segments;
}

export function segmentLinePath(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
}

/** Closes a segment's stroke down/up to the BASELINE's own y (not the plot floor, unlike this
 *  file's flat single-tone areaFill) - fills only the sliver between the line and the baseline,
 *  same "two-tone AREA chart" shape the CoinGlass reference itself uses. */
export function segmentAreaPath(points: { x: number; y: number }[], baselineY: number): string {
  const first = points[0];
  const last = points[points.length - 1];
  return `${segmentLinePath(points)} L ${last.x.toFixed(2)} ${baselineY.toFixed(2)} L ${first.x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
}
