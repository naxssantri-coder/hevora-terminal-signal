// Standalone sanity test for the 2026-08-29 XAUUSD signal-engine audit (Tasks 1-4).
//
// WHY THIS EXISTS: server.ts is a monolith that starts polling external APIs and listening on a
// port the moment it's imported (same constraint documented in scripts/test-xauusd-signal-status.ts
// and scripts/backtest-xau-engine.ts), so the real functions cannot be unit-tested by importing
// server.ts directly. This copies the new pure functions VERBATIM from server.ts (not reimplemented
// from memory) so these checks test the real shipped logic. Re-copy the relevant block here if any
// of these functions change in server.ts.
//
// All candle data below is clearly-labeled SYNTHETIC test fixture data used to exercise pure
// function logic (boundary conditions, aggregation math, session-window edges) - never presented
// as, or substituted for, a live market read. This sandbox's egress to gold-api.com/Yahoo/Binance
// is blocked (confirmed repeatedly on this project), so this is what CAN be verified here; anything
// requiring real live data is called out explicitly as NOT verified by this script.

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

// ---- verbatim copies from server.ts ---------------------------------------------------------

function calculateADX(candles: Candle[], period = 14): number {
  if (!candles || candles.length < 5) return 25; // Default neutral

  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;

    trs.push(tr);
    plusDMs.push(plusDM);
    minusDMs.push(minusDM);
  }

  const window = Math.min(trs.length, period);
  if (window === 0) return 25;

  const sliceTR = trs.slice(-window);
  const slicePlusDM = plusDMs.slice(-window);
  const sliceMinusDM = minusDMs.slice(-window);

  const sumTR = sliceTR.reduce((a, b) => a + b, 0) || 0.00001;
  const sumPlusDM = slicePlusDM.reduce((a, b) => a + b, 0);
  const sumMinusDM = sliceMinusDM.reduce((a, b) => a + b, 0);

  const plusDI = (sumPlusDM / sumTR) * 100;
  const minusDI = (sumMinusDM / sumTR) * 100;

  const diDiff = Math.abs(plusDI - minusDI);
  const diSum = plusDI + minusDI || 0.00001;
  const dx = (diDiff / diSum) * 100;

  return Number(dx.toFixed(2));
}

function calculateEMASeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function aggregateXauCandles(candles5m: Candle[], barsPerGroup: number): Candle[] {
  if (!candles5m || candles5m.length === 0) return [];
  const groups: Candle[] = [];
  for (let i = 0; i < candles5m.length; i += barsPerGroup) {
    const slice = candles5m.slice(i, i + barsPerGroup);
    if (slice.length === 0) continue;
    groups.push({
      time: slice[0].time,
      open: slice[0].open,
      high: Math.max(...slice.map((c) => c.high)),
      low: Math.min(...slice.map((c) => c.low)),
      close: slice[slice.length - 1].close,
      volume: slice.reduce((acc, c) => acc + (c.volume || 0), 0),
    });
  }
  return groups;
}

function xauTrendFromAggregatedBars(bars: Candle[]): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (bars.length < 4) return 'NEUTRAL';
  const recent = bars.slice(-8);
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 1; i < recent.length - 1; i++) {
    if (recent[i].high > recent[i - 1].high && recent[i].high > recent[i + 1].high) highs.push(recent[i].high);
    if (recent[i].low < recent[i - 1].low && recent[i].low < recent[i + 1].low) lows.push(recent[i].low);
  }
  if (highs.length >= 2 && lows.length >= 2) {
    const higherHighs = highs[highs.length - 1] > highs[highs.length - 2];
    const higherLows = lows[lows.length - 1] > lows[lows.length - 2];
    const lowerHighs = highs[highs.length - 1] < highs[highs.length - 2];
    const lowerLows = lows[lows.length - 1] < lows[lows.length - 2];
    if (higherHighs && higherLows) return 'BULLISH';
    if (lowerHighs && lowerLows) return 'BEARISH';
  }
  const first = recent[0].close;
  const last = recent[recent.length - 1].close;
  const pct = (last - first) / (first || 1);
  if (pct > 0.0015) return 'BULLISH';
  if (pct < -0.0015) return 'BEARISH';
  return 'NEUTRAL';
}

