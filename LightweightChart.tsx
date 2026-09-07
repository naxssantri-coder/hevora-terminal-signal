import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPaneApi,
  type IPriceLine,
  type UTCTimestamp,
  type MouseEventParams,
} from 'lightweight-charts';
import { Info, RefreshCw, SlidersHorizontal, Maximize2, Minimize2, Camera, History, Play, Pause, SkipBack, SkipForward, X } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext';
import { UnavailableState } from './ui';
import { useEndpoint } from '../lib/useEndpoint';
import { PairId, Signal } from '../types';
import { DrawingToolbar } from './chart/DrawingToolbar';
import { useDrawingTools } from './chart/useDrawingTools';
import { useDrawingTemplates } from './chart/useDrawingTemplates';

type XauInterval = '5m' | '15m' | '1h' | '4h';

interface XauIntradayCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** True on the single trailing candle when it's the still-forming bar (real, live-accumulating
   *  ticks not yet locked into candleStore.XAUUSD) rather than a closed one. XAUUSD-only concept -
   *  the generic /api/market/candles endpoint used for every other pair doesn't expose this. */
  forming?: boolean;
}

interface XauIntradayResponse {
  pairId: 'XAUUSD';
  interval: XauInterval;
  candles: XauIntradayCandle[];
  source: string;
  oldestUnderlyingCandleTime: string | null;
  newestUnderlyingCandleTime: string | null;
  fetchedAt: string;
}

interface GenericCandle { t: number; o: number; h: number; l: number; c: number }

interface GenericCandlesResponse {
  candles: Record<string, GenericCandle[]>;
  interval: '5m';
  source: string;
  newestAt: string | null;
  fetchedAt: string;
}

// 2026-09-01 ("samain tombol interval semua pair" follow-up): /api/market/intraday - the non-XAU
// equivalent of XauIntradayResponse, for the 15m/1h/4h aggregations built server-side from
// candlearchive:{pairId}:5m (crypto) or :1m (forex) - see that endpoint's own comment in server.ts.
// 5m itself still comes from GenericCandlesResponse above (the live, always-5m /api/market/candles)
// - this only ever covers 15m/1h/4h.
interface NonXauIntradayResponse {
  pairId: string;
  interval: '15m' | '1h' | '4h';
  candles: GenericCandle[];
  source: string;
  oldestUnderlyingCandleTime: string | null;
  newestUnderlyingCandleTime: string | null;
  fetchedAt: string;
}

// --- Daily/Weekly/Monthly (Bagian J Tugas 1, 2026-09-01) ------------------------------------
//
// A wholly separate, on-demand fetch pipeline from every intraday path above - never mixed with
// candleStore/the tick-built feed, per the user's own explicit instruction ("jalur fetch terpisah
// dari pipa intraday tick-built yang sudah ada - jangan dicampur logikanya"). Backed by
// /api/market/eod (server.ts), which itself never fabricates data: a genuinely unavailable source
// comes back as an HTTP 502, surfaced here the same way the intraday paths already surface theirs.
type EodInterval = '1D' | '1W' | '1M';

interface EodApiCandle { t: number; o: number; h: number; l: number; c: number }

interface EodApiResponse {
  success: boolean;
  pairId: string;
  interval: EodInterval;
  candles: EodApiCandle[];
  source?: string;
  /** True only for XAUUSD - its D/W/M data is COMEX gold futures (GC=F), not spot, since
   *  XAUUSD=X is delisted at every granularity on Yahoo (verified, not assumed - see
   *  scripts/probe-eod-history-sources.ts). Drives the permanent on-chart disclosure badge below,
   *  per the user's explicit final decision ("Opsi A"). */
  isFuturesProxy?: boolean;
  disclosure?: string;
  error?: string;
}

// Pairs /api/market/eod actually has a real source for (mirrors server.ts's EOD_CRYPTO_SYMBOL /
// EOD_FOREX_SYMBOL maps plus the XAUUSD GC=F route) - an explicit list rather than inferring from
// pairId shape, so a pair this endpoint doesn't cover yet never shows a D/W/M switch that 502s.
const EOD_SUPPORTED_PAIRS: readonly PairId[] = ['XAUUSD', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'EURUSD', 'GBPUSD', 'USDCHF', 'USDCAD'];

interface LightweightChartProps {
  /** Which pair's candles to render. XAUUSD gets its full dedicated feature set (interval switch,
   *  live forming bar, /api/market/xau-intraday) - every other pair reads the general, 5m-only
   *  /api/market/candles endpoint (see that endpoint's own comment in server.ts: it wholesale-
   *  reflects candleStore[pairId], the exact same feed already backing that pair's price
   *  everywhere else on this page). This branches ONLY the data source and interval-switch UI -
   *  every other piece (indicators, gap-fill, signal overlay, legend, theme) is identical for
   *  every pair, per this project's "branch on pairId === 'XAUUSD', don't fork the shared path"
   *  convention. */
  pairId: PairId;
  pairName: string;
  /** Price decimal precision for this pair (PAIRS_LIST[x].digits) - XAUUSD is always 2; other
   *  pairs vary (e.g. forex majors are typically 4-5, crypto varies by price magnitude). */
  digits: number;
  /** Active signal for this pair (if any) - its entry/SL/TP1/TP2 levels are overlaid as horizontal
   *  price lines when present. Purely a visual overlay; never mutated here. */
  signal?: Signal | null;
  /** 2026-09-01 (Bagian F, drawing-tools framework): opt-in, defaults to false. The framework is
   *  built and verified (see useDrawingTools.ts's own comment) but not yet confirmed on a real
   *  device - no caller should pass true until that confirmation happens; this prop exists so the
   *  feature can be exercised on this branch without touching the XAUUSD production route's
   *  current behavior at all when omitted. */
  drawingToolsEnabled?: boolean;
}

type Bar = { time: UTCTimestamp; open: number; high: number; low: number; close: number };
type IndicatorPoint = { time: UTCTimestamp; value: number };

/** What the on-canvas OHLC legend shows - either the hovered candle or (default) the latest one. */
interface LegendInfo {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  changeAbs: number;
  changePct: number;
}

// Same 5-second cadence the rest of the engine's own tick loop runs on - candleStore only actually
// changes once per closed 5-minute bar, but polling a little faster than that keeps XAUUSD's still-
// forming current bar's high/low/close visibly live without hammering the endpoint. For non-XAU
// pairs this just re-reads the same 5m snapshot slightly more often than it changes - harmless.
const POLL_MS = 5000;
// Replay auto-play: how long each bar stays on screen before advancing to the next one.
const REPLAY_STEP_MS = 700;

// Expected bar spacing per interval - the same real-bar aggregation buckets /api/market/xau-intraday
// itself groups by (XAUUSD only; every other pair is always 5m via /api/market/candles), used here
// purely to detect gaps for the whitespace-fill below, not to fetch or compute anything new.
const BUCKET_MS: Record<XauInterval, number> = { '5m': 5 * 60 * 1000, '15m': 15 * 60 * 1000, '1h': 60 * 60 * 1000, '4h': 4 * 60 * 60 * 1000 };

const formatPrice = (n: number, digits: number) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Reads a CSS custom property's current value straight off :root, so this chart's colors are
 *  pulled from the same source of truth as every other themed element (src/index.css) instead of
 *  a second, hand-copied palette that can silently drift out of sync when the theme file changes. */
const cssVar = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

// --- Saved layout (Bagian F, 2026-09-01 follow-up) ------------------------------------------
//
// Which interval and which indicators a reader has switched on is a per-viewer display
// preference, not real trading data - so it's stored client-side (localStorage), scoped per pair
// so a future multi-pair rollout doesn't have one pair's chosen indicators leak into another's.
// Never assumed to survive: every read is wrapped in try/catch (a private window, cleared site
// data, or a browser blocking storage all make localStorage throw or come back empty), and a
// missing/corrupt/invalid entry always falls back to this component's normal hardcoded defaults
// (5m, every indicator off) rather than crashing or rendering nothing.
const CHART_LAYOUT_STORAGE_PREFIX = 'hevora:chart:layout:';

interface SavedChartLayout {
  interval?: XauInterval;
  activeIndicators?: Partial<Record<IndicatorKey, boolean>>;
}

const VALID_INTERVALS: readonly XauInterval[] = ['5m', '15m', '1h', '4h'];

/** Reads and validates a saved layout - a hand-edited or stale-schema localStorage value is
 *  sanitized field-by-field (unknown interval/indicator keys dropped) rather than trusted
 *  wholesale, so a corrupt entry degrades to "that one field uses the normal default" instead of
 *  crashing the chart or applying a nonsense interval/indicator key. */
