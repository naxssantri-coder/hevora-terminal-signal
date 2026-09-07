// Pure geometry helpers for drawing-tools hit-testing and rendering math - deliberately kept free
// of any lightweight-charts or DOM dependency so they're testable directly with plain Node
// (scripts/verify-drawing-math.ts), the same pattern already used for the indicator formulas.

export interface Pt {
  x: number;
  y: number;
}

/** Euclidean distance from a point to a finite line segment (a..b) - the standard "closest point
 *  on segment" projection, clamped to the segment's own endpoints so a point beyond either end
 *  measures to that endpoint, not to the infinite line through it. */
export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/** Distance from a point to an infinite ray starting at `a` and passing through `b` (extending
 *  PAST b, never before a) - used for the ray tool, which is only bounded on one side. */
export function distanceToRay(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, t); // only clamp the start, never the far end
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/** Distance from a point to a horizontal line at pixel row `y0` (a horizontalLine drawing spans
 *  the whole pane width, so only the vertical distance to its row matters - x is unconstrained). */
export function distanceToHorizontalLine(p: Pt, y0: number): number {
  return Math.abs(p.y - y0);
}

/** True if `p` falls on or inside the rectangle with corners `a` and `b` (either diagonal order),
 *  widened by `tolerance` px so a click near the border still counts - a rectangle drawing's hit
 *  area is its outline plus a small margin, not just an exact-pixel border. */
export function isNearRectangle(p: Pt, a: Pt, b: Pt, tolerance: number): boolean {
  const left = Math.min(a.x, b.x) - tolerance;
  const right = Math.max(a.x, b.x) + tolerance;
  const top = Math.min(a.y, b.y) - tolerance;
  const bottom = Math.max(a.y, b.y) + tolerance;
  if (p.x < left || p.x > right || p.y < top || p.y > bottom) return false;
  // Inside the outer bound - now require being NEAR the border specifically (not deep inside),
  // matching how TradingView's own rectangle selection only grabs near the edges, not a click
  // anywhere inside a large box (which would otherwise make overlapping shapes unselectable).
  const innerLeft = Math.min(a.x, b.x) + tolerance;
  const innerRight = Math.max(a.x, b.x) - tolerance;
  const innerTop = Math.min(a.y, b.y) + tolerance;
  const innerBottom = Math.max(a.y, b.y) - tolerance;
  const deepInside = p.x > innerLeft && p.x < innerRight && p.y > innerTop && p.y < innerBottom;
  return !deepInside;
}

/** Distance from a point to an INFINITE line through `a` and `b`, extending past BOTH ends
 *  (unlike distanceToRay, which only extends past `b`) - used for the extended-line tool. */
export function distanceToLine(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq; // deliberately NOT clamped at all
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/** Distance from a point to a vertical line at pixel column `x0` (a verticalLine drawing spans the
 *  whole pane height, so only the horizontal distance to its column matters). */
export function distanceToVerticalLine(p: Pt, x0: number): number {
  return Math.abs(p.x - x0);
}

/** True if `p` is within `tolerance` px of the BORDER of the ellipse inscribed in the pixel-space
 *  bounding box of corners `a`/`b` (the same box convention as isNearRectangle - a circle is just
 *  an ellipse whose renderer picks equal radii, hit-tested identically). Uses the normalized-
 *  distance-from-center test (dx/rx)^2+(dy/ry)^2 == 1 for the border, scaled by `tolerance`
 *  converted into the same normalized units along each axis independently (an ellipse's border
 *  isn't a constant pixel-distance from center, so a flat pixel tolerance would over-select near
 *  the flatter side and under-select near the pointed side without this normalization). */
export function isNearEllipseBorder(p: Pt, a: Pt, b: Pt, tolerance: number): boolean {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.max(Math.abs(b.x - a.x) / 2, 1);
  const ry = Math.max(Math.abs(b.y - a.y) / 2, 1);
  const normalized = ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2;
  const normalizedDistanceFromBorder = Math.abs(Math.sqrt(normalized) - 1);
  // Convert the pixel tolerance to an approximate normalized tolerance using the smaller radius
  // (the tighter, more conservative bound) so the hit band doesn't balloon on a very elongated
  // ellipse's long axis.
  const normalizedTolerance = tolerance / Math.min(rx, ry);
  return normalizedDistanceFromBorder <= normalizedTolerance;
}

/** Distance from a point to the nearest of the 3 edges of a triangle - each edge tested as a
 *  regular finite segment, so the closest edge (not necessarily the closest vertex) wins, exactly
 *  matching how a reader expects to click "on" a triangle's outline anywhere along its edges. */
export function distanceToTriangleBorder(p: Pt, a: Pt, b: Pt, c: Pt): number {
  return Math.min(distanceToSegment(p, a, b), distanceToSegment(p, b, c), distanceToSegment(p, c, a));
}

/** Distance from a point to the nearest segment of a polyline (2+ connected points) - the
 *  standard "distance to nearest edge of a path" test, same segment math as distanceToSegment. */
export function distanceToPolyline(p: Pt, points: Pt[]): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y);
  let min = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    min = Math.min(min, distanceToSegment(p, points[i], points[i + 1]));
  }
  return min;
}

/** Real price level for one standard Fibonacci retracement ratio between two anchor prices -
 *  standard convention: 0 sits at the SECOND point (priceB), 1 sits at the first (priceA),
 *  regardless of which one is numerically higher (so retracement direction always reads correctly
 *  whether the swing was drawn high-to-low or low-to-high). */
export function fibLevelPrice(priceA: number, priceB: number, ratio: number): number {
  return priceB + (priceA - priceB) * ratio;
}

/** Percentage change from `from` to `to`, the same convention the on-canvas OHLC legend already
 *  uses elsewhere in this chart (signed, `to` relative to `from`). */
export function pctChange(from: number, to: number): number {
  return from !== 0 ? ((to - from) / from) * 100 : 0;
}