interface XauHtfBias { m15: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; h1: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; combined: 'BULLISH' | 'BEARISH' | 'NEUTRAL' }
function detectXauHtfBias(candles5m: Candle[]): XauHtfBias {
  const m15 = xauTrendFromAggregatedBars(aggregateXauCandles(candles5m, 3));
  const h1 = xauTrendFromAggregatedBars(aggregateXauCandles(candles5m, 12));
  let combined: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (m15 === h1 && m15 !== 'NEUTRAL') combined = m15;
  else if (h1 !== 'NEUTRAL') combined = h1;
  else combined = m15;
  return { m15, h1, combined };
}

function computeXauOteZone(type: 'BUY' | 'SELL', swingHigh: number, swingLow: number): { min: number; max: number } | null {
  const range = swingHigh - swingLow;
  if (range <= 0) return null;
  if (type === 'BUY') return { min: swingHigh - 0.79 * range, max: swingHigh - 0.62 * range };
  return { min: swingLow + 0.62 * range, max: swingLow + 0.79 * range };
}

function isXauKillzone(nowMs: number): boolean {
  const h = new Date(nowMs).getUTCHours();
  return (h >= 7 && h < 10) || (h >= 12 && h < 15);
}

function isXauJudasSwingWindow(nowMs: number): boolean {
  const h = new Date(nowMs).getUTCHours();
  return h >= 7 && h < 9;
}

function detectXauInducement(candles: Candle[], swingHighs: number[], swingLows: number[], direction: 'BUY' | 'SELL'): boolean {
  if (candles.length < 6) return false;
  const recent = candles.slice(-6, -1);
  if (direction === 'BUY') {
    const minorLows = swingLows.slice(0, -1);
    if (minorLows.length === 0) return false;
    const minorLow = minorLows[minorLows.length - 1];
    return recent.some((c) => c.low < minorLow && c.close > minorLow);
  }
  const minorHighs = swingHighs.slice(0, -1);
  if (minorHighs.length === 0) return false;
  const minorHigh = minorHighs[minorHighs.length - 1];
  return recent.some((c) => c.high > minorHigh && c.close < minorHigh);
}

function computeXauEmaConfluence(candles: Candle[], type: 'BUY' | 'SELL'): { score: number; note: string } {
  if (candles.length < 20) return { score: 0, note: '' };
  const closes = candles.map((c) => c.close);
  const currentPrice = closes[closes.length - 1];
  let score = 0;
  const notes: string[] = [];

  const ema20Series = calculateEMASeries(closes, 20);
  const ema20 = ema20Series[ema20Series.length - 1];
  const ema20Prior = ema20Series[Math.max(0, ema20Series.length - 6)];
  const ema20Rising = ema20 > ema20Prior;
  const alignedEma20 = type === 'BUY' ? currentPrice > ema20 : currentPrice < ema20;
  if (alignedEma20) {
    const slopeAligned = type === 'BUY' ? ema20Rising : !ema20Rising;
    score += slopeAligned ? 3 : 2;
    notes.push(`✓ Searah EMA20${slopeAligned ? ' (slope mendukung)' : ''}.`);
  }

  if (candles.length >= 200) {
    const ema200Series = calculateEMASeries(closes, 200);
    const ema200 = ema200Series[ema200Series.length - 1];
    const alignedEma200 = type === 'BUY' ? currentPrice > ema200 : currentPrice < ema200;
    if (alignedEma200) {
      score += 3;
      notes.push('✓ Searah EMA200 (bias jangka panjang).');
    }
  }

  return { score, note: notes.join(' ') };
}

function calculateXauAdxSlope(candles: Candle[], lookback = 5): number {
  if (candles.length < 14 + lookback) return 0;
  const adxNow = calculateADX(candles, 14);
  const adxPrior = calculateADX(candles.slice(0, candles.length - lookback), 14);
  return adxNow - adxPrior;
}

