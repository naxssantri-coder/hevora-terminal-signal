// Drawing-tools data model (Bagian F, drawing-tools framework - built on a separate branch per
// the user's own instruction: needs their real-device visual confirmation before it ever reaches
// main, so nothing here is wired into the production chart route yet).
//
// Every drawing is anchored in DATA SPACE (a real time + a real price), never in pixel space - so
// a drawing correctly stays attached to the same price/time as the reader pans/zooms the chart,
// exactly like TradingView's own drawings do. Pixel coordinates are only ever computed at render
// time via the chart's own priceToCoordinate/timeToCoordinate, never stored.

export type DrawingTool =
  | 'cursor'
  | 'trendline'
  | 'ray'
  | 'extendedLine'
  | 'horizontalLine'
  | 'horizontalRay'
  | 'verticalLine'
  | 'rectangle'
  | 'circle'
  | 'ellipse'
  | 'triangle'
  | 'polyline'
  | 'parallelChannel'
  | 'fibRetracement'
  | 'fibExtension'
  | 'fibChannel'
  | 'text'
  | 'note'
  | 'priceLabel'
  | 'measure'
  | 'position'
  // Tier 2 (Bagian J Tugas 4, 2026-09-01, lower priority per the user's own ordering) - the
  // markers cluster (arrowMarker/flagMark/pin/callout/signpost) plus trendAngle shipped first
  // (reused Tier 1's one-click/two-click infrastructure almost unchanged). This follow-up pass
  // adds crossline (a one-click horizontal+vertical reticle through one point), disjointChannel
  // (two independent trendline segments - unlike parallelChannel, the second line isn't derived
  // from the first), and regressionTrend (a real linear-regression fit + 1-stdev channel over the
  // bars between two anchor points' TIMES, recomputed from barsRef.current at render time - see
  // useDrawingTools.ts's own comment on why it's not baked into `points`).
  //
  // Brush/Highlighter (this pass): the one genuinely new interaction model in Tier 2 - every other
  // tool here (Tier 1 and 2 alike) commits on discrete CLICKS; these two capture a live mouse-DRAG
  // as a dense point path instead (see useDrawingTools.ts's DRAG_TOOLS/dragDrawingActiveRef for the
  // parallel handlePointerDown/Move/Up path this requires). Rendered/hit-tested as a path (like
  // polyline), but selection never exposes individual point handles or lets you drag a single
  // sample point - a 100+ point freehand stroke's own points aren't meaningful drag targets, so the
  // whole stroke moves as one rigid body instead (see hitTest's own tool check).
  //
  // Fib Circles/Arcs/Speed Resistance Fan (this pass): 3 more of the "five more exotic Fibonacci
  // variants" - all computed in pure PIXEL space directly from the two already-converted anchor
  // pixel points (px[0]/px[1]), same simplification convention fibChannel above already uses.
  //
  // Fib Time Zone (this pass, follow-up): originally deferred over a suspected timeToCoordinate
  // extrapolation limit - CONFIRMED for real (a standalone lightweight-charts harness, not just
  // assumed): timeToCoordinate returns null for literally any time past the last known bar, even
  // 1 bar-interval past it, let alone a 34x/55x Fibonacci multiple. Solved the same way fibCircles/
  // Arcs/SpeedFan already do: extrapolate in pure PIXEL space from the two anchor points' own
  // already-converted pixel X positions (pixelUnit = px[1].x - px[0].x) rather than re-deriving a
  // coordinate for each Fibonacci-multiple TIME through the chart API - sidesteps the null-return
  // limit entirely instead of working around it.
  //
  // Fib Spiral (this pass, second follow-up): its earlier "most involved, needs polar-to-pixel arc
  // math" deferral reason turned out to just be implementation effort, not a real blocker (unlike
  // flat top/bottom below) - a golden-ratio logarithmic spiral (r = r0 * PHI^(theta/90deg), one full
  // radius growth by PHI every quarter turn - the standard textbook definition) has no ambiguity to
  // resolve, so it's implemented as a dense pixel-space polyline (~270 points over 3 full turns)
  // from the two anchor points, same rendering/hit-test approach as the brush tool's own polyline.
  //
  // Still NOT included (still open, not silently dropped): flat top/bottom. Unlike every tool
  // above, its blocker isn't math or an engine limitation this sandbox can test its way out of - it
  // depends on matching a specific reference platform's own exact construction convention (which of
  // the 3+ anchors sets the flat level, and how the sloped side is derived from the rest), which
  // can't be verified without live access to that platform. Guessing and shipping a guess as if it
  // were the real convention would be the UI-tooling equivalent of this project's own "no fabricated
  // data" rule - left open rather than risk that, pending the user's own reference/confirmation.
  | 'trendAngle'
  | 'arrowMarker'
  | 'flagMark'
  | 'pin'
  | 'callout'
  | 'signpost'
  | 'crossline'
  | 'disjointChannel'
  | 'regressionTrend'
  | 'brush'
  | 'highlighter'
  | 'fibCircles'
  | 'fibArcs'
  | 'fibSpeedFan'
  | 'fibTimeZone'
  | 'fibSpiral';

