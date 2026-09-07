// URGENT one-off investigation (2026-09-04, 2nd incident same day): user reports only 4 XAUUSD
// signals fired today despite a large dump (~4472 -> ~4368) followed by a fast rally back to
// ~4432 - exactly the "big directional move" the original roadmap doc said must never be missed.
// Question: did the Volatility Regime Gate (XAU_EXTREME_VOL_PERCENTILE, see server.ts) reject this
// move, and if so, is it structurally unable to tell "wild-with-no-direction" (should reject) apart
// from "wild-but-directional/expansion" (should be caught, not rejected)?
//
// This pulls REAL production XAUUSD 5m candles (candleStore.XAUUSD, 25h retention, /api/market/candles
// - this sandbox cannot reach Render directly, same GitHub-Actions-run pattern as every other
// scripts/audit-*.ts / urgent-*.ts in this repo) and replays the EXACT production gate logic
// (calculateATR + detectMarketRegime, byte-for-byte ported from server.ts as of commit cb3bb0a,
// XAU_EXTREME_VOL_PERCENTILE = 0.95) against every real bar of today, reconstructing when the gate
// was actually ON/OFF tick-by-tick and cross-referencing that against the real price path and the
// (already-computed-but-unused-by-the-gate) regime.extreme directional flag. No fabricated numbers -
// every value below is derived from real fetched candles run through the real production formulas.

const BASE_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function basicAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).toString('base64');
}

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ---- Exact port of server.ts's calculateATR (line 1484) ----
function calculateATR(candles: Candle[], period = 14): number {
  if (!candles || candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  if (slice.length === 0) return 0;
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / slice.length;
}

// ---- Exact port of server.ts's calculateRSI (line 1505) ----
function calculateRSI(candles: Candle[], period = 14): { rsi: number; bullishDivergence: boolean; bearishDivergence: boolean } {
  if (!candles || candles.length < 2) return { rsi: 50, bullishDivergence: false, bearishDivergence: false };
  const lookback = Math.min(candles.length - 1, 20);
  const rsiValues: number[] = [];
  for (let idx = candles.length - lookback; idx < candles.length; idx++) {
    const start = Math.max(1, idx - period + 1);
    let gain = 0;
    let loss = 0;
    let count = 0;
    for (let j = start; j <= idx; j++) {
      const diff = candles[j].close - candles[j - 1].close;
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);
      count++;
    }
    if (count === 0) {
      rsiValues.push(50);
    } else {
      const avgGain = gain / count;
      const avgLoss = loss / count;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsiValues.push(100 - 100 / (1 + rs));
    }
  }
  const currentRSI = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;
  let bullishDivergence = false;
  let bearishDivergence = false;
  if (candles.length >= 6 && rsiValues.length >= 6) {
    const n = candles.length;
    const rLen = rsiValues.length;
    const currPriceLow = candles[n - 1].low;
    const prevPriceLow = candles[n - 5].low;
    const currPriceHigh = candles[n - 1].high;
    const prevPriceHigh = candles[n - 5].high;
    const currRsi = rsiValues[rLen - 1];
    const prevRsi = rsiValues[rLen - 5];
    if (currPriceLow < prevPriceLow && currRsi > prevRsi + 1.5) bullishDivergence = true;
    if (currPriceHigh > prevPriceHigh && currRsi < prevRsi - 1.5) bearishDivergence = true;
  }
  return { rsi: Number(currentRSI.toFixed(2)), bullishDivergence, bearishDivergence };
}

// ---- Exact port of server.ts's calculateADX (line 1566) ----
function calculateADX(candles: Candle[], period = 14): number {
  if (!candles || candles.length < 5) return 25;
  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
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
  return Number(((diDiff / diSum) * 100).toFixed(2));
}