function getMostRecentKillzoneOpenMs(nowMs: number): number {
  const d = new Date(nowMs);
  const londonOpen = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 7, 0, 0);
  const nyOpen = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0);
  if (nowMs >= nyOpen) return nyOpen;
  if (nowMs >= londonOpen) return londonOpen;
  return nyOpen - 24 * 3600 * 1000;
}

function computeXauAnchoredVWAP(candles: Candle[], anchorMs: number): number | null {
  const relevant = candles.filter((c) => c.time >= anchorMs);
  if (relevant.length === 0) return null;
  let pv = 0;
  let vol = 0;
  for (const c of relevant) {
    const typical = (c.high + c.low + c.close) / 3;
    const v = c.volume && c.volume > 0 ? c.volume : 1;
    pv += typical * v;
    vol += v;
  }
  return vol > 0 ? pv / vol : null;
}

interface XauTpoProfile { poc: number; vah: number; val: number }
function computeXauTpoProfile(candles: Candle[], atr: number): XauTpoProfile | null {
  if (!candles || candles.length < 20 || !atr || atr <= 0) return null;
  const recent = candles.slice(-100);
  const binWidth = Math.max(atr * 0.25, 0.05);
  const touches = new Map<number, number>();
  for (const c of recent) {
    const lowBin = Math.floor(c.low / binWidth);
    const highBin = Math.ceil(c.high / binWidth);
    for (let b = lowBin; b <= highBin; b++) touches.set(b, (touches.get(b) || 0) + 1);
  }
  if (touches.size === 0) return null;

  const sortedBins = [...touches.entries()].sort((a, b) => b[1] - a[1]);
  const pocBin = sortedBins[0][0];
  const poc = (pocBin + 0.5) * binWidth;

  const totalTouches = [...touches.values()].reduce((a, b) => a + b, 0);
  const target = totalTouches * 0.68;
  let acc = touches.get(pocBin) || 0;
  let lowBound = pocBin;
  let highBound = pocBin;
  while (acc < target && (touches.has(lowBound - 1) || touches.has(highBound + 1))) {
    const below = touches.get(lowBound - 1) || 0;
    const above = touches.get(highBound + 1) || 0;
    if (above >= below && touches.has(highBound + 1)) {
      highBound++;
      acc += above;
    } else if (touches.has(lowBound - 1)) {
      lowBound--;
      acc += below;
    } else break;
  }

  return { poc, val: lowBound * binWidth, vah: (highBound + 1) * binWidth };
}

// Task 1: verbatim copy of buildXauCandleFromTicks's bar-close decision (the part with no module
// globals / Redis/env dependencies - the pure "does this tick close the current bar" math).
function xauBarTimeFor(nowMs: number): number {
  return Math.floor(nowMs / 300000) * 300000;
}

// Task 4: verbatim copy of pickXauTpPair + the tiered validity check from evaluateXauIctSetups.
const XAU_MIN_TP_SEPARATION_ATR_MULT = 1.0;
function pickXauTpPair(sortedSwings: number[], atr: number, riskDist = atr): { tp1: number | null; tp2: number | null; tpMax: number | null } {
  if (sortedSwings.length === 0) return { tp1: null, tp2: null, tpMax: null };
  const tp1 = sortedSwings[0];
  const minSeparation = Math.max(atr * XAU_MIN_TP_SEPARATION_ATR_MULT, riskDist * 0.6);
  const tp2Index = sortedSwings.findIndex((target, index) => index > 0 && Math.abs(target - tp1) >= minSeparation);
  if (tp2Index < 0) return { tp1, tp2: null, tpMax: null };
  const tp2 = sortedSwings[tp2Index];
  const tpMax = sortedSwings.slice(tp2Index + 1).find((target) => Math.abs(target - tp2) >= minSeparation) ?? null;
  return { tp1, tp2, tpMax };
}