function loadChartLayout(pairId: string): SavedChartLayout | null {
  try {
    const raw = window.localStorage.getItem(CHART_LAYOUT_STORAGE_PREFIX + pairId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const out: SavedChartLayout = {};
    if (VALID_INTERVALS.includes(parsed.interval)) out.interval = parsed.interval;
    if (parsed.activeIndicators && typeof parsed.activeIndicators === 'object') {
      const sanitized: Partial<Record<IndicatorKey, boolean>> = {};
      for (const key of INDICATOR_ORDER) {
        if (typeof parsed.activeIndicators[key] === 'boolean') sanitized[key] = parsed.activeIndicators[key];
      }
      out.activeIndicators = sanitized;
    }
    return out;
  } catch {
    return null;
  }
}

function saveChartLayout(pairId: string, layout: SavedChartLayout): void {
  try {
    window.localStorage.setItem(CHART_LAYOUT_STORAGE_PREFIX + pairId, JSON.stringify(layout));
  } catch {
    // Storage unavailable/full/blocked - the layout just won't be remembered this session, which
    // is the same experience as before this feature existed. Nothing to surface to the reader.
  }
}

// --- Candle gap rendering (Bagian G, 2026-09-01) --------------------------------------------
//
// A pair's candleStore only ever gets a bar written when a real tick actually lands in that slot -
// if the feed goes quiet for a few minutes (a hiccup, not necessarily a full outage), that slot
// never gets a candle at all. lightweight-charts draws whatever data points it's given at uniform
// per-point spacing regardless of the real time gap between them, so a skipped slot used to render
// as the surrounding candles simply being pulled tight together - visually indistinguishable from
// "nothing happened here" when something (a data gap) really did. Verified against real production
// XAUUSD data via scripts/audit-xau-candle-gaps.ts before this fix was written, not assumed; applies
// identically to every pair since it's a property of lightweight-charts' rendering, not of any one
// pair's data.
//
// Fix: insert one lightweight-charts "whitespace" data point (`{ time }`, no OHLC) per missing bar
// slot between two real candles whose time difference exceeds one bar duration. lightweight-charts
// natively supports whitespace entries in a Candlestick series - they take up their own index slot
// with no candle body drawn, which is exactly a genuine visual gap. This NEVER invents a price -
// no doji, no flat bar, no interpolation - it only tells the chart honestly "there is real elapsed
// time here with no data", which is strictly more truthful than either fabricating a bar or letting
// the gap compress into nothing.
type DisplayPoint = Bar | { time: UTCTimestamp };

function fillGapsWithWhitespace(bars: Bar[], bucketMs: number): DisplayPoint[] {
  if (bars.length === 0) return [];
  const bucketSec = Math.round(bucketMs / 1000);
  const out: DisplayPoint[] = [bars[0]];
  for (let i = 1; i < bars.length; i++) {
    const prevTime = bars[i - 1].time as number;
    const curTime = bars[i].time as number;
    for (let t = prevTime + bucketSec; t < curTime; t += bucketSec) {
      out.push({ time: t as UTCTimestamp });
    }
    out.push(bars[i]);
  }
  return out;
}

const buildLegendFromBars = (bars: Bar[], index: number): LegendInfo | null => {
  if (index < 0 || index >= bars.length) return null;
  const bar = bars[index];
  const prevClose = index > 0 ? bars[index - 1].close : bar.open;
  const changeAbs = bar.close - prevClose;
  const changePct = prevClose !== 0 ? (changeAbs / prevClose) * 100 : 0;
  return { time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, changeAbs, changePct };
};

// --- Technical indicators (2026-08-31, chart follow-up polish) -----------------------------------
//
// Every function below is a pure computation over the SAME closed-price series already rendered on
// the candlesticks - no new fetch, no external source, nothing estimated. Each explicitly returns
// NO points at all for any prefix of the series shorter than its own minimum period, rather than a
// truncated/wrong partial line - "belum cukup data" is surfaced honestly in the UI (see
// INDICATOR_DEFS.minBars below) instead of ever drawing a line that quietly starts from garbage.

/** Simple moving average - one point per bar once `period` closes are available. */
function computeSMA(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length < period) return [];
  const out: IndicatorPoint[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= period) sum -= bars[i - period].close;
    if (i >= period - 1) out.push({ time: bars[i].time, value: sum / period });
  }
  return out;
}

/** Exponential moving average, seeded with the plain SMA of the first `period` closes (standard
 *  convention) - the same reason no points are emitted before that seed bar. */
function computeEMA(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length < period) return [];
  const k = 2 / (period + 1);
  const out: IndicatorPoint[] = [];
  let seedSum = 0;
  for (let i = 0; i < period; i++) seedSum += bars[i].close;
  let ema = seedSum / period;
  out.push({ time: bars[period - 1].time, value: ema });
  for (let i = period; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
    out.push({ time: bars[i].time, value: ema });
  }
  return out;
}

/** Bollinger Bands: SMA(period) +/- (mult * population std-dev over the same rolling window). */
function computeBollinger(
  bars: Bar[],
  period: number,
  mult: number
): { upper: IndicatorPoint[]; mid: IndicatorPoint[]; lower: IndicatorPoint[] } {
  if (bars.length < period) return { upper: [], mid: [], lower: [] };
  const upper: IndicatorPoint[] = [];
  const mid: IndicatorPoint[] = [];
  const lower: IndicatorPoint[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].close;
    const mean = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (bars[j].close - mean) ** 2;
    const sd = Math.sqrt(variance / period);
    mid.push({ time: bars[i].time, value: mean });
    upper.push({ time: bars[i].time, value: mean + mult * sd });
    lower.push({ time: bars[i].time, value: mean - mult * sd });
  }
  return { upper, mid, lower };
}

// --- Oscillators (Bagian F, 2026-09-01 follow-up) -------------------------------------------
//
// RSI/MACD/StochRSI/ATR below - all computed purely from each bar's real open/high/low/close, the
// exact same series the candlesticks themselves are drawn from. None of these use volume: the
// `volume: 100` field written into candleStore.XAUUSD (and mirrored for other pairs) is a fixed
// placeholder, never a real traded-volume read, so it must never feed an indicator's math - these
// four were deliberately chosen because none of the standard formulas need volume at all. Each one
// follows the same "return nothing before there's genuinely enough data" contract as
// computeSMA/computeEMA/computeBollinger above, not a truncated/estimated partial line.

/** Wilder's RSI (the original, standard smoothing - not a plain SMA of gains/losses). Needs
 *  `period` price CHANGES (period+1 closes) before the first seed average exists. */
function computeRSI(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length < period + 1) return [];
  const out: IndicatorPoint[] = [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= period;
  avgLoss /= period;
  const rsiAt = (gain: number, loss: number) => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out.push({ time: bars[period].time, value: rsiAt(avgGain, avgLoss) });
  for (let i = period + 1; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push({ time: bars[i].time, value: rsiAt(avgGain, avgLoss) });
  }
  return out;
}

/** Wilder's ATR - Wilder-smoothed average of True Range (max of the three real high/low/prevClose
 *  spreads, never estimated). Needs `period` true-range samples (period+1 bars) before the first
 *  seed average exists - identical shape to computeRSI's own warm-up. */
function computeATR(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length < period + 1) return [];
  const trueRange = (i: number) =>
    Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
  const out: IndicatorPoint[] = [];
  let atr = 0;
  for (let i = 1; i <= period; i++) atr += trueRange(i);
  atr /= period;
  out.push({ time: bars[period].time, value: atr });
  for (let i = period + 1; i < bars.length; i++) {
    atr = (atr * (period - 1) + trueRange(i)) / period;
    out.push({ time: bars[i].time, value: atr });
  }
  return out;
}

/** MACD(fast,slow,signal) - fast/slow EMA of close (reusing computeEMA), signal is an EMA of the
 *  MACD line itself, histogram is macd-signal. Standard 12/26/9 periods. */
function computeMACD(
  bars: Bar[],
  fast: number,
  slow: number,
  signalPeriod: number
): { macd: IndicatorPoint[]; signal: IndicatorPoint[]; histogram: IndicatorPoint[] } {
  const emaFast = computeEMA(bars, fast);
  const emaSlow = computeEMA(bars, slow);
  if (emaSlow.length === 0) return { macd: [], signal: [], histogram: [] };
  // emaFast starts earlier than emaSlow (smaller period) - align both to emaSlow's own time range
  // by index offset (both are computed off the exact same `bars` array, so their time grids are a
  // simple constant offset apart: slow-period - fast-period bars).
  const offset = emaSlow[0] ? emaFast.findIndex((p) => p.time === emaSlow[0].time) : -1;
  if (offset < 0) return { macd: [], signal: [], histogram: [] };
  const macd: IndicatorPoint[] = emaSlow.map((p, i) => ({ time: p.time, value: emaFast[i + offset].value - p.value }));
  // EMA of the MACD line's own value series - same seed-with-SMA convention as computeEMA, applied
  // to a synthetic "bars" shape (time + value standing in for time + close) so the identical,
  // already-verified smoothing logic is reused rather than a second hand-written copy.
  const macdAsBars: Bar[] = macd.map((p) => ({ time: p.time, open: p.value, high: p.value, low: p.value, close: p.value }));
  const signal = computeEMA(macdAsBars, signalPeriod);
  const signalOffset = signal.length > 0 ? macd.findIndex((p) => p.time === signal[0].time) : -1;
  const histogram: IndicatorPoint[] =
    signalOffset < 0 ? [] : signal.map((p, i) => ({ time: p.time, value: macd[i + signalOffset].value - p.value }));
  return { macd, signal, histogram };
}

/** Stochastic RSI: RSI(rsiPeriod) run back through the plain stochastic %K/%D formula (min-max
 *  normalize over stochPeriod, then SMA-smooth %K into %D) - a standard, well-known compound
 *  indicator, not a novel formula. */
function computeStochRSI(
  bars: Bar[],
  rsiPeriod: number,
  stochPeriod: number,
  kSmooth: number,
  dSmooth: number
): { k: IndicatorPoint[]; d: IndicatorPoint[] } {
  const rsi = computeRSI(bars, rsiPeriod);
  if (rsi.length < stochPeriod) return { k: [], d: [] };
  const raw: IndicatorPoint[] = [];
  for (let i = stochPeriod - 1; i < rsi.length; i++) {
    const window = rsi.slice(i - stochPeriod + 1, i + 1).map((p) => p.value);
    const lo = Math.min(...window);
    const hi = Math.max(...window);
    raw.push({ time: rsi[i].time, value: hi === lo ? 0 : ((rsi[i].value - lo) / (hi - lo)) * 100 });
  }
  const rawAsBars: Bar[] = raw.map((p) => ({ time: p.time, open: p.value, high: p.value, low: p.value, close: p.value }));
  const k = computeSMA(rawAsBars, kSmooth).map((p) => ({ time: p.time, value: p.value }));
  const kAsBars: Bar[] = k.map((p) => ({ time: p.time, open: p.value, high: p.value, low: p.value, close: p.value }));
  const d = computeSMA(kAsBars, dSmooth).map((p) => ({ time: p.time, value: p.value }));
  return { k, d };
}

type OverlayIndicatorKey = 'ema9' | 'ema21' | 'sma20' | 'bb20';
type OscillatorKey = 'rsi14' | 'macd' | 'stochRsi' | 'atr14';
type IndicatorKey = OverlayIndicatorKey | OscillatorKey;

// Fixed colors (not theme-swapped) chosen to stay readable against both the dark and light
// backgrounds this chart supports - mid-tone, not pure white/black - and deliberately distinct
// from --color-up/--color-down/SL-TP overlay colors so an indicator line is never mistaken for a
// price level or a candle direction. sma20 reuses --color-brand, the same cyan accent already used
// elsewhere in HEVORA (info icons, badges), for one less arbitrary color in the palette.
//
// `pane` marks the four oscillators as needing their OWN pane (0-100/unbounded-range indicators
// that would be visually meaningless sharing the main price axis) - the four price overlays have
// no `pane` field at all, since they draw straight onto the main candlestick pane (index 0).
const OSCILLATOR_KEYS = ['rsi14', 'macd', 'stochRsi', 'atr14'] as const;
type OscillatorIndicatorKey = (typeof OSCILLATOR_KEYS)[number];