type MarketVolatility = 'LOW' | 'NORMAL' | 'HIGH';
type MarketTrendRegime = 'STRONG_UP' | 'STRONG_DOWN' | 'RANGING' | 'REVERSAL_UP' | 'REVERSAL_DOWN';
type MarketCompression = 'NONE' | 'COMPRESSING' | 'COMPRESSED';
interface MarketRegime {
  volatility: MarketVolatility;
  trend: MarketTrendRegime;
  atrPercentileRank?: number;
  compression?: MarketCompression;
  extreme?: boolean;
}

const XAU_BREAKOUT_MIN_ADX = 25; // server.ts line 2358
const XAU_EXTREME_VOL_PERCENTILE = 0.95; // server.ts line 1064 (as of commit cb3bb0a)

// ---- Exact port of server.ts's detectMarketRegime (line 1709), XAUUSD-only ----
function detectMarketRegime(candles: Candle[], atr: number, rsiInfo?: { rsi: number; bullishDivergence: boolean; bearishDivergence: boolean }, adxVal?: number): MarketRegime {
  let volatility: MarketVolatility = 'NORMAL';
  let atrPercentileRank: number | undefined;
  const atrValues: number[] = [];
  if (candles && candles.length >= 20) {
    const maxLookback = Math.min(20, candles.length - 14);
    for (let offset = 0; offset < maxLookback; offset++) {
      const sub = candles.slice(0, candles.length - offset);
      if (sub.length >= 14) {
        const subAtr = calculateATR(sub, 14);
        if (subAtr && subAtr > 0) atrValues.push(subAtr);
      }
    }
    if (atrValues.length > 0) {
      const avgAtr = atrValues.reduce((a, b) => a + b, 0) / atrValues.length;
      if (avgAtr > 0) {
        if (atr > 1.5 * avgAtr) volatility = 'HIGH';
        else if (atr < 0.6 * avgAtr) volatility = 'LOW';
      }
      const atLeastAsLow = atrValues.filter((v) => v <= atr).length;
      atrPercentileRank = atLeastAsLow / atrValues.length;
    }
  }

  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  if (candles && candles.length >= 5) {
    for (let i = 2; i < candles.length - 1; i++) {
      if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high) swingHighs.push(candles[i].high);
      if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low) swingLows.push(candles[i].low);
    }
  }
  const currentPrice = candles && candles.length > 0 ? candles[candles.length - 1].close : 0;
  const lastSwingHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1] : currentPrice;
  const lastSwingLow = swingLows.length > 0 ? swingLows[swingLows.length - 1] : currentPrice;
  const bullishBOS = currentPrice > lastSwingHigh;
  const bearishBOS = currentPrice < lastSwingLow;
  const rsiData = rsiInfo || (candles && candles.length >= 14 ? calculateRSI(candles, 14) : { rsi: 50, bullishDivergence: false, bearishDivergence: false });
  const adx = adxVal !== undefined ? adxVal : candles && candles.length >= 14 ? calculateADX(candles, 14) : 20;
  let recentBullishBOS = bullishBOS;
  let recentBearishBOS = bearishBOS;
  if (candles && candles.length >= 5 && (!recentBullishBOS || !recentBearishBOS)) {
    const last5 = candles.slice(-5);
    for (const c of last5) {
      if (c.close > lastSwingHigh) recentBullishBOS = true;
      if (c.close < lastSwingLow) recentBearishBOS = true;
    }
  }
  let isHigherHighsHigherLows = false;
  let isLowerHighsLowerLows = false;
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const sh2 = swingHighs[swingHighs.length - 1];
    const sh1 = swingHighs[swingHighs.length - 2];
    const sl2 = swingLows[swingLows.length - 1];
    const sl1 = swingLows[swingLows.length - 2];
    if (sh2 > sh1 && sl2 > sl1) isHigherHighsHigherLows = true;
    if (sh2 < sh1 && sl2 < sl1) isLowerHighsLowerLows = true;
  }
  let trend: MarketTrendRegime = 'RANGING';
  if (rsiData.bullishDivergence && recentBullishBOS) trend = 'REVERSAL_UP';
  else if (rsiData.bearishDivergence && recentBearishBOS) trend = 'REVERSAL_DOWN';
  else if (isHigherHighsHigherLows && adx >= 18) trend = 'STRONG_UP';
  else if (isLowerHighsLowerLows && adx >= 18) trend = 'STRONG_DOWN';
  else if (adx < 18) trend = 'RANGING';
  else {
    if (currentPrice > lastSwingHigh && adx >= 18) trend = 'STRONG_UP';
    else if (currentPrice < lastSwingLow && adx >= 18) trend = 'STRONG_DOWN';
    else trend = 'RANGING';
  }

  let compression: MarketCompression | undefined;
  let extreme: boolean | undefined;
  if (atrValues.length >= 10) {
    const recentAvg = atrValues.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const olderSample = atrValues.slice(5, Math.min(15, atrValues.length));
    const olderAvg = olderSample.length > 0 ? olderSample.reduce((a, b) => a + b, 0) / olderSample.length : 0;
    if (atrPercentileRank !== undefined && atrPercentileRank <= 0.25) compression = 'COMPRESSED';
    else if (olderAvg > 0 && recentAvg < olderAvg * 0.85 && atrPercentileRank !== undefined && atrPercentileRank < 0.5) compression = 'COMPRESSING';
    else compression = 'NONE';
  } else {
    compression = 'NONE';
  }
  if ((trend === 'STRONG_UP' || trend === 'STRONG_DOWN') && atrPercentileRank !== undefined && atrPercentileRank >= 0.85 && adx >= XAU_BREAKOUT_MIN_ADX) {
    let sustained = true;
    if (candles && candles.length >= 20) {
      const earlierAdx = calculateADX(candles.slice(0, candles.length - 3), 14);
      if (!earlierAdx || earlierAdx < XAU_BREAKOUT_MIN_ADX * 0.8) sustained = false;
    }
    extreme = sustained;
  } else {
    extreme = false;
  }

  return { volatility, trend, atrPercentileRank, compression, extreme };
}