interface XauCandidateLike {
  type: 'BUY' | 'SELL';
  entryZone: { min: number; max: number; optimal: number } | null;
  structuralSLLevel: number | null;
  tp1Level: number | null;
  tp2Level: number | null;
  tpMaxLevel: number | null;
}
function xauCandidateHasValidOrdering(c: XauCandidateLike, atr: number, requireWideSeparation: boolean): boolean {
  if (c.tp1Level === null || c.entryZone === null) return false;
  if (c.type === 'BUY' && !(c.tp1Level > c.entryZone.optimal)) return false;
  if (c.type === 'SELL' && !(c.tp1Level < c.entryZone.optimal)) return false;
  if (!requireWideSeparation) return true;
  if (c.tp2Level === null || c.tpMaxLevel === null) return false;
  const requiredSeparation = Math.max(atr * XAU_MIN_TP_SEPARATION_ATR_MULT, Math.abs(c.entryZone.optimal - c.structuralSLLevel!) * 0.6);
  if (Math.abs(c.tp2Level - c.tp1Level) < requiredSeparation) return false;
  if (c.type === 'BUY') return c.tp2Level > c.tp1Level && c.tpMaxLevel! > c.tp2Level;
  return c.tp2Level < c.tp1Level && c.tpMaxLevel! < c.tp2Level;
}

// ---- test harness ------------------------------------------------------------------------------

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    console.log(`  OK   ${label}`);
    passed++;
  } else {
    console.log(`  FAIL ${label}`);
    failed++;
  }
}

function makeCandles(count: number, startTime: number, startPrice: number, stepPerBar: number, noiseAmp: number): Candle[] {
  const out: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    // deterministic pseudo-noise (no Math.random - reproducible test data)
    const noise = Math.sin(i * 1.7) * noiseAmp;
    const close = open + stepPerBar + noise;
    const high = Math.max(open, close) + Math.abs(noise) * 0.5 + 0.05;
    const low = Math.min(open, close) - Math.abs(noise) * 0.5 - 0.05;
    out.push({ time: startTime + i * 300000, open, high, low, close, volume: 100 });
    price = close;
  }
  return out;
}

// A genuinely non-trending series: each close oscillates around a FIXED baseline (never carries
// cumulative drift forward from the previous close, unlike makeCandles above) - a real "choppy
// range" fixture, not noise that happens to random-walk into a net direction over many bars.
function makeOscillatingCandles(count: number, startTime: number, baseline: number, amp: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const open = baseline + Math.sin(i * 0.9) * amp;
    const close = baseline + Math.sin((i + 1) * 0.9) * amp;
    const high = Math.max(open, close) + amp * 0.15;
    const low = Math.min(open, close) - amp * 0.15;
    out.push({ time: startTime + i * 300000, open, high, low, close, volume: 100 });
  }
  return out;
}

// ================================================================================================
console.log('[Task 1] buildXauCandleFromTicks bar-close boundary math');
{
  const t0 = Date.UTC(2026, 0, 15, 0, 0, 0); // exact 5-minute-bar boundary (UTC midnight)
  const bar0 = xauBarTimeFor(t0);
  check('same bar for two ticks 2 minutes apart', xauBarTimeFor(t0) === xauBarTimeFor(t0 + 2 * 60_000));
  check('different bar for a tick 5+ minutes later', xauBarTimeFor(t0 + 5 * 60_000 + 1) !== bar0);
  check('bar time is always a multiple of 300000ms', xauBarTimeFor(t0 + 137_000) % 300000 === 0);
}

// ================================================================================================
console.log('\n[Task 1] candleStore merge-by-time + 150-bar cap logic (same Map-based dedup used in buildXauCandleFromTicks/fetchGold)');
{
  const existing: Candle[] = makeCandles(150, 1_700_000_000_000, 2600, 0.1, 0.3);
  const newClosed: Candle = { time: existing[existing.length - 1].time + 300000, open: 2615, high: 2616, low: 2614, close: 2615.5, volume: 100 };
  const byTime = new Map<number, Candle>();
  for (const c of existing) byTime.set(c.time, c);
  byTime.set(newClosed.time, newClosed);
  const merged = Array.from(byTime.values()).sort((a, b) => a.time - b.time).slice(-150);
  check('merged store stays capped at 150', merged.length === 150);
  check('newest closed candle is the last element', merged[merged.length - 1].time === newClosed.time);
  check('oldest candle was evicted once past 150 (no unbounded growth)', merged[0].time === existing[1].time);
}