const INDICATOR_DEFS: Record<IndicatorKey, { label: string; minBars: number; color: string; pane?: true }> = {
  ema9: { label: 'EMA 9', minBars: 9, color: '#F2B84B' },
  ema21: { label: 'EMA 21', minBars: 21, color: '#8B7CF6' },
  sma20: { label: 'SMA 20', minBars: 20, color: cssVar('--color-brand', '#22D3EE') },
  bb20: { label: 'BB 20', minBars: 20, color: '#8A8F98' },
  // minBars derived directly from each function's own warm-up above: RSI(14) needs 15 closes for
  // its first point; StochRSI needs RSI(14)'s own 15 plus a 14-wide min/max window (+13) plus two
  // 3-period SMA smoothing passes (+2 +2) = 32; MACD(12,26,9) needs EMA(26)'s 26 plus 9 MACD
  // points to seed its own signal EMA (+8) = 34; ATR(14) mirrors RSI's warm-up shape (15).
  rsi14: { label: 'RSI 14', minBars: 15, color: '#F2B84B', pane: true },
  macd: { label: 'MACD', minBars: 34, color: '#22D3EE', pane: true },
  stochRsi: { label: 'Stoch RSI', minBars: 32, color: '#8B7CF6', pane: true },
  atr14: { label: 'ATR 14', minBars: 15, color: '#8A8F98', pane: true },
};
const INDICATOR_ORDER: IndicatorKey[] = ['ema9', 'ema21', 'sma20', 'bb20', 'rsi14', 'macd', 'stochRsi', 'atr14'];
const OSCILLATOR_PANE_HEIGHT = 110;

type IndicatorSeriesRefs = Partial<Record<IndicatorKey | 'bbUpper' | 'bbLower' | 'macdSignal', ISeriesApi<'Line'>>> & {
  macdHist?: ISeriesApi<'Histogram'>;
  stochD?: ISeriesApi<'Line'>;
};

// --- Resize-handle affordance (Bagian F tambahan, 2026-09-01 follow-up) ---------------------
//
// Dragging a pane divider to resize it was already fully functional (lightweight-charts' own
// native pane-resize interaction, `enableResize: true`) - the reported problem was purely that
// nothing SHOWS a divider is draggable, so a reader never discovers it. lightweight-charts doesn't
// expose a public option to render a custom grip icon on its own separator, so this appends a
// small, purely decorative (pointer-events: none - the real drag hit-area is the native separator
// underneath it, untouched) grip element as a DOM child of each pane's own element
// (IPaneApi.getHTMLElement(), a real documented API) at its bottom edge. Verified via a standalone
// Playwright check (this sandbox can't render the full app) that this child survives sibling panes
// being added/removed and stays correctly positioned via plain CSS (not manually recomputed pixel
// coordinates) since it's a real DOM child of the pane element it tracks.
const PANE_GRIP_ATTR = 'data-hevora-pane-grip';

function removePaneGrip(paneEl: HTMLElement | null): void {
  paneEl?.querySelector(`[${PANE_GRIP_ATTR}]`)?.remove();
}

function addPaneGrip(paneEl: HTMLElement | null): void {
  if (!paneEl) return;
  removePaneGrip(paneEl); // idempotent - pane 0's element persists across rebuilds, never duplicate
  if (getComputedStyle(paneEl).position === 'static') paneEl.style.position = 'relative';
  const grip = document.createElement('div');
  grip.setAttribute(PANE_GRIP_ATTR, '1');
  Object.assign(grip.style, {
    position: 'absolute',
    left: '50%',
    bottom: '-3px',
    transform: 'translateX(-50%)',
    width: '32px',
    height: '5px',
    borderRadius: '3px',
    backgroundColor: cssVar('--border-strong', '#4B5563'),
    opacity: '0.55',
    pointerEvents: 'none',
    zIndex: '5',
  });
  paneEl.appendChild(grip);
}