export const TOOL_ORDER: DrawingTool[] = [
  'cursor',
  'trendline', 'ray', 'extendedLine', 'trendAngle', 'crossline',
  'horizontalLine', 'horizontalRay', 'verticalLine',
  'rectangle', 'circle', 'ellipse', 'triangle', 'polyline', 'brush', 'highlighter',
  'parallelChannel', 'disjointChannel',
  'fibRetracement', 'fibExtension', 'fibChannel', 'fibCircles', 'fibArcs', 'fibSpeedFan', 'fibTimeZone', 'fibSpiral',
  'text', 'note', 'priceLabel',
  'arrowMarker', 'flagMark', 'pin', 'callout', 'signpost',
  'measure',
  'position',
  'regressionTrend',
];

/** How many CLICKS a reader makes before this tool commits (not the final stored `points.length`,
 *  which can differ - `position` is placed with 2 clicks, entry then stop, but a 3rd point, the
 *  auto-computed take-profit, is appended before persisting - see useDrawingTools.ts). Single
 *  source of truth for the click-counting logic there and any UI that needs to know "is this tool
 *  done yet". `null` means variable-length (polyline only - finished by double-click/Enter). */
export const TOOL_CLICK_COUNT: Record<Exclude<DrawingTool, 'cursor'>, number | null> = {
  trendline: 2, ray: 2, extendedLine: 2, trendAngle: 2,
  horizontalLine: 1, horizontalRay: 1, verticalLine: 1,
  rectangle: 2, circle: 2, ellipse: 2, triangle: 3, polyline: null,
  parallelChannel: 3,
  fibRetracement: 2, fibExtension: 2, fibChannel: 2,
  text: 1, note: 1, priceLabel: 1,
  arrowMarker: 1, flagMark: 1, pin: 1, callout: 1, signpost: 1,
  crossline: 1, disjointChannel: 4, regressionTrend: 2,
  brush: null, highlighter: null,
  fibCircles: 2, fibArcs: 2, fibSpeedFan: 2, fibTimeZone: 2, fibSpiral: 2,
  measure: 2,
  position: 2,
};

export interface DrawingPoint {
  time: number; // UTCTimestamp (seconds) - the same unit Bar.time already uses elsewhere in this chart
  price: number;
}

export interface DrawingObject {
  id: string;
  tool: Exclude<DrawingTool, 'cursor'>;
  // Point count per tool - see TOOL_CLICK_COUNT (points.length can exceed the click count - see
  // its own comment, currently only true for 'position'). Never validated beyond "at least 1" at
  // the type level - enforced by how each tool is built (see useDrawingTools.ts), not by a
  // discriminated union, to keep the render/hit-test code that iterates `points` uniform.
  points: DrawingPoint[];
  text?: string; // only meaningful for tool === 'text' | 'note'
  // 'position' only: whether points[0]->points[1] (entry->stop) reads as a long or short - derived
  // once at creation time from which side of entry the stop landed on, then stored (not
  // re-derived every render) so dragging the stop below/above entry doesn't retroactively flip
  // which side is "risk" vs "reward" out from under a reader who's already looking at it.
  positionDirection?: 'long' | 'short';
  color: string;
  lineWidth: number;
  locked: boolean;
  hidden: boolean;
  createdAt: number;
}

export interface DrawingsState {
  drawings: DrawingObject[];
}

export const DEFAULT_DRAWING_COLOR = '#F2B84B';
export const DEFAULT_DRAWING_LINE_WIDTH = 2;

export const FIB_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

// Standard fib EXTENSION ratios (projecting beyond the 0-1 swing, both directions) - a simplified
// 2-anchor-point variant rather than the classic 3-point (A-B-C) construction, documented in
// useDrawingTools.ts where it's rendered. -0.618/-0.272 project past point B (beyond the "0" end);
// 1.272/1.618/2/2.618 project past point A (beyond the "1" end/full extension zone).
export const FIB_EXTENSION_LEVELS: readonly number[] = [-0.618, -0.272, 0, 1, 1.272, 1.618, 2, 2.618];

/** Default RR multiple for the position tool's auto-computed take-profit (TP distance = this many
 *  times the entry-to-stop risk distance) - a real, disclosed default a reader can then drag to
 *  any RR they actually want, never presented as an engine-calibrated number (that would blur the
 *  line with this project's real signal engine, which this tool has nothing to do with). */
export const POSITION_DEFAULT_RR = 2;