// ================================================================================================
console.log('\n[Task 2] detectXauHtfBias on a real (aggregated) uptrend vs downtrend vs flat/choppy series');
{
  const uptrend = makeCandles(150, 1_700_000_000_000, 2600, 1.2, 0.4); // strong steady climb
  const downtrend = makeCandles(150, 1_700_000_000_000, 2700, -1.2, 0.4);
  const flat = makeOscillatingCandles(150, 1_700_000_000_000, 2650, 3); // oscillates around a fixed baseline, no net drift

  const biasUp = detectXauHtfBias(uptrend);
  const biasDown = detectXauHtfBias(downtrend);
  const biasFlat = detectXauHtfBias(flat);

  check('uptrend -> combined BULLISH', biasUp.combined === 'BULLISH');
  check('uptrend -> both m15 and h1 read BULLISH (not just one timeframe)', biasUp.m15 === 'BULLISH' && biasUp.h1 === 'BULLISH');
  check('downtrend -> combined BEARISH', biasDown.combined === 'BEARISH');
  check('flat/choppy -> combined NEUTRAL (no false directional bias from noise)', biasFlat.combined === 'NEUTRAL');

  // Too little history -> NEUTRAL, never fabricated
  const short = makeCandles(5, 1_700_000_000_000, 2650, 1, 0);
  check('insufficient history -> NEUTRAL, not a guess', detectXauHtfBias(short).combined === 'NEUTRAL');
}

// ================================================================================================
console.log('\n[Task 3] computeXauOteZone (ICT 62%-79% retracement)');
{
  const swingLow = 2600;
  const swingHigh = 2700; // 100-point leg
  const buyZone = computeXauOteZone('BUY', swingHigh, swingLow)!;
  const sellZone = computeXauOteZone('SELL', swingHigh, swingLow)!;
  check('BUY OTE zone min < max', buyZone.min < buyZone.max);
  check('BUY OTE zone sits within the leg (not below swingLow or above swingHigh)', buyZone.min >= swingLow && buyZone.max <= swingHigh);
  check('BUY OTE zone is the deep retracement (62-79% back from the high)', Math.abs(buyZone.max - (swingHigh - 0.62 * 100)) < 1e-9 && Math.abs(buyZone.min - (swingHigh - 0.79 * 100)) < 1e-9);
  check('SELL OTE zone mirrors BUY (62-79% back up from the low)', Math.abs(sellZone.min - (swingLow + 0.62 * 100)) < 1e-9 && Math.abs(sellZone.max - (swingLow + 0.79 * 100)) < 1e-9);
  check('degenerate zero-range swing -> null, never divides by zero / fabricates a zone', computeXauOteZone('BUY', 2650, 2650) === null);
}

console.log('\n[Task 3] Killzone / Judas Swing session windows (UTC)');
{
  const d = (h: number, m = 0) => Date.UTC(2026, 0, 15, h, m, 0);
  check('06:59 UTC -> not killzone (just before London open)', !isXauKillzone(d(6, 59)));
  check('07:00 UTC -> killzone (London open)', isXauKillzone(d(7, 0)));
  check('09:59 UTC -> still killzone', isXauKillzone(d(9, 59)));
  check('10:00 UTC -> NOT killzone (London window closed, before NY overlap)', !isXauKillzone(d(10, 0)));
  check('12:00 UTC -> killzone (NY open)', isXauKillzone(d(12, 0)));
  check('14:59 UTC -> still killzone', isXauKillzone(d(14, 59)));
  check('15:00 UTC -> not killzone', !isXauKillzone(d(15, 0)));
  check('20:00 UTC -> not killzone (Asian/quiet session)', !isXauKillzone(d(20, 0)));

  check('07:00-08:59 UTC -> Judas Swing window', isXauJudasSwingWindow(d(7, 0)) && isXauJudasSwingWindow(d(8, 59)));
  check('09:00 UTC -> Judas Swing window closed', !isXauJudasSwingWindow(d(9, 0)));
}