function fmtWIB(t: number): string {
  const d = new Date(t + 7 * 3600 * 1000); // display as UTC+7 (WIB) without relying on host TZ
  return d.toISOString().replace('T', ' ').replace('Z', '').slice(0, 16) + ' WIB';
}

async function main() {
  console.log('===== URGENT: XAUUSD Volatility Regime Gate vs today\'s dump-rally directional move =====');
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log(`XAU_EXTREME_VOL_PERCENTILE (live, commit cb3bb0a) = ${XAU_EXTREME_VOL_PERCENTILE}`);
  console.log('');

  console.log('--- Fetching real candleStore.XAUUSD via /api/market/candles (public, 5m bars, ~25h retention) ---');
  const res = await fetch(`${BASE_URL}/api/market/candles`);
  if (!res.ok) {
    console.log(`FAILED: HTTP ${res.status}`);
    process.exitCode = 1;
    return;
  }
  const data: any = await res.json();
  const raw: Array<{ t: number; o: number; h: number; l: number; c: number }> = data?.candles?.XAUUSD || [];
  const candles: Candle[] = raw.map((c) => ({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: 100 })).sort((a, b) => a.time - b.time);
  console.log(`Fetched ${candles.length} real XAUUSD 5m candles, ${candles.length > 0 ? fmtWIB(candles[0].time) : 'n/a'} -> ${candles.length > 0 ? fmtWIB(candles[candles.length - 1].time) : 'n/a'}`);
  console.log('');

  if (candles.length < 20) {
    console.log('Not enough real candles to reconstruct regime (<20). Stopping.');
    return;
  }

  interface Row {
    time: number;
    close: number;
    atr: number;
    atrPercentileRank: number | undefined;
    gateOn: boolean;
    trend: MarketTrendRegime;
    extreme: boolean;
  }
  const rows: Row[] = [];
  for (let i = 19; i < candles.length; i++) {
    const window = candles.slice(0, i + 1); // exact production semantics: candleStore grows, detectMarketRegime looks backward from the end
    const atr = calculateATR(window, 14);
    const rsiData = calculateRSI(window, 14);
    const adx = calculateADX(window, 14);
    const regime = detectMarketRegime(window, atr, rsiData, adx);
    const gateOn = regime.atrPercentileRank !== undefined && regime.atrPercentileRank >= XAU_EXTREME_VOL_PERCENTILE;
    rows.push({ time: window[window.length - 1].time, close: window[window.length - 1].close, atr, atrPercentileRank: regime.atrPercentileRank, gateOn, trend: regime.trend, extreme: !!regime.extreme });
  }

  console.log(`--- [1/4] Reconstructed ${rows.length} real ticks of gate state (needs >=20 candles of history, so first ${candles.length - rows.length} real candles are skipped) ---`);
  console.log('');

  // [4] Full timeline as contiguous ON/OFF segments (gate state changes), each with real price range.
  console.log('--- [4] FULL TIMELINE TODAY: gate ON/OFF segments vs real price action ---');
  let segStart = 0;
  for (let i = 1; i <= rows.length; i++) {
    const boundary = i === rows.length || rows[i].gateOn !== rows[segStart].gateOn;
    if (boundary) {
      const seg = rows.slice(segStart, i);
      const first = seg[0];
      const last = seg[seg.length - 1];
      const durationMin = (last.time - first.time) / 60000 + 5;
      const closes = seg.map((r) => r.close);
      const minClose = Math.min(...closes);
      const maxClose = Math.max(...closes);
      const trends = new Set(seg.map((r) => r.trend));
      const anyExtreme = seg.some((r) => r.extreme);
      const pctRanks = seg.map((r) => r.atrPercentileRank).filter((v): v is number => v !== undefined);
      const minPct = pctRanks.length ? Math.min(...pctRanks) : undefined;
      const maxPct = pctRanks.length ? Math.max(...pctRanks) : undefined;
      console.log(
        `${first.gateOn ? 'GATE ON ' : 'gate off'} | ${fmtWIB(first.time)} -> ${fmtWIB(last.time)} (${durationMin.toFixed(0)}min) | price ${first.close.toFixed(2)} -> ${last.close.toFixed(2)} (range ${minClose.toFixed(2)}-${maxClose.toFixed(2)}) | atrPctRank ${minPct?.toFixed(2)}-${maxPct?.toFixed(2)} | trend(s): ${[...trends].join(',')} | regime.extreme seen: ${anyExtreme}`
      );
      segStart = i;
    }
  }
  console.log('');

  // [2/3] Directly answer: among gate-ON segments, was the underlying trend directional (STRONG_UP/STRONG_DOWN)
  // or was regime.extreme (the Fase A directional-expansion flag, NOT wired into the gate) true?
  console.log('--- [2/3] Gate-ON ticks broken down by trend regime + Fase A extreme flag (is the gate blind to direction?) ---');
  const gateOnRows = rows.filter((r) => r.gateOn);
  const byTrend: Record<string, number> = {};
  let extremeCount = 0;
  for (const r of gateOnRows) {
    byTrend[r.trend] = (byTrend[r.trend] || 0) + 1;
    if (r.extreme) extremeCount++;
  }
  console.log(`Total gate-ON ticks today: ${gateOnRows.length} / ${rows.length} (${((gateOnRows.length / rows.length) * 100).toFixed(1)}%)`);
  console.log(`Gate-ON ticks by underlying trend regime: ${JSON.stringify(byTrend)}`);
  console.log(`Of those, regime.extreme (Fase A directional-expansion flag) was true on ${extremeCount}/${gateOnRows.length} gate-ON ticks (${gateOnRows.length ? ((extremeCount / gateOnRows.length) * 100).toFixed(1) : '0'}%)`);
  console.log('NOTE: server.ts line 3615 gates purely on atrPercentileRank >= 0.95, regardless of regime.trend or regime.extreme.');
  console.log('regime.extreme already exists (Fase A) specifically to separate directional expansion from non-directional chop, but is NOT read by the gate check - confirmed by direct code inspection (server.ts:3615) independent of this data.');
  console.log('');

  // Explicit call-out: which gate-ON segments overlap with STRONG_UP/STRONG_DOWN trend (i.e. the gate rejecting a directional move, not chop)
  console.log('--- Gate-ON segments where the underlying trend was STRONG_UP or STRONG_DOWN (directional, not choppy) ---');
  segStart = 0;
  for (let i = 1; i <= rows.length; i++) {
    const boundary = i === rows.length || rows[i].gateOn !== rows[segStart].gateOn;
    if (boundary) {
      const seg = rows.slice(segStart, i);
      if (seg[0].gateOn) {
        const directional = seg.filter((r) => r.trend === 'STRONG_UP' || r.trend === 'STRONG_DOWN');
        if (directional.length > 0) {
          const first = seg[0];
          const last = seg[seg.length - 1];
          console.log(`${fmtWIB(first.time)} -> ${fmtWIB(last.time)}: ${directional.length}/${seg.length} ticks in this gate-ON segment were STRONG_UP/STRONG_DOWN (price ${first.close.toFixed(2)} -> ${last.close.toFixed(2)})`);
        }
      }
      segStart = i;
    }
  }
  console.log('');

  // Locate the actual dump (largest drawdown) and rally (largest recovery) in the real fetched data for cross-reference.
  console.log('--- Real largest dump / rally found in fetched data (for cross-reference with user-reported ~4472->4368->4432) ---');
  let maxDrawdown = { from: rows[0], to: rows[0], delta: 0 };
  let runningPeak = rows[0];
  for (const r of rows) {
    if (r.close > runningPeak.close) runningPeak = r;
    const dd = runningPeak.close - r.close;
    if (dd > maxDrawdown.delta) maxDrawdown = { from: runningPeak, to: r, delta: dd };
  }
  console.log(`Largest dump: ${maxDrawdown.from.close.toFixed(2)} @ ${fmtWIB(maxDrawdown.from.time)} -> ${maxDrawdown.to.close.toFixed(2)} @ ${fmtWIB(maxDrawdown.to.time)} (-$${maxDrawdown.delta.toFixed(2)})`);
  let maxRally = { from: maxDrawdown.to, to: maxDrawdown.to, delta: 0 };
  const afterDump = rows.filter((r) => r.time >= maxDrawdown.to.time);
  let runningTrough = maxDrawdown.to;
  for (const r of afterDump) {
    if (r.close < runningTrough.close) runningTrough = r;
    const rally = r.close - runningTrough.close;
    if (rally > maxRally.delta) maxRally = { from: runningTrough, to: r, delta: rally };
  }
  console.log(`Largest rally after that dump: ${maxRally.from.close.toFixed(2)} @ ${fmtWIB(maxRally.from.time)} -> ${maxRally.to.close.toFixed(2)} @ ${fmtWIB(maxRally.to.time)} (+$${maxRally.delta.toFixed(2)})`);
  const dumpRows = rows.filter((r) => r.time >= maxDrawdown.from.time && r.time <= maxRally.to.time);
  const dumpGateOnCount = dumpRows.filter((r) => r.gateOn).length;
  console.log(`During this dump+rally window (${fmtWIB(maxDrawdown.from.time)} -> ${fmtWIB(maxRally.to.time)}, ${dumpRows.length} ticks): gate was ON for ${dumpGateOnCount}/${dumpRows.length} ticks (${dumpRows.length ? ((dumpGateOnCount / dumpRows.length) * 100).toFixed(1) : '0'}%)`);
  console.log('');

  console.log('--- [C] /api/admin/xau-candle-health (admin) - current staleness/anti-flip/anti-countertrend counters, for elimination ---');
  try {
    const res2 = await fetch(`${BASE_URL}/api/admin/xau-candle-health`, { headers: { Authorization: basicAuthHeader() } });
    if (!res2.ok) {
      console.log(`FAILED: HTTP ${res2.status}`);
    } else {
      const health: any = await res2.json();
      console.log(JSON.stringify(health, null, 2));
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }

  console.log('');
  console.log('===== End of investigation =====');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
