import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import {
  DrawingObject,
  DrawingPoint,
  DrawingTool,
  TOOL_CLICK_COUNT,
  DEFAULT_DRAWING_COLOR,
  DEFAULT_DRAWING_LINE_WIDTH,
  FIB_LEVELS,
  FIB_EXTENSION_LEVELS,
  POSITION_DEFAULT_RR,
} from './drawingTypes';
import {
  distanceToSegment, distanceToRay, distanceToLine, distanceToHorizontalLine, distanceToVerticalLine,
  isNearRectangle, isNearEllipseBorder, distanceToTriangleBorder, distanceToPolyline,
  fibLevelPrice, pctChange,
} from './drawingMath';

// Radii ratios for fibCircles/fibArcs (both anchored on the same two-point pixel distance - see
// their own render/hit-test comments for the one real difference between them). Extends FIB_LEVELS
// with the 1.618 extension ratio for a fuller, more useful set of rings than the plain 0-1 range.
const FIB_CIRCLE_ARC_RATIOS: readonly number[] = [0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
// Classic "eighths + thirds" Fibonacci Speed Resistance Fan division ratios.
const FIB_SPEED_FAN_RATIOS: readonly number[] = [1 / 8, 1 / 3, 1 / 2, 2 / 3, 7 / 8];
// Fibonacci sequence multiples for fibTimeZone's vertical lines (deduplicated - the sequence's own
// leading 1,1 collapses to a single 1x line, same as every real charting platform's own version).
const FIB_TIME_ZONE_MULTIPLES: readonly number[] = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55];
// fibSpiral: golden-ratio logarithmic spiral, r(theta) = r0 * PHI^(theta / 90deg) - radius grows by
// the golden ratio every quarter turn, the standard definition. Drawn/hit-tested as a dense pixel
// polyline (like brush) rather than a true canvas arc, since a log spiral has no closed-form canvas
// primitive - computed directly in pixel space from the two anchors' own pixel positions, same
// simplification convention as fibCircles/fibArcs/fibSpeedFan/fibTimeZone above.
const FIB_SPIRAL_GOLDEN_RATIO = 1.618033988749895;
const FIB_SPIRAL_STEP_DEG = 4;
const FIB_SPIRAL_MAX_TURNS = 3;

function fibSpiralPixelPoints(center: PixelPoint, radiusPoint: PixelPoint): PixelPoint[] {
  const r0 = Math.hypot(radiusPoint.x - center.x, radiusPoint.y - center.y);
  if (r0 <= 0) return [center, center];
  const startAngle = Math.atan2(radiusPoint.y - center.y, radiusPoint.x - center.x);
  // Spiral outward counter-clockwise in screen space from the start angle, matching the direction a
  // reader would naturally sweep from the anchor point - a fixed, disclosed convention (this tool
  // has no single canonical direction across charting platforms).
  const pts: PixelPoint[] = [];
  const maxDeg = 360 * FIB_SPIRAL_MAX_TURNS;
  for (let deg = 0; deg <= maxDeg; deg += FIB_SPIRAL_STEP_DEG) {
    const r = r0 * Math.pow(FIB_SPIRAL_GOLDEN_RATIO, deg / 90);
    const theta = startAngle - (deg * Math.PI) / 180;
    pts.push({ x: center.x + r * Math.cos(theta), y: center.y + r * Math.sin(theta) });
  }
  return pts;
}

// Drawing-tools overlay (Bagian F, framework pass - built on a separate branch, not wired into the
// production chart route yet per the user's own "needs my real-device confirmation first" rule).
//
// Architecture decision: a SEPARATE, absolutely-positioned <canvas> drawn with plain 2D canvas
// calls, rather than lightweight-charts' own ISeriesPrimitive plugin API. Both are legitimate;
// this one was chosen because it's far easier to reason about and get right without being able to
// visually verify pixel-perfect rendering myself in this sandbox (Clerk auth blocks the full app) -
// plain canvas 2D calls (moveTo/lineTo/strokeRect) are well-understood and low-risk, versus
// replicating lightweight-charts' own internal (undocumented in detail) primitive renderer
// contract. Every drawing's points are stored in DATA SPACE (time + price) and only ever converted
// to pixels at render/hit-test time via the chart's own priceToCoordinate/timeToCoordinate - so
// drawings correctly stay anchored to their real price/time as the reader pans or zooms.
//
// Known v1 trade-off, disclosed rather than hidden: lightweight-charts' public API has no
// subscribable raw mousedown/mouseup (only a completed `click` and continuous `crosshairMove`),
// so drag-to-move needs a real overlay with pointer-events enabled - which then also intercepts
// clicks that would otherwise pan the chart natively. This hook compensates by forwarding an
// empty-space drag on the overlay into an equivalent manual pan (via setVisibleLogicalRange), so
// panning still works while the overlay is mounted - but it is a reimplementation, not the
// original native gesture, and hasn't been felt out on a real device yet.

const ENDPOINT_HIT_RADIUS = 9;
const BODY_HIT_TOLERANCE = 6;
const HANDLE_SIZE = 7;
const POLYLINE_DBLCLICK_MS = 350;

// Wheel-zoom tuning (see handleWheel below). SENSITIVITY controls how much a single wheel notch
// (~100 deltaY on most mice) zooms: exp(-100 * 0.0016) ~= 0.85, i.e. ~15% narrower per notch - a
// common, comfortable step (noticeably responsive but not jumpy). MAX_STEP caps any single wheel
// event (including one large trackpad burst) to at most a 2x zoom in or out. MIN_BARS/
// MAX_BARS_MULTIPLE bound how far in/out a reader can go - matches the "can't zoom into nothing or
// blow past the loaded data" behavior any real charting platform enforces.
const WHEEL_ZOOM_SENSITIVITY = 0.0016;
const WHEEL_ZOOM_MAX_STEP = 2;
const WHEEL_ZOOM_MIN_BARS = 3;
const WHEEL_ZOOM_MAX_BARS_MULTIPLE = 3;

// Right price-scale axis drag-to-zoom (handlePointerDown/Move/Up's priceScaleDragRef branches).
// Convention: dragging DOWN narrows the visible price range (candles read taller - "zoom in"),
// dragging UP widens it ("zoom out") - matches TradingView's own right-axis drag direction.
// Anchored on the drag's own starting range MIDPOINT (not the cursor Y), same as TradingView's
// axis drag - unlike wheel-zoom on the time axis, a price-scale drag has no natural "point under
// the cursor should stay fixed" anchor since the axis itself has no data at the cursor's Y.
const PRICE_SCALE_DRAG_SENSITIVITY = 0.006;

// Pan momentum/inertia tuning - the "kerasa kaku" complaint TradingView's own native kinetic
// scroll is compared against: a fast drag should keep gliding briefly after mouseup and decelerate
// smoothly, instead of stopping dead the instant the button is released.
// VELOCITY_SMOOTHING: how much weight a fresh instantaneous-velocity sample gets in the running
// EMA (0-1) - smooths out single-frame jitter (mousemove events don't arrive at a perfectly even
// cadence) without lagging noticeably behind a real, sustained drag speed.
// MIN_LAUNCH_VELOCITY: below this (logical units/ms) at release, momentum doesn't start at all -
// a slow drag or a plain click-release should stop dead, not visibly drift.
// FRICTION_PER_SECOND: velocity multiplier after a full second of gliding (frame-rate independent
// - applied as friction^(dt/1000) each frame, not a fixed per-frame constant) - 0.02 means it's
// down to 2% of its launch speed after 1s, i.e. a quick, snappy glide-and-stop rather than a long
// float, matching the brief deceleration real charting platforms use rather than a physics-toy one.
// STOP_VELOCITY: the loop ends once decay brings speed below this (logical units/ms).
const PAN_MOMENTUM_VELOCITY_SMOOTHING = 0.35;
const PAN_MOMENTUM_MIN_LAUNCH_VELOCITY = 0.02;
const PAN_MOMENTUM_FRICTION_PER_SECOND = 0.02;
const PAN_MOMENTUM_STOP_VELOCITY = 0.0005;
const PAN_MOMENTUM_MAX_DURATION_MS = 2000;

interface PixelPoint { x: number; y: number }