console.log('\n[Task 3] detectXauInducement (minor swing liquidity grab before the real move)');
{
  const t0 = 1_700_000_000_000;
  const swingLows = [2610, 2605]; // protected (most recent) = 2605, minor = 2610
  const swingHighs = [2690, 2695];
  // Candle 4 back (index -5) wicks below the minor low 2610 then closes back above it - genuine inducement
  const candlesWithInducement: Candle[] = [
    { time: t0, open: 2620, high: 2622, low: 2618, close: 2619, volume: 100 },
    { time: t0 + 300000, open: 2619, high: 2620, low: 2608, close: 2612, volume: 100 }, // wicks below 2610, closes above it
    { time: t0 + 600000, open: 2612, high: 2614, low: 2611, close: 2613, volume: 100 },
    { time: t0 + 900000, open: 2613, high: 2618, low: 2612, close: 2617, volume: 100 },
    { time: t0 + 1200000, open: 2617, high: 2622, low: 2616, close: 2621, volume: 100 },
    { time: t0 + 1500000, open: 2621, high: 2625, low: 2620, close: 2624, volume: 100 }, // "entry candle" - excluded from the scan
  ];
  check('BUY inducement detected when a minor low was wicked-and-reclaimed', detectXauInducement(candlesWithInducement, swingHighs, swingLows, 'BUY'));

  const candlesNoInducement: Candle[] = candlesWithInducement.map((c) => ({ ...c, low: Math.min(c.low, c.open, c.close) + 20 })); // never gets near 2610
  check('no false positive when no minor low was actually swept', !detectXauInducement(candlesNoInducement, swingHighs, swingLows, 'BUY'));
}

console.log('\n[Task 3] computeXauEmaConfluence (EMA20/EMA200 alignment + slope)');
{
  const uptrend = makeCandles(60, 1_700_000_000_000, 2600, 1.0, 0.2);
  const buyScore = computeXauEmaConfluence(uptrend, 'BUY');
  const sellScore = computeXauEmaConfluence(uptrend, 'SELL');
  check('BUY in a real uptrend gets a positive EMA20 score (price above rising EMA20)', buyScore.score > 0);
  check('SELL in that same uptrend gets zero (price is not below EMA20)', sellScore.score === 0);
  check('EMA200 skipped gracefully under 200 candles (score never fabricated from insufficient history)', computeXauEmaConfluence(uptrend, 'BUY').note.includes('EMA200') === false);

  const longHistory = makeCandles(220, 1_700_000_000_000, 2600, 0.5, 0.2);
  const longScore = computeXauEmaConfluence(longHistory, 'BUY');
  check('EMA200 check activates once there really are >= 200 candles', longScore.note.includes('EMA200'));
}

console.log('\n[Task 3] calculateXauAdxSlope (rising ADX for strengthening trend vs flat for range)');
{
  // calculateXauAdxSlope compares ADX over the LAST 14 bars now vs the last 14 bars as of 5 bars
  // ago (a heavily-overlapping, shifted window) - so the trend needs to start close enough to the
  // end of the series that "5 bars ago"'s window still has a meaningfully choppier mix than "now"'s
  // purely-trending window. 45 choppy bars then 15 strongly-trending bars does that: adxNow's last
  // 14 bars are entirely inside the trend; adxPrior's (5 bars earlier) still includes a chunk of
  // the choppy section.
  const accelerating: Candle[] = [
    ...makeOscillatingCandles(45, 1_700_000_000_000, 2600, 1.5),
    ...makeCandles(15, 1_700_000_000_000 + 45 * 300000, 2600, 3.0, 0.2), // then a strong clean push
  ];
  const flat = makeOscillatingCandles(60, 1_700_000_000_000, 2650, 3);
  check('accelerating trend -> positive ADX slope', calculateXauAdxSlope(accelerating) > 0);
  check('flat/choppy series -> ADX slope near zero (no false strengthening signal)', Math.abs(calculateXauAdxSlope(flat)) < 5);
}