// 2026-09-01 (bug found from the user's own screenshot/video after this feature shipped): an
// "inactive oscillator pane" was originally implemented as chart.panes()[i].setHeight(0) - which
// looked right in code but does NOT actually collapse a pane. Reading lightweight-charts' own
// compiled source (the behavior isn't documented) showed setHeight() hard-clamps its argument to
// Math.max(30, requestedHeight) internally - so every "collapsed" pane was silently sitting at a
// real, non-zero 30px, still rendering its price-axis (an empty "0.00" label, exactly what the
// video showed) instead of actually disappearing. There is no way to make a pane 0px via
// setHeight() - the only real fix is to not have the pane exist at all when its oscillator is off.
//
// rebuildOscillatorPanes therefore tears down every oscillator pane/series and rebuilds only the
// currently-active ones, each via the documented chart.addPane() (which hands back a real,
// confirmed pane index - safer than guessing whether addSeries() auto-creates a pane for an
// out-of-range index, which isn't documented either). This runs only when an oscillator toggle
// actually changes (a user action, not a per-poll cost) - the main data-push effect still just
// calls setAllIndicatorData() on whatever series currently exist, unchanged.
function rebuildOscillatorPanes(
  chart: IChartApi,
  refs: IndicatorSeriesRefs,
  activeIndicators: Record<IndicatorKey, boolean>,
  bars: Bar[]
): void {
  for (const s of [refs.rsi14, refs.macd, refs.macdSignal, refs.macdHist, refs.stochRsi, refs.stochD, refs.atr14]) {
    if (s) chart.removeSeries(s as ISeriesApi<'Line'>);
  }
  refs.rsi14 = refs.macd = refs.macdSignal = refs.stochRsi = refs.stochD = refs.atr14 = undefined;
  refs.macdHist = undefined;
  // Every pane beyond index 0 (the main candlestick pane) is, by construction, an oscillator pane
  // this function itself created - safe to remove all of them unconditionally before rebuilding.
  // Pane 0's own element is never removed (it's the main chart), so its grip (if any) is removed
  // here explicitly too - the loop below only re-adds it if at least one oscillator ends up active.
  while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);
  removePaneGrip(chart.panes()[0]?.getHTMLElement() ?? null);

  const lineDefaults = {
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    visible: true,
  } as const;

  // Every pane created below gets a resize-handle grip on its bottom edge EXCEPT the very last one
  // (nothing is below it, so there's no separator there to affix a grip to) - collected as we go
  // and applied once the final active pane is known, rather than guessing ahead of time.
  const createdPanes: IPaneApi<UTCTimestamp>[] = [];

  for (const key of OSCILLATOR_KEYS) {
    if (!activeIndicators[key]) continue;
    const pane = chart.addPane();
    createdPanes.push(pane);
    const paneIndex = pane.paneIndex();
    pane.setHeight(OSCILLATOR_PANE_HEIGHT);
    if (key === 'rsi14') {
      refs.rsi14 = chart.addSeries(LineSeries, { ...lineDefaults, color: INDICATOR_DEFS.rsi14.color, lineWidth: 2 }, paneIndex);
      refs.rsi14.createPriceLine({ price: 70, color: '#8A8F98', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
      refs.rsi14.createPriceLine({ price: 30, color: '#8A8F98', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
    } else if (key === 'macd') {
      refs.macd = chart.addSeries(LineSeries, { ...lineDefaults, color: INDICATOR_DEFS.macd.color, lineWidth: 2 }, paneIndex);
      refs.macdSignal = chart.addSeries(LineSeries, { ...lineDefaults, color: '#FF9F43', lineWidth: 1 }, paneIndex);
      refs.macdHist = chart.addSeries(
        HistogramSeries,
        { lastValueVisible: false, priceLineVisible: false, visible: true, color: cssVar('--color-up', '#2ECC71') + '99' },
        paneIndex
      );
    } else if (key === 'stochRsi') {
      refs.stochRsi = chart.addSeries(LineSeries, { ...lineDefaults, color: INDICATOR_DEFS.stochRsi.color, lineWidth: 2 }, paneIndex);
      refs.stochD = chart.addSeries(LineSeries, { ...lineDefaults, color: '#FF9F43', lineWidth: 1 }, paneIndex);
      refs.stochRsi.createPriceLine({ price: 80, color: '#8A8F98', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
      refs.stochRsi.createPriceLine({ price: 20, color: '#8A8F98', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
    } else if (key === 'atr14') {
      refs.atr14 = chart.addSeries(LineSeries, { ...lineDefaults, color: INDICATOR_DEFS.atr14.color, lineWidth: 2 }, paneIndex);
    }
  }

  // 2026-09-01: a freshly created pane's getHTMLElement() returns null SYNCHRONOUSLY right after
  // chart.addPane() - confirmed via a real Playwright check against this exact library, not
  // assumed - it only becomes a real element after the next layout/paint pass. Deferring the grip
  // placement itself (not just re-reading the element) to the next animation frame, rather than
  // calling addPaneGrip() inline above, is what actually gets a grip onto any pane beyond pane 0 -
  // calling it synchronously silently no-ops (addPaneGrip returns early on a null element) and was
  // caught only by this same Playwright check, not by tsc or a visual glance at the code.
  if (createdPanes.length > 0) {
    requestAnimationFrame(() => {
      addPaneGrip(chart.panes()[0]?.getHTMLElement() ?? null); // main pane has a separator below it too
      // Every created pane except the last gets a grip - the last one has nothing below it. Looked
      // up fresh by index here (not the possibly-stale `createdPanes` closures) in case another
      // rebuild already ran before this frame fires - a stale grip on a pane that still exists is
      // harmless (self-corrects on the next real rebuild), but indexing into a pane that's already
      // been removed must not throw, hence chart.panes()[i] with its own bounds, not `pane` directly.
      for (let i = 0; i < createdPanes.length - 1; i++) {
        addPaneGrip(chart.panes()[i + 1]?.getHTMLElement() ?? null);
      }
    });
  }

  if (bars.length > 0) setAllIndicatorData(refs, bars);
}

/** Recomputes and pushes every indicator's data in one place - called both right after a theme
 *  swap (repainting from barsRef) and on every real data poll, so the two call sites can never
 *  drift out of sync with each other. */
function setAllIndicatorData(refs: IndicatorSeriesRefs, bars: Bar[]): void {
  refs.ema9?.setData(computeEMA(bars, 9));
  refs.ema21?.setData(computeEMA(bars, 21));
  refs.sma20?.setData(computeSMA(bars, 20));
  const bb = computeBollinger(bars, 20, 2);
  refs.bbUpper?.setData(bb.upper);
  refs.bb20?.setData(bb.mid);
  refs.bbLower?.setData(bb.lower);

  refs.rsi14?.setData(computeRSI(bars, 14));
  refs.atr14?.setData(computeATR(bars, 14));

  const macdResult = computeMACD(bars, 12, 26, 9);
  refs.macd?.setData(macdResult.macd);
  refs.macdSignal?.setData(macdResult.signal);
  const upColor = cssVar('--color-up', '#2ECC71');
  const downColor = cssVar('--color-down', '#FF4D4F');
  refs.macdHist?.setData(macdResult.histogram.map((p) => ({ time: p.time, value: p.value, color: p.value >= 0 ? upColor : downColor })));

  const stoch = computeStochRSI(bars, 14, 14, 3, 3);
  refs.stochRsi?.setData(stoch.k);
  refs.stochD?.setData(stoch.d);
}

/**
 * Generalized in-house lightweight-charts pair chart (Bagian H, 2026-09-01 follow-up).
 *
 * Extracted from the original XAUUSD-only component (2026-08-31, "single source of truth" audit)
 * so the code is written once instead of duplicated per pair when a future pair is migrated off
 * TradingViewChart. `pairId === 'XAUUSD'` keeps EXACTLY its prior behavior (interval switch, the
 * live forming bar via /api/market/xau-intraday, the short-history info tooltip) - nothing about
 * XAUUSD's rendering changed in this extraction, only moved. Every other pair currently renders
 * through here ONLY if a caller explicitly passes its pairId - as of this commit, MarketView.tsx
 * still routes every non-XAU pair to TradingViewChart unchanged (see this project's standing
 * safeguard: a pair only moves off TradingView's own free, already-long history once its own
 * candleStore history is proven ready with real restart-survival evidence - not assumed here).
 *
 * This component is pure rendering: it reads whichever candle endpoint applies and draws it. It
 * has no opinion on signal generation, RR, entry/SL/TP, or any pair's trading logic.
 */
export const LightweightChart: React.FC<LightweightChartProps> = ({ pairId, pairName, digits, signal, drawingToolsEnabled = false }) => {
  const { t } = useTranslation();
  const isXau = pairId === 'XAUUSD';
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const indicatorSeriesRef = useRef<IndicatorSeriesRefs>({});
  // Mirror of the activeIndicators state below, kept in sync via a dedicated effect - lets the
  // chart-creation effect (deps=[chartTheme, digits] only, deliberately NOT activeIndicators - an
  // indicator toggle must never tear down and recreate the whole chart) read the CURRENT toggle
  // state when rebuilding oscillator panes after a theme swap, without needing it as a dependency.
  const activeIndicatorsRef = useRef<Record<IndicatorKey, boolean>>({
    ema9: false, ema21: false, sma20: false, bb20: false,
    rsi14: false, macd: false, stochRsi: false, atr14: false,
  });
  // Bars currently rendered in the series, kept in a ref (not state) purely for the crosshair
  // handler to look candles up by time without re-subscribing on every data poll.
  const barsRef = useRef<Bar[]>([]);
  // Tracks whether the very first setData()+fitContent() for the current interval has happened,
  // so subsequent polls only push incremental updates (series.update()) instead of replacing and
  // re-fitting the whole dataset - the fix for point 7 (no visible flicker/pan-reset on live
  // updates). Reset to false on every interval switch, since that's a genuinely new dataset.
  const hasFitRef = useRef(false);
  // 2026-08-31 (URGENT crash fix): the time of the last bar actually pushed into the series via
  // update() or setData(). lightweight-charts throws "Cannot update oldest data" if update() is
  // ever called with a time earlier than what it already has - reproduced for real (Playwright,
  // out-of-order mocked responses + rapid interval switching) and root-caused to useEndpoint
  // applying whichever response resolves LAST rather than whichever was requested last (fixed at
  // that root in useEndpoint.ts). This ref is the second, independent layer: even if some other
  // future code path ever manages to hand this component an out-of-order `data` update,
  // series.update() is never called with anything older than this - checked and skipped BEFORE
  // the call, not caught after.
  const lastRenderedTimeRef = useRef<number>(-Infinity);

  const [interval, setInterval] = useState<XauInterval>(() => loadChartLayout(pairId)?.interval ?? '5m');
  const [chartTheme, setChartTheme] = useState<'light' | 'dark'>(() => {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  });
  // Hovered candle info for the on-canvas OHLC legend; null means "show the latest bar instead"
  // (set from the effect below whenever fresh data lands and nothing is currently hovered).
  const [hoverLegend, setHoverLegend] = useState<LegendInfo | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  // Indicator overlays are OFF by default (point 2: "jangan dipaksa selalu tampil") - the reader
  // opts in per-indicator via the toggle row below the title bar. A previously saved choice for
  // this exact pair (see loadChartLayout) overrides the off-by-default starting point; anything
  // it didn't save (or a first-ever visit) keeps the normal all-off default.
  const [activeIndicators, setActiveIndicators] = useState<Record<IndicatorKey, boolean>>(() => ({
    ema9: false,
    ema21: false,
    sma20: false,
    bb20: false,
    rsi14: false,
    macd: false,
    stochRsi: false,
    atr14: false,
    ...loadChartLayout(pairId)?.activeIndicators,
  }));
  // How many bars are currently loaded - drives the "belum cukup data" state per indicator
  // (INDICATOR_DEFS[key].minBars) so a reader can see exactly why a toggle is disabled.
  const [barCount, setBarCount] = useState(0);
  // 2026-09-01 (Bagian F tambahan, toolbar rearrangement): the indicator toggle row used to sit
  // permanently expanded below the title bar, taking real vertical space even when a reader never
  // touches it - and read as one more "always-on box" contributing to the generic-dashboard feel.
  // It's now a single "Indicators" button (icon + label, per the TradingView reference this
  // follow-up asked to match) that opens/closes this panel - closed by default, closes again on an
  // outside click or Escape.
  const [indicatorsMenuOpen, setIndicatorsMenuOpen] = useState(false);
  const indicatorsMenuRef = useRef<HTMLDivElement>(null);
  const indicatorsButtonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Replay mode (Bagian F) - steps backward through the SAME real candles already loaded into
  // barsRef.current (no separate history fetch), showing only bars[0..replayIndex) while active so
  // a reader can practice reading price action without live polling moving the chart underneath
  // them. replayIndex is null when replay is off (normal live chart); once on, it's an index into
  // barsRef.current - the exclusive upper bound of what's currently shown. Live polling keeps
  // running in the background regardless (candles/barsRef.current stay current), so exiting replay
  // resumes live instantly with no re-fetch.
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const replayEnabled = replayIndex !== null;

  // Daily/Weekly/Monthly (Bagian J Tugas 1) - a separate mode this whole component can be in,
  // independent of `interval` above (which stays whatever intraday sub-interval was last chosen,
  // so flipping back to Live restores it exactly). eodHasFitRef mirrors hasFitRef/replayHasFitRef's
  // own "only fitContent() once per switch" pattern.
  const eodSupported = EOD_SUPPORTED_PAIRS.includes(pairId);
  const [chartMode, setChartMode] = useState<'intraday' | 'eod'>('intraday');
  const [eodInterval, setEodInterval] = useState<EodInterval>('1D');
  const eodHasFitRef = useRef(false);

  // XAUUSD reads its own dedicated endpoint (interval switch, live forming bar). Every other pair
  // reads the general, always-5m /api/market/candles endpoint (see its comment in server.ts) and
  // picks its own pairId's slice out of the all-pairs response - EXCEPT when a 15m/1h/4h interval
  // is selected, where it reads the new archive-backed /api/market/intraday instead (see
  // NonXauIntradayResponse's own comment). Every non-XAU pair this component ever renders for
  // (BTCUSDT/ETHUSDT/SOLUSDT/EURUSD/GBPUSD/USDCHF/USDCAD - see IN_HOUSE_CHART_PAIRS in
  // MarketView.tsx) already has a real permanent candle archive to aggregate from.
  const xauEndpoint = useEndpoint<XauIntradayResponse>(
    isXau ? `/api/market/xau-intraday?interval=${interval}` : null,
    POLL_MS
  );
  const genericEndpoint = useEndpoint<GenericCandlesResponse>(
    !isXau && interval === '5m' ? '/api/market/candles' : null,
    POLL_MS
  );
  const nonXauIntradayEndpoint = useEndpoint<NonXauIntradayResponse>(
    !isXau && interval !== '5m' ? `/api/market/intraday?pairId=${pairId}&interval=${interval}` : null,
    POLL_MS
  );
  const { data: rawData, error, isLoading, reload } = isXau
    ? xauEndpoint
    : interval === '5m'
      ? genericEndpoint
      : nonXauIntradayEndpoint;

  // EOD is on-demand, not continuously polled (matches /api/market/eod's own 15-minute server-side
  // cache) - refetches only when the pairId/interval actually changes (a fresh `url`) or the reader
  // hits Retry, never on a 5s timer like the intraday paths above.
  const eodEndpoint = useEndpoint<EodApiResponse>(
    chartMode === 'eod' && eodSupported ? `/api/market/eod?pairId=${pairId}&interval=${eodInterval}` : null
  );
  const eodBars: Bar[] = useMemo(() => {
    if (!eodEndpoint.data || !eodEndpoint.data.success) return [];
    return eodEndpoint.data.candles
      .map((c) => ({ time: Math.floor(c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c }))
      .sort((a, b) => (a.time as number) - (b.time as number));
  }, [eodEndpoint.data]);
  const eodShowUnavailable = chartMode === 'eod' && (Boolean(eodEndpoint.error) || eodEndpoint.data?.success === false) && (!eodEndpoint.data || eodEndpoint.data.success === false);
  const eodShowEmpty = chartMode === 'eod' && !eodShowUnavailable && !eodEndpoint.isLoading && Boolean(eodEndpoint.data) && eodBars.length === 0;
  const eodHasCandles = chartMode === 'eod' && eodBars.length > 0;

  // Normalize all three intraday response shapes into the same candle array this component
  // already knows how to render - the ONLY place their differing shapes are reconciled.
  const candles: XauIntradayCandle[] | null = useMemo(() => {
    if (!rawData) return null;
    if (isXau) return (rawData as XauIntradayResponse).candles;
    if (interval === '5m') return (rawData as GenericCandlesResponse).candles[pairId] || [];
    return (rawData as NonXauIntradayResponse).candles;
  }, [rawData, isXau, pairId, interval]);

  // Track theme changes the same way TradingViewChart does, so this chart's colors follow the
  // app's own light/dark toggle instead of being frozen at whatever theme was active on mount.
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          const currentTheme = document.documentElement.getAttribute('data-theme');
          setChartTheme(currentTheme === 'light' ? 'light' : 'dark');
        }
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // Create the chart + candlestick series + indicator line series once per container/theme.
  // autoSize tracks the container's own dimensions via ResizeObserver, so no manual resize wiring
  // is needed. Every color below is read live off the app's own CSS variables (src/index.css) -
  // same palette the TradingView widget's theme prop is configured with for every other pair, so
  // this chart reads as the same product instead of a visually bolted-on second one.
  useEffect(() => {
    if (!containerRef.current) return;

    const textColor = cssVar('--text-secondary', chartTheme === 'light' ? '#475569' : '#9D9D9D');
    const gridColor = cssVar('--border-subtle', chartTheme === 'light' ? '#E2E8F0' : '#202020');
    const scaleBorderColor = cssVar('--border-strong', chartTheme === 'light' ? '#CBD5E1' : '#333333');
    const upColor = cssVar('--color-up', '#2ECC71');
    const downColor = cssVar('--color-down', '#FF4D4F');
    const crosshairColor = cssVar('--text-muted', chartTheme === 'light' ? '#64748B' : '#6F6F6F');
    const crosshairLabelBg = cssVar('--bg-panel', chartTheme === 'light' ? '#FFFFFF' : '#0E0E0E');

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor,
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, "Roboto Mono", monospace',
        panes: { separatorColor: gridColor },
        // lightweight-charts' free/OSS default shows a small "brought to you by TradingView"
        // watermark logo. Turning it off (a supported, license-safe option - lightweight-charts is
        // MIT-licensed with no attribution requirement) keeps this reading as HEVORA's own chart,
        // consistent with the whole point of this replacement: one product, not a HEVORA shell
        // around a visibly TradingView-branded widget.
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: gridColor, style: LineStyle.Solid },
        horzLines: { color: gridColor, style: LineStyle.Solid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: crosshairColor,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: crosshairLabelBg,
        },
        horzLine: {
          color: crosshairColor,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: crosshairLabelBg,
        },
      },
      rightPriceScale: {
        borderColor: scaleBorderColor,
        textColor,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderColor: scaleBorderColor,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
      },
      // Rendered price/time labels on the axes at the crosshair position - the "label harga &
      // waktu di pinggir chart" the task asks for; both are on by default but stated explicitly
      // here so a future lightweight-charts default change can't silently turn them off.
      localization: {
        priceFormatter: (p: number) => formatPrice(p, digits),
      },
    });

    // 2026-08-31 (indicator/color follow-up): re-evaluated against the app's own --color-up/
    // --color-down (already the single source for these, not a second hand-picked palette) -
    // confirmed via a real render (Playwright screenshot, both themes) to already read as vibrant
    // and clearly contrasted against HEVORA's near-black base. The one refinement made here: the
    // body fill now sits at 92% opacity while the border/wick stay fully solid - a common
    // professional-terminal treatment (a hair more depth on the body without softening the
    // wick/border edges that carry the actual high/low information).
    const upBody = cssVar('--color-up', '#2ECC71') + 'EB';
    const downBody = cssVar('--color-down', '#FF4D4F') + 'EB';

    const series = chart.addSeries(CandlestickSeries, {
      upColor: upBody,
      downColor: downBody,
      borderUpColor: upColor,
      borderDownColor: downColor,
      wickUpColor: upColor,
      wickDownColor: downColor,
      priceFormat: { type: 'price', precision: digits, minMove: Math.pow(10, -digits) },
    });

    // Indicator overlays - created up front, hidden by default (visible synced by the effect
    // below), never priced on the axis label/price-line (that clutter belongs to the candles and
    // the signal's SL/TP price lines only) and excluded from the crosshair's own price marker.
    const lineDefaults = {
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      visible: false,
    } as const;
    indicatorSeriesRef.current = {
      ema9: chart.addSeries(LineSeries, { ...lineDefaults, color: INDICATOR_DEFS.ema9.color, lineWidth: 2 }),
      ema21: chart.addSeries(LineSeries, { ...lineDefaults, color: INDICATOR_DEFS.ema21.color, lineWidth: 2 }),
      sma20: chart.addSeries(LineSeries, { ...lineDefaults, color: INDICATOR_DEFS.sma20.color, lineWidth: 2 }),
      bbUpper: chart.addSeries(LineSeries, { ...lineDefaults, color: INDICATOR_DEFS.bb20.color, lineWidth: 1, lineStyle: LineStyle.Dashed }),
      bb20: chart.addSeries(LineSeries, { ...lineDefaults, color: INDICATOR_DEFS.bb20.color, lineWidth: 1 }), // mid band
      bbLower: chart.addSeries(LineSeries, { ...lineDefaults, color: INDICATOR_DEFS.bb20.color, lineWidth: 1, lineStyle: LineStyle.Dashed }),
    };
    // Oscillator panes are built separately, lazily, only for whichever ones are currently active
    // (see rebuildOscillatorPanes's own comment on why - setHeight(0) cannot actually collapse a
    // pane). Called once here so a freshly (re)created chart - first mount, or a theme swap that
    // tore down the previous chart instance - immediately restores whichever oscillators were on.
    rebuildOscillatorPanes(chart, indicatorSeriesRef.current, activeIndicatorsRef.current, chartMode === 'eod' ? eodBars : barsRef.current);

    chart.subscribeCrosshairMove((param: MouseEventParams<UTCTimestamp>) => {
      if (!param.time) {
        setIsHovering(false);
        return;
      }
      const idx = barsRef.current.findIndex((b) => b.time === param.time);
      if (idx === -1) {
        setIsHovering(false);
        return;
      }
      setIsHovering(true);
      setHoverLegend(buildLegendFromBars(barsRef.current, idx));
    });

    chartRef.current = chart;
    seriesRef.current = series;
    priceLinesRef.current = [];
    hasFitRef.current = false;

    // A theme swap tears down and recreates the chart/series above, but the data-push effect below
    // only re-runs when a fresh poll actually lands (its dependency is `data`, not `chartTheme`) -
    // without this, the new series would sit empty for up to POLL_MS after every theme toggle, a
    // real flicker-to-blank regression (the exact thing point 7 asks this pass to avoid). barsRef
    // survives the recreation (it's a ref, not series state), so repaint the new series from it
    // immediately whenever there's already real data to show.
    if (barsRef.current.length > 0) {
      const bars = barsRef.current;
      series.setData(fillGapsWithWhitespace(bars, BUCKET_MS[interval]));
      chart.timeScale().fitContent();
      hasFitRef.current = true;
      lastRenderedTimeRef.current = bars[bars.length - 1].time as number;

      setAllIndicatorData(indicatorSeriesRef.current, bars);
    }

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
      indicatorSeriesRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartTheme, digits]);

  // Keep the ref mirror in sync on every activeIndicators change, so the chart-creation effect
  // (which intentionally excludes activeIndicators from its own deps) always sees the latest
  // toggle state when it needs to rebuild oscillator panes after a theme swap.
  useEffect(() => {
    activeIndicatorsRef.current = activeIndicators;
  }, [activeIndicators]);

  // Sync each OVERLAY indicator's visibility to its toggle state - these all live permanently on
  // the main pane (created once, never removed), so a simple visible:true/false toggle is correct
  // and cheap. Runs after the creation effect above so it always targets the CURRENT series
  // instances, including right after a theme-swap recreation.
  useEffect(() => {
    const refs = indicatorSeriesRef.current;
    refs.ema9?.applyOptions({ visible: activeIndicators.ema9 });
    refs.ema21?.applyOptions({ visible: activeIndicators.ema21 });
    refs.sma20?.applyOptions({ visible: activeIndicators.sma20 });
    refs.bbUpper?.applyOptions({ visible: activeIndicators.bb20 });
    refs.bb20?.applyOptions({ visible: activeIndicators.bb20 });
    refs.bbLower?.applyOptions({ visible: activeIndicators.bb20 });
  }, [activeIndicators.ema9, activeIndicators.ema21, activeIndicators.sma20, activeIndicators.bb20]);

  // Oscillators are NOT toggled via visible:true/false - a lightweight-charts pane cannot be
  // shrunk to 0px (see rebuildOscillatorPanes's own comment), so an inactive oscillator's pane and
  // series are fully torn down instead of hidden. This effect fires only when one of the four
  // oscillator flags actually changes (a user click, not a per-poll cost) or after a theme swap
  // recreates the chart (the creation effect handles that first call; chartTheme is still a
  // dependency here so this effect's own rebuild stays in sync going forward).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    rebuildOscillatorPanes(chart, indicatorSeriesRef.current, activeIndicators, chartMode === 'eod' ? eodBars : barsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndicators.rsi14, activeIndicators.macd, activeIndicators.stochRsi, activeIndicators.atr14, chartTheme, chartMode]);

  // Reset the "already fitted" flag whenever the requested interval changes - a genuinely new
  // dataset (different bucket width, different bar count) deserves a fresh fitContent(), unlike a
  // routine poll within the same interval. lastRenderedTimeRef resets too, purely for clarity - the
  // next response always lands via the full setData() branch (hasFitRef is false), which doesn't
  // consult this guard to decide whether to apply itself, only records into it afterward - but
  // leaving a stale threshold from the OLD interval's timestamp grid sitting here between the
  // switch and that first response is confusing to reason about even though it's harmless.
  useEffect(() => {
    hasFitRef.current = false;
    lastRenderedTimeRef.current = -Infinity;
  }, [interval, chartMode]);

  // Reset all per-pair chart state when the pair itself changes (e.g. a future multi-pair page that
  // reuses one mounted instance across pairs) - a different pairId is a wholly different dataset,
  // same as an interval switch above.
  useEffect(() => {
    hasFitRef.current = false;
    lastRenderedTimeRef.current = -Infinity;
    barsRef.current = [];
    setBarCount(0);
    setHoverLegend(null);
    // Re-applies this pair's OWN saved layout (or the all-off/5m default if it has none) - a no-op
    // on first mount (the useState initializers above already loaded the same values), but correct
    // if this same component instance is ever reused across pairs later.
    const saved = loadChartLayout(pairId);
    setInterval(saved?.interval ?? '5m');
    setActiveIndicators({
      ema9: false, ema21: false, sma20: false, bb20: false,
      rsi14: false, macd: false, stochRsi: false, atr14: false,
      ...saved?.activeIndicators,
    });
  }, [pairId]);

  // Persist the current interval + indicator toggles for THIS pair on every change, so reloading
  // the page (or coming back to this pair later) restores the same view instead of resetting to
  // the hardcoded defaults - the "saved layout" feature. Deliberately does NOT include drawings
  // (no drawing-tools feature exists on this chart yet) or the theme (already its own app-wide
  // setting, not per-chart). Skipped on the very first render after a pairId change (that render's
  // values came FROM storage via the effect above, so writing them back is a redundant no-op).
  const skipNextSaveRef = useRef(true);
  useEffect(() => {
    skipNextSaveRef.current = true;
  }, [pairId]);
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    saveChartLayout(pairId, { interval, activeIndicators });
  }, [pairId, interval, activeIndicators]);

  // Push real candle data into the series whenever a fresh poll lands. First load (or an interval
  // switch) does a full setData()+fitContent(); every subsequent poll only pushes the trailing 1-2
  // bars via update() - the forming bar's live tick-by-tick changes, plus a newly-closed bar if
  // one just appeared - so an already-panned/zoomed view is never yanked back to "fit all" every
  // 5 seconds, and nothing about the other already-rendered bars is re-sent or re-drawn. Indicator
  // overlays always go through setData() (never update()) regardless - they're cheap to fully
  // recompute (<=150 points) and setData has none of the strict-increasing-time constraints
  // update() does, so there's no equivalent ordering risk to guard there.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !candles) return;
    const bars: Bar[] = candles
      .map((c) => ({ time: Math.floor(c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    barsRef.current = bars;
    setBarCount(bars.length);
    if (bars.length === 0) return;

    // Replay mode and EOD mode both own the series while active (see their own dedicated effects
    // below) - this effect still updates barsRef.current/barCount above unconditionally so the
    // replay scrubber's upper bound and "resume live" data stay current in the background even
    // while EOD/replay has the visible series, it just skips pushing anything to it itself.
    if (replayEnabled || chartMode !== 'intraday') return;

    const bucketMs = BUCKET_MS[interval];

    // Gap-fill for DISPLAY only (see fillGapsWithWhitespace's own comment) - indicators/legend/
    // crosshair below all keep using the real-only `bars` array; only what's actually sent to
    // lightweight-charts' series gets whitespace entries inserted.
    const display = fillGapsWithWhitespace(bars, bucketMs);

    if (!hasFitRef.current) {
      // A full setData() replaces the series' entire internal state, so it's always safe
      // regardless of what was rendered before (theme swap, interval switch, or first mount).
      series.setData(display);
      chartRef.current?.timeScale().fitContent();
      hasFitRef.current = true;
      lastRenderedTimeRef.current = bars[bars.length - 1].time as number;
    } else {
      // URGENT crash fix (2026-08-31): root-caused via a real reproduction (Playwright, mocked
      // out-of-order network responses + rapid interval switching) to useEndpoint applying
      // whichever response resolved LAST rather than whichever was requested last - fixed at that
      // root in useEndpoint.ts. This is the second, independent layer: series.update() is only
      // ever called with a time that is >= the last time this component actually rendered,
      // checked BEFORE the call via lastRenderedTimeRef - never via try/catch after the fact, so a
      // rejected point is a deliberate, logged skip (this poll's update for that point is dropped,
      // the next good poll corrects it), not a silently-swallowed exception. lightweight-charts'
      // update() is happy with a time equal to what it already has (an in-place update of the same
      // point) - only a STRICTLY earlier time is invalid, so the guard here is >=, not >.
      //
      // Bagian G follow-up: pulled from `display` (gap-filled), not `bars`, and filtered by time
      // rather than a fixed trailing-2 slice - if a gap just opened up live (the tick feed went
      // quiet since the last poll), the new whitespace slot(s) between the last rendered point and
      // the new one need to be pushed too, not just the newest real bar.
      const trailingDisplay = display.filter((p) => (p.time as number) >= lastRenderedTimeRef.current);
      for (const point of trailingDisplay) {
        const pointTime = point.time as number;
        if (pointTime < lastRenderedTimeRef.current) {
          console.warn(
            `[LightweightChart:${pairId}] Dropped an out-of-order candle update (point time ${pointTime} < last rendered ${lastRenderedTimeRef.current}) instead of sending it to lightweight-charts - this would have thrown "Cannot update oldest data". The next valid poll will catch the chart back up.`
          );
          continue;
        }
        series.update(point);
        lastRenderedTimeRef.current = pointTime;
      }
    }

    setAllIndicatorData(indicatorSeriesRef.current, bars);

    // Keep the on-canvas legend showing the latest bar while nothing is being hovered.
    if (!isHovering) setHoverLegend(buildLegendFromBars(bars, bars.length - 1));
    // isHovering deliberately excluded - re-running this whole effect on every hover/unhover would
    // fight the crosshair handler above for control of hoverLegend during a poll that lands
    // mid-hover. It's read fresh via the closure each time `candles` actually changes instead.
    // replayEnabled IS included - exiting replay (replayIndex -> null) needs this effect to
    // immediately re-push the live series/indicators/legend, not wait for the next poll. chartMode
    // is included for the same reason - switching back from EOD to Live needs this to re-render
    // immediately rather than waiting for the next 5s poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, replayEnabled, chartMode]);

  // Renders the replay slice (bars[0..replayIndex)) whenever replay is active and its index moves -
  // a full setData() each time (never update()), since replay can jump by any amount (a scrubber
  // drag, not just +/-1 steps) and setData has none of update()'s strictly-increasing-time
  // constraint. Indicators get the same real-only (non-gap-filled) bars slice as the live path
  // above uses for them. Deliberately does NOT call fitContent() on every step - only once when
  // replay is first entered - so scrubbing/playing doesn't fight a reader's own pan/zoom.
  const replayHasFitRef = useRef(false);
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || replayIndex === null) {
      replayHasFitRef.current = false;
      return;
    }
    const bars = barsRef.current;
    const slice = bars.slice(0, replayIndex);
    if (slice.length === 0) return;

    const bucketMs = BUCKET_MS[interval];
    series.setData(fillGapsWithWhitespace(slice, bucketMs));
    setAllIndicatorData(indicatorSeriesRef.current, slice);
    if (!isHovering) setHoverLegend(buildLegendFromBars(slice, slice.length - 1));

    if (!replayHasFitRef.current) {
      chartRef.current?.timeScale().fitContent();
      replayHasFitRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayIndex, isXau, interval]);

  // Auto-play: steps replayIndex forward by one bar every REPLAY_STEP_MS while replayPlaying is
  // true, stopping (and un-setting replayPlaying) the moment it catches up to the live bar count -
  // "caught up to now" is where replay naturally ends, not a state a reader has to notice and stop
  // manually.
  useEffect(() => {
    if (!replayPlaying || replayIndex === null) return;
    const id = window.setInterval(() => {
      setReplayIndex((idx) => {
        if (idx === null) return idx;
        const next = idx + 1;
        if (next >= barsRef.current.length) {
          setReplayPlaying(false);
          return barsRef.current.length;
        }
        return next;
      });
    }, REPLAY_STEP_MS);
    return () => window.clearInterval(id);
  }, [replayPlaying, replayIndex === null]);

  const startReplay = () => {
    const total = barsRef.current.length;
    if (total < 2) return; // nothing meaningful to replay yet
    // Starts 3/4 of the way through the currently-loaded history by default - enough real bars
    // behind the start point to read structure, and enough ahead of it to step through before
    // catching up to "now". A reader can immediately drag the scrubber anywhere else.
    setReplayIndex(Math.max(1, Math.floor(total * 0.75)));
    setReplayPlaying(false);
  };
  const exitReplay = () => {
    setReplayIndex(null);
    setReplayPlaying(false);
  };
  const stepReplay = (delta: number) => {
    setReplayIndex((idx) => {
      if (idx === null) return idx;
      return Math.max(1, Math.min(barsRef.current.length, idx + delta));
    });
  };

  // Renders EOD bars whenever chartMode is 'eod' and a fresh D/W/M response lands - always a full
  // setData() (never update()), since these bars come from an on-demand fetch, not a live-ticking
  // feed. Indicators/legend reuse the exact same helpers the intraday/replay paths already use,
  // just fed eodBars instead - computing RSI/MACD/etc. on daily/weekly/monthly bars is a real,
  // useful feature, not something that needs its own separate math.
  useEffect(() => {
    eodHasFitRef.current = false;
  }, [chartMode, eodInterval, pairId]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || chartMode !== 'eod') return;
    if (eodBars.length === 0) return;
    series.setData(eodBars);
    setAllIndicatorData(indicatorSeriesRef.current, eodBars);
    if (!isHovering) setHoverLegend(buildLegendFromBars(eodBars, eodBars.length - 1));
    if (!eodHasFitRef.current) {
      chartRef.current?.timeScale().fitContent();
      eodHasFitRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eodBars, chartMode]);

  // Overlay the active signal's entry/SL/TP1/TP2 levels as horizontal price lines. Cleared and
  // redrawn whenever the signal changes (including going to null on completion) or the series is
  // recreated (theme swap).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // Series may already be gone (unmount race) - nothing to clean up in that case.
      }
    }
    priceLinesRef.current = [];

    if (!signal) return;

    // One consistent line style for every level (2026-09-01, corrected per the user's own
    // follow-up: SL/TP1/TP2 used to render solid while Entry rendered dashed at the same
    // lineWidth:1 - fixed once already by making everything dashed at lineWidth:1, but the user
    // came back and said the READ they actually wanted was the opposite: all four BOLDER than
    // before, not thinner, while still uniform with each other. lineWidth:2 (solid) for every
    // level now - still one single style shared by all four, just a heavier one. Color is the
    // only thing that still varies per level (explicitly asked to keep - it's how Entry/SL/TP1/
    // TP2 stay tellable apart at a glance).
    const lines: Array<{ price: number; color: string; title: string }> = [
      { price: signal.entryMin, color: '#8A8F98', title: 'Entry' },
      { price: signal.entryMax, color: '#8A8F98', title: 'Entry' },
      { price: signal.stopLoss, color: '#FF4D4F', title: 'SL' },
      { price: signal.takeProfit1, color: '#2ECC71', title: 'TP1' },
      { price: signal.takeProfit2, color: '#1DD1A1', title: 'TP2' },
    ];

    for (const line of lines) {
      if (typeof line.price !== 'number' || Number.isNaN(line.price)) continue;
      const created = series.createPriceLine({
        price: line.price,
        color: line.color,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: line.title,
      });
      priceLinesRef.current.push(created);
    }
  }, [signal, chartTheme]);

  // Close the Indicators dropdown on an outside click or Escape - standard menu behavior, not
  // wired up before because the row it replaces was never a dropdown (always expanded inline).
  useEffect(() => {
    if (!indicatorsMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (indicatorsMenuRef.current?.contains(target) || indicatorsButtonRef.current?.contains(target)) return;
      setIndicatorsMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIndicatorsMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [indicatorsMenuOpen]);

  // Track whether THIS chart card (not some other element) is the one currently fullscreened, so
  // the toggle button's icon/label reflects reality even if fullscreen was exited via Escape or the
  // browser's own UI rather than this button.
  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === cardRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement === cardRef.current) {
      document.exitFullscreen().catch(() => {
        // Some embedding contexts (e.g. a cross-origin iframe without allow="fullscreen") reject
        // this - nothing more this component can do about that; the button just stays as-is.
      });
    } else {
      cardRef.current?.requestFullscreen().catch(() => {
        // Same - a rejected request just leaves the chart in its normal (non-fullscreen) layout.
      });
    }
  };

  // Exports exactly what's currently rendered (candles + whichever overlays/oscillators are on) as
  // a PNG, via lightweight-charts' own documented takeScreenshot() - real pixels off the canvas,
  // not a re-render or a separate export pipeline that could drift from what's actually on screen.
  const handleScreenshot = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const canvas = chart.takeScreenshot();
    const link = document.createElement('a');
    link.download = `hevora-${pairId.toLowerCase()}-${interval}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  // Drawing templates/style presets (Bagian J Tugas 5) - its own small hook, independent of
  // useDrawingTools' canvas/hit-testing concerns (see useDrawingTemplates.ts's own comment).
  const {
    templates: drawingTemplates,
    defaultTemplateId: drawingDefaultTemplateId,
    defaultStyle: drawingDefaultStyle,
    saveTemplate: saveDrawingTemplate,
    deleteTemplate: deleteDrawingTemplate,
    setDefaultTemplateId: setDrawingDefaultTemplateId,
  } = useDrawingTemplates();

  // Drawing-tools framework (Bagian F) - only actually mounted (canvas element rendered, listeners
  // attached) when drawingToolsEnabled is true, so calling the hook unconditionally here costs
  // nothing extra for the current production route (drawingToolsEnabled defaults to false).
  const {
    canvasRef: drawingCanvasRef,
    activeTool,
    setActiveTool,
    magnetMode,
    setMagnetMode,
    selectedDrawing,
    contextMenu,
    closeContextMenu,
    toggleLockSelected,
    toggleHideSelected,
    duplicateSelected,
    updateSelectedStyle,
    deleteSelected,
    clearAll,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useDrawingTools({ pairId, chart: chartRef.current, series: seriesRef.current, bars: barsRef.current, digits, defaultStyle: drawingDefaultStyle });

  // Saving a new template also makes it the default for future drawings (matches TradingView's
  // own "apply a template" behavior - picking one is both "use this look now" and "keep using
  // it"), and applying an existing template does the same plus live-restyles the current
  // selection if there is one.
  const handleSaveDrawingTemplate = (name: string, color: string, lineWidth: number) => {
    const created = saveDrawingTemplate(name, color, lineWidth);
    setDrawingDefaultTemplateId(created.id);
  };
  const handleApplyDrawingTemplate = (id: string) => {
    const tpl = drawingTemplates.find((t) => t.id === id);
    if (!tpl) return;
    setDrawingDefaultTemplateId(id);
    if (selectedDrawing) updateSelectedStyle({ color: tpl.color, lineWidth: tpl.lineWidth });
  };

  const hasCandles = (candles?.length ?? 0) > 0;
  const showUnavailable = Boolean(error) && !rawData;
  const showEmpty = !showUnavailable && !isLoading && rawData !== null && rawData !== undefined && !hasCandles;
  // 2026-09-01 (retention raised 150->300 bars, persistence-across-restarts follow-up): XAUUSD's
  // 1h/4h are permanently capped at ~25h of candleStore.XAUUSD's rolling retention (~25 bars for
  // 1h, ~6 for 4h) - a structural ceiling, not a "still filling in" state that keeps improving with
  // more server uptime. XAUUSD-only concept (the only pair with an interval switch at all right
  // now) - not shown for any other pair.
  const showShortHistoryNote = (interval === '1h' || interval === '4h') && hasCandles;

  const legendColor = useMemo(() => {
    if (!hoverLegend) return 'var(--text-secondary)';
    return hoverLegend.changeAbs >= 0 ? 'var(--color-up)' : 'var(--color-down)';
  }, [hoverLegend]);

  const activeIndicatorCount = INDICATOR_ORDER.filter((key) => activeIndicators[key]).length;

  return (
    <div
      ref={cardRef}
      className="w-full hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] overflow-hidden transition-all duration-300 flex flex-col [&:fullscreen]:h-screen [&:fullscreen]:rounded-none bg-[var(--bg-base)]"
    >
      {/* Title Bar - mirrors TradingViewChart's own layout so swapping between pairs doesn't jump
          the surrounding page. Reorganized 2026-09-01 (Bagian F tambahan) to follow the TradingView
          reference this follow-up asked to match: pair info left; interval, Indicators, fullscreen,
          screenshot, then the status badge on the right. Alert/Replay/a saved-layout SELECTOR are
          deliberately absent - those depend on features that don't exist yet (no alerts, no replay
          mode, and layout is auto-saved per pair rather than a set of named templates to pick
          between) - adding buttons for them now would be exactly the kind of decorative,
          non-functional UI this project's own "AI-generic" audit flags. Undo/redo for drawings now
          DOES exist (see useDrawingTools.ts) - its buttons live in the left drawing toolbar below,
          grouped with the rest of the drawing controls, rather than here. */}
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] text-xs font-mono">
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full ${showUnavailable ? 'bg-[var(--color-down)]' : 'bg-[#2ECC71] animate-pulse'}`} />
          <span className="font-black text-sm text-[var(--text-primary)] tracking-wide">{pairName}</span>
          <span className="text-[var(--text-muted)]">|</span>
          <span className="text-[var(--text-secondary)] text-xs font-bold">{pairId}</span>
          {isXau && (
            <span title={t('market.xauChartSourceLabel')} className="cursor-help shrink-0 inline-flex">
              <Info className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Interval switch. 2026-09-01 ("samain tombol interval semua pair" follow-up): 5m/15m/
              1h/4h are now real for every pair this component renders (XAUUSD via
              /api/market/xau-intraday, every other pair via /api/market/candles for 5m and the
              new archive-backed /api/market/intraday for 15m/1h/4h - see that endpoint's own
              comment in server.ts). D/W/M (Bagian J Tugas 1) stays its own separate on-demand
              fetch (/api/market/eod, never mixed with the intraday pipe), shown for every pair
              that endpoint has a real source for (EOD_SUPPORTED_PAIRS above). */}
          <div className="flex items-center gap-0.5 p-0.5 bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-full mr-1">
              {(['5m', '15m', '1h', '4h'] as const).map((iv) => (
                  <button
                    key={iv}
                    type="button"
                    onClick={() => {
                      setChartMode('intraday');
                      setInterval(iv);
                    }}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer ${
                      chartMode === 'intraday' && interval === iv
                        ? 'bg-[var(--text-primary)] text-[var(--bg-base)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    {iv.toUpperCase()}
                  </button>
                ))}
              {eodSupported &&
                (['1D', '1W', '1M'] as const).map((iv) => (
                  <button
                    key={iv}
                    type="button"
                    onClick={() => {
                      if (replayEnabled) exitReplay();
                      setChartMode('eod');
                      setEodInterval(iv);
                    }}
                    title={iv === '1D' ? 'Daily' : iv === '1W' ? 'Weekly' : 'Monthly'}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer ${
                      chartMode === 'eod' && eodInterval === iv
                        ? 'bg-[var(--text-primary)] text-[var(--bg-base)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    {iv.replace('1', '')}
                  </button>
                ))}
            </div>
          {isXau && chartMode === 'eod' && (
            <span
              title={eodEndpoint.data?.disclosure || 'Data futures GC=F - bisa sedikit beda dari harga spot header/intraday (yang baca harga spot)'}
              className="px-1.5 py-0.5 rounded bg-[var(--color-brand)]/10 border border-[var(--color-brand)]/25 text-[var(--color-brand)] text-[9px] font-black uppercase tracking-wider cursor-help shrink-0 mr-1"
            >
              Futures GC=F
            </span>
          )}

          {/* Indicators button - icon + label text (per the reference), opens/closes the panel
              below rather than the old always-expanded row. The count badge is real state (how
              many are actually on), not decoration. */}
          <div className="relative">
            <button
              ref={indicatorsButtonRef}
              type="button"
              onClick={() => setIndicatorsMenuOpen((v) => !v)}
              aria-expanded={indicatorsMenuOpen}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                indicatorsMenuOpen ? 'bg-[var(--bg-panel)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('market.xauChartIndicatorsLabel')}</span>
              {activeIndicatorCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded-full bg-[var(--color-brand)] text-[var(--bg-base)] text-[9px] font-black">
                  {activeIndicatorCount}
                </span>
              )}
            </button>

            {indicatorsMenuOpen && (
              <div
                ref={indicatorsMenuRef}
                className="absolute right-0 top-full mt-1.5 z-20 w-64 max-h-80 overflow-y-auto p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-lg flex flex-col gap-1"
              >
                {INDICATOR_ORDER.map((key) => {
                  const def = INDICATOR_DEFS[key];
                  const insufficientData = barCount > 0 && barCount < def.minBars;
                  const active = activeIndicators[key];
                  const tooltip = insufficientData
                    ? t('market.xauChartIndicatorInsufficientData').replace('{needed}', String(def.minBars)).replace('{have}', String(barCount))
                    : undefined;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={insufficientData}
                      onClick={() => setActiveIndicators((prev) => ({ ...prev, [key]: !prev[key] }))}
                      title={tooltip}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded text-[11px] font-bold font-mono text-left transition-colors ${
                        insufficientData
                          ? 'opacity-40 cursor-not-allowed text-[var(--text-muted)]'
                          : active
                          ? ''
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] cursor-pointer'
                      }`}
                      style={active && !insufficientData ? { backgroundColor: `${def.color}1F`, color: def.color } : undefined}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: def.color }} />
                      {def.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => (replayEnabled ? exitReplay() : startReplay())}
            title={
              replayEnabled
                ? 'Keluar dari Replay'
                : chartMode === 'eod'
                ? 'Replay hanya untuk chart Live (intraday) - kembali ke Live dulu'
                : 'Replay - mundur ke candle lama, jalan step-by-step atau auto-play'
            }
            disabled={!replayEnabled && (barCount < 2 || chartMode === 'eod')}
            className={`inline-flex items-center justify-center w-7 h-7 rounded transition-colors ${
              replayEnabled
                ? 'bg-[var(--color-brand)]/20 text-[var(--color-brand)]'
                : barCount < 2 || chartMode === 'eod'
                ? 'text-[var(--text-muted)] opacity-40 cursor-not-allowed'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)] cursor-pointer'
            }`}
          >
            <History className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? t('market.chartExitFullscreen') : t('market.chartFullscreen')}
            className="inline-flex items-center justify-center w-7 h-7 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)] transition-colors cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={handleScreenshot}
            title={t('market.chartScreenshot')}
            className="inline-flex items-center justify-center w-7 h-7 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)] transition-colors cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>

          <span className="text-[var(--text-muted)] hidden sm:inline ml-1">|</span>
          {chartMode === 'eod' ? (
            !eodShowUnavailable && eodHasCandles ? (
              <span className="px-2.5 py-0.5 rounded bg-[var(--color-brand)]/10 border border-[var(--color-brand)]/20 text-[var(--color-brand)] font-extrabold tracking-wider hidden sm:inline">
                {eodInterval} DATA
              </span>
            ) : eodShowUnavailable ? (
              <span className="px-2.5 py-0.5 rounded bg-[var(--color-down)]/10 border border-[var(--color-down)]/20 text-[var(--color-down)] font-extrabold tracking-wider">
                {t('market.chartUnavailableBadge')}
              </span>
            ) : null
          ) : !showUnavailable && hasCandles ? (
            <span className="px-2.5 py-0.5 rounded bg-[#2ECC71]/10 border border-[#2ECC71]/20 text-[#2ECC71] font-extrabold tracking-wider hidden sm:inline">
              LIVE DATA
            </span>
          ) : showUnavailable ? (
            <span className="px-2.5 py-0.5 rounded bg-[var(--color-down)]/10 border border-[var(--color-down)]/20 text-[var(--color-down)] font-extrabold tracking-wider">
              {t('market.chartUnavailableBadge')}
            </span>
          ) : null}
        </div>
      </div>

      {/* Replay control bar (Bagian F) - only rendered while replay is active, sits between the
          title bar and the chart canvas so it never overlaps the candles or the drawing overlay. */}
      {replayEnabled && chartMode === 'intraday' && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-panel)] border-b border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={() => setReplayPlaying((v) => !v)}
            title={replayPlaying ? 'Pause' : 'Play'}
            className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
          >
            {replayPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => stepReplay(-1)}
            title="Mundur 1 candle"
            className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => stepReplay(1)}
            title="Maju 1 candle"
            className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
          <input
            type="range"
            min={1}
            max={Math.max(1, barCount)}
            value={Math.min(replayIndex ?? 1, Math.max(1, barCount))}
            onChange={(e) => {
              setReplayPlaying(false);
              setReplayIndex(Number(e.target.value));
            }}
            className="flex-1 accent-[var(--color-brand)] cursor-pointer"
          />
          <span className="font-mono text-[10px] text-[var(--text-muted)] tabular-nums shrink-0">
            {replayIndex}/{barCount}
          </span>
          <button
            type="button"
            onClick={exitReplay}
            title="Tutup Replay"
            className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--text-secondary)] hover:text-[var(--color-down)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Drawing-tools framework (Bagian F, 2026-09-01) - built alongside the toolbar/grip
          follow-ups, verified with real Playwright checks (see useDrawingTools.ts/DrawingToolbar's
          own comments), but deliberately NOT enabled by default here yet: this whole row only
          renders when explicitly turned on via the drawingToolsEnabled prop, so nothing about the
          production chart's current behavior changes until the user has tested it for real and
          this component's caller opts in. */}
      {/* This row is given the SAME explicit responsive height the chart frame used to own alone
          (moved up here) - a flex row with no height of its own just grows to fit its tallest
          child, and the drawing toolbar's ~27 stacked buttons (Bagian F v2) are taller than that.
          Giving the row itself a real height lets both children resolve h-full against something
          concrete, so the toolbar scrolls internally (see its own overflow-y-auto) instead of
          stretching the whole card - and pushing the page - taller than intended. */}
      <div className={isFullscreen ? 'flex flex-1 min-h-0' : 'flex h-[340px] sm:h-[360px] md:h-[420px] lg:h-[54vh] xl:h-[60vh] min-h-0'}>
        {/* Drawing tools stay intraday-only for now (Bagian J Tugas 1 scope) - a drawing's pixel
            coordinates are meaningful relative to whichever bars are currently on the series, and
            switching to EOD replaces that entirely, so the toolbar/overlay hide rather than risk
            a drawing rendering against the wrong dataset. */}
        {drawingToolsEnabled && chartMode === 'intraday' && (
          <DrawingToolbar
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            magnetMode={magnetMode}
            onToggleMagnet={() => setMagnetMode((v) => !v)}
            selectedDrawing={selectedDrawing}
            contextMenu={contextMenu}
            onCloseContextMenu={closeContextMenu}
            onToggleLock={toggleLockSelected}
            onToggleHide={toggleHideSelected}
            onDuplicate={duplicateSelected}
            onDelete={deleteSelected}
            onClearAll={clearAll}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            templates={drawingTemplates}
            defaultTemplateId={drawingDefaultTemplateId}
            defaultStyle={drawingDefaultStyle}
            onUpdateSelectedStyle={updateSelectedStyle}
            onSaveTemplate={handleSaveDrawingTemplate}
            onDeleteTemplate={deleteDrawingTemplate}
            onApplyTemplate={handleApplyDrawingTemplate}
          />
        )}
      {/* Chart Canvas Frame - takes the rest of the row's now-explicit height (see the row div's
          own comment above); fullscreen still grows via flex-1 same as before, :fullscreen only
          matches the actual fullscreened element (cardRef, the outer card), not this descendant,
          so this is real state-driven, not a CSS pseudo-class trick. */}
      <div className="flex-1 min-h-0 w-full relative bg-[var(--bg-base)]">
        {/* On-canvas OHLC legend, TradingView-style: pair symbol + O/H/L/C + change (value & %),
            colored by direction. Shows the hovered candle while the crosshair is over one,
            otherwise the latest (possibly still-forming) bar - never a fabricated value, always
            whichever real candle is currently being looked at. */}
        {(chartMode === 'eod' ? eodHasCandles : hasCandles) && hoverLegend && (
          <div className="absolute top-2 left-2 z-10 flex flex-wrap items-center gap-x-2.5 gap-y-1 px-2.5 py-1.5 rounded-md bg-[var(--bg-base)]/80 backdrop-blur-sm text-[10px] sm:text-[11px] font-mono font-bold pointer-events-none select-none">
            <span className="text-[var(--text-primary)] font-black">
              {pairId} · {chartMode === 'eod' ? eodInterval : (interval).toUpperCase()}
              {isXau && chartMode === 'eod' && <span className="text-[var(--color-brand)]"> (GC=F)</span>}
            </span>
            {/* 2026-08-31 (softened per this follow-up task): the short-history caveat used to be
                a permanently-visible text block taking up real canvas space. Now it's a small,
                familiar info-icon (the exact `title`-tooltip pattern already used elsewhere on this
                chart and across the app) right next to the interval label - present and honest on
                hover/tap, but out of the way otherwise. */}
            {showShortHistoryNote && (
              <span
                title={t(isXau ? 'market.xauChartShortHistoryTooltip' : 'market.nonXauChartShortHistoryTooltip').replace('{interval}', interval.toUpperCase())}
                className="cursor-help pointer-events-auto inline-flex shrink-0"
              >
                <Info className="w-3 h-3 text-[var(--text-muted)]" />
              </span>
            )}
            <span className="text-[var(--text-muted)]">O</span>
            <span style={{ color: legendColor }}>{formatPrice(hoverLegend.open, digits)}</span>
            <span className="text-[var(--text-muted)]">H</span>
            <span style={{ color: legendColor }}>{formatPrice(hoverLegend.high, digits)}</span>
            <span className="text-[var(--text-muted)]">L</span>
            <span style={{ color: legendColor }}>{formatPrice(hoverLegend.low, digits)}</span>
            <span className="text-[var(--text-muted)]">C</span>
            <span style={{ color: legendColor }}>{formatPrice(hoverLegend.close, digits)}</span>
            <span style={{ color: legendColor }}>
              {hoverLegend.changeAbs >= 0 ? '+' : ''}
              {formatPrice(hoverLegend.changeAbs, digits)} ({hoverLegend.changePct >= 0 ? '+' : ''}
              {hoverLegend.changePct.toFixed(2)}%)
            </span>
          </div>
        )}

        {chartMode === 'eod' && eodShowUnavailable ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 z-20 bg-[var(--bg-base)]">
            <div className="w-full max-w-md">
              <UnavailableState
                source="HEVORA Engine (/api/market/eod)"
                detail={`Data ${eodInterval} untuk ${pairId} sedang tidak tersedia dari sumbernya - dicoba lagi, bukan angka rekaan.`}
                action={
                  <button
                    type="button"
                    onClick={() => eodEndpoint.reload()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    {t('market.chartRetry')}
                  </button>
                }
              />
            </div>
          </div>
        ) : chartMode === 'eod' && eodShowEmpty ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 z-20 pointer-events-none">
            <div className="max-w-sm text-center text-[11px] text-[var(--text-muted)] font-mono bg-[var(--bg-base)]/90 px-4 py-3 rounded-lg border border-[var(--border-subtle)]">
              Belum ada bar {eodInterval} untuk {pairId}.
            </div>
          </div>
        ) : chartMode === 'eod' && eodEndpoint.isLoading && !eodEndpoint.data ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2 p-6 pointer-events-none z-20 text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)] animate-pulse" />
            {pairName} {eodInterval} {t('market.chartLoading')}
          </div>
        ) : chartMode === 'intraday' && showUnavailable ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 z-20 bg-[var(--bg-base)]">
            <div className="w-full max-w-md">
              <UnavailableState
                source={isXau ? 'HEVORA Engine (/api/market/xau-intraday)' : 'HEVORA Engine (/api/market/candles)'}
                detail={isXau ? t('market.xauChartUnavailableDetail') : t('market.genericChartUnavailableDetail').replace('{pair}', pairId)}
                action={
                  <button
                    type="button"
                    onClick={() => reload()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    {t('market.chartRetry')}
                  </button>
                }
              />
            </div>
          </div>
        ) : chartMode === 'intraday' && showEmpty ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 z-20 pointer-events-none">
            <div className="max-w-sm text-center text-[11px] text-[var(--text-muted)] font-mono bg-[var(--bg-base)]/90 px-4 py-3 rounded-lg border border-[var(--border-subtle)]">
              {isXau ? t('market.xauChartEmpty') : t('market.genericChartEmpty').replace('{pair}', pairId)}
            </div>
          </div>
        ) : chartMode === 'intraday' && isLoading && !rawData ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 pointer-events-none z-20">
            <div className="w-full h-full absolute inset-0 flex flex-col justify-end gap-2 p-6 opacity-70">
              <div className="w-full h-2/5 rounded-lg bg-[var(--border-subtle)] animate-pulse" />
              <div className="flex gap-2 h-16">
                <div className="flex-1 rounded bg-[var(--border-subtle)] animate-pulse" />
                <div className="flex-1 rounded bg-[var(--border-subtle)] animate-pulse" style={{ animationDelay: '0.15s' }} />
                <div className="flex-1 rounded bg-[var(--border-subtle)] animate-pulse" style={{ animationDelay: '0.3s' }} />
              </div>
            </div>
            <div className="relative z-10 flex items-center gap-2 text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-widest bg-[var(--bg-base)]/80 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2ECC71] animate-pulse" />
              {pairName} {t('market.chartLoading')}
            </div>
          </div>
        ) : null}
        <div ref={containerRef} className="w-full h-full" />
        {drawingToolsEnabled && chartMode === 'intraday' && (
          <canvas
            ref={drawingCanvasRef}
            data-hevora-drawing-overlay="1"
            className="absolute inset-0 w-full h-full z-[6]"
            style={{ cursor: activeTool !== 'cursor' ? 'crosshair' : undefined }}
          />
        )}
      </div>
      </div>
    </div>
  );
};