function genId(): string {
  return `dr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const DRAWINGS_STORAGE_PREFIX = 'hevora:chart:drawings:';

function loadDrawings(pairId: string): DrawingObject[] {
  try {
    const raw = window.localStorage.getItem(DRAWINGS_STORAGE_PREFIX + pairId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDrawings(pairId: string, drawings: DrawingObject[]): void {
  try {
    window.localStorage.setItem(DRAWINGS_STORAGE_PREFIX + pairId, JSON.stringify(drawings));
  } catch {
    // Storage unavailable/blocked - drawings just won't survive a reload this session.
  }
}

/** Tools that commit on a SINGLE click and never accumulate a second point. */
const ONE_CLICK_TOOLS: ReadonlySet<Exclude<DrawingTool, 'cursor'>> = new Set([
  'horizontalLine', 'horizontalRay', 'verticalLine', 'text', 'note', 'priceLabel',
  'arrowMarker', 'flagMark', 'pin', 'callout', 'signpost', 'crossline',
]);
/** Tools whose single click needs a text prompt before committing. */
const TEXT_PROMPT_TOOLS: ReadonlySet<Exclude<DrawingTool, 'cursor'>> = new Set(['text', 'note', 'callout', 'signpost']);
/** Tools that capture a live mouse-DRAG as a dense point path, rather than committing on discrete
 *  clicks like every other tool here - see handlePointerDown/Move/Up's own DRAG_TOOLS branches. */
const DRAG_TOOLS: ReadonlySet<Exclude<DrawingTool, 'cursor'>> = new Set(['brush', 'highlighter']);
/** Minimum pixel distance between two consecutive captured drag points - keeps a fast freehand
 *  stroke from accumulating one point per mousemove event (which can fire well over 60/sec),
 *  without visibly changing the stroke's shape at normal chart zoom levels. */
const DRAG_CAPTURE_MIN_DISTANCE_PX = 3;

export interface UseDrawingToolsParams {
  pairId: string;
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  bars: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[];
  digits: number;
  /** Bagian J Tugas 5 (drawing templates): the style every NEWLY drawn object should start with -
   *  null/omitted falls back to DEFAULT_DRAWING_COLOR/DEFAULT_DRAWING_LINE_WIDTH, exactly the
   *  behavior before templates existed. Read via a ref (see defaultStyleRef below), not a
   *  useCallback dependency, so a template switch never has to rebuild buildDrawing/the pointer
   *  handlers that close over it. */
  defaultStyle?: { color: string; lineWidth: number } | null;
}

export function useDrawingTools({ pairId, chart, series, bars, digits, defaultStyle }: UseDrawingToolsParams) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawings, setDrawings] = useState<DrawingObject[]>(() => loadDrawings(pairId));
  const defaultStyleRef = useRef(defaultStyle);
  defaultStyleRef.current = defaultStyle;
  const [activeTool, setActiveToolState] = useState<DrawingTool>('cursor');
  const [magnetMode, setMagnetMode] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inProgress, setInProgress] = useState<{ tool: Exclude<DrawingTool, 'cursor'>; points: DrawingPoint[] } | null>(null);
  const [previewPoint, setPreviewPoint] = useState<DrawingPoint | null>(null);
  // Right-click-on-a-drawing context menu (color/width/lock/hide/duplicate/delete for THAT
  // specific drawing, not just the toolbar's "default for new drawings" flyout) - position in page
  // coordinates (not canvas-relative), since it renders via a portal at document.body level. Which
  // drawing it targets is just whatever `selectedId` is - the right-click handler below selects
  // the hit drawing at the same time it opens the menu, so there's no separate "menu target" to
  // track that could ever drift out of sync with the selection.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Undo/redo history - a plain stack of past `drawings` snapshots, pushed on every COMMITTED
  // change (new drawing, delete, drag-release, lock/hide/duplicate), never on the live in-flight
  // preview of a drag (that would flood the stack with one entry per mouse-move pixel). See
  // pushHistory below - the single choke point every mutation goes through.
  const undoStackRef = useRef<DrawingObject[][]>([]);
  const redoStackRef = useRef<DrawingObject[][]>([]);
  const [historyTick, setHistoryTick] = useState(0); // bumped to force a re-render when the stacks change, since refs alone don't trigger one

  // Refs mirroring state that the raw DOM mouse handlers (added once via useEffect, not on every
  // render) need to read fresh without becoming a dependency that would re-attach listeners
  // constantly - the same pattern already used elsewhere in this chart (barsRef etc.).
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const magnetModeRef = useRef(magnetMode);
  magnetModeRef.current = magnetMode;
  const barsRef = useRef(bars);
  barsRef.current = bars;
  const inProgressRef = useRef(inProgress);
  inProgressRef.current = inProgress;
  const lastClickAtRef = useRef(0);
  const lastClickPosRef = useRef<PixelPoint | null>(null);
  // Brush/highlighter's own drag-capture state - separate from dragRef below (which is for
  // dragging an EXISTING selected drawing in cursor mode, an unrelated flow).
  const dragDrawingActiveRef = useRef(false);
  const lastDragCapturePixelRef = useRef<PixelPoint | null>(null);

  const dragRef = useRef<{
    id: string;
    pointIndex: number | 'body';
    startDataPoint: DrawingPoint; // where the mouse-down happened, in data space
    startPoints: DrawingPoint[]; // the drawing's own points at drag start, for 'body' offset math
  } | null>(null);
  const panDragRef = useRef<{ startX: number; startRange: { from: number; to: number } } | null>(null);
  // Pan momentum/inertia (handlePointerMove's velocity sampling, handlePointerUp's launch, and the
  // stepMomentum loop below) - see PAN_MOMENTUM_* constants for the tuning.
  const panVelocitySampleRef = useRef<{ x: number; t: number } | null>(null);
  const panVelocityRef = useRef(0); // logical units of range-shift per millisecond
  const momentumRafRef = useRef<number | null>(null);
  // Right price-scale axis drag-to-zoom (see handlePointerDown's own comment on why this is
  // checked before anything else, and PRICE_SCALE_DRAG_SENSITIVITY below for the direction
  // convention).
  const priceScaleDragRef = useRef<{ startY: number; startRange: { from: number; to: number } } | null>(null);

  // Reload this pair's own saved drawings whenever pairId changes (a different pair is a wholly
  // different drawing set, same convention as the saved-layout feature on interval/indicators).
  useEffect(() => {
    setDrawings(loadDrawings(pairId));
    setSelectedId(null);
    setInProgress(null);
    setActiveToolState('cursor');
    undoStackRef.current = [];
    redoStackRef.current = [];
  }, [pairId]);

  /** The single choke point for every COMMITTED mutation - pushes the PREVIOUS state onto the undo
   *  stack, clears redo (a new action invalidates whatever was "ahead"), then persists. Never
   *  called for the live-updating preview during an active drag (see handlePointerMove) - only
   *  once, when that drag/edit actually finishes. */
  const persist = useCallback((next: DrawingObject[]) => {
    undoStackRef.current = [...undoStackRef.current, drawingsRef.current];
    redoStackRef.current = [];
    setDrawings(next);
    saveDrawings(pairId, next);
    setHistoryTick((t) => t + 1);
  }, [pairId]);

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const previous = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, drawingsRef.current];
    setDrawings(previous);
    saveDrawings(pairId, previous);
    setSelectedId(null);
    setHistoryTick((t) => t + 1);
  }, [pairId]);

  const redo = useCallback(() => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const next = stack[stack.length - 1];
    redoStackRef.current = stack.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, drawingsRef.current];
    setDrawings(next);
    saveDrawings(pairId, next);
    setSelectedId(null);
    setHistoryTick((t) => t + 1);
  }, [pairId]);

  const setActiveTool = useCallback((tool: DrawingTool) => {
    setInProgress(null);
    setPreviewPoint(null);
    setSelectedId(null);
    setActiveToolState(tool);
  }, []);

  // --- coordinate conversion -------------------------------------------------------------------

  const pixelToData = useCallback((x: number, y: number): DrawingPoint | null => {
    if (!chart || !series) return null;
    const time = chart.timeScale().coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    if (time === null || price === null) return null;
    return { time: time as unknown as number, price };
  }, [chart, series]);

  const dataToPixel = useCallback((p: DrawingPoint): PixelPoint | null => {
    if (!chart || !series) return null;
    const x = chart.timeScale().timeToCoordinate(p.time as UTCTimestamp);
    const y = series.priceToCoordinate(p.price);
    if (x === null || y === null) return null;
    return { x, y };
  }, [chart, series]);

  /** Magnet mode: snap a candidate data-point to the nearest bar's nearest OHLC value within a
   *  small pixel radius - a real, useful snap (not a decorative toggle), same convention
   *  TradingView's own magnet mode follows. Only applies when magnetMode is on; a miss (nothing
   *  close enough) returns the original point unchanged. */
  const applyMagnet = useCallback((p: DrawingPoint): DrawingPoint => {
    if (!magnetModeRef.current || barsRef.current.length === 0) return p;
    let nearestBar = barsRef.current[0];
    let nearestTimeDiff = Math.abs((nearestBar.time as number) - p.time);
    for (const bar of barsRef.current) {
      const diff = Math.abs((bar.time as number) - p.time);
      if (diff < nearestTimeDiff) { nearestTimeDiff = diff; nearestBar = bar; }
    }
    const candidates = [nearestBar.open, nearestBar.high, nearestBar.low, nearestBar.close];
    let nearestPrice = candidates[0];
    let nearestPriceDiff = Math.abs(candidates[0] - p.price);
    for (const c of candidates) {
      const diff = Math.abs(c - p.price);
      if (diff < nearestPriceDiff) { nearestPriceDiff = diff; nearestPrice = c; }
    }
    return { time: nearestBar.time as number, price: nearestPrice };
  }, []);

  // --- hit testing -------------------------------------------------------------------------------

  /** Returns the hit drawing (topmost/most-recent wins) and which part was hit ('body' or a point
   *  index), or null. Pure pixel-space test - callers already converted the click to pixels. */
  const hitTest = useCallback((mouse: PixelPoint): { drawing: DrawingObject; part: number | 'body' } | null => {
    const list = drawingsRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      if (d.hidden) continue;
      const pixelPoints = d.points.map(dataToPixel).filter((p): p is PixelPoint => p !== null);
      if (pixelPoints.length === 0) continue;

      // Brush/highlighter skip individual-point hit-testing entirely - a 100+ point freehand
      // stroke's own sample points aren't meaningful drag handles, so the whole stroke is only
      // ever selected/dragged as one rigid body (the bodyHit branch below), never reshaped by one
      // point.
      if (d.tool !== 'brush' && d.tool !== 'highlighter') {
        for (let pi = 0; pi < pixelPoints.length; pi++) {
          if (Math.hypot(mouse.x - pixelPoints[pi].x, mouse.y - pixelPoints[pi].y) <= ENDPOINT_HIT_RADIUS) {
            return { drawing: d, part: pi };
          }
        }
      }

      let bodyHit = false;
      if ((d.tool === 'horizontalLine' || d.tool === 'priceLabel') && pixelPoints[0]) {
        bodyHit = distanceToHorizontalLine(mouse, pixelPoints[0].y) <= BODY_HIT_TOLERANCE;
      } else if (d.tool === 'horizontalRay' && pixelPoints[0]) {
        bodyHit = mouse.x >= pixelPoints[0].x - BODY_HIT_TOLERANCE && distanceToHorizontalLine(mouse, pixelPoints[0].y) <= BODY_HIT_TOLERANCE;
      } else if (d.tool === 'verticalLine' && pixelPoints[0]) {
        bodyHit = distanceToVerticalLine(mouse, pixelPoints[0].x) <= BODY_HIT_TOLERANCE;
      } else if (d.tool === 'crossline' && pixelPoints[0]) {
        bodyHit = distanceToHorizontalLine(mouse, pixelPoints[0].y) <= BODY_HIT_TOLERANCE
          || distanceToVerticalLine(mouse, pixelPoints[0].x) <= BODY_HIT_TOLERANCE;
      } else if ((d.tool === 'text' || d.tool === 'note') && pixelPoints[0]) {
        bodyHit = Math.hypot(mouse.x - pixelPoints[0].x, mouse.y - pixelPoints[0].y) <= 20;
      } else if (
        (d.tool === 'arrowMarker' || d.tool === 'flagMark' || d.tool === 'pin' || d.tool === 'callout' || d.tool === 'signpost') &&
        pixelPoints[0]
      ) {
        // Same radius-around-the-anchor convention as text/note above - every one of these tools
        // is a small icon (plus, for callout/signpost, a short text label) anchored to one point.
        bodyHit = Math.hypot(mouse.x - pixelPoints[0].x, mouse.y - pixelPoints[0].y) <= 24;
      } else if (d.tool === 'ray' && pixelPoints.length === 2) {
        bodyHit = distanceToRay(mouse, pixelPoints[0], pixelPoints[1]) <= BODY_HIT_TOLERANCE;
      } else if (d.tool === 'extendedLine' && pixelPoints.length === 2) {
        bodyHit = distanceToLine(mouse, pixelPoints[0], pixelPoints[1]) <= BODY_HIT_TOLERANCE;
      } else if (d.tool === 'rectangle' && pixelPoints.length === 2) {
        bodyHit = isNearRectangle(mouse, pixelPoints[0], pixelPoints[1], BODY_HIT_TOLERANCE);
      } else if ((d.tool === 'circle' || d.tool === 'ellipse') && pixelPoints.length === 2) {
        bodyHit = isNearEllipseBorder(mouse, pixelPoints[0], pixelPoints[1], BODY_HIT_TOLERANCE);
      } else if (d.tool === 'triangle' && pixelPoints.length === 3) {
        bodyHit = distanceToTriangleBorder(mouse, pixelPoints[0], pixelPoints[1], pixelPoints[2]) <= BODY_HIT_TOLERANCE;
      } else if (d.tool === 'polyline' && pixelPoints.length >= 2) {
        bodyHit = distanceToPolyline(mouse, pixelPoints) <= BODY_HIT_TOLERANCE;
      } else if (d.tool === 'brush' && pixelPoints.length >= 2) {
        bodyHit = distanceToPolyline(mouse, pixelPoints) <= BODY_HIT_TOLERANCE;
      } else if (d.tool === 'highlighter' && pixelPoints.length >= 2) {
        // Wider hit band than brush - matches the visually thicker highlighter stroke (4x lineWidth
        // in drawOne above), so clicking anywhere on the visible marker actually selects it.
        bodyHit = distanceToPolyline(mouse, pixelPoints) <= BODY_HIT_TOLERANCE * 3;
      } else if (d.tool === 'parallelChannel' && pixelPoints.length === 3) {
        const offsetPx = offsetPointsForChannel(pixelPoints[0], pixelPoints[1], pixelPoints[2]);
        bodyHit = distanceToSegment(mouse, pixelPoints[0], pixelPoints[1]) <= BODY_HIT_TOLERANCE
          || distanceToSegment(mouse, offsetPx[0], offsetPx[1]) <= BODY_HIT_TOLERANCE;
      } else if (d.tool === 'disjointChannel' && pixelPoints.length === 4) {
        bodyHit = distanceToSegment(mouse, pixelPoints[0], pixelPoints[1]) <= BODY_HIT_TOLERANCE
          || distanceToSegment(mouse, pixelPoints[2], pixelPoints[3]) <= BODY_HIT_TOLERANCE;
      } else if (d.tool === 'regressionTrend' && pixelPoints.length === 2) {
        // Approximation: hit-tests the raw anchor-click segment, not the exact fitted regression
        // line (which can diverge from the two raw clicks once real bar closes are averaged in) -
        // disclosed simplification, same spirit as fibChannel's own approximate pixel-offset math
        // above, appropriate for this tool's Tier 2/lowest-priority scope.
        bodyHit = distanceToSegment(mouse, pixelPoints[0], pixelPoints[1]) <= BODY_HIT_TOLERANCE;
      } else if (d.tool === 'fibChannel' && pixelPoints.length === 2) {
        // Any of the fib-ratio parallel lines counts as a hit, not just the base trendline.
        bodyHit = FIB_LEVELS.some((ratio) => {
          const off = channelOffsetPx(pixelPoints[0], pixelPoints[1], ratio);
          return distanceToSegment(mouse, off[0], off[1]) <= BODY_HIT_TOLERANCE;
        });
      } else if (d.tool === 'fibCircles' && pixelPoints.length === 2) {
        const baseRadius = Math.hypot(pixelPoints[1].x - pixelPoints[0].x, pixelPoints[1].y - pixelPoints[0].y);
        bodyHit = FIB_CIRCLE_ARC_RATIOS.some((ratio) => {
          const distFromCenter = Math.hypot(mouse.x - pixelPoints[0].x, mouse.y - pixelPoints[0].y);
          return Math.abs(distFromCenter - baseRadius * ratio) <= BODY_HIT_TOLERANCE;
        });
      } else if (d.tool === 'fibArcs' && pixelPoints.length === 2) {
        const baseRadius = Math.hypot(pixelPoints[1].x - pixelPoints[0].x, pixelPoints[1].y - pixelPoints[0].y);
        bodyHit = FIB_CIRCLE_ARC_RATIOS.some((ratio) => {
          const distFromCenter = Math.hypot(mouse.x - pixelPoints[1].x, mouse.y - pixelPoints[1].y);
          return Math.abs(distFromCenter - baseRadius * ratio) <= BODY_HIT_TOLERANCE;
        });
      } else if (d.tool === 'fibSpeedFan' && pixelPoints.length === 2) {
        const verticalHeight = pixelPoints[1].y - pixelPoints[0].y;
        bodyHit = FIB_SPEED_FAN_RATIOS.some((ratio) => {
          const divisionPoint = { x: pixelPoints[1].x, y: pixelPoints[0].y + ratio * verticalHeight };
          return distanceToSegment(mouse, pixelPoints[0], divisionPoint) <= BODY_HIT_TOLERANCE;
        });
      } else if (d.tool === 'fibTimeZone' && pixelPoints.length === 2) {
        const pixelUnit = pixelPoints[1].x - pixelPoints[0].x;
        bodyHit = FIB_TIME_ZONE_MULTIPLES.some((mult) => {
          const x = pixelPoints[0].x + mult * pixelUnit;
          return distanceToVerticalLine(mouse, x) <= BODY_HIT_TOLERANCE;
        });
      } else if (d.tool === 'fibSpiral' && pixelPoints.length === 2) {
        bodyHit = distanceToPolyline(mouse, fibSpiralPixelPoints(pixelPoints[0], pixelPoints[1])) <= BODY_HIT_TOLERANCE;
      } else if (d.tool === 'position' && pixelPoints.length >= 2) {
        bodyHit = distanceToHorizontalLine(mouse, pixelPoints[0].y) <= BODY_HIT_TOLERANCE
          || distanceToHorizontalLine(mouse, pixelPoints[1].y) <= BODY_HIT_TOLERANCE
          || (pixelPoints[2] && distanceToHorizontalLine(mouse, pixelPoints[2].y) <= BODY_HIT_TOLERANCE);
      } else if (pixelPoints.length === 2) {
        // trendline, fibRetracement, fibExtension, measure - hit-test the connecting segment.
        bodyHit = distanceToSegment(mouse, pixelPoints[0], pixelPoints[1]) <= BODY_HIT_TOLERANCE;
      }
      if (bodyHit) return { drawing: d, part: 'body' };
    }
    return null;
  }, [dataToPixel]);

  // --- rendering -----------------------------------------------------------------------------

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !chart || !series) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const paneWidth = rect.width;
    const paneHeight = rect.height;

    const drawOne = (
      d: Pick<DrawingObject, 'tool' | 'points' | 'text' | 'color' | 'lineWidth' | 'positionDirection'>,
      isSelected: boolean,
      isPreview: boolean
    ) => {
      const pts = d.points.map(dataToPixel);
      if (pts.some((p) => p === null)) return;
      const px = pts as PixelPoint[];

      ctx.save();
      ctx.strokeStyle = d.color;
      ctx.fillStyle = d.color;
      ctx.lineWidth = d.lineWidth;
      if (isPreview) ctx.setLineDash([5, 4]);

      if (d.tool === 'trendline') {
        strokeLine(ctx, px[0], px[1]);
      } else if (d.tool === 'trendAngle') {
        strokeLine(ctx, px[0], px[1]);
        // Screen-space angle (matches TradingView's own Trend Angle tool - recomputed from
        // current pixel geometry every render, so it tracks pan/zoom, not a fixed data-space
        // slope, which price and time units can't meaningfully share as one angle anyway).
        const dx = px[1].x - px[0].x;
        const dy = px[1].y - px[0].y;
        const angleDeg = Math.atan2(-dy, dx) * (180 / Math.PI);
        drawLabelBadge(ctx, `${angleDeg.toFixed(1)}°`, (px[0].x + px[1].x) / 2, (px[0].y + px[1].y) / 2 - 4);
      } else if (d.tool === 'ray') {
        strokeLine(ctx, px[0], extendPastPoint(px[0], px[1], paneWidth, paneHeight));
      } else if (d.tool === 'extendedLine') {
        const far1 = extendPastPoint(px[1], px[0], paneWidth, paneHeight);
        const far2 = extendPastPoint(px[0], px[1], paneWidth, paneHeight);
        strokeLine(ctx, far1, far2);
      } else if (d.tool === 'horizontalLine') {
        strokeLine(ctx, { x: 0, y: px[0].y }, { x: paneWidth, y: px[0].y });
      } else if (d.tool === 'horizontalRay') {
        strokeLine(ctx, px[0], { x: paneWidth, y: px[0].y });
      } else if (d.tool === 'verticalLine') {
        strokeLine(ctx, { x: px[0].x, y: 0 }, { x: px[0].x, y: paneHeight });
      } else if (d.tool === 'crossline') {
        strokeLine(ctx, { x: 0, y: px[0].y }, { x: paneWidth, y: px[0].y });
        strokeLine(ctx, { x: px[0].x, y: 0 }, { x: px[0].x, y: paneHeight });
      } else if (d.tool === 'rectangle') {
        strokeFilledRect(ctx, px[0], px[1]);
      } else if (d.tool === 'circle' || d.tool === 'ellipse') {
        const cx = (px[0].x + px[1].x) / 2;
        const cy = (px[0].y + px[1].y) / 2;
        let rx = Math.abs(px[1].x - px[0].x) / 2;
        let ry = Math.abs(px[1].y - px[0].y) / 2;
        if (d.tool === 'circle') rx = ry = Math.min(rx, ry); // equal radii in PIXEL space, matching how it looks drawn, not data units
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.globalAlpha = 0.12;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
      } else if (d.tool === 'triangle') {
        ctx.beginPath();
        ctx.moveTo(px[0].x, px[0].y);
        ctx.lineTo(px[1].x, px[1].y);
        ctx.lineTo(px[2].x, px[2].y);
        ctx.closePath();
        ctx.globalAlpha = 0.12;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
      } else if (d.tool === 'polyline') {
        ctx.beginPath();
        ctx.moveTo(px[0].x, px[0].y);
        for (let i = 1; i < px.length; i++) ctx.lineTo(px[i].x, px[i].y);
        ctx.stroke();
      } else if (d.tool === 'brush' && px.length >= 2) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(px[0].x, px[0].y);
        for (let i = 1; i < px.length; i++) ctx.lineTo(px[i].x, px[i].y);
        ctx.stroke();
      } else if (d.tool === 'highlighter' && px.length >= 2) {
        // Thicker, semi-transparent marker-style stroke - the one visual difference from brush.
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = d.lineWidth * 4;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(px[0].x, px[0].y);
        for (let i = 1; i < px.length; i++) ctx.lineTo(px[i].x, px[i].y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (d.tool === 'parallelChannel' && px.length === 3) {
        strokeLine(ctx, px[0], px[1]);
        const off = offsetPointsForChannel(px[0], px[1], px[2]);
        strokeLine(ctx, off[0], off[1]);
      } else if (d.tool === 'disjointChannel' && px.length === 4) {
        // Unlike parallelChannel, the second line is a genuinely INDEPENDENT trendline (its own 2
        // clicks), not derived by offsetting the first - so the two edges don't have to be
        // parallel, matching TradingView's own "Disjoint Channel" tool.
        strokeLine(ctx, px[0], px[1]);
        strokeLine(ctx, px[2], px[3]);
      } else if (d.tool === 'regressionTrend') {
        // The two clicks only define a TIME range (their price values are ignored) - the actual
        // line is a real least-squares linear regression fit over every real bar's close in that
        // range, recomputed here from barsRef.current rather than baked into `points` at creation,
        // so it stays accurate as more bars close within an already-drawn range. Skipped (nothing
        // drawn) if there's fewer than 2 real bars in range - not an error, just nothing to fit yet.
        const t0 = Math.min(d.points[0].time, d.points[1].time);
        const t1 = Math.max(d.points[0].time, d.points[1].time);
        const rangeBars = barsRef.current.filter((b) => (b.time as number) >= t0 && (b.time as number) <= t1);
        const reg = linearRegression(rangeBars.map((b) => b.close));
        if (reg && rangeBars.length >= 2) {
          const firstBar = rangeBars[0];
          const lastBar = rangeBars[rangeBars.length - 1];
          const yFirst = reg.intercept;
          const yLast = reg.slope * (rangeBars.length - 1) + reg.intercept;
          const pxFirst = dataToPixel({ time: firstBar.time as number, price: yFirst });
          const pxLast = dataToPixel({ time: lastBar.time as number, price: yLast });
          if (pxFirst && pxLast) {
            strokeLine(ctx, pxFirst, pxLast);
            // +/-1 stdev channel, dashed to visually read as a band rather than a third trendline.
            const pxFirstUp = dataToPixel({ time: firstBar.time as number, price: yFirst + reg.stdev });
            const pxLastUp = dataToPixel({ time: lastBar.time as number, price: yLast + reg.stdev });
            const pxFirstDown = dataToPixel({ time: firstBar.time as number, price: yFirst - reg.stdev });
            const pxLastDown = dataToPixel({ time: lastBar.time as number, price: yLast - reg.stdev });
            ctx.setLineDash([4, 3]);
            if (pxFirstUp && pxLastUp) strokeLine(ctx, pxFirstUp, pxLastUp);
            if (pxFirstDown && pxLastDown) strokeLine(ctx, pxFirstDown, pxLastDown);
            ctx.setLineDash(isPreview ? [5, 4] : []);
          }
        }
      } else if (d.tool === 'fibRetracement' || d.tool === 'fibExtension') {
        const priceA = d.points[0].price;
        const priceB = d.points[1].price;
        const left = Math.min(px[0].x, px[1].x);
        const rightAnchor = Math.max(px[0].x, px[1].x);
        const right = d.tool === 'fibExtension' ? paneWidth : rightAnchor; // extension levels read as forward projections, so extend to the pane edge
        const levels = d.tool === 'fibExtension' ? FIB_EXTENSION_LEVELS : FIB_LEVELS;
        for (const ratio of levels) {
          const levelPrice = fibLevelPrice(priceA, priceB, ratio);
          const y = series.priceToCoordinate(levelPrice);
          if (y === null) continue;
          strokeLine(ctx, { x: left, y }, { x: right, y });
          ctx.font = '10px ui-monospace, monospace';
          ctx.fillText(`${(ratio * 100).toFixed(1)}%  ${levelPrice.toFixed(digits)}`, right - (d.tool === 'fibExtension' ? 90 : -4), y - 3);
        }
      } else if (d.tool === 'fibChannel') {
        for (const ratio of FIB_LEVELS) {
          const off = channelOffsetPx(px[0], px[1], ratio);
          strokeLine(ctx, off[0], off[1]);
        }
      } else if (d.tool === 'fibCircles') {
        // Centered at the FIRST anchor (the swing start) - concentric, visually round on screen
        // (equal x/y pixel radius, same convention the plain 'circle' tool already uses), at
        // Fibonacci ratios of the two anchors' own pixel distance.
        const baseRadius = Math.hypot(px[1].x - px[0].x, px[1].y - px[0].y);
        for (const ratio of FIB_CIRCLE_ARC_RATIOS) {
          const r = baseRadius * ratio;
          if (r <= 0) continue;
          ctx.beginPath();
          ctx.ellipse(px[0].x, px[0].y, r, r, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.font = '9px ui-monospace, monospace';
          ctx.fillText(`${(ratio * 100).toFixed(1)}%`, px[0].x + r + 3, px[0].y - 3);
        }
      } else if (d.tool === 'fibArcs') {
        // Same math as fibCircles, but centered at the SECOND anchor (the swing end) instead - the
        // one real distinguishing convention between the two tools kept here (see drawingTypes.ts's
        // own comment on the pixel-space simplification both share).
        const baseRadius = Math.hypot(px[1].x - px[0].x, px[1].y - px[0].y);
        for (const ratio of FIB_CIRCLE_ARC_RATIOS) {
          const r = baseRadius * ratio;
          if (r <= 0) continue;
          ctx.beginPath();
          ctx.ellipse(px[1].x, px[1].y, r, r, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.font = '9px ui-monospace, monospace';
          ctx.fillText(`${(ratio * 100).toFixed(1)}%`, px[1].x + r + 3, px[1].y - 3);
        }
      } else if (d.tool === 'fibSpeedFan') {
        // Classic construction: divide the vertical (price) distance between the two anchors into
        // eighths/thirds, then fan trend lines out from the FIRST anchor to each division point on
        // the SECOND anchor's own time (x position) - same simplified pixel-space math as the other
        // two fib tools above.
        const verticalHeight = px[1].y - px[0].y;
        for (const ratio of FIB_SPEED_FAN_RATIOS) {
          const divisionPoint = { x: px[1].x, y: px[0].y + ratio * verticalHeight };
          strokeLine(ctx, px[0], divisionPoint);
          ctx.font = '9px ui-monospace, monospace';
          ctx.fillText(`${(ratio * 100).toFixed(1)}%`, divisionPoint.x + 3, divisionPoint.y - 3);
        }
      } else if (d.tool === 'fibTimeZone') {
        // Vertical lines at Fibonacci multiples of the two anchors' own pixel X distance -
        // extrapolated in pure PIXEL space (pixelUnit below), not by re-deriving a coordinate for
        // each multiple's real TIME through the chart API - see drawingTypes.ts's own comment on
        // why (timeToCoordinate returns null past the last known bar, confirmed for real).
        const pixelUnit = px[1].x - px[0].x;
        for (const mult of FIB_TIME_ZONE_MULTIPLES) {
          const x = px[0].x + mult * pixelUnit;
          strokeLine(ctx, { x, y: 0 }, { x, y: paneHeight });
          ctx.font = '9px ui-monospace, monospace';
          ctx.fillText(String(mult), x + 3, 12);
        }
      } else if (d.tool === 'fibSpiral') {
        const spiralPts = fibSpiralPixelPoints(px[0], px[1]);
        ctx.beginPath();
        ctx.moveTo(spiralPts[0].x, spiralPts[0].y);
        for (let i = 1; i < spiralPts.length; i++) ctx.lineTo(spiralPts[i].x, spiralPts[i].y);
        ctx.stroke();
      } else if (d.tool === 'text') {
        ctx.font = 'bold 12px ui-monospace, monospace';
        ctx.fillText(d.text || '', px[0].x + 4, px[0].y - 4);
      } else if (d.tool === 'note') {
        ctx.beginPath();
        ctx.arc(px[0].x, px[0].y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = 'bold 11px ui-monospace, monospace';
        const label = d.text || '';
        const metrics = ctx.measureText(label);
        ctx.globalAlpha = 0.9;
        ctx.fillRect(px[0].x + 8, px[0].y - 20, metrics.width + 10, 18);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#0B0B0B';
        ctx.fillText(label, px[0].x + 13, px[0].y - 7);
      } else if (d.tool === 'priceLabel') {
        const label = d.points[0].price.toFixed(digits);
        ctx.font = 'bold 11px ui-monospace, monospace';
        const metrics = ctx.measureText(label);
        strokeLine(ctx, { x: 0, y: px[0].y }, { x: paneWidth, y: px[0].y });
        ctx.globalAlpha = 0.9;
        ctx.fillRect(px[0].x - metrics.width / 2 - 5, px[0].y - 9, metrics.width + 10, 18);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#0B0B0B';
        ctx.fillText(label, px[0].x - metrics.width / 2, px[0].y + 4);
      } else if (d.tool === 'arrowMarker') {
        // A simple filled up-arrow anchored so its TIP sits at the clicked point - matches how a
        // reader clicks "on" the candle/level they mean to mark.
        ctx.beginPath();
        ctx.moveTo(px[0].x, px[0].y - 10);
        ctx.lineTo(px[0].x - 6, px[0].y + 2);
        ctx.lineTo(px[0].x - 2, px[0].y + 2);
        ctx.lineTo(px[0].x - 2, px[0].y + 10);
        ctx.lineTo(px[0].x + 2, px[0].y + 10);
        ctx.lineTo(px[0].x + 2, px[0].y + 2);
        ctx.lineTo(px[0].x + 6, px[0].y + 2);
        ctx.closePath();
        ctx.fill();
      } else if (d.tool === 'flagMark') {
        strokeLine(ctx, { x: px[0].x, y: px[0].y }, { x: px[0].x, y: px[0].y - 18 });
        ctx.beginPath();
        ctx.moveTo(px[0].x, px[0].y - 18);
        ctx.lineTo(px[0].x + 14, px[0].y - 14);
        ctx.lineTo(px[0].x, px[0].y - 10);
        ctx.closePath();
        ctx.fill();
      } else if (d.tool === 'pin') {
        // Map-pin silhouette: a round head above the anchor with a triangular tip pointing
        // exactly at the clicked point, same "tip = the real anchor" convention as arrowMarker.
        ctx.beginPath();
        ctx.arc(px[0].x, px[0].y - 12, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(px[0].x - 4, px[0].y - 8);
        ctx.lineTo(px[0].x, px[0].y);
        ctx.lineTo(px[0].x + 4, px[0].y - 8);
        ctx.closePath();
        ctx.fill();
      } else if (d.tool === 'callout') {
        const label = d.text || '';
        ctx.font = 'bold 11px ui-monospace, monospace';
        const metrics = ctx.measureText(label);
        const bubbleX = px[0].x + 8;
        const bubbleY = px[0].y - 26;
        const bubbleW = metrics.width + 12;
        const bubbleH = 20;
        ctx.globalAlpha = 0.92;
        ctx.fillRect(bubbleX, bubbleY, bubbleW, bubbleH);
        // Pointer tail from the bubble's bottom-left corner back to the real anchor point - the
        // one visual difference from 'note' (a plain bubble with no tail).
        ctx.beginPath();
        ctx.moveTo(bubbleX, bubbleY + bubbleH);
        ctx.lineTo(bubbleX + 10, bubbleY + bubbleH);
        ctx.lineTo(px[0].x, px[0].y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#0B0B0B';
        ctx.fillText(label, bubbleX + 6, bubbleY + bubbleH - 6);
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(px[0].x, px[0].y, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (d.tool === 'signpost') {
        const label = d.text || '';
        ctx.font = 'bold 11px ui-monospace, monospace';
        const metrics = ctx.measureText(label);
        const poleTopY = px[0].y - 24;
        strokeLine(ctx, { x: px[0].x, y: px[0].y }, { x: px[0].x, y: poleTopY });
        const boxW = metrics.width + 14;
        const boxH = 18;
        ctx.beginPath();
        ctx.moveTo(px[0].x, poleTopY);
        ctx.lineTo(px[0].x + 8, poleTopY - boxH / 2);
        ctx.lineTo(px[0].x + 8 + boxW, poleTopY - boxH / 2);
        ctx.lineTo(px[0].x + 8 + boxW, poleTopY + boxH / 2);
        ctx.lineTo(px[0].x + 8, poleTopY + boxH / 2);
        ctx.closePath();
        ctx.globalAlpha = 0.92;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#0B0B0B';
        ctx.fillText(label, px[0].x + 14, poleTopY + 4);
      } else if (d.tool === 'measure') {
        strokeLine(ctx, px[0], px[1]);
        const priceDelta = d.points[1].price - d.points[0].price;
        const pct = pctChange(d.points[0].price, d.points[1].price);
        const barsCount = barsRef.current.filter((b) => (b.time as number) >= Math.min(d.points[0].time, d.points[1].time) && (b.time as number) <= Math.max(d.points[0].time, d.points[1].time)).length;
        const midX = (px[0].x + px[1].x) / 2;
        const midY = (px[0].y + px[1].y) / 2;
        const label = `${priceDelta >= 0 ? '+' : ''}${priceDelta.toFixed(digits)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)  ${barsCount} bar${barsCount === 1 ? '' : 's'}`;
        drawLabelBadge(ctx, label, midX, midY - 4);
      } else if (d.tool === 'position' && px.length >= 2) {
        const entryPx = px[0];
        const stopPx = px[1];
        const takeProfitPx = px[2];
        const isLong = d.positionDirection === 'long';
        const riskColor = '#FF4D4F';
        const rewardColor = '#2ECC71';
        const left = Math.min(entryPx.x, stopPx.x, takeProfitPx?.x ?? entryPx.x);
        const right = Math.max(entryPx.x, stopPx.x, takeProfitPx?.x ?? entryPx.x) + 60;
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = riskColor;
        ctx.fillRect(left, Math.min(entryPx.y, stopPx.y), right - left, Math.abs(stopPx.y - entryPx.y));
        if (takeProfitPx) {
          ctx.fillStyle = rewardColor;
          ctx.fillRect(left, Math.min(entryPx.y, takeProfitPx.y), right - left, Math.abs(takeProfitPx.y - entryPx.y));
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = d.color;
        strokeLine(ctx, { x: left, y: entryPx.y }, { x: right, y: entryPx.y });
        ctx.strokeStyle = riskColor;
        ctx.setLineDash([4, 3]);
        strokeLine(ctx, { x: left, y: stopPx.y }, { x: right, y: stopPx.y });
        if (takeProfitPx) {
          ctx.strokeStyle = rewardColor;
          strokeLine(ctx, { x: left, y: takeProfitPx.y }, { x: right, y: takeProfitPx.y });
        }
        ctx.setLineDash([]);
        if (takeProfitPx) {
          const riskDist = Math.abs(d.points[0].price - d.points[1].price);
          const rewardDist = Math.abs(d.points[2].price - d.points[0].price);
          const rr = riskDist > 0 ? rewardDist / riskDist : 0;
          ctx.fillStyle = '#fff';
          const label = `${isLong ? 'LONG' : 'SHORT'}  R:R ${rr.toFixed(2)}`;
          drawLabelBadge(ctx, label, (left + right) / 2, entryPx.y - 12);
        }
      }

      // Brush/highlighter skip per-point handles - a 100+ point freehand stroke's own sample
      // points aren't meaningful drag targets (see hitTest's own matching skip below), so drawing
      // a little square at every one of them would just be visual noise, not usable UI.
      if (isSelected && d.tool !== 'brush' && d.tool !== 'highlighter') {
        ctx.fillStyle = d.color;
        for (const p of px) {
          ctx.fillRect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        }
      }
      ctx.restore();
    };

    for (const d of drawingsRef.current) {
      if (d.hidden) continue;
      drawOne(d, d.id === selectedIdRef.current, false);
    }

    if (inProgressRef.current) {
      const ip = inProgressRef.current;
      const pts = previewPoint ? [...ip.points, previewPoint] : ip.points;
      const requiredClicks = TOOL_CLICK_COUNT[ip.tool];
      const minPointsToDraw = ip.tool === 'polyline' || ip.tool === 'brush' || ip.tool === 'highlighter' ? 1 : ONE_CLICK_TOOLS.has(ip.tool) ? 1 : 2;
      if (pts.length >= minPointsToDraw && (requiredClicks === null || pts.length <= requiredClicks)) {
        drawOne({ tool: ip.tool, points: pts, color: DEFAULT_DRAWING_COLOR, lineWidth: DEFAULT_DRAWING_LINE_WIDTH }, false, true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, series, dataToPixel, digits, previewPoint]);

  useEffect(() => { redraw(); }, [redraw, drawings, selectedId, inProgress, previewPoint]);

  // Redraw whenever the visible range changes (pan/zoom) - drawings are anchored in data space so
  // their PIXEL position must be recomputed, not just left as-is.
  useEffect(() => {
    if (!chart) return;
    const handler = () => redraw();
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, [chart, redraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redraw]);

  // --- mouse interaction -----------------------------------------------------------------------

  const buildDrawing = useCallback((tool: Exclude<DrawingTool, 'cursor'>, points: DrawingPoint[], text?: string): DrawingObject => {
    const style = defaultStyleRef.current;
    const base: DrawingObject = {
      id: genId(), tool, points,
      color: style?.color ?? DEFAULT_DRAWING_COLOR, lineWidth: style?.lineWidth ?? DEFAULT_DRAWING_LINE_WIDTH,
      locked: false, hidden: false, createdAt: Date.now(),
    };
    if (text !== undefined) base.text = text;
    if (tool === 'position') {
      // Auto-computed take-profit: POSITION_DEFAULT_RR times the entry-to-stop risk distance, on
      // the profit side implied by where the stop landed (stop below entry = long = TP above;
      // stop above entry = short = TP below). Direction is derived ONCE here, not re-derived on
      // every render, so dragging the stop across entry later doesn't retroactively relabel it.
      const [entry, stop] = points;
      const isLong = stop.price < entry.price;
      const riskDist = Math.abs(entry.price - stop.price);
      const takeProfitPrice = isLong ? entry.price + riskDist * POSITION_DEFAULT_RR : entry.price - riskDist * POSITION_DEFAULT_RR;
      base.points = [entry, stop, { time: entry.time, price: takeProfitPrice }];
      base.positionDirection = isLong ? 'long' : 'short';
    }
    return base;
  }, []);

  // Only ever reached for the genuine multi-click tools (trendline/ray/extendedLine/rectangle/
  // circle/ellipse/triangle/fibRetracement/fibExtension/fibChannel/measure/parallelChannel/
  // position) - the ONE_CLICK_TOOLS set commits immediately in handlePointerDown below and never
  // sets `inProgress` at all.
  const commitInProgress = useCallback((finalPoint: DrawingPoint) => {
    const ip = inProgressRef.current;
    if (!ip) return;
    const newDrawing = buildDrawing(ip.tool, [...ip.points, finalPoint]);
    persist([...drawingsRef.current, newDrawing]);
    setInProgress(null);
    setPreviewPoint(null);
    setActiveToolState('cursor');
  }, [persist, buildDrawing]);

  const finishPolyline = useCallback(() => {
    const ip = inProgressRef.current;
    if (!ip || ip.tool !== 'polyline' || ip.points.length < 2) {
      setInProgress(null);
      setPreviewPoint(null);
      setActiveToolState('cursor');
      return;
    }
    persist([...drawingsRef.current, buildDrawing('polyline', ip.points)]);
    setInProgress(null);
    setPreviewPoint(null);
    setActiveToolState('cursor');
  }, [persist, buildDrawing]);

  // Cancels any in-flight momentum glide - any new pointer interaction (a fresh pan, a click, a
  // drawing tool, a price-scale drag) should stop it dead, not have the chart keep sliding
  // underneath whatever the reader is now doing.
  const stopMomentum = useCallback(() => {
    if (momentumRafRef.current !== null) {
      cancelAnimationFrame(momentumRafRef.current);
      momentumRafRef.current = null;
    }
    panVelocityRef.current = 0;
    panVelocitySampleRef.current = null;
  }, []);

  // Cancel any in-flight momentum glide on unmount - a dangling requestAnimationFrame calling
  // chart.timeScale() after the chart itself has been destroyed (pair switch, unmount) would throw.
  useEffect(() => stopMomentum, [stopMomentum]);

  const handlePointerDown = useCallback((clientX: number, clientY: number, canvasRect: DOMRect) => {
    stopMomentum();
    setContextMenu(null);
    const x = clientX - canvasRect.left;
    const y = clientY - canvasRect.top;

    // Right price-scale axis drag-to-zoom - checked FIRST of all, before even cursor-mode
    // hit-testing: the axis is a distinct interactive strip outside the plot area in every real
    // charting platform, so a drag starting there is never a drawing click or a plot pan,
    // regardless of which tool is currently active (same priority wheel-zoom already gets).
    if (series) {
      const priceScaleWidth = series.priceScale().width();
      if (priceScaleWidth > 0 && x >= canvasRect.width - priceScaleWidth) {
        const range = series.priceScale().getVisibleRange();
        if (range) priceScaleDragRef.current = { startY: y, startRange: { from: range.from, to: range.to } };
        return;
      }
    }

    // Cursor mode is checked next (still before requiring a valid data-space point - pixelToData below
    // bails to null for a lot of ordinary chart real-estate: the right-offset margin past the last
    // bar, the vertical margin above/below the visible price range, etc. - see pixelToData's own
    // comment). A pan/select gesture must still start from those "dead" pixels exactly like it does
    // in TradingView itself (drag-panning from the empty space next to the last candle is completely
    // normal) - selecting an existing drawing or starting a manual pan needs pixel space only, no
    // data-space conversion at all. This was the root cause of pan never engaging in practice: any
    // drag whose STARTING pixel happened to land in one of those dead zones silently no-op'd here.
    if (activeToolRef.current === 'cursor') {
      const hit = hitTest({ x, y });
      if (hit) {
        setSelectedId(hit.drawing.id);
        if (!hit.drawing.locked) {
          const rawData = pixelToData(x, y);
          if (rawData) {
            dragRef.current = { id: hit.drawing.id, pointIndex: hit.part, startDataPoint: applyMagnet(rawData), startPoints: hit.drawing.points };
          }
        }
      } else {
        setSelectedId(null);
        const chartInstance = chart;
        if (chartInstance) {
          const range = chartInstance.timeScale().getVisibleLogicalRange();
          if (range) panDragRef.current = { startX: x, startRange: { from: range.from, to: range.to } };
        }
      }
      return;
    }

    const rawData = pixelToData(x, y);
    if (!rawData) return;
    const data = applyMagnet(rawData);
    const tool = activeToolRef.current;

    if (DRAG_TOOLS.has(tool)) {
      // Freehand tools deliberately ignore magnet mode (snapping every sample point to the
      // nearest candle O/H/L/C would turn a smooth stroke into a jagged staircase) - use the
      // raw, unsnapped data point regardless of the global magnetMode toggle.
      setInProgress({ tool, points: [rawData] });
      dragDrawingActiveRef.current = true;
      lastDragCapturePixelRef.current = { x, y };
      return;
    }

    if (tool === 'polyline') {
      // Finishing a polyline needs a real double-click: same time window AND same spot - a
      // fast pair of ordinary clicks at two DIFFERENT points (completely normal when placing
      // polyline vertices quickly) must add a second vertex, not be misread as "done".
      const now = Date.now();
      const last = lastClickPosRef.current;
      const isSameSpot = !!last && Math.hypot(x - last.x, y - last.y) < ENDPOINT_HIT_RADIUS;
      const isDoubleClick = isSameSpot && now - lastClickAtRef.current < POLYLINE_DBLCLICK_MS && !!inProgressRef.current;
      lastClickAtRef.current = now;
      lastClickPosRef.current = { x, y };
      if (isDoubleClick) {
        finishPolyline();
        return;
      }
      if (!inProgressRef.current) {
        setInProgress({ tool, points: [data] });
      } else {
        setInProgress({ tool, points: [...inProgressRef.current.points, data] });
      }
      return;
    }

    if (ONE_CLICK_TOOLS.has(tool)) {
      if (TEXT_PROMPT_TOOLS.has(tool)) {
        const text = window.prompt('Text:', '');
        if (text) persist([...drawingsRef.current, buildDrawing(tool, [data], text)]);
      } else {
        persist([...drawingsRef.current, buildDrawing(tool, [data])]);
      }
      setActiveToolState('cursor');
      return;
    }

    const requiredClicks = TOOL_CLICK_COUNT[tool] ?? 2;
    if (!inProgressRef.current) {
      setInProgress({ tool, points: [data] });
    } else if (inProgressRef.current.points.length + 1 < requiredClicks) {
      setInProgress({ tool, points: [...inProgressRef.current.points, data] });
    } else {
      commitInProgress(data);
    }
  }, [pixelToData, applyMagnet, hitTest, commitInProgress, finishPolyline, persist, buildDrawing, chart, series, stopMomentum]);

  const handlePointerMove = useCallback((clientX: number, clientY: number, canvasRect: DOMRect) => {
    const x = clientX - canvasRect.left;
    const y = clientY - canvasRect.top;
    const rawData = pixelToData(x, y);

    if (dragDrawingActiveRef.current && inProgressRef.current && rawData) {
      // Appends every sample point directly to inProgress.points (not the previewPoint mechanism
      // every other in-progress tool uses below) - the accumulated path itself IS the live preview
      // for a freehand stroke. Distance-throttled so a fast stroke doesn't queue a state update on
      // literally every mousemove event.
      const last = lastDragCapturePixelRef.current;
      if (!last || Math.hypot(x - last.x, y - last.y) >= DRAG_CAPTURE_MIN_DISTANCE_PX) {
        lastDragCapturePixelRef.current = { x, y };
        setInProgress({ tool: inProgressRef.current.tool, points: [...inProgressRef.current.points, rawData] });
      }
      return;
    }

    if (inProgressRef.current && rawData) {
      setPreviewPoint(applyMagnet(rawData));
      return;
    }

    if (dragRef.current && rawData) {
      const drag = dragRef.current;
      const data = applyMagnet(rawData);
      const list = drawingsRef.current;
      const idx = list.findIndex((d) => d.id === drag.id);
      if (idx === -1) return;
      const target = list[idx];
      let newPoints: DrawingPoint[];
      if (drag.pointIndex === 'body') {
        const dt = data.time - drag.startDataPoint.time;
        const dp = data.price - drag.startDataPoint.price;
        newPoints = drag.startPoints.map((p) => ({ time: p.time + dt, price: p.price + dp }));
      } else {
        newPoints = target.points.map((p, i) => (i === drag.pointIndex ? data : p));
      }
      const next = [...list];
      next[idx] = { ...target, points: newPoints };
      setDrawings(next); // live-update while dragging; persisted (localStorage + undo history) on pointer-up
      return;
    }

    if (panDragRef.current && chart) {
      const deltaPx = x - panDragRef.current.startX;
      const paneWidth = canvasRef.current?.getBoundingClientRect().width || 1;
      const rangeWidth = panDragRef.current.startRange.to - panDragRef.current.startRange.from;
      const deltaLogical = (deltaPx / paneWidth) * rangeWidth;
      chart.timeScale().setVisibleLogicalRange({
        from: panDragRef.current.startRange.from - deltaLogical,
        to: panDragRef.current.startRange.to - deltaLogical,
      });

      // Momentum velocity sampling - an EMA of "how many logical units per ms is range.from
      // currently shifting by", so a release mid-fast-drag can continue that same motion (see
      // handlePointerUp's launch and stepMomentum below). Deliberately independent of React
      // render timing (performance.now(), not a state update) - matches this whole pan
      // implementation's own "no React round-trip in the hot path" convention.
      const now = performance.now();
      const lastSample = panVelocitySampleRef.current;
      if (lastSample) {
        const dt = now - lastSample.t;
        if (dt > 0) {
          const dxPx = x - lastSample.x;
          const instVelocity = -((dxPx / paneWidth) * rangeWidth) / dt;
          panVelocityRef.current =
            panVelocityRef.current * (1 - PAN_MOMENTUM_VELOCITY_SMOOTHING) + instVelocity * PAN_MOMENTUM_VELOCITY_SMOOTHING;
        }
      }
      panVelocitySampleRef.current = { x, t: now };
      return;
    }

    if (priceScaleDragRef.current && series) {
      const drag = priceScaleDragRef.current;
      const deltaY = y - drag.startY;
      const rangeHeight = drag.startRange.to - drag.startRange.from;
      const factor = Math.exp(deltaY * PRICE_SCALE_DRAG_SENSITIVITY);
      const mid = (drag.startRange.from + drag.startRange.to) / 2;
      const newHalf = Math.max(rangeHeight / factor / 2, 1e-6);
      series.priceScale().applyOptions({ autoScale: false });
      series.priceScale().setVisibleRange({ from: mid - newHalf, to: mid + newHalf });
    }
  }, [pixelToData, applyMagnet, chart, series]);

  // Launches the momentum glide from whatever velocity handlePointerMove's pan-branch sampling
  // last measured - a self-recursing requestAnimationFrame loop, cancelable at any time via
  // stopMomentum (called at the top of every new handlePointerDown). Below
  // PAN_MOMENTUM_MIN_LAUNCH_VELOCITY it's a no-op, so a slow drag or a plain click-release stops
  // dead instead of visibly drifting.
  const launchMomentum = useCallback(() => {
    if (!chart || Math.abs(panVelocityRef.current) < PAN_MOMENTUM_MIN_LAUNCH_VELOCITY) {
      panVelocityRef.current = 0;
      return;
    }
    const startTime = performance.now();
    let lastFrameTime = startTime;
    const step = (now: number) => {
      const dt = now - lastFrameTime;
      lastFrameTime = now;
      if (
        !chart ||
        now - startTime > PAN_MOMENTUM_MAX_DURATION_MS ||
        Math.abs(panVelocityRef.current) < PAN_MOMENTUM_STOP_VELOCITY
      ) {
        momentumRafRef.current = null;
        panVelocityRef.current = 0;
        return;
      }
      const range = chart.timeScale().getVisibleLogicalRange();
      if (range) {
        const shift = panVelocityRef.current * dt;
        chart.timeScale().setVisibleLogicalRange({ from: range.from + shift, to: range.to + shift });
      }
      // Frame-rate-independent decay: friction^(dt/1000), not a fixed per-frame multiplier - see
      // PAN_MOMENTUM_FRICTION_PER_SECOND's own comment.
      panVelocityRef.current *= Math.pow(PAN_MOMENTUM_FRICTION_PER_SECOND, dt / 1000);
      momentumRafRef.current = requestAnimationFrame(step);
    };
    momentumRafRef.current = requestAnimationFrame(step);
  }, [chart]);

  const handlePointerUp = useCallback(() => {
    if (dragDrawingActiveRef.current) {
      const ip = inProgressRef.current;
      dragDrawingActiveRef.current = false;
      lastDragCapturePixelRef.current = null;
      if (ip && ip.points.length >= 2) {
        persist([...drawingsRef.current, buildDrawing(ip.tool, ip.points)]);
      }
      setInProgress(null);
      setPreviewPoint(null);
      setActiveToolState('cursor');
      return;
    }
    if (dragRef.current) {
      persist(drawingsRef.current);
      dragRef.current = null;
    }
    if (panDragRef.current) {
      launchMomentum();
    }
    panDragRef.current = null;
    priceScaleDragRef.current = null;
  }, [persist, buildDrawing, launchMomentum]);

  // Mouse-wheel zoom - the drawing overlay sits on top of lightweight-charts' own canvas and
  // intercepts every pointer event reaching it (see this hook's own top comment), so the library's
  // built-in handleScale wheel zoom never fires either, exactly like native drag-pan didn't. Same
  // fix shape: reimplement it manually against the public timeScale API instead. Zooms around the
  // cursor's own logical position (coordinateToLogical - unlike coordinateToTime/pixelToData, this
  // stays valid across the whole pane, including the empty margins, since it's a continuous
  // coordinate rather than one anchored to a real bar) so the point under the mouse stays fixed
  // while the range around it grows/shrinks, matching the feel of every real charting platform's
  // scroll-to-zoom instead of always zooming around a fixed centre.
  const handleWheel = useCallback((e: WheelEvent, canvasRect: DOMRect) => {
    if (!chart) return;
    stopMomentum();
    const range = chart.timeScale().getVisibleLogicalRange();
    if (!range) return;
    const x = e.clientX - canvasRect.left;
    const pivot = chart.timeScale().coordinateToLogical(x);
    if (pivot === null) return;

    e.preventDefault();

    // deltaY < 0 (wheel up/scroll forward) zooms IN (narrower range); > 0 zooms out - the same
    // direction convention TradingView, Google Maps, etc. all use. Clamped per-event so one very
    // large deltaY spike (some trackpads/mice burst much bigger values than a standard notch)
    // can't jump the zoom level jarringly in one tick.
    const rawFactor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
    const factor = Math.min(WHEEL_ZOOM_MAX_STEP, Math.max(1 / WHEEL_ZOOM_MAX_STEP, rawFactor));

    let newFrom = pivot - (pivot - range.from) / factor;
    let newTo = pivot + (range.to - pivot) / factor;

    // Clamp how far a reader can zoom in/out so the range can't collapse to ~0 bars (chart turns
    // into a single giant candle) or balloon absurdly wide (every bar squeezed to sub-pixel).
    const width = newTo - newFrom;
    if (width < WHEEL_ZOOM_MIN_BARS) {
      const mid = (newFrom + newTo) / 2;
      newFrom = mid - WHEEL_ZOOM_MIN_BARS / 2;
      newTo = mid + WHEEL_ZOOM_MIN_BARS / 2;
    } else {
      const maxWidth = Math.max(WHEEL_ZOOM_MIN_BARS * 4, barsRef.current.length * WHEEL_ZOOM_MAX_BARS_MULTIPLE);
      if (width > maxWidth) {
        const mid = (newFrom + newTo) / 2;
        newFrom = mid - maxWidth / 2;
        newTo = mid + maxWidth / 2;
      }
    }

    chart.timeScale().setVisibleLogicalRange({ from: newFrom, to: newTo });
  }, [chart, stopMomentum]);

  // Right-click on an existing drawing: selects it (same as a left-click would) and opens the
  // context menu at the click position - rendered by DrawingToolbar (it already has every piece
  // this needs: the color palette, width buttons, and lock/hide/duplicate/delete actions, all
  // already wired to whichever drawing is selected). Right-clicking empty canvas space just
  // suppresses the browser's own menu without opening ours - same as clicking empty space with the
  // left button doesn't select anything either.
  const handleContextMenu = useCallback((e: MouseEvent, canvasRect: DOMRect) => {
    e.preventDefault();
    stopMomentum();
    const x = e.clientX - canvasRect.left;
    const y = e.clientY - canvasRect.top;
    const hit = hitTest({ x, y });
    if (hit) {
      setSelectedId(hit.drawing.id);
      setContextMenu({ x: e.clientX, y: e.clientY });
    } else {
      setContextMenu(null);
    }
  }, [hitTest, stopMomentum]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // button !== 0 (not the primary/left button) is ignored here - a right-click used to also
    // fall through into this same handler (starting a pan-drag or placing a drawing point) before
    // the browser's own contextmenu event fired right after, which was never intended; right-click
    // is handled entirely by onContextMenu below now.
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      handlePointerDown(e.clientX, e.clientY, canvas.getBoundingClientRect());
    };
    const onMove = (e: MouseEvent) => handlePointerMove(e.clientX, e.clientY, canvas.getBoundingClientRect());
    const onUp = () => handlePointerUp();
    const onWheel = (e: WheelEvent) => handleWheel(e, canvas.getBoundingClientRect());
    const onContextMenu = (e: MouseEvent) => handleContextMenu(e, canvas.getBoundingClientRect());
    // Double-clicking the price axis restores auto-scale - the standard way back after a manual
    // drag-zoom (handlePointerMove's priceScaleDragRef branch turns autoScale off), same as every
    // real charting platform's own axis-reset gesture.
    const onDblClick = (e: MouseEvent) => {
      if (!series) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const priceScaleWidth = series.priceScale().width();
      if (priceScaleWidth > 0 && x >= rect.width - priceScaleWidth) {
        series.priceScale().applyOptions({ autoScale: true });
      }
    };
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // { passive: false } - handleWheel calls preventDefault() to stop the page itself from
    // scrolling while the reader is zooming the chart; a passive listener can't call it.
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [handlePointerDown, handlePointerMove, handlePointerUp, handleWheel, handleContextMenu, series]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dragDrawingActiveRef.current = false;
        lastDragCapturePixelRef.current = null;
        setInProgress(null);
        setPreviewPoint(null);
        setActiveToolState('cursor');
        setSelectedId(null);
        setContextMenu(null);
      } else if (e.key === 'Enter' && inProgressRef.current?.tool === 'polyline') {
        finishPolyline();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = selectedIdRef.current;
        if (!id) return;
        const target = drawingsRef.current.find((d) => d.id === id);
        if (!target || target.locked) return;
        persist(drawingsRef.current.filter((d) => d.id !== id));
        setSelectedId(null);
        setContextMenu(null);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [persist, finishPolyline, undo, redo]);

  // --- selection actions (toolbar-driven) -----------------------------------------------------

  const selectedDrawing = useMemo(() => drawings.find((d) => d.id === selectedId) ?? null, [drawings, selectedId]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    persist(drawingsRef.current.filter((d) => d.id !== selectedId));
    setSelectedId(null);
    setContextMenu(null);
  }, [selectedId, persist]);

  const toggleLockSelected = useCallback(() => {
    if (!selectedId) return;
    persist(drawingsRef.current.map((d) => (d.id === selectedId ? { ...d, locked: !d.locked } : d)));
  }, [selectedId, persist]);

  const toggleHideSelected = useCallback(() => {
    if (!selectedId) return;
    persist(drawingsRef.current.map((d) => (d.id === selectedId ? { ...d, hidden: !d.hidden } : d)));
  }, [selectedId, persist]);

  const duplicateSelected = useCallback(() => {
    if (!selectedDrawing) return;
    const bucketMs = 5 * 60; // shift the copy a few bars over so it doesn't sit exactly on top
    const copy: DrawingObject = {
      ...selectedDrawing,
      id: genId(),
      points: selectedDrawing.points.map((p) => ({ ...p, time: p.time + bucketMs * 3 })),
      createdAt: Date.now(),
    };
    persist([...drawingsRef.current, copy]);
    setSelectedId(copy.id);
  }, [selectedDrawing, persist]);

  const clearAll = useCallback(() => {
    persist([]);
    setSelectedId(null);
  }, [persist]);

  /** Bagian J Tugas 5: applies a color/lineWidth change to whichever drawing is currently
   *  selected - a no-op (not an error) when nothing is selected, same "quietly does nothing"
   *  convention as deleteSelected/toggleLockSelected above. */
  const updateSelectedStyle = useCallback((patch: Partial<Pick<DrawingObject, 'color' | 'lineWidth'>>) => {
    if (!selectedIdRef.current) return;
    persist(drawingsRef.current.map((d) => (d.id === selectedIdRef.current ? { ...d, ...patch } : d)));
  }, [persist]);

  return {
    canvasRef,
    drawings,
    activeTool,
    setActiveTool,
    magnetMode,
    setMagnetMode,
    selectedId,
    selectedDrawing,
    contextMenu,
    closeContextMenu: () => setContextMenu(null),
    deleteSelected,
    toggleLockSelected,
    toggleHideSelected,
    duplicateSelected,
    updateSelectedStyle,
    clearAll,
    undo,
    redo,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    historyTick,
  };
}

// --- module-level pixel-space rendering helpers (no data-space/chart dependency) ----------------

function strokeLine(ctx: CanvasRenderingContext2D, a: PixelPoint, b: PixelPoint): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function strokeFilledRect(ctx: CanvasRenderingContext2D, a: PixelPoint, b: PixelPoint): void {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  ctx.globalAlpha = 0.12;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.strokeRect(x, y, w, h);
}

function drawLabelBadge(ctx: CanvasRenderingContext2D, label: string, cx: number, cy: number): void {
  ctx.font = 'bold 11px ui-monospace, monospace';
  const metrics = ctx.measureText(label);
  const savedFill = ctx.fillStyle;
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = savedFill;
  ctx.fillRect(cx - metrics.width / 2 - 4, cy - 12, metrics.width + 8, 16);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0B0B0B';
  ctx.fillText(label, cx - metrics.width / 2, cy);
  ctx.fillStyle = savedFill;
}

/** Extends a line starting at `from` through `through` far enough to clear the pane in that
 *  direction, regardless of slope - shared by the ray and extended-line renderers. */
function extendPastPoint(from: PixelPoint, through: PixelPoint, paneWidth: number, paneHeight: number): PixelPoint {
  const dx = through.x - from.x;
  const dy = through.y - from.y;
  const reach = Math.max(paneWidth, paneHeight) * 2;
  const length = Math.hypot(dx, dy) || 1;
  const scale = reach / length;
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

/** The second (offset) line of a parallel channel, in PIXEL space: p2's perpendicular pixel
 *  offset from the base line (p0->p1) applied to both p0 and p1. Pixel-space (not a price-only
 *  offset) so the channel visually stays parallel on screen regardless of the price/time axis
 *  scales, matching how a reader drags the 3rd point to set the channel's visual width. */
function offsetPointsForChannel(p0: PixelPoint, p1: PixelPoint, p2: PixelPoint): [PixelPoint, PixelPoint] {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return [p0, p1];
  const t = ((p2.x - p0.x) * dx + (p2.y - p0.y) * dy) / lengthSq;
  const projX = p0.x + t * dx;
  const projY = p0.y + t * dy;
  const offX = p2.x - projX;
  const offY = p2.y - projY;
  return [{ x: p0.x + offX, y: p0.y + offY }, { x: p1.x + offX, y: p1.y + offY }];
}

/** One fib-CHANNEL level's line, in PIXEL space: the base trendline (p0->p1) shifted parallel to
 *  itself by `ratio` of its own perpendicular... simplified here to a straight vertical (y-only)
 *  pixel offset scaled by the line's own pixel height, which reads correctly for the dominant
 *  "trend channel" case (a sloped price line) without needing true perpendicular-in-pixel-space
 *  geometry - documented as a deliberate simplification, not textbook-exact. */
function channelOffsetPx(p0: PixelPoint, p1: PixelPoint, ratio: number): [PixelPoint, PixelPoint] {
  const heightPx = p1.y - p0.y;
  const offsetY = -ratio * heightPx;
  return [{ x: p0.x, y: p0.y + offsetY }, { x: p1.x, y: p1.y + offsetY }];
}

/** Standard least-squares linear regression (x = bar index 0..n-1, y = close) plus the residual
 *  standard deviation, for the regressionTrend tool. Returns null for fewer than 2 points - not
 *  enough to fit a line. Pure data-space math, no pixel/chart dependency (mirrors this section's
 *  own "module-level, no dependency" convention). */
function linearRegression(closes: number[]): { slope: number; intercept: number; stdev: number } | null {
  const n = closes.length;
  if (n < 2) return null;
  const xMean = (n - 1) / 2; // mean of 0..n-1
  const yMean = closes.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (closes[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  let sqSum = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * i + intercept;
    sqSum += (closes[i] - predicted) ** 2;
  }
  return { slope, intercept, stdev: Math.sqrt(sqSum / n) };
}