console.log('\n[Task 3] computeXauAnchoredVWAP + getMostRecentKillzoneOpenMs');
{
  const nowMs = Date.UTC(2026, 0, 15, 13, 0, 0); // 13:00 UTC -> most recent killzone open is 12:00 UTC (NY)
  const anchor = getMostRecentKillzoneOpenMs(nowMs);
  check('anchors to the 12:00 UTC NY open when current time is inside that killzone', anchor === Date.UTC(2026, 0, 15, 12, 0, 0));

  const beforeLondon = Date.UTC(2026, 0, 15, 3, 0, 0); // 03:00 UTC -> before today's London open
  const anchorBefore = getMostRecentKillzoneOpenMs(beforeLondon);
  check('before London open -> anchors to YESTERDAY\'s NY open', anchorBefore === Date.UTC(2026, 0, 14, 12, 0, 0));

  const candles = makeCandles(24, Date.UTC(2026, 0, 15, 11, 0, 0), 2650, 0.3, 0.2); // spans 11:00-12:55 UTC
  const vwap = computeXauAnchoredVWAP(candles, Date.UTC(2026, 0, 15, 12, 0, 0));
  const priceRangeMin = Math.min(...candles.filter((c) => c.time >= Date.UTC(2026, 0, 15, 12, 0, 0)).map((c) => c.low));
  const priceRangeMax = Math.max(...candles.filter((c) => c.time >= Date.UTC(2026, 0, 15, 12, 0, 0)).map((c) => c.high));
  check('anchored VWAP only uses candles at/after the anchor and stays within their price range', vwap !== null && vwap >= priceRangeMin && vwap <= priceRangeMax);
  check('anchored VWAP is null when no candle exists at/after the anchor', computeXauAnchoredVWAP(candles, Date.UTC(2026, 0, 20, 0, 0, 0)) === null);
}

console.log('\n[Task 3] computeXauTpoProfile (TPO time-price distribution, POC/VAH/VAL - not fake volume)');
{
  // Build a series that spends a lot of TIME consolidating around 2650, with a smaller excursion up
  // to 2660 - POC should land near 2650, and VAL <= POC <= VAH.
  const consolidation = makeCandles(80, 1_700_000_000_000, 2649, 0.02, 0.15); // tight chop around 2650
  const excursion = makeCandles(15, 1_700_000_000_000 + 80 * 300000, 2650, 0.8, 0.2); // brief push up
  const candles = [...consolidation, ...excursion];
  const atr = 0.6;
  const profile = computeXauTpoProfile(candles, atr)!;
  check('TPO profile returned for a real candle history', profile !== null);
  check('VAL <= POC <= VAH (value area correctly brackets the point of control)', profile.val <= profile.poc && profile.poc <= profile.vah);
  const allLows = candles.map((c) => c.low);
  const allHighs = candles.map((c) => c.high);
  check('POC falls within the actual traded price range', profile.poc >= Math.min(...allLows) && profile.poc <= Math.max(...allHighs));
  check('POC gravitates toward the long consolidation area (~2650), not the brief excursion (~2660+)', Math.abs(profile.poc - 2650) < Math.abs(profile.poc - 2661));
  check('insufficient history (<20 candles) -> null, never a fabricated profile', computeXauTpoProfile(candles.slice(0, 10), atr) === null);
  check('zero/invalid ATR -> null, never divides by a degenerate bin width', computeXauTpoProfile(candles, 0) === null);
}

// ================================================================================================
console.log('\n[Task 4] Tiered MAIN/SCALP selection: pickXauTpPair + xauCandidateHasValidOrdering');
{
  const atr = 1.0;
  const entryOptimal = 2650;

  // Case A: two well-separated genuine swing targets available -> qualifies for MAIN.
  const wellSeparatedSwings = [2653, 2660, 2670]; // tp1=2653 (3 away), tp2 candidate needs >= max(atr*1.0, riskDist*0.6) separation from tp1
  const { tp1: tp1A, tp2: tp2A, tpMax: tpMaxA } = pickXauTpPair(wellSeparatedSwings, atr, 2);
  const candidateA: XauCandidateLike = { type: 'BUY', entryZone: { min: 2648, max: 2650, optimal: entryOptimal }, structuralSLLevel: 2648, tp1Level: tp1A, tp2Level: tp2A, tpMaxLevel: tpMaxA };
  check('Case A: genuine well-separated targets -> qualifies for MAIN (requireWideSeparation=true)', xauCandidateHasValidOrdering(candidateA, atr, true));
  check('Case A: also trivially qualifies for SCALP (MAIN candidates are always SCALP-eligible too)', xauCandidateHasValidOrdering(candidateA, atr, false));

  // Case B: only ONE genuine nearby target exists (no second swing far enough away) -> must be
  // rejected by MAIN's strict filter, but still accepted by SCALP's looser one - this is exactly
  // the frequency bottleneck Task 4 targets.
  const onlyOneTarget = [2653]; // nothing beyond it
  const { tp1: tp1B, tp2: tp2B, tpMax: tpMaxB } = pickXauTpPair(onlyOneTarget, atr, 2);
  const candidateB: XauCandidateLike = { type: 'BUY', entryZone: { min: 2648, max: 2650, optimal: entryOptimal }, structuralSLLevel: 2648, tp1Level: tp1B, tp2Level: tp2B, tpMaxLevel: tpMaxB };
  check('Case B: single nearby target only -> REJECTED by MAIN (no genuine tp2/tpMax)', !xauCandidateHasValidOrdering(candidateB, atr, true));
  check('Case B: same candidate -> ACCEPTED by SCALP (tp1 alone, correctly ordered beyond entry)', xauCandidateHasValidOrdering(candidateB, atr, false));

  // Case C: target sits BEHIND entry (invalid direction) -> must be rejected by BOTH tiers, never
  // published regardless of how loose the tier is - Task 4 must never create new invalid setups.
  const candidateC: XauCandidateLike = { type: 'BUY', entryZone: { min: 2648, max: 2650, optimal: entryOptimal }, structuralSLLevel: 2648, tp1Level: 2645, tp2Level: null, tpMaxLevel: null }; // tp1 below entry for a BUY
  check('Case C: tp1 behind entry -> rejected by MAIN', !xauCandidateHasValidOrdering(candidateC, atr, true));
  check('Case C: tp1 behind entry -> ALSO rejected by SCALP (loosening never creates an invalid setup)', !xauCandidateHasValidOrdering(candidateC, atr, false));

  // Case D: SCALP's tp2/tpMax collapse-to-tp1 fallback (mirrors the exact lines in
  // evaluateXauIctSetups' tiered selection) - downstream XAUUSD close logic needs takeProfitMax
  // to always be defined (see evaluateSignalStatus's tpMaxHit check), so this must never stay null.
  const scalpBest = { ...candidateB };
  if (scalpBest.tp2Level === null) scalpBest.tp2Level = scalpBest.tp1Level;
  if (scalpBest.tpMaxLevel === null) scalpBest.tpMaxLevel = scalpBest.tp2Level;
  check('SCALP collapse fallback: tp2Level is never left null', scalpBest.tp2Level !== null);
  check('SCALP collapse fallback: tpMaxLevel is never left null (would otherwise get stuck open - see evaluateSignalStatus)', scalpBest.tpMaxLevel !== null);
  check('SCALP collapse fallback: collapsed targets equal the genuine nearest target (never a farther/invented one)', scalpBest.tp2Level === tp1B && scalpBest.tpMaxLevel === tp1B);
}

// ================================================================================================
console.log(`\n===== XAUUSD 2026-08 audit sanity tests: ${passed} passed, ${failed} failed =====`);
process.exit(failed === 0 ? 0 : 1);
