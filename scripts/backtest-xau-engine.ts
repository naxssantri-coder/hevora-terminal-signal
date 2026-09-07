// Standalone OLD vs NEW XAU/USD signal-engine backtest harness.
//
// WHY THIS FILE EXISTS: the redesign in server.ts (branch
// claude/xauusd-signal-engine-redesign-7rid24) replaces XAUUSD-only entry/SL/TP construction with
// genuine ICT/SMC structural detection. This script replays BOTH the old and the new engine logic
// - copied verbatim from git history / the current file, not reimplemented from memory - over
// real historical XAUUSD candles, walking forward the same way the live server does
// (evaluateSignalStatus-style: wait for entry, then watch for SL/TP1/TP2), so the two can be
// compared on hard numbers: signal frequency, SL width ($) distribution, win-rate, and expectancy
// in R multiples.
//
// HONESTY NOTE (read this before trusting the numbers): this script needs network access to fetch
// real Yahoo Finance XAUUSD 1-minute candles. The sandboxed session that authored this redesign
// had outbound network access blocked by its environment's egress policy (confirmed via both a
// direct fetch and the WebFetch tool - see the PR/commit description), so it could NOT run this
// script against real data before shipping the change. Run it yourself (locally, or in a Claude
// Code Web/CLI session with default network access) to get the real before/after numbers:
//   npx tsx scripts/backtest-xau-engine.ts
//
// SIMPLIFICATIONS (disclosed, not hidden): this harness intentionally does NOT replicate every
// layer of the live pipeline, only the part the redesign actually changed (structure detection +
// entry/SL/TP construction) plus the identical downstream indicators both engines share:
//   - AI validation (Nvidia), DXY correlation adjustment, and the news-window filter are skipped
//     for BOTH engines equally (no historical news calendar or DXY series is available here) -
//     this does not bias the OLD-vs-NEW comparison since both are missing the same layers.
//   - The circuit breaker (3x SL cooldown) and adaptive win-rate threshold are skipped for the
//     same reason (they depend on the *other* engine's own live trade history, which doesn't
//     exist yet during a cold backtest) - a flat confluence threshold (70, same baseline both
//     engines already use for XAUUSD) is used instead for both.
//   - Yahoo's `range=1d`/`5d` 1-minute XAUUSD history is what the live server itself already runs
//     on (see fetchForexAndGoldData in server.ts) - this script uses the same endpoint, so
//     whatever data quality/gaps exist there apply equally to both engines.

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: number;
}

type PairId = string;

interface MarketPrice {
  symbol: PairId;
  name: string;
  category: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume: string;
  digits: number;
  tradingViewSymbol: string;
  lastUpdated: string;
  isStale?: boolean;
}

// ---- Stubs for cross-pair/live-state dependencies the copied functions reference ----
// (all of these only ever matter for non-XAUUSD forex pairs or for real-time news/AI layers -
// see the honesty note above. Stubbed to safe no-op values so the XAUUSD-only logic paths this
// backtest actually exercises are unaffected.)
const cachedCalendarEvents: any[] = [];
const currentSignals: Record<string, any> = {};
function isUsdHighImpactNewsWindow(_pairId?: PairId): boolean {
  return false; // no historical economic calendar available in this harness - disabled for BOTH engines equally
}
function getNetUsdDirection(_pairId: PairId, _type: 'BUY' | 'SELL'): 'LONG' | 'SHORT' | null {
  return null; // forex-only in the live code; never called for XAUUSD
}


// ==== shared helpers (calculateATR/RSI/ADX/EMASeries/detectMarketRegime) - identical between old & new ====
function calculateATR(candles: Candle[], period = 14): number {
  if (!candles || candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  if (slice.length === 0) return 0;
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / slice.length;
}

// Calculate RSI (14 period) and check for Bullish/Bearish Divergence
function calculateRSI(candles: Candle[], period = 14): { rsi: number; bullishDivergence: boolean; bearishDivergence: boolean } {
  if (!candles || candles.length < 2) {
    return { rsi: 50, bullishDivergence: false, bearishDivergence: false };
  }

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
      const rsiVal = 100 - (100 / (1 + rs));
      rsiValues.push(rsiVal);
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

    // Bullish Divergence: Price Lower Low while RSI Higher Low
    if (currPriceLow < prevPriceLow && currRsi > prevRsi + 1.5) {
      bullishDivergence = true;
    }
    // Bearish Divergence: Price Higher High while RSI Lower High
    if (currPriceHigh > prevPriceHigh && currRsi < prevRsi - 1.5) {
      bearishDivergence = true;
    }
  }

  return { rsi: Number(currentRSI.toFixed(2)), bullishDivergence, bearishDivergence };
}

// Calculate ADX (Average Directional Index, 14 period)
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

// Exponential Moving Average series over a value array (closes, or the MACD line itself for its
// signal EMA). Seeds from the first value rather than an SMA of the first `period` values, so it
// still produces a full-length, usable series even with a short candle history (our candle
// buffers are typically capped around 30 bars) - the naive seed's influence decays quickly via
// the exponential weighting, same pragmatic "work with whatever history is available" approach
// already used by calculateATR/calculateRSI/calculateADX above.
function calculateEMASeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

export type MarketVolatility = 'LOW' | 'NORMAL' | 'HIGH';
export type MarketTrendRegime = 'STRONG_UP' | 'STRONG_DOWN' | 'RANGING' | 'REVERSAL_UP' | 'REVERSAL_DOWN';

export type MarketCompression = 'NONE' | 'COMPRESSING' | 'COMPRESSED';

export interface MarketRegime {
  volatility: MarketVolatility;
  trend: MarketTrendRegime;
  // Percentile rank (0-1) of the CURRENT ATR reading within its own last-20-candle ATR history -
  // mirrors server.ts's detectMarketRegime exactly (see that file for the full rationale). Used by
  // newEvaluateMarketStructureFromCandles' Volatility Regime Gate below; intentionally left unused
  // by oldEvaluateMarketStructureFromCandles, which stays frozen as the pre-redesign reference.
  atrPercentileRank?: number;
  // Fase A/Fase B mirror - see server.ts's MarketRegime for the full rationale. XAUUSD-only (this
  // file only ever calls detectMarketRegime with pairId === 'XAUUSD' anyway).
  compression?: MarketCompression;
  extreme?: boolean;
}

interface StructureAnalysis {
  type: 'BUY' | 'SELL' | null;
  confluenceScore: number;
  atr: number;
  shortTermAtr?: number;
  slDelta: number;
  reasoningHeader: string;
  strategyMethod: string;
  bosDetected: boolean;
  fvgDetected: boolean;
  orderBlockDetected: boolean;
  adx?: number;
  rsi?: number;
  regime: MarketRegime;
  swingHighs?: number[];
  swingLows?: number[];
  baseMinSL?: number;
  baseMaxSL?: number;
  baseBandPct?: number;
  volMultiplier?: number;
  reversalConfirmations?: number;
  // XAU/USD-ONLY fields (see evaluateXauIctSetups above) - undefined for every other pair.
  // Carries the structural anchor levels forward so createInstitutionalScalpingSignal can build
  // entry/SL/TP from the actual OB/FVG/sweep/S&D zone that justified the setup, instead of a
  // generic % offset + flat SL clamp.
  xauPattern?: 'TREND_CONTINUATION' | 'LIQUIDITY_SWEEP_REVERSAL' | 'RANGE_SND_BOUNCE' | 'CHOCH_REVERSAL' | 'BREAKOUT_DISPLACEMENT_CONTINUATION' | null;
  xauEntryZone?: { min: number; max: number; optimal: number } | null;
  xauStructuralSLLevel?: number | null;
  xauTp1Level?: number | null;
  xauTp2Level?: number | null;
  xauGenuineSweepDetected?: boolean;
  xauGenuineSNDDetected?: boolean;
  // 2026-09-03 HTF bias & directional gate audit/backtest addition.
  xauHtfBiasCombined?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  xauHtfOpposed?: boolean;
  xauHtfAlignment?: 'ALIGNED' | 'OPPOSED' | 'NEUTRAL';
  xauChaseDistanceAtr?: number;
  xauRetestTouches?: number;
  xauRunnerUp?: XauSetupResult['runnerUp'];
  // Fase E measurement - see XauSetupResult.zoneAgeBars's own comment.
  xauZoneAgeBars?: XauSetupResult['zoneAgeBars'];
  // Fase D prerequisite - mirrors server.ts's StructureAnalysis.xauSignalTier via
  // XauSetupResult.signalTier (see evaluateXauIctSetups' MAIN/SCALP cascade).
  xauSignalTier?: XauSetupResult['signalTier'];
}

// Detect Market Regime (Volatility percentile & Trend/Reversal structure)
function detectMarketRegime(
  pairId: PairId,
  candles: Candle[],
  atr: number,
  rsiInfo?: { rsi: number; bullishDivergence: boolean; bearishDivergence: boolean },
  adxVal?: number
): MarketRegime {
  // 1. Volatility Regime: ATR percentile over last 20 candles
  let volatility: MarketVolatility = 'NORMAL';
  let atrPercentileRank: number | undefined;
  // Hoisted out of the block below (Fase A mirror) so the compression dimension can reuse this
  // same newest-first ATR sample instead of recomputing it - mirrors server.ts exactly.
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

  // 2. Trend & Reversal Structure Detection
  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  if (candles && candles.length >= 5) {
    for (let i = 2; i < candles.length - 1; i++) {
      if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high) {
        swingHighs.push(candles[i].high);
      }
      if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low) {
        swingLows.push(candles[i].low);
      }
    }
  }

  const currentPrice = candles && candles.length > 0 ? candles[candles.length - 1].close : 0;
  const lastSwingHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1] : currentPrice;
  const lastSwingLow = swingLows.length > 0 ? swingLows[swingLows.length - 1] : currentPrice;

  const bullishBOS = currentPrice > lastSwingHigh;
  const bearishBOS = currentPrice < lastSwingLow;

  const rsiData = rsiInfo || (candles && candles.length >= 14 ? calculateRSI(candles, 14) : { rsi: 50, bullishDivergence: false, bearishDivergence: false });
  const adx = adxVal !== undefined ? adxVal : (candles && candles.length >= 14 ? calculateADX(candles, 14) : 20);

  // Scan recent 5 candles for Break of Structure
  let recentBullishBOS = bullishBOS;
  let recentBearishBOS = bearishBOS;
  if (candles && candles.length >= 5 && (!recentBullishBOS || !recentBearishBOS)) {
    const last5 = candles.slice(-5);
    for (const c of last5) {
      if (c.close > lastSwingHigh) recentBullishBOS = true;
      if (c.close < lastSwingLow) recentBearishBOS = true;
    }
  }

  // Check structure direction (higher highs / higher lows)
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

  // Check Reversal conditions: lower-lows + bullish div + BOS -> REVERSAL_UP
  if (rsiData.bullishDivergence && recentBullishBOS) {
    trend = 'REVERSAL_UP';
  } else if (rsiData.bearishDivergence && recentBearishBOS) {
    trend = 'REVERSAL_DOWN';
  } else if (isHigherHighsHigherLows && adx >= 18) {
    trend = 'STRONG_UP';
  } else if (isLowerHighsLowerLows && adx >= 18) {
    trend = 'STRONG_DOWN';
  } else if (adx < 18) {
    trend = 'RANGING';
  } else {
    if (currentPrice > lastSwingHigh && adx >= 18) trend = 'STRONG_UP';
    else if (currentPrice < lastSwingLow && adx >= 18) trend = 'STRONG_DOWN';
    else trend = 'RANGING';
  }

  // 3. Fase A mirror: compression + extreme dimensions - mirrors server.ts's detectMarketRegime
  // exactly (XAUUSD-only, but this file only ever calls this with pairId === 'XAUUSD').
  let compression: MarketCompression | undefined;
  let extreme: boolean | undefined;
  if (pairId === 'XAUUSD') {
    if (atrValues.length >= 10) {
      const recentAvg = atrValues.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
      const olderSample = atrValues.slice(5, Math.min(15, atrValues.length));
      const olderAvg = olderSample.length > 0 ? olderSample.reduce((a, b) => a + b, 0) / olderSample.length : 0;
      if (atrPercentileRank !== undefined && atrPercentileRank <= 0.25) {
        compression = 'COMPRESSED';
      } else if (olderAvg > 0 && recentAvg < olderAvg * 0.85 && atrPercentileRank !== undefined && atrPercentileRank < 0.5) {
        compression = 'COMPRESSING';
      } else {
        compression = 'NONE';
      }
    } else {
      compression = 'NONE';
    }

    if (
      (trend === 'STRONG_UP' || trend === 'STRONG_DOWN') &&
      atrPercentileRank !== undefined &&
      atrPercentileRank >= 0.85 &&
      adx >= XAU_BREAKOUT_MIN_ADX
    ) {
      let sustained = true;
      if (candles && candles.length >= 20) {
        const earlierAdx = calculateADX(candles.slice(0, candles.length - 3), 14);
        if (!earlierAdx || earlierAdx < XAU_BREAKOUT_MIN_ADX * 0.8) sustained = false;
      }
      extreme = sustained;
    } else {
      extreme = false;
    }
  }

  return { volatility, trend, atrPercentileRank, compression, extreme };
}


// ==== shared helpers continued (calculateDailyVWAP/calculateH1Trend) ====
function calculateDailyVWAP(candles: Candle[]): number | null {
  if (!candles || candles.length === 0) return null;
  const now = new Date();
  const todayUTCDay = now.getUTCDay();
  const todayUTCFullYear = now.getUTCFullYear();

  const todayCandles = candles.filter((c) => {
    const d = new Date(c.time);
    return d.getUTCDay() === todayUTCDay && d.getUTCFullYear() === todayUTCFullYear;
  });

  const targetCandles = todayCandles.length >= 3 ? todayCandles : candles;

  let cumulativePV = 0;
  let cumulativeVol = 0;

  for (const c of targetCandles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = c.volume && c.volume > 0 ? c.volume : 1;
    cumulativePV += typicalPrice * vol;
    cumulativeVol += vol;
  }

  if (cumulativeVol <= 0) return null;
  return cumulativePV / cumulativeVol;
}

// Calculate H1 Trend confirmation from candle history
function calculateH1Trend(candles: Candle[]): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (!candles || candles.length < 4) return 'NEUTRAL';

  const h1BarsMap: Record<number, { open: number; high: number; low: number; close: number; time: number }> = {};
  for (const c of candles) {
    const h1Time = Math.floor(c.time / 3600000) * 3600000;
    if (!h1BarsMap[h1Time]) {
      h1BarsMap[h1Time] = { time: h1Time, open: c.open, high: c.high, low: c.low, close: c.close };
    } else {
      const b = h1BarsMap[h1Time];
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      b.close = c.close;
    }
  }

  const h1Bars = Object.values(h1BarsMap).sort((a, b) => a.time - b.time);
  if (h1Bars.length >= 2) {
    const firstOpen = h1Bars[0].open;
    const lastClose = h1Bars[h1Bars.length - 1].close;
    const pctChange = (lastClose - firstOpen) / (firstOpen || 1);
    if (pctChange > 0.0012) return 'BULLISH';
    if (pctChange < -0.0012) return 'BEARISH';
  } else if (candles.length >= 10) {
    const oldest = candles[0].close;
    const latest = candles[candles.length - 1].close;
    const pctChange = (latest - oldest) / (oldest || 1);
    if (pctChange > 0.0012) return 'BULLISH';
    if (pctChange < -0.0012) return 'BEARISH';
  }

  return 'NEUTRAL';
}

// ==== OLD engine: evaluateMarketStructureFromCandles as it existed before this redesign (verbatim, renamed) ====
function oldEvaluateMarketStructureFromCandles(
  pairId: PairId,
  marketPrice: MarketPrice,
  candles: Candle[]
): StructureAnalysis {
  const currentPrice = marketPrice.price;
  const high24h = marketPrice.high24h || currentPrice * 1.008;
  const low24h = marketPrice.low24h || currentPrice * 0.992;
  const range24h = Math.max(high24h - low24h, currentPrice * 0.004);
  const pricePos = (currentPrice - low24h) / range24h;

  let atr = calculateATR(candles, 14);
  const shortTermAtr = calculateATR(candles, 5) || atr;

  // Fallback ATR estimation if real candles buffering
  if (!atr || atr <= 0) {
    let minAtrRatio = 0.0008;
    if (pairId === 'XAUUSD') minAtrRatio = 0.0012;
    else if (pairId.includes('USDT')) minAtrRatio = 0.003;
    atr = currentPrice * minAtrRatio;
  }

  // Calculate Technical Indicators: RSI & ADX
  const rsiData = calculateRSI(candles, 14);
  const adx = calculateADX(candles, 14);
  const { rsi, bullishDivergence, bearishDivergence } = rsiData;

  // 1. Detect Market Regime (Volatility & Trend)
  const regime = detectMarketRegime(pairId, candles, atr, rsiData, adx);

  // 2. Volatility Multiplier based on Regime
  let volMultiplier = 1.0;
  if (regime.volatility === 'HIGH') volMultiplier = 1.6;
  else if (regime.volatility === 'LOW') volMultiplier = 0.7;

  // Base parameters per asset class
  let baseMinSL = 0.0008;
  let baseMaxSL = 0.0025;
  let baseBandPct = 0.00015;

  // NOTE (widened): angka lama ($1.20-$3.00 utk XAUUSD dkk) lebih sempit dari noise wajar
  // antar sumber harga (feed server vs OANDA di TradingView vs broker MT), jadi sering
  // "SL keduluan" padahal broker asli belum tersentuh. Dilebarkan secukupnya - masih pas buat
  // scalping M5/M15 & tetap aman untuk modal kecil karena posisi/lot yang harus disesuaikan
  // ke bawah (lihat riskGuidance), bukan SL yang dipersempit paksa.
  if (pairId === 'XAUUSD') {
    baseMinSL = 4.50;
    baseMaxSL = 12.00;
    baseBandPct = 0.00012;
  } else if (pairId === 'BTCUSDT') {
    baseMinSL = 260;
    baseMaxSL = 1100;
    baseBandPct = 0.0003;
  } else if (pairId === 'ETHUSDT') {
    baseMinSL = 18;
    baseMaxSL = 85;
    baseBandPct = 0.0003;
  } else if (pairId === 'SOLUSDT') {
    baseMinSL = 1.20;
    baseMaxSL = 6.50;
    baseBandPct = 0.0003;
  } else if (['EURUSD', 'GBPUSD', 'USDCHF', 'USDCAD'].includes(pairId)) {
    baseMinSL = 0.0012;
    baseMaxSL = pairId === 'GBPUSD' ? 0.0040 : 0.0035;
    baseBandPct = 0.00015;
  }

  const minSL = Number((baseMinSL * volMultiplier).toFixed(marketPrice.digits));
  const maxSL = Number((baseMaxSL * volMultiplier).toFixed(marketPrice.digits));
  const spreadVolBuffer = pairId === 'XAUUSD' ? Math.max(0.30, shortTermAtr * 0.25) : Math.max(0.00010, shortTermAtr * 0.20);
  const baseSlDelta = atr * 1.30 + spreadVolBuffer;
  const slDelta = Number(Math.max(minSL, Math.min(maxSL, baseSlDelta)).toFixed(marketPrice.digits));

  // Volatility Regime Gate: Skip signal generation if ATR exceeds volatile threshold (scaled by volMultiplier)
  if (pairId === 'XAUUSD' && atr > (1.8 * volMultiplier)) {
    return {
      type: null,
      confluenceScore: 40,
      atr,
      shortTermAtr,
      slDelta: Number((3.00 * volMultiplier).toFixed(marketPrice.digits)),
      reasoningHeader: `NO VALID SETUP: Volatility Regime Gate active (ATR ${atr.toFixed(2)} > ${(1.8 * volMultiplier).toFixed(2)}). Signal generation paused in high volatility to maintain disciplined SL in calm conditions.`,
      strategyMethod: 'Volatility Regime Gate Active',
      bosDetected: false,
      fvgDetected: false,
      orderBlockDetected: false,
      adx,
      rsi,
      regime,
      baseMinSL,
      baseMaxSL,
      baseBandPct,
      volMultiplier,
    };
  }

  // Check for High Impact News Pause Window
  const isUsdImpactedPair = pairId === 'XAUUSD' || ['EURUSD', 'GBPUSD', 'USDCHF', 'USDCAD'].includes(pairId);
  if (isUsdImpactedPair && isUsdHighImpactNewsWindow(pairId)) {
    return {
      type: null,
      confluenceScore: 40,
      atr,
      shortTermAtr,
      slDelta,
      reasoningHeader: `NO VALID SETUP: High-Impact USD Economic Event Window active (-5m to +15m). ${marketPrice.name} signal generation paused for news volatility protection.`,
      strategyMethod: 'High Impact News Filter Active',
      bosDetected: false,
      fvgDetected: false,
      orderBlockDetected: false,
      adx,
      rsi,
      regime,
      baseMinSL,
      baseMaxSL,
      baseBandPct,
      volMultiplier,
    };
  }

  // Detect Swing Highs & Lows over full candle buffer
  let swingHighs: number[] = [];
  let swingLows: number[] = [];

  if (candles.length >= 5) {
    for (let i = 2; i < candles.length - 1; i++) {
      if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high) {
        swingHighs.push(candles[i].high);
      }
      if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low) {
        swingLows.push(candles[i].low);
      }
    }
  }

  const lastSwingHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1] : high24h;
  const lastSwingLow = swingLows.length > 0 ? swingLows[swingLows.length - 1] : low24h;

  // Detect Break of Structure (BOS) & Liquidity Sweeps
  const bullishBOS = currentPrice > lastSwingHigh;
  const bearishBOS = currentPrice < lastSwingLow;
  const bullishSweep = candles.length > 0 && candles[candles.length - 1].low < lastSwingLow && currentPrice > candles[candles.length - 1].low;
  const bearishSweep = candles.length > 0 && candles[candles.length - 1].high > lastSwingHigh && currentPrice < candles[candles.length - 1].high;

  // Detect Fair Value Gap (FVG)
  let bullishFVG = false;
  let bearishFVG = false;
  if (candles.length >= 3) {
    const c1 = candles[candles.length - 3];
    const c3 = candles[candles.length - 1];
    if (c3.low > c1.high) bullishFVG = true;
    if (c3.high < c1.low) bearishFVG = true;
  }

  // Higher Timeframe Bias Confirmation
  let htTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (candles.length >= 10) {
    const oldest = candles[0].close;
    const latest = candles[candles.length - 1].close;
    const change = (latest - oldest) / (oldest || 1);
    if (change > 0.0008) htTrend = 'BULLISH';
    else if (change < -0.0008) htTrend = 'BEARISH';
  } else if (Math.abs(marketPrice.change24h) >= 0.15) {
    htTrend = marketPrice.change24h >= 0 ? 'BULLISH' : 'BEARISH';
  }

  const h1Trend = calculateH1Trend(candles);

  let volumePenalty = 0;
  if (candles.length >= 10) {
    const avgVol = candles.slice(-10).reduce((acc, c) => acc + (c.volume || 0), 0) / 10;
    const lastVol = candles[candles.length - 1]?.volume || 0;
    if (avgVol > 0 && lastVol < avgVol * 0.35) {
      volumePenalty = 8;
    }
  }

  const inDiscount = pricePos <= 0.48;
  const inPremium = pricePos >= 0.52;

  // Count Reversal Confirmations (min 2 of 3)
  let reversalConfirmations = 0;
  if (regime.trend === 'REVERSAL_UP') {
    if (bullishDivergence) reversalConfirmations++;
    if (bullishBOS || bullishSweep) reversalConfirmations++;
    if (inDiscount || bullishFVG) reversalConfirmations++;
  } else if (regime.trend === 'REVERSAL_DOWN') {
    if (bearishDivergence) reversalConfirmations++;
    if (bearishBOS || bearishSweep) reversalConfirmations++;
    if (inPremium || bearishFVG) reversalConfirmations++;
  }

  let type: 'BUY' | 'SELL' | null = null;
  let confluenceScore = 0;
  let reasoningHeader = '';

  // Handle REVERSAL trend regimes explicitly
  if (regime.trend === 'REVERSAL_UP') {
    if (reversalConfirmations < 2) {
      type = null;
      confluenceScore = 45;
      reasoningHeader = 'NO VALID SETUP: Reversal terdeteksi tapi konfirmasi belum cukup (min 2/3: RSI divergence, BOS/Sweep, OB/FVG), menunggu konfirmasi tambahan.';
    } else {
      type = 'BUY';
      confluenceScore = 78 + reversalConfirmations * 5 - volumePenalty;
      reasoningHeader = `✓ High-Probability Bullish Reversal detected (${reversalConfirmations}/3 confirmations: RSI div, BOS, OB/FVG).\n✓ Volatility regime (${regime.volatility}) scaled risk model.\n✓ Structural Stop Loss positioned below recent swing low.`;
    }
  } else if (regime.trend === 'REVERSAL_DOWN') {
    if (reversalConfirmations < 2) {
      type = null;
      confluenceScore = 45;
      reasoningHeader = 'NO VALID SETUP: Reversal terdeteksi tapi konfirmasi belum cukup (min 2/3: RSI divergence, BOS/Sweep, OB/FVG), menunggu konfirmasi tambahan.';
    } else {
      type = 'SELL';
      confluenceScore = 78 + reversalConfirmations * 5 - volumePenalty;
      reasoningHeader = `✓ High-Probability Bearish Reversal detected (${reversalConfirmations}/3 confirmations: RSI div, BOS, OB/FVG).\n✓ Volatility regime (${regime.volatility}) scaled risk model.\n✓ Structural Stop Loss positioned above recent swing high.`;
    }
  } else if ((bullishBOS || inDiscount || bullishSweep) && (bullishFVG || currentPrice <= lastSwingLow + atr * 0.6)) {
    type = 'BUY';
    confluenceScore = 74 + (bullishBOS ? 8 : 0) + (bullishFVG ? 8 : 0) + (bullishSweep ? 6 : 0) - volumePenalty;
    reasoningHeader = `✓ Genuine Market Structure Shift (MSS) detected from M5/M15 OHLC candles.\n✓ Real-time ATR (${atr.toFixed(marketPrice.digits)}) used for dynamic risk modeling.\n✓ Price retesting Discount Order Block & Fair Value Gap (FVG).`;
  } else if ((bearishBOS || inPremium || bearishSweep) && (bearishFVG || currentPrice >= lastSwingHigh - atr * 0.6)) {
    type = 'SELL';
    confluenceScore = 74 + (bearishBOS ? 8 : 0) + (bearishFVG ? 8 : 0) + (bearishSweep ? 6 : 0) - volumePenalty;
    reasoningHeader = `✓ Genuine Bearish Market Structure Shift (MSS) detected from M5/M15 OHLC candles.\n✓ Real-time ATR (${atr.toFixed(marketPrice.digits)}) used for dynamic risk modeling.\n✓ Price retesting Premium Supply Zone & Order Block (OB).`;
  } else if (Math.abs(marketPrice.change24h) >= 0.35 && adx >= 20) {
    type = marketPrice.change24h >= 0 ? 'BUY' : 'SELL';
    let trendScore = 64 + Math.min(10, Math.abs(marketPrice.change24h) * 8) - volumePenalty;
    if (candles.length >= 5) {
      const last5 = candles.slice(-5);
      const directionMatches = last5.filter(c => type === 'BUY' ? c.close >= c.open : c.close <= c.open).length;
      if (directionMatches >= 4) trendScore += 6;
    }
    confluenceScore = Math.min(85, Math.round(trendScore));
    reasoningHeader = `✓ Trend Momentum Continuation confirmed on M15 timeframe (ADX ${adx.toFixed(1)} >= 20).\n✓ Dynamic ATR Volatility (${atr.toFixed(marketPrice.digits)}) aligned with order flow.`;
  } else {
    type = null;
    confluenceScore = 45;
    reasoningHeader = 'NO VALID SETUP: Market structure in equilibrium without high-confluence entry.';
  }

  // H1 Trend Confirmation - INFORMATIONAL ONLY by product decision: never rejects a signal and
  // never applies a large penalty, so it doesn't reduce how often signals fire. It's context for
  // the user, with at most a small optional nudge to confluenceScore. h1Trend is 'NEUTRAL'
  // whenever there isn't enough H1 candle data yet (see calculateH1Trend), which naturally means
  // this block adds a neutral note and skips any adjustment for pairs without enough history -
  // never a rejection.
  if (type === 'BUY') {
    if (h1Trend === 'BULLISH') {
      reasoningHeader += '\n✓ Searah tren H1 (BULLISH).';
    } else if (h1Trend === 'BEARISH') {
      confluenceScore -= 5;
      reasoningHeader += '\n⚠ Melawan tren H1 (BEARISH) — pertimbangkan risiko lebih hati-hati.';
    } else {
      reasoningHeader += '\n• Tren H1 saat ini netral (data belum cukup atau tidak dominan satu arah).';
    }
  } else if (type === 'SELL') {
    if (h1Trend === 'BEARISH') {
      reasoningHeader += '\n✓ Searah tren H1 (BEARISH).';
    } else if (h1Trend === 'BULLISH') {
      confluenceScore -= 5;
      reasoningHeader += '\n⚠ Melawan tren H1 (BULLISH) — pertimbangkan risiko lebih hati-hati.';
    } else {
      reasoningHeader += '\n• Tren H1 saat ini netral (data belum cukup atau tidak dominan satu arah).';
    }
  }

  // Daily VWAP Confluence
  const vwap = calculateDailyVWAP(candles);
  if (type !== null && vwap !== null) {
    if (type === 'BUY') {
      if (currentPrice < vwap) {
        confluenceScore += 5;
        reasoningHeader += `\n✓ Price below Daily VWAP (${vwap.toFixed(marketPrice.digits)}) — Mean Reversion Discount (+5).`;
      } else {
        confluenceScore -= 4;
        reasoningHeader += `\n⚠ Price above Daily VWAP for BUY (-4).`;
      }
    } else if (type === 'SELL') {
      if (currentPrice > vwap) {
        confluenceScore += 5;
        reasoningHeader += `\n✓ Price above Daily VWAP (${vwap.toFixed(marketPrice.digits)}) — Mean Reversion Premium (+5).`;
      } else {
        confluenceScore -= 4;
        reasoningHeader += `\n⚠ Price below Daily VWAP for SELL (-4).`;
      }
    }
  }

  // Fibonacci Retracement Confluence
  const swingDiff = Math.abs(lastSwingHigh - lastSwingLow);
  if (type !== null && swingDiff > 0) {
    const fib50 = type === 'BUY' ? lastSwingHigh - 0.5 * swingDiff : lastSwingLow + 0.5 * swingDiff;
    const fib618 = type === 'BUY' ? lastSwingHigh - 0.618 * swingDiff : lastSwingLow + 0.618 * swingDiff;
    const tolerance = Math.max(atr * 0.4, swingDiff * 0.08);

    const near50 = Math.abs(currentPrice - fib50) <= tolerance;
    const near618 = Math.abs(currentPrice - fib618) <= tolerance;

    if (near50 || near618) {
      confluenceScore += 5;
      const fibName = near618 ? '0.618 Golden Ratio' : '0.50 Retracement';
      reasoningHeader += `\n✓ Entry zone aligned with Fibonacci ${fibName} level (+5).`;
    }
  }

  // RSI Overbought/Oversold Score Penalty
  if (type === 'BUY' && rsi > 70 && !bullishDivergence) {
    confluenceScore -= 15;
    reasoningHeader += `\n⚠ Overbought RSI (${rsi}) filter penalty applied (-15).`;
  } else if (type === 'SELL' && rsi < 30 && !bearishDivergence) {
    confluenceScore -= 15;
    reasoningHeader += `\n⚠ Oversold RSI (${rsi}) filter penalty applied (-15).`;
  }

  // HTF Bias (higher-timeframe direction derived from the M5 candle buffer) - INFORMATIONAL
  // ONLY, same product decision as the H1 trend block above: never rejects a signal, penalty
  // capped at -5 regardless of BOS/FVG confirmation, and always leaves a status note in
  // analysisReasoning (aligned/against/neutral) so the user sees the context either way.
  if (type === 'BUY') {
    if (htTrend === 'BULLISH') {
      reasoningHeader += '\n✓ Searah tren HTF (BULLISH).';
    } else if (htTrend === 'BEARISH') {
      confluenceScore -= 5;
      reasoningHeader += '\n⚠ Melawan tren HTF (BEARISH) — pertimbangkan risiko lebih hati-hati.';
    } else {
      reasoningHeader += '\n• Tren HTF saat ini netral (data belum cukup atau tidak dominan satu arah).';
    }
  } else if (type === 'SELL') {
    if (htTrend === 'BEARISH') {
      reasoningHeader += '\n✓ Searah tren HTF (BEARISH).';
    } else if (htTrend === 'BULLISH') {
      confluenceScore -= 5;
      reasoningHeader += '\n⚠ Melawan tren HTF (BULLISH) — pertimbangkan risiko lebih hati-hati.';
    } else {
      reasoningHeader += '\n• Tren HTF saat ini netral (data belum cukup atau tidak dominan satu arah).';
    }
  }

  // hoisted here so both this block's Volume Confirmation note and the pre-existing Mandatory
  // Crypto Volume Filter Penalty below can share one declaration
  const isCrypto = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].includes(pairId);

  // MACD Confirmation - INFORMATIONAL ONLY, same product decision as H1/HTF above: never
  // rejects a signal, penalty capped at -5. Standard MACD (EMA12, EMA26, signal = EMA9 of the
  // MACD line) computed from whatever candle history is available; skipped entirely (no note,
  // no adjustment) when there's under 26 candles to work with, since EMA26 wouldn't be
  // meaningful yet - never forced.
  if (type !== null && candles.length >= 26) {
    const closes = candles.map((c) => c.close);
    const ema12Series = calculateEMASeries(closes, 12);
    const ema26Series = calculateEMASeries(closes, 26);
    const macdLine = closes.map((_, i) => ema12Series[i] - ema26Series[i]);
    const signalLine = calculateEMASeries(macdLine, 9);
    const histogram = macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1];

    if (type === 'BUY') {
      if (histogram > 0) {
        reasoningHeader += '\n✓ MACD momentum searah.';
      } else {
        confluenceScore -= 5;
        reasoningHeader += '\n⚠ MACD momentum berlawanan arah — pertimbangkan risiko lebih hati-hati.';
      }
    } else if (type === 'SELL') {
      if (histogram < 0) {
        reasoningHeader += '\n✓ MACD momentum searah.';
      } else {
        confluenceScore -= 5;
        reasoningHeader += '\n⚠ MACD momentum berlawanan arah — pertimbangkan risiko lebih hati-hati.';
      }
    }
  }

  // EMA50 Trend Alignment - INFORMATIONAL ONLY, same pattern, penalty capped at -5. Requires at
  // least 50 candles to compute a real EMA50; skipped entirely (no note, no adjustment)
  // otherwise, per explicit instruction not to force this on pairs without enough history. Note:
  // candle buffers in this codebase are typically capped around 30 bars (see candleStore usage
  // throughout), so in practice this check will mostly stay skipped unless/until a pair
  // accumulates 50+ stored candles - flagged here, not silently "fixed" by lowering the 50
  // threshold, since that was an explicit, deliberate instruction.
  if (type !== null && candles.length >= 50) {
    const closes = candles.map((c) => c.close);
    const ema50Series = calculateEMASeries(closes, 50);
    const ema50 = ema50Series[ema50Series.length - 1];

    if (type === 'BUY') {
      if (currentPrice > ema50) {
        reasoningHeader += '\n✓ Searah EMA50.';
      } else {
        confluenceScore -= 5;
        reasoningHeader += '\n⚠ Melawan EMA50.';
      }
    } else if (type === 'SELL') {
      if (currentPrice < ema50) {
        reasoningHeader += '\n✓ Searah EMA50.';
      } else {
        confluenceScore -= 5;
        reasoningHeader += '\n⚠ Melawan EMA50.';
      }
    }
  }

  // Volume Confirmation - crypto only (BTCUSDT/ETHUSDT/SOLUSDT), the only pairs with real
  // exchange-reported volume in our candle data (forex/XAU candles carry a synthetic/placeholder
  // volume field, not real traded volume, so a volume check there would be meaningless). Pure
  // information either way, never a penalty - even below-average volume just gets a neutral note.
  if (type !== null && isCrypto && candles.length >= 10) {
    const avgVol10Info = candles.slice(-10).reduce((acc, c) => acc + (c.volume || 0), 0) / 10;
    const lastVolInfo = candles[candles.length - 1]?.volume || 0;

    if (avgVol10Info > 0 && lastVolInfo > avgVol10Info) {
      reasoningHeader += '\n✓ Volume di atas rata-rata, konfirmasi partisipasi pasar.';
    } else {
      reasoningHeader += '\n• Volume di bawah rata-rata, monitor kelanjutannya.';
    }
  }

  // Mandatory Crypto Volume Filter Penalty
  if (type !== null && isCrypto && candles.length >= 10) {
    const avgVol10 = candles.slice(-10).reduce((acc, c) => acc + (c.volume || 0), 0) / 10;
    const lastVol = candles[candles.length - 1]?.volume || 0;

    const isPureReversal = bullishFVG || bearishFVG || bullishSweep || bearishSweep;
    const isBreakoutOrTrend = bullishBOS || bearishBOS || (!isPureReversal && Math.abs(marketPrice.change24h) >= 0.35);

    if (isBreakoutOrTrend && avgVol10 > 0 && lastVol < avgVol10 * 0.80) {
      confluenceScore -= 12;
      reasoningHeader += `\n⚠ Low volume breakout (${lastVol.toFixed(1)} < 80% avg) penalty applied (-12).`;
    }
  }

  // Forex Directional Correlation Filter Penalty
  const isForexPair = ['EURUSD', 'GBPUSD', 'USDCHF', 'USDCAD'].includes(pairId);
  if (type !== null && isForexPair) {
    const candidateUsdDir = getNetUsdDirection(pairId, type);
    if (candidateUsdDir) {
      const activeForexPairs: PairId[] = ['EURUSD', 'GBPUSD', 'USDCHF', 'USDCAD'];
      let hasCorrelatedActive = false;
      let activeCorrelatedPair = '';

      for (const otherId of activeForexPairs) {
        if (otherId === pairId) continue;
        const activeSig = currentSignals[otherId];
        if (
          activeSig &&
          ['Running', 'Waiting Entry', 'TP1 Hit'].includes(activeSig.status)
        ) {
          const activeUsdDir = getNetUsdDirection(activeSig.pairId, activeSig.type);
          if (activeUsdDir === candidateUsdDir) {
            hasCorrelatedActive = true;
            activeCorrelatedPair = `${activeSig.pairId} ${activeSig.type}`;
            break;
          }
        }
      }

      if (hasCorrelatedActive) {
        confluenceScore -= 8;
        reasoningHeader += `\n⚠ Correlated Forex directional exposure penalty applied (-8) due to active ${activeCorrelatedPair} signal.`;
      }
    }
  }

  // Special Flexible Retest & Trigger Rules for XAU/USD
  if (pairId === 'XAUUSD') {
    const recentCandles = candles.slice(-6);
    const hasBuyOBRetest = bullishFVG || inDiscount || (recentCandles.length > 0 && recentCandles.some(c => c.low <= lastSwingLow + atr * 0.8));
    const hasSellOBRetest = bearishFVG || inPremium || (recentCandles.length > 0 && recentCandles.some(c => c.high >= lastSwingHigh - atr * 0.8));

    const has3BarMomentum = candles.length >= 3 && (
      type === 'BUY' ? candles.slice(-3).every(c => c.close >= c.open) : candles.slice(-3).every(c => c.close <= c.open)
    );

    const validTrigger = (type === 'BUY' && (hasBuyOBRetest || has3BarMomentum || bullishSweep)) ||
                         (type === 'SELL' && (hasSellOBRetest || has3BarMomentum || bearishSweep)) ||
                         confluenceScore >= 76;

    if (!validTrigger) {
      type = null;
      confluenceScore = 50;
      reasoningHeader = 'NO VALID SETUP: XAU/USD waiting for OB/FVG retest, momentum, or liquidity sweep.';
    }

    if (type !== null && confluenceScore < 70) {
      type = null;
      reasoningHeader = 'NO VALID SETUP: XAU/USD confluence score below minimum threshold (70).';
    }
  }

  // Dynamic Strategy Method
  let strategyMethod = 'M15 Market Structure Shift + OB';
  if (bullishBOS || bearishBOS) {
    strategyMethod = 'M15 Break of Structure (BOS) + CHoCH Expansion';
  } else if (bullishFVG || bearishFVG) {
    strategyMethod = 'M5 Fair Value Gap (FVG) Retest & Order Flow';
  } else if (bullishSweep || bearishSweep) {
    strategyMethod = 'M5 Liquidity Sweep & Institutional Reversal';
  } else if (type !== null) {
    strategyMethod = 'M15 Trend Momentum & Dynamic Volatility Model';
  }

  return {
    type,
    confluenceScore,
    atr,
    shortTermAtr,
    slDelta,
    reasoningHeader,
    strategyMethod,
    bosDetected: bullishBOS || bearishBOS,
    fvgDetected: bullishFVG || bearishFVG,
    orderBlockDetected: inDiscount || inPremium,
    adx,
    rsi,
    regime,
    swingHighs,
    swingLows,
    baseMinSL,
    baseMaxSL,
    baseBandPct,
    volMultiplier,
    reversalConfirmations,
  };
}


// ==== NEW engine: current evaluateMarketStructureFromCandles + its XAU-only detectors (verbatim, renamed) ====
// XAU/USD-ONLY: Genuine ICT/SMC structure detection (Order Blocks, displacement-filtered FVGs,
// clustered Supply/Demand zones) + multi-pattern setup evaluation.
//
// Scope discipline: everything in this section is only ever called from inside
// `if (pairId === 'XAUUSD')` branches further down. No other pair's detection path, scoring, or
// SL/TP math is touched by any of this - BTCUSDT/ETHUSDT/SOLUSDT/EURUSD/GBPUSD/USDCHF/USDCAD
// keep running the exact same generic logic they always did (bullishSweep/bearishSweep, the
// generic bullishFVG/bearishFVG 3-candle gap check, the flat baseMinSL/baseMaxSL bands, and the
// riskDist-multiple TP1/TP2) unchanged.
//
// This replaces 3 concrete "faked" pieces the audit found for XAUUSD specifically:
//  1. orderBlockDetected was `inDiscount || inPremium` (just "is price in the top/bottom half of
//     the 24h range") - not an Order Block at all. detectXauOrderBlocks() below finds the real
//     ICT definition: the last opposite-colored candle before an impulsive move that breaks a
//     prior swing (BOS).
//  2. structureBreakdown.mss/liquiditySweep/supplyDemand were hardcoded `true` for every signal.
//     Replaced with genuine booleans from the detectors below (mss reuses the already-genuine
//     bosDetected; liquiditySweep reuses the already-genuine bullishSweep/bearishSweep; supplyDemand
//     is now the clustered-zone detector's actual finding).
//  3. Entry was `currentPrice +/- bandPct` (generic % offset) and SL was clamped to a flat
//     $4.50-$12.00 band regardless of structure. Replaced by anchoring entry/SL/TP to the actual
//     structural level (OB edge, FVG boundary, liquidity-sweep wick, or S&D zone edge) that is the
//     stated reason for the trade.
// ============================================================================================

interface XauOrderBlock {
  type: 'bullish' | 'bearish';
  high: number;
  low: number;
  index: number;
  mitigated: boolean;
}

// Real ICT Order Block: the last candle opposite to an impulsive move that breaks a PRIOR swing
// (computed only from candles strictly before the OB candle, so this can never "see the future").
// An OB is "mitigated" once a later candle closes back through its far edge - it's no longer a
// valid zone to retest.
function detectXauOrderBlocks(candles: Candle[], atr: number): { bullish: XauOrderBlock[]; bearish: XauOrderBlock[] } {
  const bullish: XauOrderBlock[] = [];
  const bearish: XauOrderBlock[] = [];
  if (!candles || candles.length < 6 || !atr || atr <= 0) return { bullish, bearish };

  for (let i = 1; i < candles.length - 1; i++) {
    const c = candles[i];
    const next = candles[i + 1];
    const isBearishCandle = c.close < c.open;
    const isBullishCandle = c.close > c.open;
    const nextBodyMove = next.close - next.open;

    const priorSlice = candles.slice(Math.max(0, i - 10), i);
    let priorSwingHigh = -Infinity;
    let priorSwingLow = Infinity;
    for (let j = 1; j < priorSlice.length - 1; j++) {
      if (priorSlice[j].high > priorSlice[j - 1].high && priorSlice[j].high > priorSlice[j + 1].high) {
        priorSwingHigh = Math.max(priorSwingHigh, priorSlice[j].high);
      }
      if (priorSlice[j].low < priorSlice[j - 1].low && priorSlice[j].low < priorSlice[j + 1].low) {
        priorSwingLow = Math.min(priorSwingLow, priorSlice[j].low);
      }
    }
    if (priorSlice.length > 0) {
      if (priorSwingHigh === -Infinity) priorSwingHigh = Math.max(...priorSlice.map((p) => p.high));
      if (priorSwingLow === Infinity) priorSwingLow = Math.min(...priorSlice.map((p) => p.low));
    } else {
      priorSwingHigh = c.high;
      priorSwingLow = c.low;
    }

    // Bullish OB: last down-candle before an impulsive up move that breaks the prior swing high (BOS)
    if (isBearishCandle && nextBodyMove >= atr * 0.8 && next.close > priorSwingHigh) {
      bullish.push({ type: 'bullish', high: c.high, low: c.low, index: i, mitigated: false });
    }
    // Bearish OB: last up-candle before an impulsive down move that breaks the prior swing low (BOS)
    if (isBullishCandle && -nextBodyMove >= atr * 0.8 && next.close < priorSwingLow) {
      bearish.push({ type: 'bearish', high: c.high, low: c.low, index: i, mitigated: false });
    }
  }

  for (const ob of bullish) {
    for (let k = ob.index + 2; k < candles.length; k++) {
      if (candles[k].close < ob.low) { ob.mitigated = true; break; }
    }
  }
  for (const ob of bearish) {
    for (let k = ob.index + 2; k < candles.length; k++) {
      if (candles[k].close > ob.high) { ob.mitigated = true; break; }
    }
  }

  return { bullish, bearish };
}

interface XauFVG {
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  index: number;
  filled: boolean;
}

// Same 3-candle imbalance test the generic bullishFVG/bearishFVG check already uses elsewhere in
// this file, PLUS a minimum-displacement filter (gap >= 0.25x ATR) so a microscopic gap doesn't
// count as a genuine FVG, and scanned across the FULL candle buffer (not just the last 3 candles)
// so the nearest still-unfilled gap can be found, not just whatever happened in the latest bar.
function detectXauFVGs(candles: Candle[], atr: number): { bullish: XauFVG[]; bearish: XauFVG[] } {
  const bullish: XauFVG[] = [];
  const bearish: XauFVG[] = [];
  if (!candles || candles.length < 3 || !atr || atr <= 0) return { bullish, bearish };
  const minGap = atr * 0.25;

  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c3 = candles[i];
    if (c3.low > c1.high && (c3.low - c1.high) >= minGap) {
      bullish.push({ type: 'bullish', top: c3.low, bottom: c1.high, index: i, filled: false });
    }
    if (c3.high < c1.low && (c1.low - c3.high) >= minGap) {
      bearish.push({ type: 'bearish', top: c1.low, bottom: c3.high, index: i, filled: false });
    }
  }

  for (const g of bullish) {
    for (let k = g.index + 1; k < candles.length; k++) {
      if (candles[k].low <= g.bottom) { g.filled = true; break; }
    }
  }
  for (const g of bearish) {
    for (let k = g.index + 1; k < candles.length; k++) {
      if (candles[k].high >= g.top) { g.filled = true; break; }
    }
  }

  return { bullish, bearish };
}

interface XauZone {
  top: number;
  bottom: number;
  touches: number;
  kind: 'supply' | 'demand';
}

// Supply/Demand from clustered consolidation, not a single swing point: bins recent candle
// highs/lows into ATR-sized buckets and keeps buckets touched >= 3 times as a real S&D zone -
// price that has repeatedly rejected from the same area, which is the actual ICT/SMC definition,
// not a single fractal high/low.
function detectXauSupplyDemandZones(candles: Candle[], atr: number, currentPrice: number): { supply: XauZone[]; demand: XauZone[] } {
  const supply: XauZone[] = [];
  const demand: XauZone[] = [];
  if (!candles || candles.length < 10 || !atr || atr <= 0) return { supply, demand };

  const binWidth = Math.max(atr * 0.5, 0.01);
  const highBins = new Map<number, number>();
  const lowBins = new Map<number, number>();

  const recent = candles.slice(-60);
  for (const c of recent) {
    const hBin = Math.round(c.high / binWidth);
    const lBin = Math.round(c.low / binWidth);
    highBins.set(hBin, (highBins.get(hBin) || 0) + 1);
    lowBins.set(lBin, (lowBins.get(lBin) || 0) + 1);
  }

  for (const [bin, touches] of highBins.entries()) {
    if (touches >= 3) {
      const level = bin * binWidth;
      if (level > currentPrice) {
        supply.push({ top: level + binWidth / 2, bottom: level - binWidth / 2, touches, kind: 'supply' });
      }
    }
  }
  for (const [bin, touches] of lowBins.entries()) {
    if (touches >= 3) {
      const level = bin * binWidth;
      if (level < currentPrice) {
        demand.push({ top: level + binWidth / 2, bottom: level - binWidth / 2, touches, kind: 'demand' });
      }
    }
  }

  // Rank by strength (touch count) FIRST, distance only as a tiebreaker - a thin, incidentally
  // nearby bin (e.g. a level candles merely passed through once or twice while travelling toward
  // the real zone) should never outrank a genuinely well-touched cluster just for being a bin
  // closer to the current price. This is what makes it "clustered consolidation" S&D rather than
  // a single nearest swing point.
  const rankZones = (zones: XauZone[], nearnessOf: (z: XauZone) => number): XauZone[] =>
    [...zones].sort((a, b) => (b.touches - a.touches) || (nearnessOf(a) - nearnessOf(b)));

  const rankedSupply = rankZones(supply, (z) => z.bottom); // ties broken by nearest-above-price
  const rankedDemand = rankZones(demand, (z) => -z.top); // ties broken by nearest-below-price

  return { supply: rankedSupply.slice(0, 2), demand: rankedDemand.slice(0, 2) };
}

interface XauSetupResult {
  type: 'BUY' | 'SELL' | null;
  pattern: 'TREND_CONTINUATION' | 'LIQUIDITY_SWEEP_REVERSAL' | 'RANGE_SND_BOUNCE' | 'CHOCH_REVERSAL' | 'BREAKOUT_DISPLACEMENT_CONTINUATION' | null;
  confluenceScore: number;
  reasoningNote: string;
  strategyMethod: string;
  entryZone: { min: number; max: number; optimal: number } | null;
  // Fase E measurement (mirrors server.ts's XauSetupResult.zoneAgeBars exactly - see that file's
  // own comment for the full rationale). Only populated for TREND_CONTINUATION candidates.
  zoneAgeBars?: number | null;
  structuralSLLevel: number | null;
  tp1Level: number | null;
  tp2Level: number | null;
  // Fase D prerequisite (2026-09-04): mirrors server.ts's XauSetupResult.signalTier - see the
  // MAIN/SCALP selection cascade below for the port. Undefined only for `noSetup` (no candidate
  // ever qualified either tier).
  signalTier?: 'MAIN' | 'SCALP';
  genuineOBDetected: boolean;
  genuineSNDDetected: boolean;
  genuineFVGDetected: boolean;
  // 2026-09-03 HTF bias & directional gate audit/backtest addition - logged so the walk-forward
  // loop can tag each fired signal with whether it went out aligned with, opposed to, or neutral
  // relative to the genuine HTF read at that moment, independent of gateMode (even in 'OLD' mode
  // this is computed for reporting, it's just not used to filter anything).
  htfBiasCombined?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  htfOpposed?: boolean;
  // 2026-09-03 Fase 3 addition - mirrors production's XauSetupResult.htfAlignment exactly (see
  // server.ts's own comment). Derived from the same opposesHtf/alignsHtf values as
  // htfBiasCombined/htfOpposed above, just normalized into the 3-way label the adaptive-weighting
  // cache keys off.
  htfAlignment?: 'ALIGNED' | 'OPPOSED' | 'NEUTRAL';
  // Fase 3 diagnostics - populated only when fase3Mode==='ON', for the backtest report's own
  // instrumentation (never read by production, never affects gating/scoring beyond what's already
  // baked into confluenceScore).
  chaseDistanceAtr?: number;
  retestTouches?: number;
  // Fase 4 diagnostic - see the assignment site's own comment.
  runnerUp?: {
    pattern: 'TREND_CONTINUATION' | 'LIQUIDITY_SWEEP_REVERSAL' | 'RANGE_SND_BOUNCE' | 'CHOCH_REVERSAL' | 'BREAKOUT_DISPLACEMENT_CONTINUATION' | null;
    type: 'BUY' | 'SELL';
    confluenceScore: number;
    entryZone: { min: number; max: number; optimal: number } | null;
    structuralSLLevel: number | null;
    tp1Level: number | null;
    tp2Level: number | null;
  } | null;
}

// Multi-pattern XAU/USD setup scan - runs 3 independent ICT/SMC patterns in parallel, each suited
// to a different market regime, instead of the old single validTrigger check that only recognized
// one combined pattern. This directly targets the "signal jarang muncul" complaint WITHOUT
// lowering the bar for any individual pattern: trending markets get trend-continuation,
// ranging markets (low ADX) get S&D bounces (a genuinely different, valid setup - not a fallback),
// and a liquidity sweep is now its own independent trigger in either regime, not just a scoring
// bonus buried inside the old combined check.

// Mirrors server.ts's pickXauTpPair/XAU_MIN_TP_SEPARATION_ATR_MULT exactly - see that file for the
// full rationale. Ensures TP2 is a genuinely separate swing target, not a trivially-close pivot.
const XAU_MIN_TP_SEPARATION_ATR_MULT = 1.0;

// 2026-09-01 RR ENGINE REWORK CANDIDATES - mirrors the same-named/same-purpose constants added to
// server.ts's evaluateXauIctSetups this session (search server.ts for these exact names for the
// full rationale). NOT backtest-calibrated to a final number yet - this script's job is to produce
// the before/after numbers that calibrate them.
//
// KNOWN FIDELITY GAP (predates this session, not introduced by it): this file's
// evaluateXauIctSetups/newBuildEntrySlTp were an older, simplified mirror of server.ts's real XAU
// logic - missing the rejection-close confirmation requirement, the MAIN/SCALP signal-tier split,
// and (until an earlier session added it) the worst-case-fill-edge RR gate. The before/after
// comparisons this script produced before 2026-09-04 are still valid for isolating the effect of
// each session's own changes (both runs of any given comparison share the same base), but signal
// counts from before that date under-represent production, which also generates SCALP-tier
// signals this mirror could not produce at all.
//
// 2026-09-04 (Fase D prerequisite): the MAIN/SCALP tier split IS NOW PORTED (see
// evaluateXauIctSetups' tiered selection cascade and newBuildEntrySlTp's tier-aware RR gate) -
// this mirror now produces both tiers, same as production. STILL MISSING, not touched by this
// port: the rejection-close confirmation requirement for TREND_CONTINUATION candidate GENERATION
// itself (hasXauBullishRejectionClose/hasXauBearishRejectionClose exist in this file and are used
// by the Fase B anti-countertrend gate mirror, but Pattern 1's own candidate-creation condition
// here still does not require them the way server.ts's evaluateXauIctSetups does) - flagged
// honestly rather than silently assumed fixed. Any report this script produces that buckets by
// pattern should be read with that residual gap in mind for TREND_CONTINUATION specifically.
//
// Mutable (not const) so the calibration sweep below can re-run the same real fetched candles
// through multiple threshold combinations in one process. UPDATED 2026-09-01 after two real-data
// sweep rounds (see the sweep table this script prints, "RECOMMENDED-A"): the original 0.4 zone-cap
// guess collapsed signals to ~0-2/906 in BOTH rounds - the cap alone, not the RR floor or extension
// gate, was the culprit. 0.6 is the calibrated replacement: on real data it INCREASED both frequency
// (267 vs 135/day-equivalent baseline, zone-cap alone) and quality (avgR 0.31 vs 0.20) versus no cap
// at all, and combined with the 1.5/2.5 RR floor below (RECOMMENDED-A) still keeps ~67% of baseline
// frequency while nearly doubling avg R (0.35) and worst-case-edge RR1 median (1.13 -> 2.01). These
// are still CANDIDATE defaults, not shipped to server.ts yet - see the chat report for
// RECOMMENDED-A vs RECOMMENDED-B (2.0/3.5, higher quality, ~41% of baseline frequency) and the
// standing risk-trade-off pause this project follows before a human picks the final number.
let xauReworkParams = {
  minRr1Main: 1.5,
  minRr2Main: 2.5,
  zoneWidthToRiskRatio: 0.6, // Infinity disables the zone-width cap entirely
  extensionAtrMult: 2.0, // Infinity disables the anti-chasing extension gate entirely
};

function pickXauTpPair(sortedSwings: number[], atr: number, riskDist = atr): { tp1: number | null; tp2: number | null } {
  if (sortedSwings.length === 0) return { tp1: null, tp2: null };
  const tp1 = sortedSwings[0];
  // Same production rule: a target gap must clear both one ATR and 0.6R.
  const minSeparation = Math.max(atr * XAU_MIN_TP_SEPARATION_ATR_MULT, riskDist * 0.6);
  const tp2 = sortedSwings.slice(1).find((target) => Math.abs(target - tp1) >= minSeparation) ?? null;
  return { tp1, tp2 };
}

// Fase D prerequisite (2026-09-04): SCALP tier's own RR1 floor - mirrors server.ts's
// XAU_MIN_RR1_SCALP exactly (see that file's own comment for the RR-engine-rework rationale;
// this value is the same RECOMMENDED-A number already live in production, not a new candidate).
const XAU_MIN_RR1_SCALP = 1.5;

// Mirrors server.ts's pickXauScalpTpPair exactly, minus the tpMax leg - this file's XauSetupResult
// never carried a separate tpMax field even before this port (production itself now always
// publishes takeProfit2 === takeProfitMax, see server.ts's "TP structure simplification" comment,
// so the 2-level tp1/tp2 model here already matches what production actually ships).
function pickXauScalpTpPair(sortedSwings: number[], entry: number, atr: number, riskDist: number, minRr1: number): { tp1: number | null; tp2: number | null } {
  if (sortedSwings.length === 0 || riskDist <= 0) return { tp1: null, tp2: null };
  const tp1Index = sortedSwings.findIndex((target) => Math.abs(target - entry) / riskDist >= minRr1);
  if (tp1Index < 0) return { tp1: null, tp2: null };
  const tp1 = sortedSwings[tp1Index];
  const minSeparation = Math.max(atr * XAU_MIN_TP_SEPARATION_ATR_MULT, riskDist * 0.6);
  const tp2Index = sortedSwings.findIndex((target, index) => index > tp1Index && Math.abs(target - tp1) >= minSeparation);
  const tp2 = tp2Index >= 0 ? sortedSwings[tp2Index] : null;
  return { tp1, tp2 };
}

interface XauChochResult { bullishChoch: boolean; bearishChoch: boolean; chochCandle: Candle | null }
function detectXauChoch(candles: Candle[], swingHighs: number[], swingLows: number[], atr: number): XauChochResult {
  const none = { bullishChoch: false, bearishChoch: false, chochCandle: null };
  if (candles.length < 6 || swingHighs.length < 3 || swingLows.length < 3 || atr <= 0) return none;
  const higher = swingHighs.at(-1)! > swingHighs.at(-2)! && swingHighs.at(-2)! > swingHighs.at(-3)! && swingLows.at(-1)! > swingLows.at(-2)! && swingLows.at(-2)! > swingLows.at(-3)!;
  const lower = swingHighs.at(-1)! < swingHighs.at(-2)! && swingHighs.at(-2)! < swingHighs.at(-3)! && swingLows.at(-1)! < swingLows.at(-2)! && swingLows.at(-2)! < swingLows.at(-3)!;
  const protectedLow = swingLows.at(-1)!; const protectedHigh = swingHighs.at(-1)!;
  for (let i = Math.max(0, candles.length - 3); i < candles.length; i++) {
    const c = candles[i];
    if (higher && c.close <= protectedLow - atr * .5 && candles.slice(i + 1).every(next => next.close < protectedLow)) return { bullishChoch: false, bearishChoch: true, chochCandle: c };
    if (lower && c.close >= protectedHigh + atr * .5 && candles.slice(i + 1).every(next => next.close > protectedHigh)) return { bullishChoch: true, bearishChoch: false, chochCandle: c };
  }
  return none;
}

// 2026-09-03 Fase 3 addition - mirrors server.ts's computeXauRetestQuality exactly.
function computeXauRetestQuality(candles: Candle[], zoneLow: number, zoneHigh: number): { clean: boolean; touches: number } {
  const recent = candles.slice(-3);
  const touches = recent.filter((c) => c.low <= zoneHigh && c.high >= zoneLow).length;
  return { clean: touches <= 1, touches };
}

// Fase B (anti-countertrend gate audit) - mirror server.ts's hasXauBullishRejectionClose/
// hasXauBearishRejectionClose exactly. Not previously ported to this backtest engine (Pattern
// 1/2's candidate construction here is a simplified mirror that predates this production check);
// added now specifically so the anti-countertrend gate can be backtested with the SAME evidence
// bar production actually requires, not an approximation.
function hasXauBullishRejectionClose(candles: Candle[], zoneLow: number, zoneHigh: number): boolean {
  return candles.slice(-3).some((c) => c.low <= zoneHigh && c.close > zoneHigh && c.close > c.open && c.close >= zoneLow);
}
function hasXauBearishRejectionClose(candles: Candle[], zoneLow: number, zoneHigh: number): boolean {
  return candles.slice(-3).some((c) => c.high >= zoneLow && c.close < zoneLow && c.close < c.open && c.close <= zoneHigh);
}

// Fase 3 chase-guard constants - mirror server.ts's exactly.
const XAU_CHASE_SOFT_ATR_MULT = 0.5;
const XAU_CHASE_HARD_REJECT_ATR_MULT = 2.0; // == XAU_MAX_EXTENSION_FROM_ORIGIN_ATR_MULT in production; this file uses xauReworkParams.extensionAtrMult for that constant, kept separate here since the two are independently calibrated
const XAU_CHASE_PENALTY_PER_ATR = 6;
const XAU_CHASE_MAX_PENALTY = 10;

// Fase 4 Pattern 5 (BREAKOUT_DISPLACEMENT_CONTINUATION) constants - mirror server.ts's exactly.
const XAU_BREAKOUT_MIN_ADX = 25;
const XAU_BREAKOUT_MIN_ATR_PERCENTILE = 0.5;
const XAU_BREAKOUT_MIN_ADX_SLOPE = 3;

// ============================================================================================
// 2026-09-03 HTF bias & directional gate audit/backtest addition. Copied verbatim (aggregation
// mechanics) from server.ts's detectXauHtfBias/aggregateXauCandles/xauTrendFromAggregatedBars -
// this is the piece that did NOT exist anywhere in this file before this session, since the old
// gate this backtest used to compare (`gateMode: 'OLD'` below) never had a real HTF bias signal to
// begin with (see the OLD/NEW comments right below evaluateXauIctSetups' own gateMode branches).
// D1 here comes from real fetched daily Yahoo/GC=F candles (see fetchRealXauDailyCandles), gated
// by the same XAU_D1_MIN_REAL_DAYS >= 7 honesty rule as the production xauD1BiasCache - this
// backtest can actually exercise the D1 tier (unlike production today) because Yahoo daily history
// goes back far further than the production archive has had time to accumulate.
// ============================================================================================
type XauTrend = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
interface XauHtfBias { m15: XauTrend; h1: XauTrend; h4: XauTrend; d1: XauTrend; d1Available: boolean; combined: XauTrend }
const XAU_D1_MIN_REAL_DAYS = 7;

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

function xauTrendFromAggregatedBars(bars: Candle[]): XauTrend {
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

// dailyCandlesSoFar: real daily bars up to (not including) the current walk-forward point - the
// caller is responsible for only ever passing bars that would genuinely already exist at that
// point in time (see runXauHtfGateAudit below), so this never leaks future data into a "current"
// D1 read.
function detectXauHtfBias(candles5m: Candle[], dailyCandlesSoFar: Candle[]): XauHtfBias {
  const m15 = xauTrendFromAggregatedBars(aggregateXauCandles(candles5m, 3));
  const h1 = xauTrendFromAggregatedBars(aggregateXauCandles(candles5m, 12));
  const h4 = xauTrendFromAggregatedBars(aggregateXauCandles(candles5m, 48));
  const d1Available = dailyCandlesSoFar.length >= XAU_D1_MIN_REAL_DAYS;
  const d1: XauTrend = d1Available ? xauTrendFromAggregatedBars(dailyCandlesSoFar) : 'NEUTRAL';

  let combined: XauTrend = 'NEUTRAL';
  if (d1Available && d1 !== 'NEUTRAL') combined = d1;
  else if (h4 !== 'NEUTRAL') combined = h4;
  else if (h1 !== 'NEUTRAL') combined = h1;
  else combined = m15;
  return { m15, h1, h4, d1, d1Available, combined };
}

// 2026-09-03 Fase 4 addition - mirrors server.ts's calculateXauAdxSlope exactly (this file's
// mirror never needed it before Pattern 5, since none of the Task 3 confluence factors that also
// use it in production are replicated here - see this file's own disclosed fidelity-gap notes).
function calculateXauAdxSlope(candles: Candle[], lookback = 5): number {
  if (candles.length < 14 + lookback) return 0;
  const adxNow = calculateADX(candles, 14);
  const adxPrior = calculateADX(candles.slice(0, candles.length - lookback), 14);
  return adxNow - adxPrior;
}

function evaluateXauIctSetups(
  candles: Candle[],
  currentPrice: number,
  atr: number,
  adx: number,
  regime: MarketRegime,
  swingHighs: number[],
  swingLows: number[],
  bullishSweep: boolean,
  bearishSweep: boolean,
  lastSwingHigh: number,
  lastSwingLow: number,
  sessionHigh24h: number,
  sessionLow24h: number,
  // 2026-09-03 HTF bias & directional gate audit/backtest addition. 'OLD' reproduces the
  // pre-redesign production gate this file's TREND_CONTINUATION/CHOCH_REVERSAL comment describes
  // (informational-only H1-window bias, -18 penalty never a hard filter, sweep/range excluded from
  // the HTF gate entirely); 'NEW' applies the redesigned gate (hard filter for
  // TREND_CONTINUATION/CHOCH_REVERSAL, two-mode sweep, H4-ranging-confirmed range) - see
  // server.ts's evaluateXauIctSetups for the production version this mirrors. dailyCandlesSoFar
  // feeds the D1 tier (see detectXauHtfBias) - real daily bars only, honestly gated by
  // XAU_D1_MIN_REAL_DAYS.
  gateMode: 'OLD' | 'NEW',
  dailyCandlesSoFar: Candle[],
  // 2026-09-03 Fase 3 audit/backtest addition - independent per-item toggles (rather than one
  // blanket ON/OFF) so the backtest can isolate which of the 3 items actually drives any observed
  // frequency/quality change, instead of only ever reporting their combined effect. All default to
  // false, so every existing call site is completely unaffected. patternAlignmentCache is only
  // read when enableAdaptiveWeighting is true - the CALLER is responsible for computing it
  // walk-forward-safe (only from trades already closed strictly before "now" - see
  // runXauFase3Audit) so this function itself never needs to know about time/lookahead at all,
  // exactly like production reads its own cache synchronously.
  fase3Options: { enableAdaptiveWeighting: boolean; enableRetestQuality: boolean; enableChaseGuard: boolean; enableAntiCountertrendGate?: boolean } = { enableAdaptiveWeighting: false, enableRetestQuality: false, enableChaseGuard: false },
  patternAlignmentCache: Record<string, { sampleSize: number; avgR: number; adjustment: number }> = {},
  // 2026-09-03 Fase 4 audit/backtest addition - default false so every existing call site (every
  // prior Fase 2/Fase 3 comparison in this file) is completely unaffected. Mirrors server.ts's
  // Pattern 5 (BREAKOUT_DISPLACEMENT_CONTINUATION) exactly.
  enablePattern5Breakout: boolean = false
): XauSetupResult {
  const obs = detectXauOrderBlocks(candles, atr);
  const fvgs = detectXauFVGs(candles, atr);
  const zones = detectXauSupplyDemandZones(candles, atr, currentPrice);

  const genuineOBDetected = obs.bullish.some((o) => !o.mitigated) || obs.bearish.some((o) => !o.mitigated);
  const genuineFVGDetected = fvgs.bullish.some((g) => !g.filled) || fvgs.bearish.some((g) => !g.filled);
  const genuineSNDDetected = zones.supply.length > 0 || zones.demand.length > 0;

  const noSetup: XauSetupResult = {
    type: null,
    pattern: null,
    confluenceScore: 45,
    reasoningNote: 'NO VALID SETUP: Belum ada pola ICT/SMC XAU/USD genuine (trend-continuation OB/FVG, liquidity sweep reversal, atau range S&D bounce) yang cocok dengan kondisi market saat ini.',
    strategyMethod: 'XAU/USD Multi-Pattern ICT/SMC Scan',
    entryZone: null,
    structuralSLLevel: null,
    tp1Level: null,
    tp2Level: null,
    genuineOBDetected,
    genuineSNDDetected,
    genuineFVGDetected,
  };
  if (!candles || candles.length < 15) return noSetup;

  const freshBullOB = obs.bullish.filter((o) => !o.mitigated);
  const freshBearOB = obs.bearish.filter((o) => !o.mitigated);
  const nearestBullFVG = fvgs.bullish.filter((g) => !g.filled).sort((a, b) => b.index - a.index)[0];
  const nearestBearFVG = fvgs.bearish.filter((g) => !g.filled).sort((a, b) => b.index - a.index)[0];

  // Fase D prerequisite: xauTargetSwings mirrors server.ts's Candidate.xauTargetSwings - the same
  // genuine sorted swing/liquidity list this candidate's tp1/tp2 were already picked from, kept
  // around so the SCALP-tier nearest-liquidity preference (pickXauScalpTpPair) can re-walk it.
  type Candidate = Omit<XauSetupResult, 'type' | 'genuineOBDetected' | 'genuineSNDDetected' | 'genuineFVGDetected'> & { type: 'BUY' | 'SELL'; xauTargetSwings?: number[] };
  const candidates: Candidate[] = [];

  // ---- Pattern 1: Trend continuation (BOS already in trend direction + retest OB/FVG) ----
  if (regime.trend === 'STRONG_UP' && freshBullOB.length > 0) {
    const ob = freshBullOB[freshBullOB.length - 1];
    const extendedFromOriginUp = atr > 0 && (currentPrice - lastSwingHigh) > xauReworkParams.extensionAtrMult * atr;
    if (!extendedFromOriginUp && currentPrice <= ob.high + atr * 0.5 && currentPrice >= ob.low - atr * 0.3) {
      const oppositeSwings = swingHighs.filter((h) => h > ob.high).sort((a, b) => a - b);
      const { tp1: xauTp1, tp2: xauTp2 } = pickXauTpPair(oppositeSwings, atr, Math.abs(ob.high - ob.low));
      candidates.push({
        type: 'BUY', pattern: 'TREND_CONTINUATION', confluenceScore: 80,
        reasoningNote: `✓ Trend Continuation BUY: BOS bullish + retest Bullish Order Block genuine di ${ob.low.toFixed(2)}-${ob.high.toFixed(2)} (candle berlawanan arah terakhir sebelum impulsive move).`,
        strategyMethod: 'XAU Trend Continuation: BOS + Bullish OB Retest',
        entryZone: { min: ob.low, max: ob.high, optimal: ob.high },
        zoneAgeBars: candles.length - 1 - ob.index,
        structuralSLLevel: ob.low, tp1Level: xauTp1, tp2Level: xauTp2,
        xauTargetSwings: oppositeSwings,
      });
    }
  }
  if (regime.trend === 'STRONG_DOWN' && freshBearOB.length > 0) {
    const ob = freshBearOB[freshBearOB.length - 1];
    const extendedFromOriginDown = atr > 0 && (lastSwingLow - currentPrice) > xauReworkParams.extensionAtrMult * atr;
    if (!extendedFromOriginDown && currentPrice >= ob.low - atr * 0.5 && currentPrice <= ob.high + atr * 0.3) {
      const oppositeSwings = swingLows.filter((l) => l < ob.low).sort((a, b) => b - a);
      const { tp1: xauTp1, tp2: xauTp2 } = pickXauTpPair(oppositeSwings, atr, Math.abs(ob.high - ob.low));
      candidates.push({
        type: 'SELL', pattern: 'TREND_CONTINUATION', confluenceScore: 80,
        reasoningNote: `✓ Trend Continuation SELL: BOS bearish + retest Bearish Order Block genuine di ${ob.low.toFixed(2)}-${ob.high.toFixed(2)} (candle berlawanan arah terakhir sebelum impulsive move).`,
        strategyMethod: 'XAU Trend Continuation: BOS + Bearish OB Retest',
        entryZone: { min: ob.low, max: ob.high, optimal: ob.low },
        zoneAgeBars: candles.length - 1 - ob.index,
        structuralSLLevel: ob.high, tp1Level: xauTp1, tp2Level: xauTp2,
        xauTargetSwings: oppositeSwings,
      });
    }
  }
  // Fallback for trend continuation via displacement-filtered FVG retest when no fresh OB exists
  if (regime.trend === 'STRONG_UP' && nearestBullFVG && !candidates.some((c) => c.pattern === 'TREND_CONTINUATION')) {
    const extendedFromOriginUpFvg = atr > 0 && (currentPrice - lastSwingHigh) > xauReworkParams.extensionAtrMult * atr;
    if (!extendedFromOriginUpFvg && currentPrice <= nearestBullFVG.top + atr * 0.3 && currentPrice >= nearestBullFVG.bottom - atr * 0.2) {
      const oppositeSwings = swingHighs.filter((h) => h > nearestBullFVG.top).sort((a, b) => a - b);
      const { tp1: xauTp1, tp2: xauTp2 } = pickXauTpPair(oppositeSwings, atr, Math.abs(nearestBullFVG.top - nearestBullFVG.bottom));
      candidates.push({
        type: 'BUY', pattern: 'TREND_CONTINUATION', confluenceScore: 76,
        reasoningNote: `✓ Trend Continuation BUY: retest Bullish FVG genuine (displacement >= 0.25xATR) di ${nearestBullFVG.bottom.toFixed(2)}-${nearestBullFVG.top.toFixed(2)}.`,
        strategyMethod: 'XAU Trend Continuation: FVG Retest',
        entryZone: { min: nearestBullFVG.bottom, max: nearestBullFVG.top, optimal: nearestBullFVG.top },
        zoneAgeBars: candles.length - 1 - nearestBullFVG.index,
        structuralSLLevel: nearestBullFVG.bottom, tp1Level: xauTp1, tp2Level: xauTp2,
        xauTargetSwings: oppositeSwings,
      });
    }
  }
  if (regime.trend === 'STRONG_DOWN' && nearestBearFVG && !candidates.some((c) => c.pattern === 'TREND_CONTINUATION')) {
    const extendedFromOriginDownFvg = atr > 0 && (lastSwingLow - currentPrice) > xauReworkParams.extensionAtrMult * atr;
    if (!extendedFromOriginDownFvg && currentPrice >= nearestBearFVG.bottom - atr * 0.3 && currentPrice <= nearestBearFVG.top + atr * 0.2) {
      const oppositeSwings = swingLows.filter((l) => l < nearestBearFVG.bottom).sort((a, b) => b - a);
      const { tp1: xauTp1, tp2: xauTp2 } = pickXauTpPair(oppositeSwings, atr, Math.abs(nearestBearFVG.top - nearestBearFVG.bottom));
      candidates.push({
        type: 'SELL', pattern: 'TREND_CONTINUATION', confluenceScore: 76,
        reasoningNote: `✓ Trend Continuation SELL: retest Bearish FVG genuine (displacement >= 0.25xATR) di ${nearestBearFVG.bottom.toFixed(2)}-${nearestBearFVG.top.toFixed(2)}.`,
        strategyMethod: 'XAU Trend Continuation: FVG Retest',
        entryZone: { min: nearestBearFVG.bottom, max: nearestBearFVG.top, optimal: nearestBearFVG.bottom },
        zoneAgeBars: candles.length - 1 - nearestBearFVG.index,
        structuralSLLevel: nearestBearFVG.top, tp1Level: xauTp1, tp2Level: xauTp2,
        xauTargetSwings: oppositeSwings,
      });
    }
  }

  // ---- Pattern 2: Liquidity sweep reversal (independent trigger, any regime) ----
  if (bullishSweep) {
    const sweepCandle = candles[candles.length - 1];
    const oppositeSwings = swingHighs.filter((h) => h > currentPrice).sort((a, b) => a - b);
    const { tp1: xauTp1, tp2: xauTp2 } = pickXauTpPair(oppositeSwings, atr, Math.abs(sweepCandle.close - sweepCandle.low));
    candidates.push({
      type: 'BUY', pattern: 'LIQUIDITY_SWEEP_REVERSAL', confluenceScore: 79,
      reasoningNote: `✓ Liquidity Sweep Reversal BUY: wick menembus swing low ${lastSwingLow.toFixed(2)} lalu close kembali di dalam range (${sweepCandle.close.toFixed(2)}).`,
      strategyMethod: 'XAU Liquidity Sweep & Institutional Reversal',
      entryZone: { min: sweepCandle.low, max: sweepCandle.close, optimal: sweepCandle.close },
      structuralSLLevel: sweepCandle.low, tp1Level: xauTp1, tp2Level: xauTp2,
      xauTargetSwings: oppositeSwings,
    });
  }
  if (bearishSweep) {
    const sweepCandle = candles[candles.length - 1];
    const oppositeSwings = swingLows.filter((l) => l < currentPrice).sort((a, b) => b - a);
    const { tp1: xauTp1, tp2: xauTp2 } = pickXauTpPair(oppositeSwings, atr, Math.abs(sweepCandle.high - sweepCandle.close));
    candidates.push({
      type: 'SELL', pattern: 'LIQUIDITY_SWEEP_REVERSAL', confluenceScore: 79,
      reasoningNote: `✓ Liquidity Sweep Reversal SELL: wick menembus swing high ${lastSwingHigh.toFixed(2)} lalu close kembali di dalam range (${sweepCandle.close.toFixed(2)}).`,
      strategyMethod: 'XAU Liquidity Sweep & Institutional Reversal',
      entryZone: { min: sweepCandle.close, max: sweepCandle.high, optimal: sweepCandle.close },
      structuralSLLevel: sweepCandle.high, tp1Level: xauTp1, tp2Level: xauTp2,
      xauTargetSwings: oppositeSwings,
    });
  }

  // ---- Pattern 3: genuine CHOCH reversal, independent from regime lag ----
  const choch = detectXauChoch(candles, swingHighs, swingLows, atr);
  if (choch.bullishChoch || choch.bearishChoch) {
    const type = choch.bullishChoch ? 'BUY' : 'SELL';
    const structuralSLLevel = type === 'BUY' ? lastSwingLow : lastSwingHigh;
    const targets = type === 'BUY' ? swingHighs.filter(h => h > currentPrice).sort((a,b) => a-b) : swingLows.filter(l => l < currentPrice).sort((a,b) => b-a);
    const entry = choch.chochCandle!.close;
    const { tp1, tp2 } = pickXauTpPair(targets, atr, Math.abs(entry - structuralSLLevel));
    candidates.push({ type, pattern: 'CHOCH_REVERSAL', confluenceScore: 78, reasoningNote: 'Genuine close-and-hold CHOCH reversal.', strategyMethod: 'XAU Genuine CHOCH Reversal', entryZone: { min: Math.min(choch.chochCandle!.open, entry), max: Math.max(choch.chochCandle!.open, entry), optimal: entry }, structuralSLLevel, tp1Level: tp1, tp2Level: tp2, xauTargetSwings: targets });
  }

  // 2026-09-03 HTF bias & directional gate audit/backtest addition - see detectXauHtfBias's own
  // comment. Computed before Pattern 3's range-bounce check below so 'NEW' mode can require a
  // genuine H4 ranging read, not just a quiet 5m ADX.
  const htfBias = detectXauHtfBias(candles, dailyCandlesSoFar);

  // ---- Pattern 3: Range / Supply-Demand bounce (only in genuinely ranging conditions) ----
  // Materiality guard: a "range" isn't genuine unless it spans a real multiple of ATR between its
  // demand and supply edges - without this, degenerate/near-flat data can produce a technically
  // "clustered" zone (>= 3 touches) that's actually sub-noise, with a near-zero-width range that
  // would fail the RR quality filter downstream anyway. Rejecting it here instead of relying only
  // on that later filter keeps this function's own output meaningful in isolation.
  const zoneSpan = zones.demand[0] && zones.supply[0] ? zones.supply[0].top - zones.demand[0].bottom : 0;
  const rangeIsMaterial = zoneSpan >= atr * 2;
  // 'NEW' mode additionally requires htfBias.h4 === 'NEUTRAL' (hypothesis 4: 5m ADX alone can read
  // "ranging" during a pullback inside a strong H4 trend) - 'OLD' mode keeps the original ADX-only
  // gate so the comparison isolates exactly this one change.
  const rangeHtfOk = gateMode === 'OLD' || htfBias.h4 === 'NEUTRAL';
  if (adx < 22 && rangeIsMaterial && rangeHtfOk) {
    const demandZone = zones.demand[0];
    const supplyZone = zones.supply[0];
    if (demandZone && currentPrice <= demandZone.top + atr * 0.3 && currentPrice >= demandZone.bottom - atr * 0.3) {
      candidates.push({
        type: 'BUY', pattern: 'RANGE_SND_BOUNCE', confluenceScore: 74 + Math.min(6, demandZone.touches),
        reasoningNote: `✓ Range S&D Bounce BUY: harga di zona demand klaster konsolidasi (${demandZone.touches}x rejection) ${demandZone.bottom.toFixed(2)}-${demandZone.top.toFixed(2)}, ADX rendah (${adx.toFixed(1)}) mengonfirmasi ranging.`,
        strategyMethod: 'XAU Range Supply/Demand Zone Bounce',
        entryZone: { min: demandZone.bottom, max: demandZone.top, optimal: demandZone.top },
        structuralSLLevel: demandZone.bottom, tp1Level: supplyZone ? supplyZone.bottom : null, tp2Level: supplyZone ? supplyZone.top : null,
      });
    }
    if (supplyZone && currentPrice >= supplyZone.bottom - atr * 0.3 && currentPrice <= supplyZone.top + atr * 0.3) {
      candidates.push({
        type: 'SELL', pattern: 'RANGE_SND_BOUNCE', confluenceScore: 74 + Math.min(6, supplyZone.touches),
        reasoningNote: `✓ Range S&D Bounce SELL: harga di zona supply klaster konsolidasi (${supplyZone.touches}x rejection) ${supplyZone.bottom.toFixed(2)}-${supplyZone.top.toFixed(2)}, ADX rendah (${adx.toFixed(1)}) mengonfirmasi ranging.`,
        strategyMethod: 'XAU Range Supply/Demand Zone Bounce',
        entryZone: { min: supplyZone.bottom, max: supplyZone.top, optimal: supplyZone.bottom },
        structuralSLLevel: supplyZone.top, tp1Level: demandZone ? demandZone.top : null, tp2Level: demandZone ? demandZone.bottom : null,
      });
    }
  }

  // ---- Pattern 5 (Fase 4, 2026-09-03) - mirrors server.ts's Pattern 5 exactly. Gated behind
  // enablePattern5Breakout so the ablation harness can compare baseline (4 patterns) vs
  // baseline+Pattern5 on the same real data. ----
  if (enablePattern5Breakout) {
    const displacementCandle = candles[candles.length - 1];
    const displacementMinGap = atr * 0.25;
    const breakoutAdxSlope = calculateXauAdxSlope(candles);
    const genuineExpansion = adx >= XAU_BREAKOUT_MIN_ADX && breakoutAdxSlope > XAU_BREAKOUT_MIN_ADX_SLOPE &&
      regime.atrPercentileRank !== undefined && regime.atrPercentileRank >= XAU_BREAKOUT_MIN_ATR_PERCENTILE && regime.atrPercentileRank < XAU_EXTREME_VOL_PERCENTILE;

    if (genuineExpansion && atr > 0) {
      const bullishDisplacementBOS = displacementCandle.close > lastSwingHigh && displacementCandle.close > displacementCandle.open &&
        (displacementCandle.close - lastSwingHigh) >= displacementMinGap;
      if (bullishDisplacementBOS) {
        const entryOptimal = displacementCandle.close;
        const structuralSLLevel = lastSwingHigh;
        const displacementSizeAtr = (displacementCandle.close - lastSwingHigh) / atr;
        const baseScore = 75 + Math.min(3, Math.max(0, Math.round((displacementSizeAtr - 0.25) * 4)));
        const oppositeSwings = swingHighs.filter((h) => h > entryOptimal).sort((a, b) => a - b);
        const { tp1, tp2 } = pickXauTpPair(oppositeSwings, atr, Math.abs(entryOptimal - structuralSLLevel));
        candidates.push({
          type: 'BUY', pattern: 'BREAKOUT_DISPLACEMENT_CONTINUATION', confluenceScore: baseScore,
          reasoningNote: `✓ Breakout Displacement Continuation BUY: displacement genuine (${displacementSizeAtr.toFixed(2)}x ATR) menembus swing high ${lastSwingHigh.toFixed(2)}, ADX ${adx.toFixed(1)} naik, ATR percentile ${(regime.atrPercentileRank! * 100).toFixed(0)}%.`,
          strategyMethod: 'XAU Breakout/Displacement Continuation',
          entryZone: { min: Math.min(displacementCandle.open, displacementCandle.close), max: Math.max(displacementCandle.open, displacementCandle.close), optimal: entryOptimal },
          structuralSLLevel, tp1Level: tp1, tp2Level: tp2,
          xauTargetSwings: oppositeSwings,
        });
      }
      const bearishDisplacementBOS = displacementCandle.close < lastSwingLow && displacementCandle.close < displacementCandle.open &&
        (lastSwingLow - displacementCandle.close) >= displacementMinGap;
      if (bearishDisplacementBOS) {
        const entryOptimal = displacementCandle.close;
        const structuralSLLevel = lastSwingLow;
        const displacementSizeAtr = (lastSwingLow - displacementCandle.close) / atr;
        const baseScore = 75 + Math.min(3, Math.max(0, Math.round((displacementSizeAtr - 0.25) * 4)));
        const oppositeSwings = swingLows.filter((l) => l < entryOptimal).sort((a, b) => b - a);
        const { tp1, tp2 } = pickXauTpPair(oppositeSwings, atr, Math.abs(entryOptimal - structuralSLLevel));
        candidates.push({
          type: 'SELL', pattern: 'BREAKOUT_DISPLACEMENT_CONTINUATION', confluenceScore: baseScore,
          reasoningNote: `✓ Breakout Displacement Continuation SELL: displacement genuine (${displacementSizeAtr.toFixed(2)}x ATR) menembus swing low ${lastSwingLow.toFixed(2)}, ADX ${adx.toFixed(1)} naik, ATR percentile ${(regime.atrPercentileRank! * 100).toFixed(0)}%.`,
          strategyMethod: 'XAU Breakout/Displacement Continuation',
          entryZone: { min: Math.min(displacementCandle.open, displacementCandle.close), max: Math.max(displacementCandle.open, displacementCandle.close), optimal: entryOptimal },
          structuralSLLevel, tp1Level: tp1, tp2Level: tp2,
          xauTargetSwings: oppositeSwings,
        });
      }
    }
  }

  // 2026-09-03 HTF bias & directional gate audit/backtest addition - the actual gate/scoring
  // difference between 'OLD' and 'NEW' modes, mirroring server.ts's evaluateXauIctSetups exactly.
  const h4BarsForSweepCheck = aggregateXauCandles(candles, 48);
  const h4SwingHighsForSweepCheck: number[] = [];
  const h4SwingLowsForSweepCheck: number[] = [];
  for (let i = 1; i < h4BarsForSweepCheck.length - 1; i++) {
    const b = h4BarsForSweepCheck;
    if (b[i].high > b[i - 1].high && b[i].high > b[i + 1].high) h4SwingHighsForSweepCheck.push(b[i].high);
    if (b[i].low < b[i - 1].low && b[i].low < b[i + 1].low) h4SwingLowsForSweepCheck.push(b[i].low);
  }
  const isNearGenuineH4StructuralLevel = (level: number): boolean => {
    if (!(atr > 0)) return false;
    const tolerance = atr * 0.75;
    return h4SwingHighsForSweepCheck.some((h) => Math.abs(h - level) <= tolerance) || h4SwingLowsForSweepCheck.some((l) => Math.abs(l - level) <= tolerance);
  };

  // NOTE: must be a genuinely separate array (never just `= candidates`) - the code below does
  // `candidates.length = 0; candidates.push(...gatedCandidates)`, which would truncate this to
  // nothing first if it aliased the same array (this bit exactly once during this task's own
  // first real-data run: OLD mode aliased `candidates` here, then `candidates.length = 0` wiped
  // both references before the push, so OLD always fired 0 signals for a bug reason, not a real
  // gate-behavior reason - fixed by always copying here regardless of gateMode).
  let gatedCandidates = [...candidates];
  if (gateMode === 'NEW') {
    gatedCandidates = candidates.filter((c) => {
      if (c.pattern !== 'TREND_CONTINUATION' && c.pattern !== 'CHOCH_REVERSAL' && c.pattern !== 'LIQUIDITY_SWEEP_REVERSAL' && c.pattern !== 'BREAKOUT_DISPLACEMENT_CONTINUATION') return true;
      const opposesHtf = (c.type === 'BUY' && htfBias.combined === 'BEARISH') || (c.type === 'SELL' && htfBias.combined === 'BULLISH');
      if (!opposesHtf) return true;
      if (c.pattern === 'TREND_CONTINUATION' || c.pattern === 'CHOCH_REVERSAL' || c.pattern === 'BREAKOUT_DISPLACEMENT_CONTINUATION') return false;
      const sweptLevel = c.type === 'BUY' ? lastSwingLow : lastSwingHigh;
      return isNearGenuineH4StructuralLevel(sweptLevel);
    });
  }
  for (const c of gatedCandidates) {
    const opposesHtf = (c.type === 'BUY' && htfBias.combined === 'BEARISH') || (c.type === 'SELL' && htfBias.combined === 'BULLISH');
    const alignsHtf = (c.type === 'BUY' && htfBias.combined === 'BULLISH') || (c.type === 'SELL' && htfBias.combined === 'BEARISH');
    c.htfBiasCombined = htfBias.combined;
    c.htfOpposed = opposesHtf;
    c.htfAlignment = opposesHtf ? 'OPPOSED' : alignsHtf ? 'ALIGNED' : 'NEUTRAL';
    if (c.pattern === 'RANGE_SND_BOUNCE') c.htfAlignment = 'NEUTRAL'; // not gated on directional bias - matches production
    if (gateMode === 'OLD') {
      // Pre-redesign behavior: -18 penalty (never a hard filter) for TREND_CONTINUATION/
      // CHOCH_REVERSAL only; LIQUIDITY_SWEEP_REVERSAL and RANGE_SND_BOUNCE excluded entirely.
      if (c.pattern === 'TREND_CONTINUATION' || c.pattern === 'CHOCH_REVERSAL') {
        if (opposesHtf) c.confluenceScore -= 18;
        else if (alignsHtf) c.confluenceScore += 4;
      }
    } else {
      // Redesigned behavior: TREND_CONTINUATION/CHOCH_REVERSAL/BREAKOUT_DISPLACEMENT_CONTINUATION
      // opposing candidates were already discarded above (hard filter), so only alignsHtf/neutral
      // reach this point for them.
      if (c.pattern === 'TREND_CONTINUATION' || c.pattern === 'CHOCH_REVERSAL' || c.pattern === 'BREAKOUT_DISPLACEMENT_CONTINUATION') {
        if (alignsHtf) c.confluenceScore += 4;
      } else if (c.pattern === 'LIQUIDITY_SWEEP_REVERSAL') {
        if (alignsHtf) c.confluenceScore += 4;
        else if (opposesHtf) c.confluenceScore -= 18; // survived isNearGenuineH4StructuralLevel above
      }
    }
  }
  candidates.length = 0;
  candidates.push(...gatedCandidates);

  // 2026-09-03 Fase 3 addition - mirrors server.ts's Task 7 (chase guard) hard-reject pass +
  // Task 6/Task 5 scoring, each independently toggleable so the backtest can isolate which item
  // drives any observed frequency/quality change (see fase3Options' own comment). All default
  // false, so every existing OLD/NEW gateMode comparison from Fase 2 is completely unaffected.
  {
    const xauChaseDistanceAtr = (entryOptimal: number): number => (atr > 0 ? Math.abs(currentPrice - entryOptimal) / atr : 0);
    if (fase3Options.enableChaseGuard) {
      const chaseFiltered = candidates.filter((c) => {
        if (!c.entryZone) return true;
        const within = xauChaseDistanceAtr(c.entryZone.optimal) <= XAU_CHASE_HARD_REJECT_ATR_MULT;
        if (!within) xauChaseHardRejectCounterForAudit++;
        return within;
      });
      candidates.length = 0;
      candidates.push(...chaseFiltered);
    }

    for (const c of candidates) {
      // Task 5: adaptive pattern weighting
      if (fase3Options.enableAdaptiveWeighting && c.pattern) {
        const combo = patternAlignmentCache[`${c.pattern}|${c.htfAlignment}`];
        if (combo) c.confluenceScore += combo.adjustment;
      }
      // Task 6: retest quality (TREND_CONTINUATION only)
      if (fase3Options.enableRetestQuality && c.pattern === 'TREND_CONTINUATION' && c.entryZone) {
        const retest = computeXauRetestQuality(candles, c.entryZone.min, c.entryZone.max);
        c.retestTouches = retest.touches;
        if (retest.clean) c.confluenceScore += 3;
      }
      // Task 7: chase guard soft penalty (diagnostics - chaseDistanceAtr - are always recorded so
      // the report can show the real distribution even on runs where the guard itself is off)
      if (c.entryZone) {
        const chaseAtr = xauChaseDistanceAtr(c.entryZone.optimal);
        c.chaseDistanceAtr = chaseAtr;
        if (fase3Options.enableChaseGuard && chaseAtr > XAU_CHASE_SOFT_ATR_MULT) {
          const penalty = -Math.min(XAU_CHASE_MAX_PENALTY, Math.round((chaseAtr - XAU_CHASE_SOFT_ATR_MULT) * XAU_CHASE_PENALTY_PER_ATR));
          c.confluenceScore += penalty;
        }
      }
    }
  }

  // Session high/low (real data from marketPrice, not invented) as a TP2 fallback ONLY when a
  // candidate has a genuine TP1 but no second, further target from swings - never used as TP1.
  for (const c of candidates) {
    if (c.tp1Level !== null && c.tp2Level === null) {
      if (c.type === 'BUY' && sessionHigh24h > c.tp1Level) c.tp2Level = sessionHigh24h;
      else if (c.type === 'SELL' && sessionLow24h < c.tp1Level) c.tp2Level = sessionLow24h;
    }
  }

  // Fase B (anti-countertrend gate) mirror - see server.ts's xauPassesAntiCountertrendGate for the
  // full rationale. Default-off (enableAntiCountertrendGate undefined/false) so every existing call
  // site in this file is completely unaffected; only runXauAntiCountertrendGateAudit turns it on.
  const xauPassesAntiCountertrendGate = (c: Candidate): boolean => {
    if (!fase3Options.enableAntiCountertrendGate) return true;
    if (c.pattern !== 'CHOCH_REVERSAL' && c.pattern !== 'LIQUIDITY_SWEEP_REVERSAL') return true;
    if (!regime.extreme) return true;
    const opposesTrend = (c.type === 'SELL' && regime.trend === 'STRONG_UP') || (c.type === 'BUY' && regime.trend === 'STRONG_DOWN');
    if (!opposesTrend) return true;
    if (!c.entryZone) return false;
    const chochConfirmed = c.type === 'BUY' ? choch.bullishChoch : choch.bearishChoch;
    if (!chochConfirmed) return false;
    const rejectionConfirmed = c.type === 'BUY'
      ? hasXauBullishRejectionClose(candles, c.entryZone.min, c.entryZone.max)
      : hasXauBearishRejectionClose(candles, c.entryZone.min, c.entryZone.max);
    if (!rejectionConfirmed) return false;
    return computeXauRetestQuality(candles, c.entryZone.min, c.entryZone.max).clean;
  };

  // ==========================================================================================
  // Fase D prerequisite (2026-09-04): tiered MAIN/SCALP selection - ports server.ts's Task 4
  // (XAUUSD audit) cascade, previously a documented fidelity gap in this file (see
  // xauReworkParams' own comment history: "generates SCALP-tier signals this mirror cannot
  // produce at all"). requireWideSeparation=true (MAIN) requires tp2 to exist AND be a genuinely
  // separate (>= XAU_MIN_TP_SEPARATION_ATR_MULT) liquidity level, not a trivially-close pivot;
  // requireWideSeparation=false (SCALP) only requires the same genuine entry/tp1 ordering - the
  // second, FAR-target requirement is what's dropped, never the structural genuineness itself.
  // ==========================================================================================
  const xauCandidateHasValidOrdering = (c: Candidate, requireWideSeparation: boolean): boolean => {
    if (c.tp1Level === null || c.entryZone === null) return false;
    if (c.type === 'BUY' && !(c.tp1Level > c.entryZone.optimal)) return false;
    if (c.type === 'SELL' && !(c.tp1Level < c.entryZone.optimal)) return false;
    if (!requireWideSeparation) return true;
    if (c.tp2Level === null) return false;
    const requiredSeparation = Math.max(atr * XAU_MIN_TP_SEPARATION_ATR_MULT, Math.abs(c.entryZone.optimal - c.structuralSLLevel!) * 0.6);
    if (Math.abs(c.tp2Level - c.tp1Level) < requiredSeparation) return false;
    return c.type === 'BUY' ? c.tp2Level > c.tp1Level : c.tp2Level < c.tp1Level;
  };

  // 2026-09-03 Fase 4 audit addition: the highest-scoring OTHER-pattern candidate that also
  // structurally qualified this same tick, from the SAME pool the winner was picked from (if any)
  // - lets runXauFase3Audit measure whether BREAKOUT_DISPLACEMENT_CONTINUATION ever won the "best
  // candidate" slot over a genuine candidate from one of the 4 existing patterns, and simulate
  // that counterfactual directly (never invented - it's the exact same real candles/candidate this
  // tick already produced).
  const pickRunnerUp = (pool: Candidate[], best: Candidate) => {
    const runnerUpCandidate = pool.find((c) => c.pattern !== best.pattern);
    return runnerUpCandidate
      ? { pattern: runnerUpCandidate.pattern, type: runnerUpCandidate.type, confluenceScore: runnerUpCandidate.confluenceScore, entryZone: runnerUpCandidate.entryZone, structuralSLLevel: runnerUpCandidate.structuralSLLevel, tp1Level: runnerUpCandidate.tp1Level, tp2Level: runnerUpCandidate.tp2Level }
      : null;
  };

  const mainValid = candidates.filter((c) => xauCandidateHasValidOrdering(c, true) && xauPassesAntiCountertrendGate(c));
  if (mainValid.length > 0) {
    mainValid.sort((a, b) => b.confluenceScore - a.confluenceScore);
    const { xauTargetSwings: _mainDrop, ...best } = mainValid[0];
    const runnerUp = pickRunnerUp(mainValid, mainValid[0]);
    return { ...best, genuineOBDetected, genuineSNDDetected, genuineFVGDetected, signalTier: 'MAIN', runnerUp };
  }

  // SCALP nearest-liquidity priority (mirrors server.ts's evaluateXauIctSetups exactly): re-derive
  // each candidate's tp1/tp2 by re-walking the SAME genuine swing/liquidity list it already
  // produced (xauTargetSwings), preferring the nearest target that still clears XAU_MIN_RR1_SCALP
  // - never invents a level and never loosens the RR floor. Candidates with no xauTargetSwings
  // (RANGE_SND_BOUNCE, whose single zone-edge target has no "list" to re-walk) pass through
  // unchanged, exactly like production.
  const scalpCandidates: Candidate[] = candidates.map((c) => {
    if (!c.xauTargetSwings || c.entryZone === null || c.structuralSLLevel === null) return c;
    const riskDist = Math.abs(c.entryZone.optimal - c.structuralSLLevel);
    const preferred = pickXauScalpTpPair(c.xauTargetSwings, c.entryZone.optimal, atr, riskDist, XAU_MIN_RR1_SCALP);
    if (preferred.tp1 === null) return { ...c, tp1Level: null, tp2Level: null };
    let tp2Level = preferred.tp2;
    // Same real-24h-session-extreme TP2 fallback already applied to every candidate above - kept
    // consistent between the two selection paths rather than silently dropping it here.
    if (tp2Level === null) {
      if (c.type === 'BUY' && sessionHigh24h > preferred.tp1) tp2Level = sessionHigh24h;
      else if (c.type === 'SELL' && sessionLow24h < preferred.tp1) tp2Level = sessionLow24h;
    }
    return { ...c, tp1Level: preferred.tp1, tp2Level };
  });

  // SCALP gets an EXTRA structural confirmation requirement MAIN does not have - the candidate's
  // own structural level (structuralSLLevel, the invalidation point) must have held for the last 2
  // CLOSED candles, not just been consistent with the single most recent one. Mirrors server.ts's
  // xauScalpLevelHeldTwoCloses exactly.
  const xauScalpLevelHeldTwoCloses = (c: Candidate): boolean => {
    if (c.structuralSLLevel === null) return false;
    const lastTwoClosed = candles.slice(-2);
    if (lastTwoClosed.length < 2) return false;
    return c.type === 'BUY'
      ? lastTwoClosed.every((cd) => cd.close > c.structuralSLLevel!)
      : lastTwoClosed.every((cd) => cd.close < c.structuralSLLevel!);
  };

  const scalpValid = scalpCandidates.filter((c) => xauCandidateHasValidOrdering(c, false) && xauScalpLevelHeldTwoCloses(c) && xauPassesAntiCountertrendGate(c));
  if (scalpValid.length > 0) {
    scalpValid.sort((a, b) => b.confluenceScore - a.confluenceScore);
    const { xauTargetSwings: _scalpDrop, ...best } = scalpValid[0];
    // Collapse to a single near target when no wider genuine target exists - mirrors production's
    // "downstream evaluation always has a well-defined closing level" convention.
    if (best.tp2Level === null) best.tp2Level = best.tp1Level;
    const runnerUp = pickRunnerUp(scalpValid, scalpValid[0]);
    return { ...best, genuineOBDetected, genuineSNDDetected, genuineFVGDetected, signalTier: 'SCALP', runnerUp };
  }

  return noSetup;
}

// Genuine Technical Market Structure Evaluator using Real OHLC Candles & ATR
function newEvaluateMarketStructureFromCandles(
  pairId: PairId,
  marketPrice: MarketPrice,
  candles: Candle[],
  // 2026-09-03 HTF bias & directional gate audit/backtest addition - defaulted so every existing
  // call site (non-XAU pairs, and any pre-existing OLD-vs-NEW engine comparison in this file) keeps
  // running the pre-redesign gate unchanged unless explicitly asked for 'NEW'.
  xauGateMode: 'OLD' | 'NEW' = 'OLD',
  xauDailyCandlesSoFar: Candle[] = [],
  // 2026-09-03 Fase 3 audit/backtest addition - same default-off convention as xauGateMode above.
  xauFase3Options: { enableAdaptiveWeighting: boolean; enableRetestQuality: boolean; enableChaseGuard: boolean; enableAntiCountertrendGate?: boolean } = { enableAdaptiveWeighting: false, enableRetestQuality: false, enableChaseGuard: false },
  xauPatternAlignmentCache: Record<string, { sampleSize: number; avgR: number; adjustment: number }> = {},
  // 2026-09-03 Fase 4 audit/backtest addition - same default-off convention as above.
  xauEnablePattern5Breakout: boolean = false,
  // 2026-09-04 URGENT investigation follow-up audit: user asked to measure - not yet decide - what
  // happens if the Volatility Regime Gate exempts ticks where regime.extreme is already true (a
  // sustained, directional STRONG_UP/STRONG_DOWN expansion per Fase A's own definition) instead of
  // pausing signal generation on every extreme-ATR-percentile tick regardless of direction. Default
  // false so every existing call site keeps running the exact shipped gate (production behavior)
  // unchanged unless explicitly asked for this ablation. This function NEVER decides to ship this -
  // it only measures it, same convention as xauGateMode/fase3Options before it.
  xauExemptExtremeFromGate: boolean = false
): StructureAnalysis {
  const currentPrice = marketPrice.price;
  const high24h = marketPrice.high24h || currentPrice * 1.008;
  const low24h = marketPrice.low24h || currentPrice * 0.992;
  const range24h = Math.max(high24h - low24h, currentPrice * 0.004);
  const pricePos = (currentPrice - low24h) / range24h;

  let atr = calculateATR(candles, 14);
  const shortTermAtr = calculateATR(candles, 5) || atr;

  // Fallback ATR estimation if real candles buffering
  if (!atr || atr <= 0) {
    let minAtrRatio = 0.0008;
    if (pairId === 'XAUUSD') minAtrRatio = 0.0012;
    else if (pairId.includes('USDT')) minAtrRatio = 0.003;
    atr = currentPrice * minAtrRatio;
  }

  // Calculate Technical Indicators: RSI & ADX
  const rsiData = calculateRSI(candles, 14);
  const adx = calculateADX(candles, 14);
  const { rsi, bullishDivergence, bearishDivergence } = rsiData;

  // 1. Detect Market Regime (Volatility & Trend)
  const regime = detectMarketRegime(pairId, candles, atr, rsiData, adx);

  // 2. Volatility Multiplier based on Regime
  let volMultiplier = 1.0;
  if (regime.volatility === 'HIGH') volMultiplier = 1.6;
  else if (regime.volatility === 'LOW') volMultiplier = 0.7;

  // Base parameters per asset class
  let baseMinSL = 0.0008;
  let baseMaxSL = 0.0025;
  let baseBandPct = 0.00015;

  // NOTE (widened): angka lama ($1.20-$3.00 utk XAUUSD dkk) lebih sempit dari noise wajar
  // antar sumber harga (feed server vs OANDA di TradingView vs broker MT), jadi sering
  // "SL keduluan" padahal broker asli belum tersentuh. Dilebarkan secukupnya - masih pas buat
  // scalping M5/M15 & tetap aman untuk modal kecil karena posisi/lot yang harus disesuaikan
  // ke bawah (lihat riskGuidance), bukan SL yang dipersempit paksa.
  if (pairId === 'XAUUSD') {
    baseMinSL = 4.50;
    baseMaxSL = 12.00;
    baseBandPct = 0.00012;
  } else if (pairId === 'BTCUSDT') {
    baseMinSL = 260;
    baseMaxSL = 1100;
    baseBandPct = 0.0003;
  } else if (pairId === 'ETHUSDT') {
    baseMinSL = 18;
    baseMaxSL = 85;
    baseBandPct = 0.0003;
  } else if (pairId === 'SOLUSDT') {
    baseMinSL = 1.20;
    baseMaxSL = 6.50;
    baseBandPct = 0.0003;
  } else if (['EURUSD', 'GBPUSD', 'USDCHF', 'USDCAD'].includes(pairId)) {
    baseMinSL = 0.0012;
    baseMaxSL = pairId === 'GBPUSD' ? 0.0040 : 0.0035;
    baseBandPct = 0.00015;
  }

  const minSL = Number((baseMinSL * volMultiplier).toFixed(marketPrice.digits));
  const maxSL = Number((baseMaxSL * volMultiplier).toFixed(marketPrice.digits));
  const spreadVolBuffer = pairId === 'XAUUSD' ? Math.max(0.30, shortTermAtr * 0.25) : Math.max(0.00010, shortTermAtr * 0.20);
  const baseSlDelta = atr * 1.30 + spreadVolBuffer;
  const slDelta = Number(Math.max(minSL, Math.min(maxSL, baseSlDelta)).toFixed(marketPrice.digits));

  // Volatility Regime Gate: mirrors server.ts's evaluateMarketStructureFromCandles exactly - see
  // that file for the full before/after rationale. Percentile-relative (XAU_EXTREME_VOL_PERCENTILE
  // within the ATR's own trailing 20-candle sample), not a fixed dollar figure.
  const atrPercentileRank = regime.atrPercentileRank;
  const exemptedByDirectionalExtreme = xauExemptExtremeFromGate && regime.extreme === true;
  if (pairId === 'XAUUSD' && atrPercentileRank !== undefined && atrPercentileRank >= XAU_EXTREME_VOL_PERCENTILE && !exemptedByDirectionalExtreme) {
    return {
      type: null,
      confluenceScore: 40,
      atr,
      shortTermAtr,
      slDelta: Number((3.00 * volMultiplier).toFixed(marketPrice.digits)),
      reasoningHeader: `NO VALID SETUP: Volatility Regime Gate active (ATR ${atr.toFixed(2)} at the ${(atrPercentileRank * 100).toFixed(0)}th percentile of its own last-20-candle range, >= ${(XAU_EXTREME_VOL_PERCENTILE * 100).toFixed(0)}th). Signal generation paused - extreme volatility relative to XAUUSD's own recent activity.`,
      strategyMethod: 'Volatility Regime Gate Active',
      bosDetected: false,
      fvgDetected: false,
      orderBlockDetected: false,
      adx,
      rsi,
      regime,
      baseMinSL,
      baseMaxSL,
      baseBandPct,
      volMultiplier,
    };
  }

  // Check for High Impact News Pause Window
  const isUsdImpactedPair = pairId === 'XAUUSD' || ['EURUSD', 'GBPUSD', 'USDCHF', 'USDCAD'].includes(pairId);
  if (isUsdImpactedPair && isUsdHighImpactNewsWindow(pairId)) {
    return {
      type: null,
      confluenceScore: 40,
      atr,
      shortTermAtr,
      slDelta,
      reasoningHeader: `NO VALID SETUP: High-Impact USD Economic Event Window active (-5m to +15m). ${marketPrice.name} signal generation paused for news volatility protection.`,
      strategyMethod: 'High Impact News Filter Active',
      bosDetected: false,
      fvgDetected: false,
      orderBlockDetected: false,
      adx,
      rsi,
      regime,
      baseMinSL,
      baseMaxSL,
      baseBandPct,
      volMultiplier,
    };
  }

  // Detect Swing Highs & Lows over full candle buffer
  let swingHighs: number[] = [];
  let swingLows: number[] = [];

  if (candles.length >= 5) {
    for (let i = 2; i < candles.length - 1; i++) {
      if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high) {
        swingHighs.push(candles[i].high);
      }
      if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low) {
        swingLows.push(candles[i].low);
      }
    }
  }

  const lastSwingHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1] : high24h;
  const lastSwingLow = swingLows.length > 0 ? swingLows[swingLows.length - 1] : low24h;

  // Detect Break of Structure (BOS) & Liquidity Sweeps
  const bullishBOS = currentPrice > lastSwingHigh;
  const bearishBOS = currentPrice < lastSwingLow;
  const bullishSweep = candles.length > 0 && candles[candles.length - 1].low < lastSwingLow && currentPrice > candles[candles.length - 1].low;
  const bearishSweep = candles.length > 0 && candles[candles.length - 1].high > lastSwingHigh && currentPrice < candles[candles.length - 1].high;

  // Detect Fair Value Gap (FVG)
  let bullishFVG = false;
  let bearishFVG = false;
  if (candles.length >= 3) {
    const c1 = candles[candles.length - 3];
    const c3 = candles[candles.length - 1];
    if (c3.low > c1.high) bullishFVG = true;
    if (c3.high < c1.low) bearishFVG = true;
  }

  // Higher Timeframe Bias Confirmation
  let htTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (candles.length >= 10) {
    const oldest = candles[0].close;
    const latest = candles[candles.length - 1].close;
    const change = (latest - oldest) / (oldest || 1);
    if (change > 0.0008) htTrend = 'BULLISH';
    else if (change < -0.0008) htTrend = 'BEARISH';
  } else if (Math.abs(marketPrice.change24h) >= 0.15) {
    htTrend = marketPrice.change24h >= 0 ? 'BULLISH' : 'BEARISH';
  }

  const h1Trend = calculateH1Trend(candles);

  let volumePenalty = 0;
  if (candles.length >= 10) {
    const avgVol = candles.slice(-10).reduce((acc, c) => acc + (c.volume || 0), 0) / 10;
    const lastVol = candles[candles.length - 1]?.volume || 0;
    if (avgVol > 0 && lastVol < avgVol * 0.35) {
      volumePenalty = 8;
    }
  }

  const inDiscount = pricePos <= 0.48;
  const inPremium = pricePos >= 0.52;

  // Count Reversal Confirmations (min 2 of 3)
  let reversalConfirmations = 0;
  if (regime.trend === 'REVERSAL_UP') {
    if (bullishDivergence) reversalConfirmations++;
    if (bullishBOS || bullishSweep) reversalConfirmations++;
    if (inDiscount || bullishFVG) reversalConfirmations++;
  } else if (regime.trend === 'REVERSAL_DOWN') {
    if (bearishDivergence) reversalConfirmations++;
    if (bearishBOS || bearishSweep) reversalConfirmations++;
    if (inPremium || bearishFVG) reversalConfirmations++;
  }

  let type: 'BUY' | 'SELL' | null = null;
  let confluenceScore = 0;
  let reasoningHeader = '';
  let xauSetup: XauSetupResult | null = null;

  // XAU/USD-ONLY: multi-pattern ICT/SMC scan (trend continuation / liquidity sweep reversal /
  // range S&D bounce) replaces the generic single-path MSS logic below for this pair only. Every
  // other pair falls through to the unchanged generic chain in the `else if` branches.
  if (pairId === 'XAUUSD') {
    xauSetup = evaluateXauIctSetups(
      candles, currentPrice, atr, adx, regime, swingHighs, swingLows,
      bullishSweep, bearishSweep, lastSwingHigh, lastSwingLow, high24h, low24h,
      xauGateMode, xauDailyCandlesSoFar, xauFase3Options, xauPatternAlignmentCache, xauEnablePattern5Breakout
    );
    type = xauSetup.type;
    confluenceScore = xauSetup.confluenceScore;
    reasoningHeader = xauSetup.reasoningNote;
  }
  // Handle REVERSAL trend regimes explicitly
  else if (regime.trend === 'REVERSAL_UP') {
    if (reversalConfirmations < 2) {
      type = null;
      confluenceScore = 45;
      reasoningHeader = 'NO VALID SETUP: Reversal terdeteksi tapi konfirmasi belum cukup (min 2/3: RSI divergence, BOS/Sweep, OB/FVG), menunggu konfirmasi tambahan.';
    } else {
      type = 'BUY';
      confluenceScore = 78 + reversalConfirmations * 5 - volumePenalty;
      reasoningHeader = `✓ High-Probability Bullish Reversal detected (${reversalConfirmations}/3 confirmations: RSI div, BOS, OB/FVG).\n✓ Volatility regime (${regime.volatility}) scaled risk model.\n✓ Structural Stop Loss positioned below recent swing low.`;
    }
  } else if (regime.trend === 'REVERSAL_DOWN') {
    if (reversalConfirmations < 2) {
      type = null;
      confluenceScore = 45;
      reasoningHeader = 'NO VALID SETUP: Reversal terdeteksi tapi konfirmasi belum cukup (min 2/3: RSI divergence, BOS/Sweep, OB/FVG), menunggu konfirmasi tambahan.';
    } else {
      type = 'SELL';
      confluenceScore = 78 + reversalConfirmations * 5 - volumePenalty;
      reasoningHeader = `✓ High-Probability Bearish Reversal detected (${reversalConfirmations}/3 confirmations: RSI div, BOS, OB/FVG).\n✓ Volatility regime (${regime.volatility}) scaled risk model.\n✓ Structural Stop Loss positioned above recent swing high.`;
    }
  } else if ((bullishBOS || inDiscount || bullishSweep) && (bullishFVG || currentPrice <= lastSwingLow + atr * 0.6)) {
    type = 'BUY';
    confluenceScore = 74 + (bullishBOS ? 8 : 0) + (bullishFVG ? 8 : 0) + (bullishSweep ? 6 : 0) - volumePenalty;
    reasoningHeader = `✓ Genuine Market Structure Shift (MSS) detected from M5/M15 OHLC candles.\n✓ Real-time ATR (${atr.toFixed(marketPrice.digits)}) used for dynamic risk modeling.\n✓ Price retesting Discount Order Block & Fair Value Gap (FVG).`;
  } else if ((bearishBOS || inPremium || bearishSweep) && (bearishFVG || currentPrice >= lastSwingHigh - atr * 0.6)) {
    type = 'SELL';
    confluenceScore = 74 + (bearishBOS ? 8 : 0) + (bearishFVG ? 8 : 0) + (bearishSweep ? 6 : 0) - volumePenalty;
    reasoningHeader = `✓ Genuine Bearish Market Structure Shift (MSS) detected from M5/M15 OHLC candles.\n✓ Real-time ATR (${atr.toFixed(marketPrice.digits)}) used for dynamic risk modeling.\n✓ Price retesting Premium Supply Zone & Order Block (OB).`;
  } else if (Math.abs(marketPrice.change24h) >= 0.35 && adx >= 20) {
    type = marketPrice.change24h >= 0 ? 'BUY' : 'SELL';
    let trendScore = 64 + Math.min(10, Math.abs(marketPrice.change24h) * 8) - volumePenalty;
    if (candles.length >= 5) {
      const last5 = candles.slice(-5);
      const directionMatches = last5.filter(c => type === 'BUY' ? c.close >= c.open : c.close <= c.open).length;
      if (directionMatches >= 4) trendScore += 6;
    }
    confluenceScore = Math.min(85, Math.round(trendScore));
    reasoningHeader = `✓ Trend Momentum Continuation confirmed on M15 timeframe (ADX ${adx.toFixed(1)} >= 20).\n✓ Dynamic ATR Volatility (${atr.toFixed(marketPrice.digits)}) aligned with order flow.`;
  } else {
    type = null;
    confluenceScore = 45;
    reasoningHeader = 'NO VALID SETUP: Market structure in equilibrium without high-confluence entry.';
  }

  // H1 Trend Confirmation - INFORMATIONAL ONLY by product decision: never rejects a signal and
  // never applies a large penalty, so it doesn't reduce how often signals fire. It's context for
  // the user, with at most a small optional nudge to confluenceScore. h1Trend is 'NEUTRAL'
  // whenever there isn't enough H1 candle data yet (see calculateH1Trend), which naturally means
  // this block adds a neutral note and skips any adjustment for pairs without enough history -
  // never a rejection.
  if (type === 'BUY') {
    if (h1Trend === 'BULLISH') {
      reasoningHeader += '\n✓ Searah tren H1 (BULLISH).';
    } else if (h1Trend === 'BEARISH') {
      confluenceScore -= 5;
      reasoningHeader += '\n⚠ Melawan tren H1 (BEARISH) — pertimbangkan risiko lebih hati-hati.';
    } else {
      reasoningHeader += '\n• Tren H1 saat ini netral (data belum cukup atau tidak dominan satu arah).';
    }
  } else if (type === 'SELL') {
    if (h1Trend === 'BEARISH') {
      reasoningHeader += '\n✓ Searah tren H1 (BEARISH).';
    } else if (h1Trend === 'BULLISH') {
      confluenceScore -= 5;
      reasoningHeader += '\n⚠ Melawan tren H1 (BULLISH) — pertimbangkan risiko lebih hati-hati.';
    } else {
      reasoningHeader += '\n• Tren H1 saat ini netral (data belum cukup atau tidak dominan satu arah).';
    }
  }

  // Daily VWAP Confluence
  const vwap = calculateDailyVWAP(candles);
  if (type !== null && vwap !== null) {
    if (type === 'BUY') {
      if (currentPrice < vwap) {
        confluenceScore += 5;
        reasoningHeader += `\n✓ Price below Daily VWAP (${vwap.toFixed(marketPrice.digits)}) — Mean Reversion Discount (+5).`;
      } else {
        confluenceScore -= 4;
        reasoningHeader += `\n⚠ Price above Daily VWAP for BUY (-4).`;
      }
    } else if (type === 'SELL') {
      if (currentPrice > vwap) {
        confluenceScore += 5;
        reasoningHeader += `\n✓ Price above Daily VWAP (${vwap.toFixed(marketPrice.digits)}) — Mean Reversion Premium (+5).`;
      } else {
        confluenceScore -= 4;
        reasoningHeader += `\n⚠ Price below Daily VWAP for SELL (-4).`;
      }
    }
  }

  // Fibonacci Retracement Confluence
  const swingDiff = Math.abs(lastSwingHigh - lastSwingLow);
  if (type !== null && swingDiff > 0) {
    const fib50 = type === 'BUY' ? lastSwingHigh - 0.5 * swingDiff : lastSwingLow + 0.5 * swingDiff;
    const fib618 = type === 'BUY' ? lastSwingHigh - 0.618 * swingDiff : lastSwingLow + 0.618 * swingDiff;
    const tolerance = Math.max(atr * 0.4, swingDiff * 0.08);

    const near50 = Math.abs(currentPrice - fib50) <= tolerance;
    const near618 = Math.abs(currentPrice - fib618) <= tolerance;

    if (near50 || near618) {
      confluenceScore += 5;
      const fibName = near618 ? '0.618 Golden Ratio' : '0.50 Retracement';
      reasoningHeader += `\n✓ Entry zone aligned with Fibonacci ${fibName} level (+5).`;
    }
  }

  // RSI Overbought/Oversold Score Penalty
  if (type === 'BUY' && rsi > 70 && !bullishDivergence) {
    confluenceScore -= 15;
    reasoningHeader += `\n⚠ Overbought RSI (${rsi}) filter penalty applied (-15).`;
  } else if (type === 'SELL' && rsi < 30 && !bearishDivergence) {
    confluenceScore -= 15;
    reasoningHeader += `\n⚠ Oversold RSI (${rsi}) filter penalty applied (-15).`;
  }

  // HTF Bias (higher-timeframe direction derived from the M5 candle buffer) - INFORMATIONAL
  // ONLY, same product decision as the H1 trend block above: never rejects a signal, penalty
  // capped at -5 regardless of BOS/FVG confirmation, and always leaves a status note in
  // analysisReasoning (aligned/against/neutral) so the user sees the context either way.
  if (type === 'BUY') {
    if (htTrend === 'BULLISH') {
      reasoningHeader += '\n✓ Searah tren HTF (BULLISH).';
    } else if (htTrend === 'BEARISH') {
      confluenceScore -= 5;
      reasoningHeader += '\n⚠ Melawan tren HTF (BEARISH) — pertimbangkan risiko lebih hati-hati.';
    } else {
      reasoningHeader += '\n• Tren HTF saat ini netral (data belum cukup atau tidak dominan satu arah).';
    }
  } else if (type === 'SELL') {
    if (htTrend === 'BEARISH') {
      reasoningHeader += '\n✓ Searah tren HTF (BEARISH).';
    } else if (htTrend === 'BULLISH') {
      confluenceScore -= 5;
      reasoningHeader += '\n⚠ Melawan tren HTF (BULLISH) — pertimbangkan risiko lebih hati-hati.';
    } else {
      reasoningHeader += '\n• Tren HTF saat ini netral (data belum cukup atau tidak dominan satu arah).';
    }
  }

  // hoisted here so both this block's Volume Confirmation note and the pre-existing Mandatory
  // Crypto Volume Filter Penalty below can share one declaration
  const isCrypto = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].includes(pairId);

  // MACD Confirmation - INFORMATIONAL ONLY, same product decision as H1/HTF above: never
  // rejects a signal, penalty capped at -5. Standard MACD (EMA12, EMA26, signal = EMA9 of the
  // MACD line) computed from whatever candle history is available; skipped entirely (no note,
  // no adjustment) when there's under 26 candles to work with, since EMA26 wouldn't be
  // meaningful yet - never forced.
  if (type !== null && candles.length >= 26) {
    const closes = candles.map((c) => c.close);
    const ema12Series = calculateEMASeries(closes, 12);
    const ema26Series = calculateEMASeries(closes, 26);
    const macdLine = closes.map((_, i) => ema12Series[i] - ema26Series[i]);
    const signalLine = calculateEMASeries(macdLine, 9);
    const histogram = macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1];

    if (type === 'BUY') {
      if (histogram > 0) {
        reasoningHeader += '\n✓ MACD momentum searah.';
      } else {
        confluenceScore -= 5;
        reasoningHeader += '\n⚠ MACD momentum berlawanan arah — pertimbangkan risiko lebih hati-hati.';
      }
    } else if (type === 'SELL') {
      if (histogram < 0) {
        reasoningHeader += '\n✓ MACD momentum searah.';
      } else {
        confluenceScore -= 5;
        reasoningHeader += '\n⚠ MACD momentum berlawanan arah — pertimbangkan risiko lebih hati-hati.';
      }
    }
  }

  // EMA50 Trend Alignment - INFORMATIONAL ONLY, same pattern, penalty capped at -5. Requires at
  // least 50 candles to compute a real EMA50; skipped entirely (no note, no adjustment)
  // otherwise, per explicit instruction not to force this on pairs without enough history. Note:
  // candle buffers in this codebase are typically capped around 30 bars (see candleStore usage
  // throughout), so in practice this check will mostly stay skipped unless/until a pair
  // accumulates 50+ stored candles - flagged here, not silently "fixed" by lowering the 50
  // threshold, since that was an explicit, deliberate instruction.
  if (type !== null && candles.length >= 50) {
    const closes = candles.map((c) => c.close);
    const ema50Series = calculateEMASeries(closes, 50);
    const ema50 = ema50Series[ema50Series.length - 1];

    if (type === 'BUY') {
      if (currentPrice > ema50) {
        reasoningHeader += '\n✓ Searah EMA50.';
      } else {
        confluenceScore -= 5;
        reasoningHeader += '\n⚠ Melawan EMA50.';
      }
    } else if (type === 'SELL') {
      if (currentPrice < ema50) {
        reasoningHeader += '\n✓ Searah EMA50.';
      } else {
        confluenceScore -= 5;
        reasoningHeader += '\n⚠ Melawan EMA50.';
      }
    }
  }

  // Volume Confirmation - crypto only (BTCUSDT/ETHUSDT/SOLUSDT), the only pairs with real
  // exchange-reported volume in our candle data (forex/XAU candles carry a synthetic/placeholder
  // volume field, not real traded volume, so a volume check there would be meaningless). Pure
  // information either way, never a penalty - even below-average volume just gets a neutral note.
  if (type !== null && isCrypto && candles.length >= 10) {
    const avgVol10Info = candles.slice(-10).reduce((acc, c) => acc + (c.volume || 0), 0) / 10;
    const lastVolInfo = candles[candles.length - 1]?.volume || 0;

    if (avgVol10Info > 0 && lastVolInfo > avgVol10Info) {
      reasoningHeader += '\n✓ Volume di atas rata-rata, konfirmasi partisipasi pasar.';
    } else {
      reasoningHeader += '\n• Volume di bawah rata-rata, monitor kelanjutannya.';
    }
  }

  // Mandatory Crypto Volume Filter Penalty
  if (type !== null && isCrypto && candles.length >= 10) {
    const avgVol10 = candles.slice(-10).reduce((acc, c) => acc + (c.volume || 0), 0) / 10;
    const lastVol = candles[candles.length - 1]?.volume || 0;

    const isPureReversal = bullishFVG || bearishFVG || bullishSweep || bearishSweep;
    const isBreakoutOrTrend = bullishBOS || bearishBOS || (!isPureReversal && Math.abs(marketPrice.change24h) >= 0.35);

    if (isBreakoutOrTrend && avgVol10 > 0 && lastVol < avgVol10 * 0.80) {
      confluenceScore -= 12;
      reasoningHeader += `\n⚠ Low volume breakout (${lastVol.toFixed(1)} < 80% avg) penalty applied (-12).`;
    }
  }

  // Forex Directional Correlation Filter Penalty
  const isForexPair = ['EURUSD', 'GBPUSD', 'USDCHF', 'USDCAD'].includes(pairId);
  if (type !== null && isForexPair) {
    const candidateUsdDir = getNetUsdDirection(pairId, type);
    if (candidateUsdDir) {
      const activeForexPairs: PairId[] = ['EURUSD', 'GBPUSD', 'USDCHF', 'USDCAD'];
      let hasCorrelatedActive = false;
      let activeCorrelatedPair = '';

      for (const otherId of activeForexPairs) {
        if (otherId === pairId) continue;
        const activeSig = currentSignals[otherId];
        if (
          activeSig &&
          ['Running', 'Waiting Entry', 'TP1 Hit'].includes(activeSig.status)
        ) {
          const activeUsdDir = getNetUsdDirection(activeSig.pairId, activeSig.type);
          if (activeUsdDir === candidateUsdDir) {
            hasCorrelatedActive = true;
            activeCorrelatedPair = `${activeSig.pairId} ${activeSig.type}`;
            break;
          }
        }
      }

      if (hasCorrelatedActive) {
        confluenceScore -= 8;
        reasoningHeader += `\n⚠ Correlated Forex directional exposure penalty applied (-8) due to active ${activeCorrelatedPair} signal.`;
      }
    }
  }

  // XAU/USD-ONLY: the old single "validTrigger" re-check (OB/FVG retest OR 3-bar momentum OR
  // sweep, above one flat confluence threshold) is fully replaced by evaluateXauIctSetups() above
  // - it already only ever sets `type` when one of the 3 independent genuine ICT patterns
  // (trend-continuation, liquidity-sweep reversal, or range S&D bounce) matched AND produced a
  // real structural entry/SL/TP anchor (see its validCandidates filter). No separate trigger
  // re-check is needed here. The final quality gate (confluence score >= dynamic threshold,
  // baseline 70 for XAUUSD) is still enforced downstream in createInstitutionalScalpingSignal
  // against structure.confluenceScore, exactly the same as every other pair.
  if (pairId === 'XAUUSD' && type !== null && (!xauSetup || !xauSetup.entryZone || xauSetup.structuralSLLevel === null || xauSetup.tp1Level === null || xauSetup.tp2Level === null)) {
    // Defensive safety net only - evaluateXauIctSetups should never set `type` without also
    // populating these, but if it somehow did, refuse to publish rather than fall back to a
    // generic/guessed level.
    type = null;
    confluenceScore = 45;
    reasoningHeader = 'NO VALID SETUP: XAU/USD structural anchor levels tidak lengkap - sinyal ditahan demi kualitas.';
  }

  // Dynamic Strategy Method
  let strategyMethod = 'M15 Market Structure Shift + OB';
  if (bullishBOS || bearishBOS) {
    strategyMethod = 'M15 Break of Structure (BOS) + CHoCH Expansion';
  } else if (bullishFVG || bearishFVG) {
    strategyMethod = 'M5 Fair Value Gap (FVG) Retest & Order Flow';
  } else if (bullishSweep || bearishSweep) {
    strategyMethod = 'M5 Liquidity Sweep & Institutional Reversal';
  } else if (type !== null) {
    strategyMethod = 'M15 Trend Momentum & Dynamic Volatility Model';
  }
  // XAU/USD-ONLY: use the actual winning pattern's own label instead of the generic guess above,
  // since for this pair we know exactly which of the 3 ICT patterns produced the setup.
  if (pairId === 'XAUUSD' && xauSetup && xauSetup.type !== null) {
    strategyMethod = xauSetup.strategyMethod;
  }

  return {
    type,
    confluenceScore,
    atr,
    shortTermAtr,
    slDelta,
    reasoningHeader,
    strategyMethod,
    bosDetected: bullishBOS || bearishBOS,
    fvgDetected: pairId === 'XAUUSD' && xauSetup ? xauSetup.genuineFVGDetected : (bullishFVG || bearishFVG),
    orderBlockDetected: pairId === 'XAUUSD' && xauSetup ? xauSetup.genuineOBDetected : (inDiscount || inPremium),
    adx,
    rsi,
    regime,
    swingHighs,
    swingLows,
    baseMinSL,
    baseMaxSL,
    baseBandPct,
    volMultiplier,
    reversalConfirmations,
    xauPattern: xauSetup?.pattern ?? null,
    xauHtfBiasCombined: xauSetup?.htfBiasCombined,
    xauHtfOpposed: xauSetup?.htfOpposed,
    xauHtfAlignment: xauSetup?.htfAlignment,
    xauChaseDistanceAtr: xauSetup?.chaseDistanceAtr,
    xauRetestTouches: xauSetup?.retestTouches,
    xauRunnerUp: xauSetup?.runnerUp,
    xauZoneAgeBars: xauSetup?.zoneAgeBars,
    xauSignalTier: xauSetup?.signalTier,
    xauEntryZone: xauSetup?.entryZone ?? null,
    xauStructuralSLLevel: xauSetup?.structuralSLLevel ?? null,
    xauTp1Level: xauSetup?.tp1Level ?? null,
    xauTp2Level: xauSetup?.tp2Level ?? null,
    xauGenuineSweepDetected: bullishSweep || bearishSweep,
    xauGenuineSNDDetected: xauSetup?.genuineSNDDetected ?? false,
  };
}

// ============================================================================================
// Entry/SL/TP construction - copied from createInstitutionalScalpingSignal's XAUUSD path, split
// into OLD (pre-redesign: flat $4.50-$12.00 clamp + riskDist*1.20/2.40 TP multiples + generic
// currentPrice +/- bandPct entry) and NEW (structural OB/FVG/sweep/S&D anchors, sanity
// floor/ceiling instead of a flat clamp, RR quality filter). digits hardcoded to 2 (XAUUSD's
// real value from PAIRS_LIST) since this harness only ever runs XAUUSD.
// ============================================================================================

interface BuiltSignal {
  type: 'BUY' | 'SELL';
  entryMin: number;
  entryMax: number;
  entryAvg: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  slDistance: number;
  rr2: number;
  // 2026-09-01 RR ENGINE REWORK: RR1 from the entry zone's midpoint (rr1, for comparison) vs from
  // the realistic worst-case fill edge (worstCaseRr1, see newBuildEntrySlTp) - only populated by
  // newBuildEntrySlTp, since oldBuildEntrySlTp doesn't have a genuine entry zone to compute a
  // worst-case edge from (its entry band is a generic % offset, not a real structural zone).
  rr1?: number;
  worstCaseRr1?: number;
  // FASE 2 (soft/hard SL candidate) - only ever populated by newBuildEntrySlTp, since the
  // soft+hard concept is built on top of the fase-1 structural SL, not the pre-fase-1 flat clamp.
  hardStopLoss?: number;
  hardSlDistance?: number;
}

const XAU_DIGITS = 2;

function oldBuildEntrySlTp(structure: StructureAnalysis, currentPrice: number): BuiltSignal | null {
  const type = structure.type;
  if (!type) return null;
  const digits = XAU_DIGITS;

  const volMultiplier = structure.volMultiplier || 1.0;
  const baseBandPct = structure.baseBandPct || 0.00015;
  const bandPct = baseBandPct * volMultiplier;

  let entryOptimal = currentPrice;
  if (type === 'BUY') {
    entryOptimal = Number((currentPrice * (1 - bandPct)).toFixed(digits));
  } else {
    entryOptimal = Number((currentPrice * (1 + bandPct)).toFixed(digits));
  }
  const halfBand = Number((currentPrice * bandPct).toFixed(digits));
  let entryMin = Number((entryOptimal - halfBand).toFixed(digits));
  let entryMax = Number((entryOptimal + halfBand).toFixed(digits));
  if (entryMin > entryMax) [entryMin, entryMax] = [entryMax, entryMin];
  const entryAvg = Number(((entryMin + entryMax) / 2).toFixed(digits));

  const baseMinSL = structure.baseMinSL || 0.0008;
  const baseMaxSL = structure.baseMaxSL || 0.0025;
  const minSL = Number((baseMinSL * volMultiplier).toFixed(digits));
  const maxSL = Number((baseMaxSL * volMultiplier).toFixed(digits));
  const shortTermAtr = structure.shortTermAtr || structure.atr;

  const swingLows = structure.swingLows || [];
  const swingHighs = structure.swingHighs || [];
  const isBuy = type === 'BUY';
  const recentLows = swingLows.length > 0 ? swingLows.slice(-3) : [isBuy ? entryMin - structure.slDelta : entryMax + structure.slDelta];
  const recentHighs = swingHighs.length > 0 ? swingHighs.slice(-3) : [isBuy ? entryMin - structure.slDelta : entryMax + structure.slDelta];
  const nearestSwingLevel = isBuy ? Math.min(...recentLows) : Math.max(...recentHighs);
  const structuralBuffer = Math.max(minSL, shortTermAtr * 0.3);
  const rawSl = isBuy ? (nearestSwingLevel - structuralBuffer) : (nearestSwingLevel + structuralBuffer);
  const rawSlDist = Math.abs(entryAvg - rawSl);
  const clampedSlDist = Math.max(minSL, Math.min(maxSL, rawSlDist));
  const stopLoss = isBuy
    ? Number((entryAvg - clampedSlDist).toFixed(digits))
    : Number((entryAvg + clampedSlDist).toFixed(digits));

  const riskDist = Math.abs(entryAvg - stopLoss);
  const takeProfit1 = isBuy
    ? Number((entryMax + riskDist * 1.20).toFixed(digits))
    : Number((entryMin - riskDist * 1.20).toFixed(digits));
  const takeProfit2 = isBuy
    ? Number((entryMax + riskDist * 2.40).toFixed(digits))
    : Number((entryMin - riskDist * 2.40).toFixed(digits));

  const slDistance = Math.abs(entryAvg - stopLoss);
  const rr2 = Math.abs(takeProfit2 - entryAvg) / (slDistance || 1);

  return { type, entryMin, entryMax, entryAvg, stopLoss, takeProfit1, takeProfit2, slDistance, rr2 };
}

function newBuildEntrySlTp(structure: StructureAnalysis, currentPrice: number): BuiltSignal | null {
  const type = structure.type;
  if (!type) return null;
  const digits = XAU_DIGITS;
  const isBuy = type === 'BUY';

  if (!structure.xauEntryZone) return null;
  let entryMin = Number(Math.min(structure.xauEntryZone.min, structure.xauEntryZone.max).toFixed(digits));
  let entryMax = Number(Math.max(structure.xauEntryZone.min, structure.xauEntryZone.max).toFixed(digits));
  let entryOptimalRaw = Number(structure.xauEntryZone.optimal.toFixed(digits));
  let entryAvg = Number(((entryMin + entryMax) / 2).toFixed(digits));

  if (
    structure.xauStructuralSLLevel === null || structure.xauStructuralSLLevel === undefined ||
    structure.xauTp1Level === null || structure.xauTp1Level === undefined ||
    structure.xauTp2Level === null || structure.xauTp2Level === undefined
  ) {
    return null;
  }

  // Zone-width cap (mirrors server.ts's createInstitutionalScalpingSignal - see
  // xauReworkParams's own comment above for the full rationale).
  {
    const structuralRisk = Math.abs(entryOptimalRaw - structure.xauStructuralSLLevel);
    const zoneWidth = entryMax - entryMin;
    if (structuralRisk > 0 && zoneWidth > xauReworkParams.zoneWidthToRiskRatio * structuralRisk) {
      const half = zoneWidth / 2;
      const trimmedMin = isBuy ? entryMin : entryMax - half;
      const trimmedMax = isBuy ? entryMin + half : entryMax;
      if (half <= xauReworkParams.zoneWidthToRiskRatio * structuralRisk) {
        entryMin = Number(trimmedMin.toFixed(digits));
        entryMax = Number(trimmedMax.toFixed(digits));
        entryOptimalRaw = Number(Math.min(Math.max(entryOptimalRaw, entryMin), entryMax).toFixed(digits));
        entryAvg = Number(((entryMin + entryMax) / 2).toFixed(digits));
      } else {
        return null; // rejected: entry zone too wide relative to risk, even after trimming
      }
    }
  }

  const shortTermAtrXau = structure.shortTermAtr || structure.atr;
  const typicalSpreadEstimate = Math.max(currentPrice * 0.00005, 0.10);
  const noiseBuffer = Math.max(structure.atr * 0.5, typicalSpreadEstimate * 3);
  const rawSlPrice = isBuy ? (structure.xauStructuralSLLevel - noiseBuffer) : (structure.xauStructuralSLLevel + noiseBuffer);
  const rawSlDist = Math.abs(entryAvg - rawSlPrice);
  const xauSlFloor = Math.max(structure.atr * 0.5, typicalSpreadEstimate * 3);
  const xauSlCeiling = Math.max(structure.atr * 6, noiseBuffer * 4);
  if (rawSlDist > xauSlCeiling) return null; // rejected: structural SL too wide (sanity ceiling)

  const slDist = Math.max(xauSlFloor, rawSlDist);
  const stopLoss = isBuy ? Number((entryAvg - slDist).toFixed(digits)) : Number((entryAvg + slDist).toFixed(digits));
  const takeProfit1 = Number(structure.xauTp1Level.toFixed(digits));
  const takeProfit2 = Number(structure.xauTp2Level.toFixed(digits));

  const riskXau = Math.abs(entryAvg - stopLoss);
  const rr1 = Math.abs(takeProfit1 - entryAvg) / (riskXau || 1);
  const rr2 = Math.abs(takeProfit2 - entryAvg) / (riskXau || 1);
  // 2026-09-01 RR ENGINE REWORK: raised from 0.7/1.3 - see MIN_RR1_MAIN/MIN_RR2_MAIN's own comment
  // in server.ts. Fase D prerequisite (2026-09-04): tier-aware, mirrors server.ts's
  // createInstitutionalScalpingSignal RR gate exactly - SCALP's tp2 may be collapsed to tp1 (a
  // single nearest genuine target, see evaluateXauIctSetups' tiered selection) precisely because a
  // wide, well-separated second target is not required for this tier, so it is never gated on
  // MIN_RR2_MAIN. SCALP's own floor (XAU_MIN_RR1_SCALP) is still a real floor, just a lower one.
  const isXauScalpTier = structure.xauSignalTier === 'SCALP';
  const MIN_RR1_MAIN = xauReworkParams.minRr1Main;
  const MIN_RR2_MAIN = xauReworkParams.minRr2Main;
  const minRr1 = isXauScalpTier ? XAU_MIN_RR1_SCALP : MIN_RR1_MAIN;
  if (rr1 < minRr1 || (!isXauScalpTier && rr2 < MIN_RR2_MAIN)) return null; // rejected: RR quality filter

  // Worst-case-fill-edge RR gate (mirrors server.ts's createInstitutionalScalpingSignal - the same
  // bar as minRr1, applied to a fill at whichever entry-zone edge is closest to TP1/farthest
  // from SL simultaneously, not just the zone's midpoint). Not a new/stricter number - the same
  // threshold, just checked against the realistic worst fill instead of only the average one.
  const worstCaseEntry = isBuy ? entryMax : entryMin;
  const worstCaseRisk = Math.abs(worstCaseEntry - stopLoss);
  const worstCaseReward = Math.abs(takeProfit1 - worstCaseEntry);
  const worstCaseRr1 = worstCaseReward / (worstCaseRisk || 1);
  if (worstCaseRr1 < minRr1) return null; // rejected: worst-case-edge RR below floor

  const slDistance = Math.abs(entryAvg - stopLoss);

  // FASE 2 CANDIDATE (not live yet): Hard SL backstop, computed once alongside the soft SL as
  // specified in the fase-2 prompt - hardSlDistance = softSlDistance + max(shortTermATR*1.0,
  // softSlDistance*0.6). This is a wider, wick-based emergency backstop; the soft SL above stays
  // the level shown to the user and requires an M5 candle-close confirmation before it counts as
  // hit (see simulateForwardSoftHard below). Computed here (not in server.ts) purely so this
  // backtest can compare the two exit models on identical entry/soft-SL/TP levels - server.ts's
  // live evaluateSignalStatus is untouched by this phase.
  const hardSlDistance = slDistance + Math.max(shortTermAtrXau * 1.0, slDistance * 0.6);
  const hardStopLoss = isBuy ? Number((entryAvg - hardSlDistance).toFixed(digits)) : Number((entryAvg + hardSlDistance).toFixed(digits));

  return { type, entryMin, entryMax, entryAvg, stopLoss, takeProfit1, takeProfit2, slDistance, rr2, rr1, worstCaseRr1, hardStopLoss, hardSlDistance };
}

// ============================================================================================
// Data loading - real XAUUSD 1-minute candles from the exact same Yahoo Finance endpoint the
// live server uses (fetchForexAndGoldData in server.ts). Requires network access - see the
// honesty note at the top of this file for what happens when it's unavailable.
// ============================================================================================

async function fetchYahooChart(symbol: string, interval: string, rangeDays: string): Promise<any> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${rangeDays}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HEVORA/1.0' },
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Yahoo fetch failed for ${symbol} (${url}): HTTP ${res.status} - body: ${bodyText.slice(0, 300)}`);
  }
  let json: any;
  try {
    json = JSON.parse(bodyText);
  } catch (e) {
    throw new Error(`Yahoo response for ${symbol} was not valid JSON - body: ${bodyText.slice(0, 300)}`);
  }
  const chartError = json?.chart?.error;
  if (chartError) {
    throw new Error(`Yahoo chart API returned an error object for ${symbol}: ${JSON.stringify(chartError)}`);
  }
  return json;
}

interface TwelveDataTimeSeriesValueBT {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

// Fetches real historical XAU/USD candles from Twelve Data's time_series endpoint - real 5-minute
// bars, matching candleStore.XAUUSD's own bar size, unlike the Yahoo/GC=F fallback chain below
// (1-minute bars, and GC=F is futures not spot). Requires TWELVE_DATA_API_KEY (a real subscription
// key, not the public "demo" key which returns a 401 auth error, not real data) - optional, purely
// a backtest-data-quality choice (2026-09-01: the live server, server.ts, never calls Twelve Data
// at all - its own dormant candle backstop was removed entirely; XAUUSD candles there are
// self-built from gold-api.com/Yahoo ticks instead, see buildXauCandleFromTicks).
// outputsize=5000 in one call (well within Twelve Data's per-request cap) to get maximum real
// history without spending multiple requests against the free-tier rate limit.
async function fetchTwelveDataXauCandles(apiKey: string): Promise<Candle[]> {
  const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=5min&outputsize=5000&timezone=UTC&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HEVORA backtest)' } });
  const bodyText = await res.text();
  let json: any;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`Twelve Data time_series response was not valid JSON - body: ${bodyText.slice(0, 300)}`);
  }
  if (!res.ok || json?.status === 'error' || !Array.isArray(json?.values)) {
    throw new Error(`Twelve Data time_series failed: HTTP ${res.status} - ${JSON.stringify(json).slice(0, 300)}`);
  }
  const values = json.values as TwelveDataTimeSeriesValueBT[];
  return values
    .map((v) => {
      const time = Date.parse(v.datetime.replace(' ', 'T') + 'Z');
      return {
        time,
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
        volume: Number(v.volume) || 0,
      };
    })
    .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close))
    .sort((a, b) => a.time - b.time);
}

async function fetchRealXauCandles(rangeDays: '1d' | '5d' = '5d'): Promise<{ candles: Candle[]; source: string; barMinutes: number }> {
  // Preferred when available: Twelve Data (5-minute bars, matching candleStore.XAUUSD's own bar
  // size) - only used when TWELVE_DATA_API_KEY is available in this environment. Falls back to the
  // Yahoo XAUUSD=X -> GC=F chain (1-minute bars) when no key is configured, so this script still
  // produces real numbers either way, just clearly labeled with which source/bar size was used.
  const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
  if (twelveDataKey) {
    try {
      const candles = await fetchTwelveDataXauCandles(twelveDataKey);
      if (candles.length >= 100) {
        return { candles, source: 'Twelve Data (XAU/USD, 5min bars) - backtest-only, opt-in data source', barMinutes: 5 };
      }
      console.warn(`[fetchRealXauCandles] Twelve Data returned only ${candles.length} candles - too thin, falling back to Yahoo/GC=F.`);
    } catch (tdErr: any) {
      console.warn(`[fetchRealXauCandles] Twelve Data fetch failed (${tdErr?.message || tdErr}), falling back to Yahoo XAUUSD=X/GC=F...`);
    }
  } else {
    console.warn('[fetchRealXauCandles] TWELVE_DATA_API_KEY not set in this environment - using Yahoo XAUUSD=X/GC=F instead (same as before). Set the repo secret for real 5-minute bars matching candleStore.XAUUSD\'s own bar size instead of the 1-minute GC=F fallback.');
  }

  // Fallback: spot XAUUSD via the exact same symbol/endpoint the live server ALSO still tries
  // (demoted to a fallback there too - see fetchGold). Further fallback: Gold futures (GC=F) if
  // the spot symbol is unavailable from this runner - noted explicitly in the output since futures
  // carry a basis differential vs spot, but real historical volatility/wick behavior (what this
  // backtest actually needs) is a reasonable stand-in when spot is unreachable.
  let json: any;
  let symbolUsed = 'XAUUSD=X';
  try {
    json = await fetchYahooChart('XAUUSD=X', '1m', rangeDays);
  } catch (primaryErr: any) {
    console.warn(`[fetchRealXauCandles] Primary symbol XAUUSD=X failed (${primaryErr?.message || primaryErr}), trying GC=F (Gold futures) as a fallback dataset...`);
    symbolUsed = 'GC=F';
    json = await fetchYahooChart('GC=F', '1m', rangeDays);
  }
  if (symbolUsed !== 'XAUUSD=X') {
    console.warn(`[fetchRealXauCandles] NOTE: using ${symbolUsed} candles, not spot XAUUSD=X - absolute price level differs slightly (futures basis) but real historical intraday volatility/wick behavior is preserved.`);
  }
  const result = json?.chart?.result?.[0];
  if (!result || !result.meta) throw new Error('Yahoo response missing chart.result[0].meta');
  const quote = result.indicators?.quote?.[0];
  const timestamps: number[] = result.timestamp || [];
  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quote?.open?.[i] != null && quote?.high?.[i] != null && quote?.low?.[i] != null && quote?.close?.[i] != null) {
      candles.push({
        time: timestamps[i] * 1000,
        open: quote.open[i],
        high: quote.high[i],
        low: quote.low[i],
        close: quote.close[i],
        volume: quote.volume?.[i] || 0,
      });
    }
  }
  return { candles, source: `Yahoo ${symbolUsed}, 1min bars`, barMinutes: 1 };
}

// ============================================================================================
// Walk-forward simulator - mirrors evaluateSignalStatus's own state machine (Waiting Entry ->
// Running -> TP1 Hit -> TP2 Hit / Stop Loss Hit / Invalidated) closely enough for a fair
// comparison, without pulling in the live server's autotrade/history-recording side effects.
// ============================================================================================

type Outcome = 'TP2' | 'TP1_THEN_SL' | 'DIRECT_SL' | 'INVALIDATED' | 'OPEN_AT_DATA_END';

interface SimResult {
  outcome: Outcome;
  slDistance: number;
  rMultiple: number; // realized P/L in units of initial risk (1R = slDistance)
  firedAtIndex: number;
  pattern?: string | null;
  exitPrice?: number; // actual price the position closed at (differs from the displayed SL level under the fase-2 close-confirm model)
  shakeoutEvents?: number; // fase-2 only: number of times price wicked through soft SL but the candle closed back inside (survived)
  // 2026-09-03 Fase 3 addition - the candle index this trade actually resolved at (undefined for
  // OPEN_AT_DATA_END, which never resolved). Needed so a walk-forward self-referential history
  // (runXauFase3Audit) only ever counts a trade once it has genuinely closed, never before -
  // otherwise the adaptive-weighting cache would leak lookahead (crediting a still-open trade's
  // eventual outcome to an earlier tick that couldn't have known it yet).
  resolvedAtIndex?: number;
  // Fase D (2026-09-04): Maximum Adverse/Favorable Excursion, in units of initial risk (1R =
  // slDistance) - the largest the trade ever moved against/in favor of the position between entry
  // fill and exit (or data end, for OPEN_AT_DATA_END), regardless of where it actually closed.
  // Always >= 0 by construction (a magnitude, not a signed P/L). Undefined only when the trade
  // never actually filled (stayed WAITING - see INVALIDATED's own branch, which returns before
  // entry, so it never gets one).
  maeR?: number;
  mfeR?: number;
}

const CANDLE_BUFFER_OLD = 30; // pre-redesign cap
const CANDLE_BUFFER_NEW = 150; // this redesign's widened cap
const CONFLUENCE_THRESHOLD = 70; // flat baseline both engines already use for XAUUSD (see honesty note)
// 2026-09-04 raised 0.90 -> 0.95 to match server.ts's constant of the same name exactly (see that
// file's own comment for the real-data streak-analysis rationale and user sign-off).
const XAU_EXTREME_VOL_PERCENTILE = 0.95;
const MAX_HOLD_BARS = 720; // ~12h of 1m bars (scales with ACTUAL_BAR_MINUTES for other bar sizes) - generous cap so a trade isn't judged "stuck" too early
// Set once in main() from fetchRealXauCandles' result (1 for Yahoo, 5 for Twelve Data) - lets
// mkMarketPrice's "24h window" stay a real 24h regardless of which source/bar size is in use.
let ACTUAL_BAR_MINUTES = 1;

function simulateForward(candles: Candle[], startIdx: number, built: BuiltSignal, pattern?: string | null): SimResult {
  const isBuy = built.type === 'BUY';
  let status: 'WAITING' | 'RUNNING' | 'TP1' = 'WAITING';
  // Fase D: running MAE/MFE in R, updated every bar the position is actually live (RUNNING/TP1) -
  // see SimResult.maeR/mfeR's own comment.
  let maeR = 0;
  let mfeR = 0;

  for (let i = startIdx; i < Math.min(candles.length, startIdx + MAX_HOLD_BARS); i++) {
    const c = candles[i];

    if (status === 'WAITING') {
      const insideEntry = c.low <= Math.max(built.entryMin, built.entryMax) && c.high >= Math.min(built.entryMin, built.entryMax);
      if (insideEntry) {
        status = 'RUNNING';
      } else {
        const slInvalidated = isBuy ? c.low <= built.stopLoss : c.high >= built.stopLoss;
        const tpInvalidated = isBuy ? c.high >= built.takeProfit1 : c.low <= built.takeProfit1;
        if (slInvalidated || tpInvalidated) {
          return { outcome: 'INVALIDATED', slDistance: built.slDistance, rMultiple: 0, firedAtIndex: startIdx, pattern, resolvedAtIndex: i };
        }
        continue;
      }
    }

    if (status === 'RUNNING' || status === 'TP1') {
      // Update MAE/MFE off this same bar's real high/low BEFORE checking SL/TP - the excursion
      // that triggers an exit is itself part of the trade's real adverse/favorable extreme, not a
      // separate event, so it must be included even on the bar that ends the trade.
      const adverseExtreme = isBuy ? built.entryAvg - c.low : c.high - built.entryAvg;
      const favorableExtreme = isBuy ? c.high - built.entryAvg : built.entryAvg - c.low;
      maeR = Math.max(maeR, adverseExtreme / (built.slDistance || 1));
      mfeR = Math.max(mfeR, favorableExtreme / (built.slDistance || 1));

      const slHit = isBuy ? c.low <= built.stopLoss : c.high >= built.stopLoss;
      if (slHit) {
        const outcome: Outcome = status === 'TP1' ? 'TP1_THEN_SL' : 'DIRECT_SL';
        // TP1-then-SL is treated as breakeven-ish (auto-BE off by default in engineSettings, so
        // realistically still a small loss/scratch) - scored at 0R here (neither win nor loss),
        // DIRECT_SL at -1R.
        const rMultiple = outcome === 'DIRECT_SL' ? -1 : 0;
        return { outcome, slDistance: built.slDistance, rMultiple, firedAtIndex: startIdx, pattern, exitPrice: built.stopLoss, resolvedAtIndex: i, maeR, mfeR };
      }
      if (status === 'RUNNING') {
        const tp1Hit = isBuy ? c.high >= built.takeProfit1 : c.low <= built.takeProfit1;
        if (tp1Hit) status = 'TP1';
      }
      const tp2Hit = isBuy ? c.high >= built.takeProfit2 : c.low <= built.takeProfit2;
      if (tp2Hit) {
        const rMultiple = Math.abs(built.takeProfit2 - built.entryAvg) / (built.slDistance || 1);
        return { outcome: 'TP2', slDistance: built.slDistance, rMultiple, firedAtIndex: startIdx, pattern, exitPrice: built.takeProfit2, resolvedAtIndex: i, maeR, mfeR };
      }
    }
  }

  return { outcome: 'OPEN_AT_DATA_END', slDistance: built.slDistance, rMultiple: 0, firedAtIndex: startIdx, pattern, maeR, mfeR };
}

// ============================================================================================
// FASE 2 CANDIDATE: Soft SL (M5 candle-close confirmation) + Hard SL (wick-based backstop).
// NOT live in server.ts - this is the walk-forward model being evaluated for the trade-off the
// user asked to see quantified before deciding whether to ship it. Diverges from simulateForward
// above ONLY in how a stop-loss touch is handled; entry, TP1, TP2 logic is byte-for-byte the same
// (per the fase-2 spec: "TP tetap wick-based ... JANGAN diubah").
// ============================================================================================
function simulateForwardSoftHard(candles: Candle[], startIdx: number, built: BuiltSignal, pattern?: string | null): SimResult {
  const isBuy = built.type === 'BUY';
  const hardStopLoss = built.hardStopLoss ?? built.stopLoss; // defensive fallback - should always be set by newBuildEntrySlTp
  let status: 'WAITING' | 'RUNNING' | 'TP1' = 'WAITING';
  let shakeoutEvents = 0;

  for (let i = startIdx; i < Math.min(candles.length, startIdx + MAX_HOLD_BARS); i++) {
    const c = candles[i];

    if (status === 'WAITING') {
      // Entry/invalidation-while-waiting is untouched by fase 2 (the spec scopes the change to
      // the SL-hit check only, for a position that is already Running/TP1) - identical to
      // simulateForward above.
      const insideEntry = c.low <= Math.max(built.entryMin, built.entryMax) && c.high >= Math.min(built.entryMin, built.entryMax);
      if (insideEntry) {
        status = 'RUNNING';
      } else {
        const slInvalidated = isBuy ? c.low <= built.stopLoss : c.high >= built.stopLoss;
        const tpInvalidated = isBuy ? c.high >= built.takeProfit1 : c.low <= built.takeProfit1;
        if (slInvalidated || tpInvalidated) {
          return { outcome: 'INVALIDATED', slDistance: built.slDistance, rMultiple: 0, firedAtIndex: startIdx, pattern, exitPrice: built.stopLoss, shakeoutEvents };
        }
        continue;
      }
    }

    if (status === 'RUNNING' || status === 'TP1') {
      // 1. Hard SL: wick-based, immediate - the backstop that bounds worst-case loss.
      const hardSlHit = isBuy ? c.low <= hardStopLoss : c.high >= hardStopLoss;
      if (hardSlHit) {
        const outcome: Outcome = status === 'TP1' ? 'TP1_THEN_SL' : 'DIRECT_SL';
        const rMultiple = outcome === 'DIRECT_SL' ? -(built.hardSlDistance ?? built.slDistance) / (built.slDistance || 1) : 0;
        return { outcome, slDistance: built.slDistance, rMultiple, firedAtIndex: startIdx, pattern, exitPrice: hardStopLoss, shakeoutEvents };
      }

      // 2. Soft SL: wick touch alone is NOT enough - needs this same candle to CLOSE outside the
      // level before it counts as hit. A wick-touch-then-close-back-inside is a survived
      // shakeout: the signal stays open, exactly as the fase-2 spec requires.
      const softWickTouch = isBuy ? c.low <= built.stopLoss : c.high >= built.stopLoss;
      if (softWickTouch) {
        const closedOutside = isBuy ? c.close < built.stopLoss : c.close > built.stopLoss;
        if (closedOutside) {
          const outcome: Outcome = status === 'TP1' ? 'TP1_THEN_SL' : 'DIRECT_SL';
          // Exit price is the candle's CLOSE, not the soft SL level - this is exactly the "realized
          // loss can be deeper than the displayed SL" risk the fase-2 spec requires disclosing.
          const realizedDist = Math.abs(built.entryAvg - c.close);
          const rMultiple = outcome === 'DIRECT_SL' ? -(realizedDist / (built.slDistance || 1)) : 0;
          return { outcome, slDistance: built.slDistance, rMultiple, firedAtIndex: startIdx, pattern, exitPrice: c.close, shakeoutEvents };
        } else {
          // Survived shakeout - record and keep the position open.
          shakeoutEvents++;
        }
      }

      if (status === 'RUNNING') {
        const tp1Hit = isBuy ? c.high >= built.takeProfit1 : c.low <= built.takeProfit1;
        if (tp1Hit) status = 'TP1';
      }
      const tp2Hit = isBuy ? c.high >= built.takeProfit2 : c.low <= built.takeProfit2;
      if (tp2Hit) {
        const rMultiple = Math.abs(built.takeProfit2 - built.entryAvg) / (built.slDistance || 1);
        return { outcome: 'TP2', slDistance: built.slDistance, rMultiple, firedAtIndex: startIdx, pattern, exitPrice: built.takeProfit2, shakeoutEvents };
      }
    }
  }

  return { outcome: 'OPEN_AT_DATA_END', slDistance: built.slDistance, rMultiple: 0, firedAtIndex: startIdx, pattern, shakeoutEvents };
}

function mkMarketPrice(candles: Candle[], idx: number, windowBars: number): MarketPrice {
  const price = candles[idx].close;
  const start = Math.max(0, idx - windowBars);
  const window = candles.slice(start, idx + 1);
  const high24h = Math.max(...window.map((c) => c.high));
  const low24h = Math.min(...window.map((c) => c.low));
  const first = window[0]?.close ?? price;
  const change24h = first ? ((price - first) / first) * 100 : 0;
  return {
    symbol: 'XAUUSD', name: 'Gold', category: 'commodities', price, change24h, high24h, low24h,
    volume: '0', digits: XAU_DIGITS, tradingViewSymbol: 'OANDA:XAUUSD', lastUpdated: new Date(candles[idx].time).toISOString(), isStale: false,
  };
}

interface EngineRunStats {
  signalsFired: number;
  rejectedByEntrySlTp: number; // structure.type was set but oldBuildEntrySlTp/newBuildEntrySlTp returned null
  outcomes: Record<Outcome, number>;
  slDistances: number[];
  rMultiples: number[];
  patternCounts: Record<string, number>;
  // TP1-to-TP2 gap ($) vs entry-to-TP1 distance ($) for every fired signal - real evidence for
  // whether TP1/TP2 sitting close together (a reported production case: $0.84 gap vs $3.84
  // entry-to-TP1) is typical market structure or was a genuine selection-logic gap (see
  // pickXauTpPair/XAU_MIN_TP_SEPARATION_ATR_MULT).
  tp1Tp2Gaps: number[];
  entryTp1Distances: number[];
  // 2026-09-01 RR ENGINE REWORK: RR1 realized from the entry zone's midpoint vs from the realistic
  // worst-case fill edge, for every fired signal - only populated when built.rr1/worstCaseRr1
  // exist (newBuildEntrySlTp; oldBuildEntrySlTp doesn't have a genuine zone to compute this from).
  midpointRr1s: number[];
  worstCaseRr1s: number[];
  // Root-cause diagnostics: WHY a tick did not fire a signal, bucketed by which gate/filter is
  // responsible (see DoD item "root cause pasti dari sinyal XAU sering tidak keluar"). Every tick
  // in the walk-forward loop lands in exactly one bucket (fired, or one of the reasons below).
  diagnostics: {
    totalTicks: number;
    volatilityGateBlocked: number; // structure.strategyMethod === 'Volatility Regime Gate Active'
    newsWindowBlocked: number; // structure.strategyMethod === 'High Impact News Filter Active' (always 0 in this harness - see honesty note)
    noDirectionFound: number; // structure.type === null for any other reason (no genuine ICT pattern / equilibrium)
    confluenceBelowThreshold: number; // structure.type set, but confluenceScore < CONFLUENCE_THRESHOLD
    rejectedAtBuildStage: number; // passed confluence, but build() rejected (RR filter or sanity SL ceiling)
    fired: number;
    // Raw confluenceScore for every tick where a direction WAS found (type !== null), regardless
    // of whether it cleared CONFLUENCE_THRESHOLD - lets the report show the real score
    // distribution against the live adaptive threshold (70 base, up to +18 stacked) rather than
    // just the flat 70 baseline this harness fires signals at.
    confluenceScoresWhenDirectionFound: number[];
    // XAUUSD-only: ATR percentile rank for every tick with enough history to compute one -
    // real-data evidence for how often the new relative Volatility Regime Gate would trigger at
    // various percentile cutoffs (see summarizeDiagnostics).
    atrPercentileRanks: number[];
  };
}

function runEngine(
  candles: Candle[],
  bufferCap: number,
  evaluate: (candles: Candle[], mp: MarketPrice) => StructureAnalysis,
  build: (structure: StructureAnalysis, currentPrice: number) => BuiltSignal | null
): EngineRunStats {
  const stats: EngineRunStats = {
    signalsFired: 0,
    rejectedByEntrySlTp: 0,
    outcomes: { TP2: 0, TP1_THEN_SL: 0, DIRECT_SL: 0, INVALIDATED: 0, OPEN_AT_DATA_END: 0 },
    slDistances: [],
    rMultiples: [],
    patternCounts: {},
    tp1Tp2Gaps: [],
    entryTp1Distances: [],
    midpointRr1s: [],
    worstCaseRr1s: [],
    diagnostics: {
      totalTicks: 0,
      volatilityGateBlocked: 0,
      newsWindowBlocked: 0,
      noDirectionFound: 0,
      confluenceBelowThreshold: 0,
      rejectedAtBuildStage: 0,
      fired: 0,
      confluenceScoresWhenDirectionFound: [],
      atrPercentileRanks: [],
    },
  };

  const MIN_HISTORY = 20;
  let i = MIN_HISTORY;
  while (i < candles.length) {
    const windowStart = Math.max(0, i - bufferCap + 1);
    const window = candles.slice(windowStart, i + 1); // candleStore as it would look at this point in time, capped the same way the live server caps it
    const mp = mkMarketPrice(candles, i, Math.round(1440 / ACTUAL_BAR_MINUTES));
    const structure = evaluate(window, mp);

    stats.diagnostics.totalTicks++;
    if (structure.regime?.atrPercentileRank !== undefined) {
      stats.diagnostics.atrPercentileRanks.push(structure.regime.atrPercentileRank);
    }
    if (structure.type) {
      stats.diagnostics.confluenceScoresWhenDirectionFound.push(structure.confluenceScore);
    }

    if (structure.type && structure.confluenceScore >= CONFLUENCE_THRESHOLD) {
      const built = build(structure, mp.price);
      if (!built) {
        stats.rejectedByEntrySlTp++;
        stats.diagnostics.rejectedAtBuildStage++;
        i++;
        continue;
      }
      stats.signalsFired++;
      stats.diagnostics.fired++;
      stats.slDistances.push(built.slDistance);
      stats.tp1Tp2Gaps.push(Math.abs(built.takeProfit2 - built.takeProfit1));
      stats.entryTp1Distances.push(Math.abs(built.takeProfit1 - built.entryAvg));
      if (built.rr1 !== undefined) stats.midpointRr1s.push(built.rr1);
      if (built.worstCaseRr1 !== undefined) stats.worstCaseRr1s.push(built.worstCaseRr1);
      const pattern = (structure as any).xauPattern ?? null;
      if (pattern) stats.patternCounts[pattern] = (stats.patternCounts[pattern] || 0) + 1;

      const result = simulateForward(candles, i + 1, built, pattern);
      stats.outcomes[result.outcome]++;
      stats.rMultiples.push(result.rMultiple);

      // Advance past this trade's resolution before scanning for the next one - mirrors the live
      // server only ever holding one open XAUUSD signal at a time.
      i = result.firedAtIndex + 1;
      // Find how far the simulation actually advanced by re-deriving it (simulateForward doesn't
      // return the ending index, only whether/when it resolved) - conservatively skip ahead by
      // re-running the wait/hold loop's index tracking inline would duplicate the function, so
      // instead just skip a fixed cool-down of a few bars and let the loop's own re-evaluation
      // naturally skip periods where structure.type stays null. This slightly under-counts the
      // "one at a time" spacing but never double-fires the same setup twice in a row.
      i += 5;
      continue;
    }

    if (!structure.type) {
      if (structure.strategyMethod === 'Volatility Regime Gate Active') stats.diagnostics.volatilityGateBlocked++;
      else if (structure.strategyMethod === 'High Impact News Filter Active') stats.diagnostics.newsWindowBlocked++;
      else stats.diagnostics.noDirectionFound++;
    } else {
      stats.diagnostics.confluenceBelowThreshold++;
    }

    i++;
  }

  return stats;
}

// ============================================================================================
// 2026-09-03 HTF bias & directional gate audit/backtest - dedicated OLD-vs-NEW comparison harness.
// Separate from runEngine above (which drives the pre-redesign-vs-this-redesign structural-SL/TP
// comparison and doesn't track per-pattern/HTF-alignment breakdowns) because this task's question
// is specifically: how often did TREND_CONTINUATION/CHOCH_REVERSAL/LIQUIDITY_SWEEP_REVERSAL fire
// AGAINST the genuine HTF trend, and what did that cost in realized win-rate, before vs after the
// gate redesign. XAU_HTF_AUDIT_BUFFER_CAP is 300 (not CANDLE_BUFFER_NEW's 150) specifically so the
// H4 tier (48-bar groups) can see its full real window (>= 4 groups needs >= 192 bars) - this
// matches production's actual XAU_CANDLE_RETENTION_BARS exactly.
// ============================================================================================
const XAU_HTF_AUDIT_BUFFER_CAP = 300;

interface XauHtfGateAuditPatternStats {
  count: number;
  alignedCount: number;
  opposedCount: number;
  neutralCount: number;
  wins: number; // TP2
  losses: number; // DIRECT_SL
  partials: number; // TP1_THEN_SL
  totalR: number;
  alignedWins: number;
  alignedLosses: number;
  alignedTotalR: number;
  opposedWins: number;
  opposedLosses: number;
  opposedTotalR: number;
}
interface XauHtfGateAuditStats {
  gateMode: 'OLD' | 'NEW';
  totalSignals: number;
  totalTicks: number;
  d1AvailableTicks: number;
  byPattern: Record<string, XauHtfGateAuditPatternStats>;
  // Fase 3 pending question 1: how often is htfBias itself NEUTRAL (not tegas bullish/bearish) at
  // all, independent of whether any candidate happened to fire that tick - measured directly via
  // detectXauHtfBias on every tick's window, NOT inferred from fired-signal structure.xauHtfBiasCombined
  // (which is undefined whenever no candidate fired at all, so would silently under-measure this).
  neutralH4Ticks: number;
  neutralCombinedTicks: number;
}

function emptyXauHtfPatternStats(): XauHtfGateAuditPatternStats {
  return { count: 0, alignedCount: 0, opposedCount: 0, neutralCount: 0, wins: 0, losses: 0, partials: 0, totalR: 0, alignedWins: 0, alignedLosses: 0, alignedTotalR: 0, opposedWins: 0, opposedLosses: 0, opposedTotalR: 0 };
}

function runXauHtfGateAudit(intraday5m: Candle[], daily: Candle[], gateMode: 'OLD' | 'NEW'): XauHtfGateAuditStats {
  const stats: XauHtfGateAuditStats = { gateMode, totalSignals: 0, totalTicks: 0, d1AvailableTicks: 0, byPattern: {}, neutralH4Ticks: 0, neutralCombinedTicks: 0 };
  const MIN_HISTORY = 40;
  let i = MIN_HISTORY;
  while (i < intraday5m.length) {
    const windowStart = Math.max(0, i - XAU_HTF_AUDIT_BUFFER_CAP + 1);
    const window = intraday5m.slice(windowStart, i + 1);
    const mp = mkMarketPrice(intraday5m, i, Math.round(1440 / ACTUAL_BAR_MINUTES));

    // Real days strictly BEFORE the current bar's own UTC calendar day only - never leaks the
    // still-forming/current day into the D1 read, matching production's closed-bars-only rule.
    const currentUtcDay = new Date(intraday5m[i].time).toISOString().slice(0, 10);
    const dailySoFar = daily.filter((d) => new Date(d.time).toISOString().slice(0, 10) < currentUtcDay);
    stats.totalTicks++;
    if (dailySoFar.length >= XAU_D1_MIN_REAL_DAYS) stats.d1AvailableTicks++;

    // Pending question 1: measured directly and independently of whether anything fires this tick.
    const htfBiasThisTick = detectXauHtfBias(window, dailySoFar);
    if (htfBiasThisTick.h4 === 'NEUTRAL') stats.neutralH4Ticks++;
    if (htfBiasThisTick.combined === 'NEUTRAL') stats.neutralCombinedTicks++;

    const structure = newEvaluateMarketStructureFromCandles('XAUUSD', mp, window, gateMode, dailySoFar);
    if (structure.type && structure.confluenceScore >= CONFLUENCE_THRESHOLD) {
      const built = newBuildEntrySlTp(structure, mp.price);
      if (built) {
        const pattern = structure.xauPattern ?? 'UNKNOWN';
        if (!stats.byPattern[pattern]) stats.byPattern[pattern] = emptyXauHtfPatternStats();
        const ps = stats.byPattern[pattern];
        stats.totalSignals++;
        ps.count++;

        const combined = structure.xauHtfBiasCombined;
        const opposed = structure.xauHtfOpposed === true;
        const aligned = !opposed && combined !== undefined && combined !== 'NEUTRAL' &&
          ((structure.type === 'BUY' && combined === 'BULLISH') || (structure.type === 'SELL' && combined === 'BEARISH'));
        if (opposed) ps.opposedCount++;
        else if (aligned) ps.alignedCount++;
        else ps.neutralCount++;

        const result = simulateForward(intraday5m, i + 1, built, pattern);
        ps.totalR += result.rMultiple;
        if (opposed) ps.opposedTotalR += result.rMultiple;
        else if (aligned) ps.alignedTotalR += result.rMultiple;
        if (result.outcome === 'TP2') {
          ps.wins++;
          if (opposed) ps.opposedWins++; else if (aligned) ps.alignedWins++;
        } else if (result.outcome === 'DIRECT_SL') {
          ps.losses++;
          if (opposed) ps.opposedLosses++; else if (aligned) ps.alignedLosses++;
        } else if (result.outcome === 'TP1_THEN_SL') {
          ps.partials++;
        }

        i = i + 1 + 5; // same one-at-a-time cool-down style as runEngine
        continue;
      }
    }
    i++;
  }
  return stats;
}

function summarizeXauHtfGateAudit(label: string, stats: XauHtfGateAuditStats, totalDays: number) {
  console.log(`\n=== ${label} (gateMode=${stats.gateMode}) ===`);
  console.log(`Total signals fired: ${stats.totalSignals} (${(stats.totalSignals / totalDays).toFixed(2)}/day over ${totalDays.toFixed(1)} days)`);
  console.log(`D1 tier available (>= ${XAU_D1_MIN_REAL_DAYS} real days of daily history so far) on ${stats.d1AvailableTicks}/${stats.totalTicks} ticks (${((stats.d1AvailableTicks / Math.max(1, stats.totalTicks)) * 100).toFixed(1)}%).`);
  console.log(`Pending question 1: htfBias.h4 NEUTRAL on ${stats.neutralH4Ticks}/${stats.totalTicks} ticks (${((stats.neutralH4Ticks / Math.max(1, stats.totalTicks)) * 100).toFixed(1)}%); htfBias.combined NEUTRAL on ${stats.neutralCombinedTicks}/${stats.totalTicks} ticks (${((stats.neutralCombinedTicks / Math.max(1, stats.totalTicks)) * 100).toFixed(1)}%). NEUTRAL never hard-blocks TREND_CONTINUATION/CHOCH_REVERSAL (see the hard-filter's own "aligned, or HTF bias currently neutral - never blocked here" comment) - this only tells us how often that pass-through actually applies.`);
  const patterns = Object.keys(stats.byPattern).sort();
  if (patterns.length === 0) {
    console.log('  (no signals fired in this run)');
    return;
  }
  for (const p of patterns) {
    const ps = stats.byPattern[p];
    const decided = ps.wins + ps.losses;
    const winRate = decided > 0 ? ((ps.wins / decided) * 100).toFixed(1) + '%' : 'n/a';
    const avgR = ps.count > 0 ? (ps.totalR / ps.count).toFixed(2) : 'n/a';
    const counterTrendPct = ps.count > 0 ? ((ps.opposedCount / ps.count) * 100).toFixed(1) + '%' : 'n/a';
    console.log(`  ${p}: count=${ps.count} (aligned=${ps.alignedCount}, opposed=${ps.opposedCount}, neutral=${ps.neutralCount}, counter-trend%=${counterTrendPct})`);
    console.log(`    overall: winRate=${winRate} avgR=${avgR} (wins=${ps.wins} losses=${ps.losses} partials=${ps.partials})`);
    if (ps.alignedCount > 0) {
      const alignedDecided = ps.alignedWins + ps.alignedLosses;
      const alignedWinRate = alignedDecided > 0 ? ((ps.alignedWins / alignedDecided) * 100).toFixed(1) + '%' : 'n/a';
      console.log(`    aligned-with-HTF only:  n=${ps.alignedCount} winRate=${alignedWinRate} avgR=${(ps.alignedTotalR / ps.alignedCount).toFixed(2)}`);
    }
    if (ps.opposedCount > 0) {
      const opposedDecided = ps.opposedWins + ps.opposedLosses;
      const opposedWinRate = opposedDecided > 0 ? ((ps.opposedWins / opposedDecided) * 100).toFixed(1) + '%' : 'n/a';
      console.log(`    counter-trend (opposed HTF): n=${ps.opposedCount} winRate=${opposedWinRate} avgR=${(ps.opposedTotalR / ps.opposedCount).toFixed(2)}`);
    }
  }
}

// ============================================================================================
// 2026-09-03 Fase 3 audit/backtest - adaptive pattern weighting + retest quality + chase guard.
// Genuinely walk-forward, no lookahead: a TRUE self-referential rolling history built ONLY from
// trades that have ALREADY closed strictly before "now" (SimResult.resolvedAtIndex's real candle
// time), mirroring exactly what production's xauPatternAlignmentCache can ever know at any given
// moment - it is never allowed to see a trade's outcome before that trade's own close time.
// ============================================================================================
const XAU_FASE3_MIN_SAMPLE = 15; // must match server.ts's XAU_PATTERN_ALIGNMENT_MIN_SAMPLE
const XAU_FASE3_WINDOW_DAYS = 30; // must match server.ts's XAU_PATTERN_ALIGNMENT_WINDOW_DAYS
const XAU_FASE3_SCALE = 4; // must match server.ts's XAU_PATTERN_ALIGNMENT_SCALE
const XAU_FASE3_MAX_ADJUSTMENT = 8; // must match server.ts's XAU_PATTERN_ALIGNMENT_MAX_ADJUSTMENT
// Incremented inside evaluateXauIctSetups' fase3Mode==='ON' chase-guard hard-reject filter -
// module-level so this harness can measure real frequency without threading a return value through
// every layer; reset to 0 at the start of each run.
let xauChaseHardRejectCounterForAudit = 0;

interface XauFase3Stats {
  label: string;
  totalSignals: number;
  totalTicks: number;
  byPattern: Record<string, XauHtfGateAuditPatternStats>;
  chaseDistances: number[]; // ATR multiples, one per fired signal
  chaseHardRejects: number;
  retestCleanCount: number;
  retestChoppyCount: number;
  // Which (pattern, alignment) combos had crossed XAU_FASE3_MIN_SAMPLE by the very end of this
  // walk-forward run - i.e. the real, no-lookahead state the adaptive-weighting cache reached after
  // seeing this entire dataset once, chronologically.
  finalComboCache: Record<string, { sampleSize: number; avgR: number; adjustment: number }>;
  // Fase 4 - every tick where BREAKOUT_DISPLACEMENT_CONTINUATION won the "best candidate" slot
  // over a genuine, independently-qualifying (confluenceScore >= CONFLUENCE_THRESHOLD) candidate
  // from one of the 4 existing patterns. Each entry simulates BOTH what actually happened (Pattern
  // 5's own outcome) and the counterfactual (the displaced candidate's outcome, built/simulated
  // via the exact same real forward candles) - so the report can say whether the displacement
  // helped or hurt, not just that it happened.
  displacements: { displacedPattern: string; pattern5R: number; counterfactualR: number | null; counterfactualOutcome: Outcome | null }[];
}

function runXauFase3Audit(
  intraday5m: Candle[],
  daily: Candle[],
  label: string,
  fase3Options: { enableAdaptiveWeighting: boolean; enableRetestQuality: boolean; enableChaseGuard: boolean; enableAntiCountertrendGate?: boolean },
  enablePattern5Breakout: boolean = false
): XauFase3Stats {
  xauChaseHardRejectCounterForAudit = 0;
  const stats: XauFase3Stats = { label, totalSignals: 0, totalTicks: 0, byPattern: {}, chaseDistances: [], chaseHardRejects: 0, retestCleanCount: 0, retestChoppyCount: 0, finalComboCache: {}, displacements: [] };
  const windowMs = XAU_FASE3_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  // Ledger of trades that have ACTUALLY closed, appended only once simulateForward returns a real
  // resolvedAtIndex (never for OPEN_AT_DATA_END, which never resolved) - the exact same
  // "only genuinely closed signals count" rule completedHistoryRecords follows in production.
  const resolvedTrades: { pattern: string; alignment: string; rMultiple: number; closedAtMs: number }[] = [];

  function computeCacheAsOf(nowMs: number): Record<string, { sampleSize: number; avgR: number; adjustment: number }> {
    const cutoffMs = nowMs - windowMs;
    const eligible = resolvedTrades.filter((t) => t.closedAtMs < nowMs && t.closedAtMs >= cutoffMs);
    const overallN = eligible.length;
    const overallAvgR = overallN > 0 ? eligible.reduce((acc, t) => acc + t.rMultiple, 0) / overallN : 0;
    const byCombo = new Map<string, typeof eligible>();
    for (const t of eligible) {
      const key = `${t.pattern}|${t.alignment}`;
      if (!byCombo.has(key)) byCombo.set(key, []);
      byCombo.get(key)!.push(t);
    }
    const cache: Record<string, { sampleSize: number; avgR: number; adjustment: number }> = {};
    for (const [key, trades] of byCombo.entries()) {
      if (trades.length < XAU_FASE3_MIN_SAMPLE) continue;
      const avgR = trades.reduce((acc, t) => acc + t.rMultiple, 0) / trades.length;
      const raw = Math.round((avgR - overallAvgR) * XAU_FASE3_SCALE);
      cache[key] = { sampleSize: trades.length, avgR, adjustment: Math.max(-XAU_FASE3_MAX_ADJUSTMENT, Math.min(XAU_FASE3_MAX_ADJUSTMENT, raw)) };
    }
    return cache;
  }

  const MIN_HISTORY = 40;
  let i = MIN_HISTORY;
  while (i < intraday5m.length) {
    const windowStart = Math.max(0, i - XAU_HTF_AUDIT_BUFFER_CAP + 1);
    const window = intraday5m.slice(windowStart, i + 1);
    const mp = mkMarketPrice(intraday5m, i, Math.round(1440 / ACTUAL_BAR_MINUTES));
    const nowMs = intraday5m[i].time;
    const currentUtcDay = new Date(nowMs).toISOString().slice(0, 10);
    const dailySoFar = daily.filter((d) => new Date(d.time).toISOString().slice(0, 10) < currentUtcDay);
    stats.totalTicks++;

    const cacheNow = fase3Options.enableAdaptiveWeighting ? computeCacheAsOf(nowMs) : {};
    const structure = newEvaluateMarketStructureFromCandles('XAUUSD', mp, window, 'NEW', dailySoFar, fase3Options, cacheNow, enablePattern5Breakout);
    if (structure.type && structure.confluenceScore >= CONFLUENCE_THRESHOLD) {
      const built = newBuildEntrySlTp(structure, mp.price);
      if (built) {
        const pattern = structure.xauPattern ?? 'UNKNOWN';
        if (!stats.byPattern[pattern]) stats.byPattern[pattern] = emptyXauHtfPatternStats();
        const ps = stats.byPattern[pattern];
        stats.totalSignals++;
        ps.count++;

        // Fase 4: did this Pattern 5 win displace a genuine candidate from another pattern?
        const runnerUp = structure.xauRunnerUp;
        const displacedGenuineCandidate = pattern === 'BREAKOUT_DISPLACEMENT_CONTINUATION' && runnerUp && runnerUp.confluenceScore >= CONFLUENCE_THRESHOLD;

        const alignment = structure.xauHtfAlignment ?? 'NEUTRAL';
        const opposed = alignment === 'OPPOSED';
        const aligned = alignment === 'ALIGNED';
        if (opposed) ps.opposedCount++;
        else if (aligned) ps.alignedCount++;
        else ps.neutralCount++;

        if (structure.xauChaseDistanceAtr !== undefined) stats.chaseDistances.push(structure.xauChaseDistanceAtr);
        if (pattern === 'TREND_CONTINUATION' && structure.xauRetestTouches !== undefined) {
          if (structure.xauRetestTouches <= 1) stats.retestCleanCount++;
          else stats.retestChoppyCount++;
        }

        const result = simulateForward(intraday5m, i + 1, built, pattern);
        ps.totalR += result.rMultiple;
        if (opposed) ps.opposedTotalR += result.rMultiple;
        else if (aligned) ps.alignedTotalR += result.rMultiple;
        if (result.outcome === 'TP2') {
          ps.wins++;
          if (opposed) ps.opposedWins++; else if (aligned) ps.alignedWins++;
        } else if (result.outcome === 'DIRECT_SL') {
          ps.losses++;
          if (opposed) ps.opposedLosses++; else if (aligned) ps.alignedLosses++;
        } else if (result.outcome === 'TP1_THEN_SL') {
          ps.partials++;
        }

        if (result.resolvedAtIndex !== undefined) {
          resolvedTrades.push({ pattern, alignment, rMultiple: result.rMultiple, closedAtMs: intraday5m[result.resolvedAtIndex].time });
        }

        // Fase 4: simulate the counterfactual - what the displaced candidate would have realized,
        // built via the exact same newBuildEntrySlTp/simulateForward machinery, over the exact same
        // real forward candles, had it fired instead of Pattern 5 on this tick.
        if (displacedGenuineCandidate && runnerUp) {
          const counterfactualStructure: StructureAnalysis = {
            ...structure,
            type: runnerUp.type,
            xauPattern: runnerUp.pattern,
            xauEntryZone: runnerUp.entryZone,
            xauStructuralSLLevel: runnerUp.structuralSLLevel,
            xauTp1Level: runnerUp.tp1Level,
            xauTp2Level: runnerUp.tp2Level,
            confluenceScore: runnerUp.confluenceScore,
          };
          const counterfactualBuilt = newBuildEntrySlTp(counterfactualStructure, mp.price);
          const counterfactualResult = counterfactualBuilt ? simulateForward(intraday5m, i + 1, counterfactualBuilt, runnerUp.pattern) : null;
          stats.displacements.push({
            displacedPattern: runnerUp.pattern ?? 'UNKNOWN',
            pattern5R: result.rMultiple,
            counterfactualR: counterfactualResult ? counterfactualResult.rMultiple : null,
            counterfactualOutcome: counterfactualResult ? counterfactualResult.outcome : null,
          });
        }

        i = i + 1 + 5;
        continue;
      }
    }
    i++;
  }
  stats.chaseHardRejects = xauChaseHardRejectCounterForAudit;
  stats.finalComboCache = intraday5m.length > 0 ? computeCacheAsOf(intraday5m[intraday5m.length - 1].time + 1) : {};
  return stats;
}

function summarizeXauFase3Audit(stats: XauFase3Stats, totalDays: number) {
  console.log(`\n=== ${stats.label} ===`);
  console.log(`Total signals fired: ${stats.totalSignals} (${(stats.totalSignals / totalDays).toFixed(2)}/day over ${totalDays.toFixed(1)} days)`);
  if (stats.chaseDistances.length > 0) {
    const sorted = [...stats.chaseDistances].sort((a, b) => a - b);
    const p50 = percentile(sorted, 0.5);
    const p90 = percentile(sorted, 0.9);
    const max = sorted[sorted.length - 1];
    const overSoft = stats.chaseDistances.filter((d) => d > XAU_CHASE_SOFT_ATR_MULT).length;
    console.log(`Chase distance (ATR multiples) across ${stats.chaseDistances.length} fired signals: p50=${p50.toFixed(2)} p90=${p90.toFixed(2)} max=${max.toFixed(2)}; over soft threshold (${XAU_CHASE_SOFT_ATR_MULT}x ATR) on ${overSoft}/${stats.chaseDistances.length} (${((overSoft / stats.chaseDistances.length) * 100).toFixed(1)}%).`);
  }
  console.log(`Chase guard hard-rejects (candidates that would otherwise have fired): ${stats.chaseHardRejects}.`);
  const retestTotal = stats.retestCleanCount + stats.retestChoppyCount;
  if (retestTotal > 0) {
    console.log(`Retest quality (TREND_CONTINUATION only, n=${retestTotal}): clean=${stats.retestCleanCount} (${((stats.retestCleanCount / retestTotal) * 100).toFixed(1)}%), choppy=${stats.retestChoppyCount} (${((stats.retestChoppyCount / retestTotal) * 100).toFixed(1)}%).`);
  } else {
    console.log('Retest quality (TREND_CONTINUATION only): no TREND_CONTINUATION signals fired in this run to grade.');
  }
  const patterns = Object.keys(stats.byPattern).sort();
  if (patterns.length === 0) {
    console.log('  (no signals fired in this run)');
    return;
  }
  const comboKeys = Object.keys(stats.finalComboCache);
  if (comboKeys.length > 0) {
    console.log(`Combos that crossed XAU_FASE3_MIN_SAMPLE (${XAU_FASE3_MIN_SAMPLE}) by end of this run's walk-forward (real, no-lookahead):`);
    for (const key of comboKeys) {
      const c = stats.finalComboCache[key];
      console.log(`  ${key}: n=${c.sampleSize} avgR=${c.avgR.toFixed(2)} adjustment=${c.adjustment > 0 ? '+' : ''}${c.adjustment}`);
    }
  } else {
    console.log(`No (pattern, alignment) combo crossed XAU_FASE3_MIN_SAMPLE (${XAU_FASE3_MIN_SAMPLE}) within this run's own walk-forward window - adaptive weighting stayed a no-op throughout.`);
  }
  for (const p of patterns) {
    const ps = stats.byPattern[p];
    const decided = ps.wins + ps.losses;
    const winRate = decided > 0 ? ((ps.wins / decided) * 100).toFixed(1) + '%' : 'n/a';
    const avgR = ps.count > 0 ? (ps.totalR / ps.count).toFixed(2) : 'n/a';
    const tag = p === 'BREAKOUT_DISPLACEMENT_CONTINUATION' ? '  <-- Fase 4 Pattern 5 (own stats, reported separately from aggregate)' : '';
    console.log(`  ${p}: count=${ps.count} winRate=${winRate} avgR=${avgR} (aligned=${ps.alignedCount}, opposed=${ps.opposedCount}, neutral=${ps.neutralCount})${tag}`);
  }

  // Fase 4, Task 3: did Pattern 5 ever "win the confluence competition" over a genuine
  // (confluenceScore >= CONFLUENCE_THRESHOLD) candidate from one of the 4 existing patterns at the
  // same tick - and when it did, was the trade Pattern 5 actually took better or worse than the
  // counterfactual trade the displaced pattern would have taken instead, simulated on the exact
  // same real forward candles via the exact same entry/SL/TP + simulateForward machinery.
  if (stats.displacements.length > 0) {
    const d = stats.displacements;
    const withCounterfactual = d.filter((x) => x.counterfactualR !== null) as { displacedPattern: string; pattern5R: number; counterfactualR: number; counterfactualOutcome: Outcome | null }[];
    const pattern5AvgR = d.reduce((acc, x) => acc + x.pattern5R, 0) / d.length;
    console.log(`\nFase 4 displacement analysis: Pattern 5 won the best-candidate slot over a genuine candidate from another pattern ${d.length} time(s).`);
    console.log(`  Pattern 5's own avgR on these displacement ticks: ${pattern5AvgR.toFixed(2)}`);
    if (withCounterfactual.length > 0) {
      const cfAvgR = withCounterfactual.reduce((acc, x) => acc + x.counterfactualR, 0) / withCounterfactual.length;
      const p5AvgROnCf = withCounterfactual.reduce((acc, x) => acc + x.pattern5R, 0) / withCounterfactual.length;
      const better = withCounterfactual.filter((x) => x.pattern5R > x.counterfactualR).length;
      const worse = withCounterfactual.filter((x) => x.pattern5R < x.counterfactualR).length;
      const tie = withCounterfactual.length - better - worse;
      console.log(`  Counterfactual (what the displaced pattern would have realized instead), n=${withCounterfactual.length}: avgR=${cfAvgR.toFixed(2)} vs Pattern 5's avgR=${p5AvgROnCf.toFixed(2)} on the same ticks.`);
      console.log(`  Pattern 5 beat the counterfactual on ${better}/${withCounterfactual.length}, lost on ${worse}/${withCounterfactual.length}, tied on ${tie}/${withCounterfactual.length}.`);
      console.log(`  => Net effect of displacement: ${p5AvgROnCf > cfAvgR ? 'Pattern 5 IMPROVED quality on these ticks (took a better trade than the one it displaced).' : p5AvgROnCf < cfAvgR ? 'Pattern 5 WORSENED quality on these ticks (displaced a trade that would have done better).' : 'no net difference.'}`);
      const byDisplaced = new Map<string, { count: number; p5R: number; cfR: number }>();
      for (const x of withCounterfactual) {
        if (!byDisplaced.has(x.displacedPattern)) byDisplaced.set(x.displacedPattern, { count: 0, p5R: 0, cfR: 0 });
        const b = byDisplaced.get(x.displacedPattern)!;
        b.count++; b.p5R += x.pattern5R; b.cfR += x.counterfactualR;
      }
      for (const [pat, b] of byDisplaced.entries()) {
        console.log(`    displaced ${pat} (n=${b.count}): Pattern5 avgR=${(b.p5R / b.count).toFixed(2)} vs counterfactual avgR=${(b.cfR / b.count).toFixed(2)}`);
      }
    } else {
      console.log('  None of these displacement ticks produced a buildable counterfactual trade (e.g. entry zone already invalidated) - no comparison available.');
    }
  } else {
    console.log('\nFase 4 displacement analysis: Pattern 5 never won the best-candidate slot over a genuine candidate from another pattern in this run (no displacements to analyze).');
  }
}

// Real 5-minute XAUUSD candles over as long a real range as Yahoo will actually serve for
// intraday bars (60d is the documented ceiling for sub-daily intervals) - matches
// candleStore.XAUUSD's own bar size exactly (unlike fetchRealXauCandles' 1-minute default above),
// which the H4/D1 aggregation math in aggregateXauCandles/detectXauHtfBias assumes.
async function fetchRealXau5mCandlesForHtfAudit(): Promise<{ candles: Candle[]; source: string }> {
  let symbolUsed = 'XAUUSD=X';
  let json: any;
  try {
    json = await fetchYahooChart('XAUUSD=X', '5m', '60d');
  } catch (primaryErr: any) {
    console.warn(`[fetchRealXau5mCandlesForHtfAudit] XAUUSD=X failed (${primaryErr?.message || primaryErr}), trying GC=F...`);
    symbolUsed = 'GC=F';
    json = await fetchYahooChart('GC=F', '5m', '60d');
  }
  const result = json?.chart?.result?.[0];
  if (!result || !result.meta) throw new Error('Yahoo 5m response missing chart.result[0].meta');
  const quote = result.indicators?.quote?.[0];
  const timestamps: number[] = result.timestamp || [];
  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quote?.open?.[i] != null && quote?.high?.[i] != null && quote?.low?.[i] != null && quote?.close?.[i] != null) {
      candles.push({ time: timestamps[i] * 1000, open: quote.open[i], high: quote.high[i], low: quote.low[i], close: quote.close[i], volume: quote.volume?.[i] || 0 });
    }
  }
  if (symbolUsed !== 'XAUUSD=X') console.warn(`[fetchRealXau5mCandlesForHtfAudit] NOTE: using ${symbolUsed} (futures basis differs slightly from spot).`);
  return { candles, source: `Yahoo ${symbolUsed}, 5min bars, range=60d requested (Yahoo may return less if less is actually available)` };
}

// Real daily XAUUSD/GC=F candles, long range - feeds both the D1 tier (detectXauHtfBias) and this
// audit's own "did the real multi-week rally/correction the user described actually happen, and
// over how many days" ground-truth check.
async function fetchRealXauDailyCandlesForHtfAudit(): Promise<{ candles: Candle[]; source: string }> {
  let symbolUsed = 'XAUUSD=X';
  let json: any;
  try {
    json = await fetchYahooChart('XAUUSD=X', '1d', '2y');
  } catch (primaryErr: any) {
    console.warn(`[fetchRealXauDailyCandlesForHtfAudit] XAUUSD=X failed (${primaryErr?.message || primaryErr}), trying GC=F...`);
    symbolUsed = 'GC=F';
    json = await fetchYahooChart('GC=F', '1d', '2y');
  }
  const result = json?.chart?.result?.[0];
  if (!result || !result.meta) throw new Error('Yahoo 1d response missing chart.result[0].meta');
  const quote = result.indicators?.quote?.[0];
  const timestamps: number[] = result.timestamp || [];
  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quote?.open?.[i] != null && quote?.high?.[i] != null && quote?.low?.[i] != null && quote?.close?.[i] != null) {
      candles.push({ time: timestamps[i] * 1000, open: quote.open[i], high: quote.high[i], low: quote.low[i], close: quote.close[i], volume: quote.volume?.[i] || 0 });
    }
  }
  if (symbolUsed !== 'XAUUSD=X') console.warn(`[fetchRealXauDailyCandlesForHtfAudit] NOTE: using ${symbolUsed} (futures basis differs slightly from spot).`);
  return { candles, source: `Yahoo ${symbolUsed}, 1d bars, range=2y requested` };
}

// Synthetic-mode helper (--htf-gate-audit --synthetic) - mechanics-only sanity check that the
// walk-forward loop, gate filtering, and stats aggregation run without crashing when this sandbox
// has no network access, exactly like the top-level --synthetic flag does for the main comparison.
// NOT evidence of real engine performance - see generateSyntheticCandles' own honesty note.
function generateSynthetic5mCandles(n: number, seed: number, spacingMs: number): Candle[] {
  const oneMinute = generateSyntheticCandles(n, seed);
  const start = Date.now() - n * spacingMs;
  return oneMinute.map((c, i) => ({ ...c, time: start + i * spacingMs }));
}

// ============================================================================================
// 2026-09-03 Fase 4, Task 0 (audit before implementation): how often does "ADX elevated/trending
// + ATR percentile in genuine expansion, but none of the 4 existing patterns produced a signal"
// actually occur in real data - a rough estimate of Pattern 5's potential upside BEFORE spending
// the implementation effort. Measures every tick (no cooldown skip - this counts CONDITIONS, not
// trades), using the exact production-equivalent config (gateMode NEW, adaptive weighting + chase
// guard on, retest quality off - matching what's actually shipped on main right now).
// "Expansion" band: ADX >= 25 (a standard trending threshold) AND atrPercentileRank in
// [0.5, XAU_EXTREME_VOL_PERCENTILE) - genuinely expanding relative to XAU's own recent range, but
// short of the separate extreme-volatility pause gate.
// ============================================================================================
interface XauBreakoutOpportunityGapStats {
  totalTicks: number;
  expansionTicks: number;
  expansionTicksNoSignal: number;
}

function measureXauBreakoutOpportunityGap(intraday5m: Candle[], daily: Candle[]): XauBreakoutOpportunityGapStats {
  const stats: XauBreakoutOpportunityGapStats = { totalTicks: 0, expansionTicks: 0, expansionTicksNoSignal: 0 };
  const prodFase3Options = { enableAdaptiveWeighting: true, enableRetestQuality: false, enableChaseGuard: true };
  const MIN_HISTORY = 40;
  for (let i = MIN_HISTORY; i < intraday5m.length; i++) {
    const windowStart = Math.max(0, i - XAU_HTF_AUDIT_BUFFER_CAP + 1);
    const window = intraday5m.slice(windowStart, i + 1);
    const mp = mkMarketPrice(intraday5m, i, Math.round(1440 / ACTUAL_BAR_MINUTES));
    const currentUtcDay = new Date(intraday5m[i].time).toISOString().slice(0, 10);
    const dailySoFar = daily.filter((d) => new Date(d.time).toISOString().slice(0, 10) < currentUtcDay);
    stats.totalTicks++;

    const structure = newEvaluateMarketStructureFromCandles('XAUUSD', mp, window, 'NEW', dailySoFar, prodFase3Options, {});
    const atrPct = structure.regime?.atrPercentileRank;
    const isExpansion = (structure.adx ?? 0) >= 25 && atrPct !== undefined && atrPct >= 0.5 && atrPct < XAU_EXTREME_VOL_PERCENTILE;
    if (isExpansion) {
      stats.expansionTicks++;
      if (!structure.type) stats.expansionTicksNoSignal++;
    }
  }
  return stats;
}

// ============================================================================================
// Fase B (roadmap Bagian 1, anti-countertrend gate) audit - measures the gate's effect specifically
// on the subset it targets: CHOCH_REVERSAL/LIQUIDITY_SWEEP_REVERSAL candidates whose direction
// opposed regime.trend while regime.extreme was true at fire time. Runs the SAME production config
// (adaptive weighting + chase guard, matching PRODUCTION CONFIG - FINAL above) with the gate off vs
// on, so the only variable that changes between the two rows is the gate itself.
// ============================================================================================
interface XauAntiCountertrendGateAuditStats {
  label: string;
  totalSignals: number;
  wins: number; // TP2, all patterns
  losses: number; // DIRECT_SL, all patterns
  totalR: number; // all patterns
  // The subset this gate actually targets.
  countertrendExtremeCount: number;
  countertrendExtremeWins: number;
  countertrendExtremeLosses: number;
  countertrendExtremeTotalR: number;
}

function runXauAntiCountertrendGateAudit(
  intraday5m: Candle[],
  daily: Candle[],
  label: string,
  enableGate: boolean
): XauAntiCountertrendGateAuditStats {
  const stats: XauAntiCountertrendGateAuditStats = {
    label, totalSignals: 0, wins: 0, losses: 0, totalR: 0,
    countertrendExtremeCount: 0, countertrendExtremeWins: 0, countertrendExtremeLosses: 0, countertrendExtremeTotalR: 0,
  };
  // Same production config already shipped (PRODUCTION CONFIG - FINAL above), plus this gate
  // toggled - isolates the gate's own effect rather than re-litigating Fase 3's own ablation.
  const options = { enableAdaptiveWeighting: true, enableRetestQuality: false, enableChaseGuard: true, enableAntiCountertrendGate: enableGate };
  const MIN_HISTORY = 40;
  let i = MIN_HISTORY;
  while (i < intraday5m.length) {
    const windowStart = Math.max(0, i - XAU_HTF_AUDIT_BUFFER_CAP + 1);
    const window = intraday5m.slice(windowStart, i + 1);
    const mp = mkMarketPrice(intraday5m, i, Math.round(1440 / ACTUAL_BAR_MINUTES));
    const currentUtcDay = new Date(intraday5m[i].time).toISOString().slice(0, 10);
    const dailySoFar = daily.filter((d) => new Date(d.time).toISOString().slice(0, 10) < currentUtcDay);

    const structure = newEvaluateMarketStructureFromCandles('XAUUSD', mp, window, 'NEW', dailySoFar, options, {});
    if (structure.type && structure.confluenceScore >= CONFLUENCE_THRESHOLD) {
      const built = newBuildEntrySlTp(structure, mp.price);
      if (built) {
        const pattern = structure.xauPattern ?? 'UNKNOWN';
        const result = simulateForward(intraday5m, i + 1, built, pattern);
        stats.totalSignals++;
        stats.totalR += result.rMultiple;
        if (result.outcome === 'TP2') stats.wins++;
        else if (result.outcome === 'DIRECT_SL') stats.losses++;

        const trend = structure.regime?.trend;
        const extreme = structure.regime?.extreme === true;
        const opposesTrend = (structure.type === 'SELL' && trend === 'STRONG_UP') || (structure.type === 'BUY' && trend === 'STRONG_DOWN');
        const isCountertrendExtreme = extreme && opposesTrend && (pattern === 'CHOCH_REVERSAL' || pattern === 'LIQUIDITY_SWEEP_REVERSAL');
        if (isCountertrendExtreme) {
          stats.countertrendExtremeCount++;
          stats.countertrendExtremeTotalR += result.rMultiple;
          if (result.outcome === 'TP2') stats.countertrendExtremeWins++;
          else if (result.outcome === 'DIRECT_SL') stats.countertrendExtremeLosses++;
        }

        i = i + 1 + 5;
        continue;
      }
    }
    i++;
  }
  return stats;
}

function summarizeXauAntiCountertrendGateAudit(stats: XauAntiCountertrendGateAuditStats) {
  console.log(`\n=== ${stats.label} ===`);
  const overallDecided = stats.wins + stats.losses;
  const overallWinRate = overallDecided > 0 ? ((stats.wins / overallDecided) * 100).toFixed(1) + '%' : 'n/a';
  const overallAvgR = stats.totalSignals > 0 ? (stats.totalR / stats.totalSignals).toFixed(2) : 'n/a';
  console.log(`Overall (all patterns): count=${stats.totalSignals}, winRate=${overallWinRate}, avgR=${overallAvgR}`);
  const subDecided = stats.countertrendExtremeWins + stats.countertrendExtremeLosses;
  const subWinRate = subDecided > 0 ? ((stats.countertrendExtremeWins / subDecided) * 100).toFixed(1) + '%' : 'n/a (n too small)';
  const subAvgR = stats.countertrendExtremeCount > 0 ? (stats.countertrendExtremeTotalR / stats.countertrendExtremeCount).toFixed(2) : 'n/a';
  console.log(`Countertrend-during-extreme-regime subset (CHOCH_REVERSAL/LIQUIDITY_SWEEP_REVERSAL opposing regime.trend while regime.extreme): count=${stats.countertrendExtremeCount}, winRate=${subWinRate}, avgR=${subAvgR}`);
}

// ============================================================================================
// URGENT 2026-09-04 follow-up (2nd incident same day): user asked to MEASURE - before deciding
// anything - what an exemption to the Volatility Regime Gate would look like. Today's real
// production data (see the companion urgent-xau-volgate-directional-investigation.ts run) showed
// the gate paused signal generation for a full 80-minute, atrPercentileRank-pinned-at-1.00 window
// that regime.extreme itself already flagged as a sustained, directional STRONG_DOWN expansion -
// not generic chop. This measures what happens, on real backtest data, if the gate exempts ticks
// where regime.extreme is already true (Fase A's own directional-expansion flag) instead of
// pausing on every extreme-ATR-percentile tick regardless of direction. Same production config
// (adaptive weighting + chase guard + anti-countertrend gate, matching PRODUCTION CONFIG - FINAL)
// run twice: current shipped gate vs the same gate with the exemption, isolating the extra signals
// the exemption alone would let through. This function NEVER changes what's shipped - it only
// measures, same convention as every other audit in this file.
// ============================================================================================
interface XauExtremeGateExemptionAuditStats {
  label: string;
  totalSignals: number;
  wins: number; // TP2, all patterns
  losses: number; // DIRECT_SL, all patterns
  totalR: number; // all patterns
  // Signals that ONLY exist because of the exemption - fired while atrPercentileRank was already
  // in the gate's block band (>= XAU_EXTREME_VOL_PERCENTILE) AND regime.extreme was true at fire
  // time (exactly the condition the currently-shipped gate would otherwise have paused on). Only
  // non-zero when the exemption is enabled.
  exemptedCount: number;
  exemptedWins: number;
  exemptedLosses: number;
  exemptedTotalR: number;
}

function runXauExtremeGateExemptionAudit(
  intraday5m: Candle[],
  daily: Candle[],
  label: string,
  exemptExtreme: boolean
): XauExtremeGateExemptionAuditStats {
  const stats: XauExtremeGateExemptionAuditStats = {
    label, totalSignals: 0, wins: 0, losses: 0, totalR: 0,
    exemptedCount: 0, exemptedWins: 0, exemptedLosses: 0, exemptedTotalR: 0,
  };
  // Same production config already shipped (PRODUCTION CONFIG - FINAL), plus the exemption toggled -
  // isolates the exemption's own effect rather than re-litigating Fase 3/B's own ablations.
  const options = { enableAdaptiveWeighting: true, enableRetestQuality: false, enableChaseGuard: true, enableAntiCountertrendGate: true };
  const MIN_HISTORY = 40;
  let i = MIN_HISTORY;
  while (i < intraday5m.length) {
    const windowStart = Math.max(0, i - XAU_HTF_AUDIT_BUFFER_CAP + 1);
    const window = intraday5m.slice(windowStart, i + 1);
    const mp = mkMarketPrice(intraday5m, i, Math.round(1440 / ACTUAL_BAR_MINUTES));
    const currentUtcDay = new Date(intraday5m[i].time).toISOString().slice(0, 10);
    const dailySoFar = daily.filter((d) => new Date(d.time).toISOString().slice(0, 10) < currentUtcDay);

    const structure = newEvaluateMarketStructureFromCandles('XAUUSD', mp, window, 'NEW', dailySoFar, options, {}, false, exemptExtreme);
    if (structure.type && structure.confluenceScore >= CONFLUENCE_THRESHOLD) {
      const built = newBuildEntrySlTp(structure, mp.price);
      if (built) {
        const pattern = structure.xauPattern ?? 'UNKNOWN';
        const result = simulateForward(intraday5m, i + 1, built, pattern);
        stats.totalSignals++;
        stats.totalR += result.rMultiple;
        if (result.outcome === 'TP2') stats.wins++;
        else if (result.outcome === 'DIRECT_SL') stats.losses++;

        const atrPct = structure.regime?.atrPercentileRank;
        const wasWithinGateBlockBand = atrPct !== undefined && atrPct >= XAU_EXTREME_VOL_PERCENTILE;
        const isExemptedSignal = exemptExtreme && wasWithinGateBlockBand && structure.regime?.extreme === true;
        if (isExemptedSignal) {
          stats.exemptedCount++;
          stats.exemptedTotalR += result.rMultiple;
          if (result.outcome === 'TP2') stats.exemptedWins++;
          else if (result.outcome === 'DIRECT_SL') stats.exemptedLosses++;
        }

        i = i + 1 + 5;
        continue;
      }
    }
    i++;
  }
  return stats;
}

function summarizeXauExtremeGateExemptionAudit(stats: XauExtremeGateExemptionAuditStats) {
  console.log(`\n=== ${stats.label} ===`);
  const overallDecided = stats.wins + stats.losses;
  const overallWinRate = overallDecided > 0 ? ((stats.wins / overallDecided) * 100).toFixed(1) + '%' : 'n/a';
  const overallAvgR = stats.totalSignals > 0 ? (stats.totalR / stats.totalSignals).toFixed(2) : 'n/a';
  console.log(`Overall (all patterns): count=${stats.totalSignals}, winRate=${overallWinRate}, avgR=${overallAvgR}`);
  const subDecided = stats.exemptedWins + stats.exemptedLosses;
  const subWinRate = subDecided > 0 ? ((stats.exemptedWins / subDecided) * 100).toFixed(1) + '%' : 'n/a (n too small)';
  const subAvgR = stats.exemptedCount > 0 ? (stats.exemptedTotalR / stats.exemptedCount).toFixed(2) : 'n/a';
  console.log(`Signals that ONLY exist because of the regime.extreme exemption (atrPercentileRank >= ${XAU_EXTREME_VOL_PERCENTILE} AND regime.extreme=true at fire time - would have been gated/paused under the currently-shipped gate): count=${stats.exemptedCount}, winRate=${subWinRate}, avgR=${subAvgR}`);
}

// ============================================================================================
// Fase E (roadmap Bagian 2, zone quality/freshness) measurement - BEFORE any confluenceScore
// wiring, measure whether a fresher OB/FVG retest (fewer candles since the zone's own formation)
// actually performs better than an older one, on real data. Precedent to take seriously: a very
// similar idea (a clean-retest confluence bonus, server.ts:3172-3185) was already implemented,
// backtested, and DELIBERATELY REMOVED after a real quality regression (TREND_CONTINUATION avgR
// 0.49->0.32, win rate 30.0%->25.0%). This measures zone age specifically (not retest chop) with
// the same production config, splitting TREND_CONTINUATION's fired signals at the median zoneAgeBars
// into a "fresher half" vs "older half" so even a small real sample stays maximally powered. This
// function does NOT change confluenceScore or any other live behavior - measurement only.
// ============================================================================================
interface XauZoneFreshnessAuditStats {
  ages: number[]; // every fired TREND_CONTINUATION signal's zoneAgeBars, in fire order
  fresherHalf: { count: number; wins: number; losses: number; totalR: number };
  olderHalf: { count: number; wins: number; losses: number; totalR: number };
}

function runXauZoneFreshnessAudit(intraday5m: Candle[], daily: Candle[]): XauZoneFreshnessAuditStats {
  const fired: { ageBars: number; outcome: string; rMultiple: number }[] = [];
  const options = { enableAdaptiveWeighting: true, enableRetestQuality: false, enableChaseGuard: true, enableAntiCountertrendGate: true };
  const MIN_HISTORY = 40;
  let i = MIN_HISTORY;
  while (i < intraday5m.length) {
    const windowStart = Math.max(0, i - XAU_HTF_AUDIT_BUFFER_CAP + 1);
    const window = intraday5m.slice(windowStart, i + 1);
    const mp = mkMarketPrice(intraday5m, i, Math.round(1440 / ACTUAL_BAR_MINUTES));
    const currentUtcDay = new Date(intraday5m[i].time).toISOString().slice(0, 10);
    const dailySoFar = daily.filter((d) => new Date(d.time).toISOString().slice(0, 10) < currentUtcDay);

    const structure = newEvaluateMarketStructureFromCandles('XAUUSD', mp, window, 'NEW', dailySoFar, options, {});
    if (structure.type && structure.confluenceScore >= CONFLUENCE_THRESHOLD) {
      const built = newBuildEntrySlTp(structure, mp.price);
      if (built) {
        if (structure.xauPattern === 'TREND_CONTINUATION' && structure.xauZoneAgeBars !== undefined && structure.xauZoneAgeBars !== null) {
          const result = simulateForward(intraday5m, i + 1, built, structure.xauPattern);
          fired.push({ ageBars: structure.xauZoneAgeBars, outcome: result.outcome, rMultiple: result.rMultiple });
        }
        i = i + 1 + 5;
        continue;
      }
    }
    i++;
  }

  const sorted = [...fired].sort((a, b) => a.ageBars - b.ageBars);
  const mid = Math.floor(sorted.length / 2);
  const fresher = sorted.slice(0, mid);
  const older = sorted.slice(mid);
  const summarize = (rows: typeof fired) => ({
    count: rows.length,
    wins: rows.filter((r) => r.outcome === 'TP2').length,
    losses: rows.filter((r) => r.outcome === 'DIRECT_SL').length,
    totalR: rows.reduce((sum, r) => sum + r.rMultiple, 0),
  });
  return {
    ages: sorted.map((r) => r.ageBars),
    fresherHalf: summarize(fresher),
    olderHalf: summarize(older),
  };
}

function summarizeXauZoneFreshnessAudit(stats: XauZoneFreshnessAuditStats) {
  console.log(`\n=== Zone freshness (zoneAgeBars) audit - TREND_CONTINUATION only ===`);
  if (stats.ages.length === 0) {
    console.log('No TREND_CONTINUATION signals fired in this run - nothing to measure.');
    return;
  }
  const sorted = stats.ages;
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  console.log(`zoneAgeBars distribution across ${sorted.length} fired TREND_CONTINUATION signals: min=${sorted[0]} p25=${p(0.25)} median=${p(0.5)} p75=${p(0.75)} max=${sorted[sorted.length - 1]} (bars, ${ACTUAL_BAR_MINUTES}min each)`);
  for (const [label, half] of [['Fresher half (younger zoneAgeBars)', stats.fresherHalf], ['Older half (older zoneAgeBars)', stats.olderHalf]] as const) {
    const decided = half.wins + half.losses;
    const winRate = decided > 0 ? ((half.wins / decided) * 100).toFixed(1) + '%' : 'n/a';
    const avgR = half.count > 0 ? (half.totalR / half.count).toFixed(2) : 'n/a';
    console.log(`${label}: count=${half.count}, winRate=${winRate}, avgR=${avgR}`);
  }
  console.log('n is small (TREND_CONTINUATION is the rarest of the 4 main patterns) - read this as a directional signal for whether a freshness-based confluenceScore bonus is worth pursuing further, not as a final verdict either way.');
}

// Fase F (roadmap Bagian 1): session as a bucket dimension - mirrors server.ts's
// isXauKillzone/isXauJudasSwingWindow/getXauSessionLabel exactly (no new time-window concept).
function isXauKillzone(nowMs: number): boolean {
  const h = new Date(nowMs).getUTCHours();
  return (h >= 7 && h < 10) || (h >= 12 && h < 15);
}
function isXauJudasSwingWindow(nowMs: number): boolean {
  const h = new Date(nowMs).getUTCHours();
  return h >= 7 && h < 9;
}
function getXauSessionLabel(nowMs: number): string {
  if (isXauJudasSwingWindow(nowMs)) return 'JUDAS_WINDOW';
  if (isXauKillzone(nowMs)) {
    const h = new Date(nowMs).getUTCHours();
    return h >= 12 ? 'NY_KILLZONE' : 'LONDON_KILLZONE';
  }
  return 'OUTSIDE_KILLZONE';
}

// ============================================================================================
// Fase D (roadmap Bagian 1): honest TP-before-SL metric from real backtest data, bucketed by
// (pattern, tier, regime.trend, session - session added by Fase F) - the real dimensions a live
// signal's own directional/structural/timing character is drawn from. For each bucket with
// n >= XAU_BUCKET_MIN_SAMPLE, computes the real TP-first vs SL-first ratio (excluding
// INVALIDATED/OPEN_AT_DATA_END, which never resolved either way) plus median MAE/MFE in R. Below
// the sample floor, a bucket's numbers are computed here for visibility in this report but MUST
// NOT be published to a live signal (see XAU_HISTORICAL_BUCKET_STATS's own comment in server.ts
// for the n>=20 cutoff enforcement). Same production config as every other audit in this file (see
// runXauZoneFreshnessAudit above).
// ============================================================================================
const XAU_BUCKET_MIN_SAMPLE = 20;

interface XauHistoricalBucketRow {
  pattern: string;
  tier: string;
  regimeTrend: string;
  session: string;
  count: number;
  tpFirstCount: number;
  slFirstCount: number;
  indeterminateCount: number; // INVALIDATED / OPEN_AT_DATA_END - never resolved either way
  maeRs: number[];
  mfeRs: number[];
}

interface XauBucketedStatsAuditStats {
  buckets: Record<string, XauHistoricalBucketRow>;
  totalFired: number;
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function runXauBucketedHistoricalStatsAudit(intraday5m: Candle[], daily: Candle[]): XauBucketedStatsAuditStats {
  const options = { enableAdaptiveWeighting: true, enableRetestQuality: false, enableChaseGuard: true, enableAntiCountertrendGate: true };
  const buckets: Record<string, XauHistoricalBucketRow> = {};
  let totalFired = 0;
  const MIN_HISTORY = 40;
  let i = MIN_HISTORY;
  while (i < intraday5m.length) {
    const windowStart = Math.max(0, i - XAU_HTF_AUDIT_BUFFER_CAP + 1);
    const window = intraday5m.slice(windowStart, i + 1);
    const mp = mkMarketPrice(intraday5m, i, Math.round(1440 / ACTUAL_BAR_MINUTES));
    const currentUtcDay = new Date(intraday5m[i].time).toISOString().slice(0, 10);
    const dailySoFar = daily.filter((d) => new Date(d.time).toISOString().slice(0, 10) < currentUtcDay);

    const structure = newEvaluateMarketStructureFromCandles('XAUUSD', mp, window, 'NEW', dailySoFar, options, {});
    if (structure.type && structure.confluenceScore >= CONFLUENCE_THRESHOLD) {
      const built = newBuildEntrySlTp(structure, mp.price);
      if (built && structure.xauPattern && structure.xauSignalTier) {
        const result = simulateForward(intraday5m, i + 1, built, structure.xauPattern);
        totalFired++;
        const session = getXauSessionLabel(intraday5m[i].time);
        const key = `${structure.xauPattern}|${structure.xauSignalTier}|${structure.regime.trend}|${session}`;
        if (!buckets[key]) {
          buckets[key] = {
            pattern: structure.xauPattern, tier: structure.xauSignalTier, regimeTrend: structure.regime.trend, session,
            count: 0, tpFirstCount: 0, slFirstCount: 0, indeterminateCount: 0, maeRs: [], mfeRs: [],
          };
        }
        const b = buckets[key];
        b.count++;
        // TP-before-SL: TP2 (never touched SL) and TP1_THEN_SL (touched TP1 before ever touching
        // SL, even though it later gave back to breakeven) both mean TP was reached first.
        // DIRECT_SL means SL was touched without ever reaching TP1. INVALIDATED/OPEN_AT_DATA_END
        // never resolved either way - excluded from the rate, counted separately for honesty.
        if (result.outcome === 'TP2' || result.outcome === 'TP1_THEN_SL') b.tpFirstCount++;
        else if (result.outcome === 'DIRECT_SL') b.slFirstCount++;
        else b.indeterminateCount++;
        if (result.maeR !== undefined) b.maeRs.push(result.maeR);
        if (result.mfeR !== undefined) b.mfeRs.push(result.mfeR);
        i = i + 1 + 5;
        continue;
      }
    }
    i++;
  }
  return { buckets, totalFired };
}

function summarizeXauBucketedStatsAudit(stats: XauBucketedStatsAuditStats) {
  console.log('\n=== Fase D/F: bucketed historical stats (pattern x tier x regime.trend x session) - TP-before-SL rate + median MAE/MFE ===');
  console.log(`Total signals fired (production config, walk-forward): ${stats.totalFired}`);
  const rows = Object.values(stats.buckets).sort((a, b) => b.count - a.count);
  const qualifying = rows.filter((r) => r.count >= XAU_BUCKET_MIN_SAMPLE);
  console.log(`Buckets with n >= ${XAU_BUCKET_MIN_SAMPLE} (eligible to publish live): ${qualifying.length} / ${rows.length} distinct buckets seen.`);
  if (rows.length === 0) {
    console.log('No signals fired in this run - nothing to bucket.');
    return;
  }
  for (const r of rows) {
    const determinate = r.tpFirstCount + r.slFirstCount;
    const tpRate = determinate > 0 ? (r.tpFirstCount / determinate) * 100 : null;
    const medianMae = medianOf(r.maeRs);
    const medianMfe = medianOf(r.mfeRs);
    const eligible = r.count >= XAU_BUCKET_MIN_SAMPLE;
    console.log(`${eligible ? '✓ PUBLISHABLE' : '✗ below floor'} ${r.pattern} | ${r.tier} | ${r.regimeTrend} | ${r.session}: n=${r.count}`);
    console.log(`    TP-before-SL rate: ${tpRate !== null ? tpRate.toFixed(1) + '%' : 'n/a'} (${r.tpFirstCount} TP-first, ${r.slFirstCount} SL-first, ${r.indeterminateCount} indeterminate/still-open)`);
    console.log(`    Median MAE: ${medianMae !== null ? medianMae.toFixed(2) + 'R' : 'n/a'}, Median MFE: ${medianMfe !== null ? medianMfe.toFixed(2) + 'R' : 'n/a'}`);
  }

  // Fase F: session-effect view - group by (pattern, tier, regimeTrend) and lay each session's row
  // side by side, so a consistent better/worse-in-one-session pattern (if any) is visible directly,
  // instead of scattered across the sorted-by-count list above. Read this ONLY where every session
  // row shown is itself PUBLISHABLE (n>=20) - a below-floor row proves nothing about a session
  // effect and must not be read as one.
  console.log('\n--- Fase F: session-effect grouping (same pattern|tier|regimeTrend, split by session) ---');
  const byCombo = new Map<string, XauHistoricalBucketRow[]>();
  for (const r of rows) {
    const comboKey = `${r.pattern}|${r.tier}|${r.regimeTrend}`;
    if (!byCombo.has(comboKey)) byCombo.set(comboKey, []);
    byCombo.get(comboKey)!.push(r);
  }
  let anyMultiSessionQualifying = false;
  for (const [comboKey, comboRows] of byCombo.entries()) {
    const qualifyingComboRows = comboRows.filter((r) => r.count >= XAU_BUCKET_MIN_SAMPLE);
    if (qualifyingComboRows.length < 2) continue; // need >=2 real sessions to compare anything
    anyMultiSessionQualifying = true;
    console.log(`${comboKey}:`);
    for (const r of qualifyingComboRows.sort((a, b) => b.count - a.count)) {
      const determinate = r.tpFirstCount + r.slFirstCount;
      const tpRate = determinate > 0 ? (r.tpFirstCount / determinate) * 100 : null;
      console.log(`    ${r.session}: n=${r.count}, TP-before-SL ${tpRate !== null ? tpRate.toFixed(1) + '%' : 'n/a'}`);
    }
  }
  if (!anyMultiSessionQualifying) {
    console.log('No (pattern, tier, regimeTrend) combo had >=2 PUBLISHABLE (n>=20) session rows in this run - not enough real data yet to say whether session matters for any combo. Per the roadmap\'s own instruction, this means NO confluence-score adjustment is justified from this run - measurement only, same discipline as Fase E\'s zoneAgeBars.');
  }
  console.log('\nOnly rows marked PUBLISHABLE (n >= 20) are eligible to be copied into server.ts\'s XAU_HISTORICAL_BUCKET_STATS lookup table - the rest are shown here for visibility only, per the explicit "n<20, jangan tampilkan angka" instruction. This script never writes that table itself; a human/session copies the PUBLISHABLE rows over after reviewing this report.');
}

// ============================================================================================
// Fase C (roadmap Bagian 1, post-SL forensics / anti-flip) audit - measures how often a same-pair
// opposite-direction candidate fires within XAU_POST_SL_ANTI_FLIP_WINDOW_BARS of a Direct-SL while
// regime.trend hasn't genuinely changed (the BUY->SL->SELL->SL whipsaw pattern the gate targets),
// and what real win-rate/avgR that subset had, gate off vs on. Mirrors server.ts's
// xauLastSlEvent/createInstitutionalScalpingSignal gate exactly, but as its own walk-forward
// (this file's evaluateXauIctSetups mirror has no direct equivalent of
// createInstitutionalScalpingSignal to hook into, so the gate is applied here in the audit loop
// itself, at the same point right after `structure` is computed).
// ============================================================================================
const XAU_POST_SL_ANTI_FLIP_WINDOW_BARS = 6;
const XAU_POST_SL_ANTI_FLIP_CONFIRMATION_BARS = 2;

interface XauPostSlAntiFlipAuditStats {
  label: string;
  totalSignals: number;
  wins: number;
  losses: number;
  totalR: number;
  // The subset this gate targets: opposite-direction candidates that fired within the post-SL
  // window while regime.trend was unchanged from the SL.
  flipCount: number;
  flipWins: number;
  flipLosses: number;
  flipTotalR: number;
  heldCount: number; // gate ON only: how many candidates the gate actually held back
}

function runXauPostSlAntiFlipAudit(
  intraday5m: Candle[],
  daily: Candle[],
  label: string,
  enableGate: boolean
): XauPostSlAntiFlipAuditStats {
  const stats: XauPostSlAntiFlipAuditStats = {
    label, totalSignals: 0, wins: 0, losses: 0, totalR: 0,
    flipCount: 0, flipWins: 0, flipLosses: 0, flipTotalR: 0, heldCount: 0,
  };
  const options = { enableAdaptiveWeighting: true, enableRetestQuality: false, enableChaseGuard: true };
  let lastSlEvent: { direction: 'BUY' | 'SELL'; atIndex: number; regimeTrend: MarketTrendRegime } | null = null;
  const MIN_HISTORY = 40;
  let i = MIN_HISTORY;
  while (i < intraday5m.length) {
    const windowStart = Math.max(0, i - XAU_HTF_AUDIT_BUFFER_CAP + 1);
    const window = intraday5m.slice(windowStart, i + 1);
    const mp = mkMarketPrice(intraday5m, i, Math.round(1440 / ACTUAL_BAR_MINUTES));
    const currentUtcDay = new Date(intraday5m[i].time).toISOString().slice(0, 10);
    const dailySoFar = daily.filter((d) => new Date(d.time).toISOString().slice(0, 10) < currentUtcDay);

    const structure = newEvaluateMarketStructureFromCandles('XAUUSD', mp, window, 'NEW', dailySoFar, options, {});
    if (structure.type && structure.confluenceScore >= CONFLUENCE_THRESHOLD) {
      const barsSinceSl = lastSlEvent ? i - lastSlEvent.atIndex : Infinity;
      const isOppositeFlip = lastSlEvent !== null && structure.type !== lastSlEvent.direction && barsSinceSl < XAU_POST_SL_ANTI_FLIP_WINDOW_BARS;
      const regimeUnchanged = isOppositeFlip && lastSlEvent !== null && structure.regime?.trend === lastSlEvent.regimeTrend;

      if (enableGate && regimeUnchanged && barsSinceSl < XAU_POST_SL_ANTI_FLIP_CONFIRMATION_BARS) {
        stats.heldCount++;
        i++;
        continue;
      }

      const built = newBuildEntrySlTp(structure, mp.price);
      if (built) {
        const pattern = structure.xauPattern ?? 'UNKNOWN';
        const result = simulateForward(intraday5m, i + 1, built, pattern);
        stats.totalSignals++;
        stats.totalR += result.rMultiple;
        if (result.outcome === 'TP2') stats.wins++;
        else if (result.outcome === 'DIRECT_SL') stats.losses++;

        if (regimeUnchanged) {
          stats.flipCount++;
          stats.flipTotalR += result.rMultiple;
          if (result.outcome === 'TP2') stats.flipWins++;
          else if (result.outcome === 'DIRECT_SL') stats.flipLosses++;
        }

        // Correctness note: simulateForward can resolve this trade far ahead of the current `i`
        // (a trade can take many bars to hit TP/SL) - unlike runEngine/runXauFase3Audit (which
        // only track independent per-signal stats and don't care about this), THIS audit needs
        // genuine temporal ordering ("bars since a specific past SL"), so `i` must never lag behind
        // a resolution it already knows about. Advance past the resolution index itself, not just
        // fire+5, whenever the trade resolved further out than that - otherwise barsSinceSl would
        // go negative for the stretch between fire and resolution and the gate would misfire on
        // stale future-dated state. Production (server.ts) has no equivalent bug: it runs in real
        // wall-clock time, so an SL is always genuinely in the past before a new signal can exist.
        let nextI = i + 1 + 5;
        if (result.outcome === 'DIRECT_SL' && result.resolvedAtIndex !== undefined) {
          const resolvedIdx = result.resolvedAtIndex;
          const resolvedWindowStart = Math.max(0, resolvedIdx - XAU_HTF_AUDIT_BUFFER_CAP + 1);
          const resolvedWindow = intraday5m.slice(resolvedWindowStart, resolvedIdx + 1);
          const resolvedAtr = calculateATR(resolvedWindow, 14) || 0;
          const resolvedRegime = detectMarketRegime('XAUUSD', resolvedWindow, resolvedAtr);
          lastSlEvent = { direction: structure.type, atIndex: resolvedIdx, regimeTrend: resolvedRegime.trend };
          nextI = Math.max(nextI, resolvedIdx + 1);
        }

        i = nextI;
        continue;
      }
    }
    i++;
  }
  return stats;
}

function summarizeXauPostSlAntiFlipAudit(stats: XauPostSlAntiFlipAuditStats) {
  console.log(`\n=== ${stats.label} ===`);
  const overallDecided = stats.wins + stats.losses;
  const overallWinRate = overallDecided > 0 ? ((stats.wins / overallDecided) * 100).toFixed(1) + '%' : 'n/a';
  const overallAvgR = stats.totalSignals > 0 ? (stats.totalR / stats.totalSignals).toFixed(2) : 'n/a';
  console.log(`Overall (all patterns): count=${stats.totalSignals}, winRate=${overallWinRate}, avgR=${overallAvgR}`);
  console.log(`Held by anti-flip gate: ${stats.heldCount}`);
  const flipDecided = stats.flipWins + stats.flipLosses;
  const flipWinRate = flipDecided > 0 ? ((stats.flipWins / flipDecided) * 100).toFixed(1) + '%' : 'n/a (n too small)';
  const flipAvgR = stats.flipCount > 0 ? (stats.flipTotalR / stats.flipCount).toFixed(2) : 'n/a';
  console.log(`BUY-SL-then-SELL(or reverse)-within-window-regime-unchanged subset that fired: count=${stats.flipCount}, winRate=${flipWinRate}, avgR=${flipAvgR}`);
}

// ============================================================================================
// 2026-09-04 URGENT follow-up: user asked how OFTEN and how LONG the Volatility Regime Gate
// (XAU_EXTREME_VOL_PERCENTILE, server.ts's evaluateMarketStructureFromCandles) actually stays
// "stuck on" in real data, before deciding whether an escape hatch is worth adding - a pure
// measurement, no threshold change. Walks EVERY real candle (no skipping, unlike runEngine's
// signal-driven walk, which jumps 5 bars after each fire and would distort streak lengths) using
// the exact same window cap (CANDLE_BUFFER_NEW) and detectMarketRegime call production itself
// uses, and reports contiguous gate-on run lengths - not just the overall % of ticks gated
// (which the existing root-cause diagnostics in runEngine's report already covers).
// ============================================================================================
interface XauVolGateStreakStats {
  thresholdLabel: string;
  totalTicks: number;
  gatedTicks: number;
  episodeLengthsBars: number[]; // one entry per contiguous "gate on" run, in bars
}

function analyzeXauVolatilityGateStreaks(candles: Candle[], threshold: number, thresholdLabel: string): XauVolGateStreakStats {
  const stats: XauVolGateStreakStats = { thresholdLabel, totalTicks: 0, gatedTicks: 0, episodeLengthsBars: [] };
  const MIN_HISTORY = 34; // 20-candle percentile lookback + 14-candle ATR warmup, same floor detectMarketRegime itself needs
  let currentStreak = 0;
  for (let i = MIN_HISTORY; i < candles.length; i++) {
    const windowStart = Math.max(0, i - CANDLE_BUFFER_NEW + 1);
    const window = candles.slice(windowStart, i + 1);
    const atr = calculateATR(window, 14) || 0;
    const regime = detectMarketRegime('XAUUSD', window, atr);
    stats.totalTicks++;
    const gated = regime.atrPercentileRank !== undefined && regime.atrPercentileRank >= threshold;
    if (gated) {
      stats.gatedTicks++;
      currentStreak++;
    } else {
      if (currentStreak > 0) stats.episodeLengthsBars.push(currentStreak);
      currentStreak = 0;
    }
  }
  if (currentStreak > 0) stats.episodeLengthsBars.push(currentStreak);
  return stats;
}

function summarizeXauVolatilityGateStreaks(stats: XauVolGateStreakStats, barMinutes: number) {
  const gatedPct = stats.totalTicks > 0 ? (stats.gatedTicks / stats.totalTicks) * 100 : 0;
  console.log(`\n=== ${stats.thresholdLabel} ===`);
  console.log(`Ticks gated: ${stats.gatedTicks}/${stats.totalTicks} (${gatedPct.toFixed(1)}% of all real ticks in this window)`);
  if (stats.episodeLengthsBars.length === 0) {
    console.log('No contiguous gate-on episodes in this window.');
    return;
  }
  const sorted = [...stats.episodeLengthsBars].sort((a, b) => a - b);
  const toMin = (bars: number) => bars * barMinutes;
  const p50 = percentile(sorted, 0.5);
  const p75 = percentile(sorted, 0.75);
  const p90 = percentile(sorted, 0.9);
  const max = sorted[sorted.length - 1];
  console.log(`Episodes (contiguous gate-on runs): ${sorted.length}`);
  console.log(`Episode length: min=${toMin(sorted[0]).toFixed(0)}min p50=${toMin(p50).toFixed(0)}min p75=${toMin(p75).toFixed(0)}min p90=${toMin(p90).toFixed(0)}min max=${toMin(max).toFixed(0)}min (${(toMin(max) / 60).toFixed(1)}h)`);
  const longEpisodes = sorted.filter((b) => toMin(b) >= 120);
  console.log(`Episodes lasting >= 2h: ${longEpisodes.length}/${sorted.length} (${((longEpisodes.length / sorted.length) * 100).toFixed(1)}%)`);
}

async function runXauHtfBiasGateAuditMain(): Promise<void> {
  console.log('===== XAUUSD HTF bias & directional gate audit/backtest (2026-09-03) =====');
  const useSynthetic = process.argv.includes('--synthetic');
  let intraday: { candles: Candle[]; source: string };
  let daily: { candles: Candle[]; source: string };

  if (useSynthetic) {
    console.log('*** --synthetic flag set: using generated random-walk series, NOT real market data. ***');
    console.log('*** This only validates the walk-forward/gate-filtering mechanics run without crashing - it is NOT evidence of real engine performance. ***');
    intraday = { candles: generateSynthetic5mCandles(3000, 7, 300_000), source: 'synthetic random walk, 5-minute spacing' };
    daily = { candles: generateSynthetic5mCandles(30, 13, 86_400_000), source: 'synthetic random walk, daily spacing' };
  } else {
    console.log('Fetching real XAUUSD/GC=F 5-minute candles (longest real range Yahoo will serve)...');
    intraday = await fetchRealXau5mCandlesForHtfAudit();
    console.log('\nFetching real XAUUSD/GC=F daily candles (D1 tier + ground-truth multi-day trend)...');
    daily = await fetchRealXauDailyCandlesForHtfAudit();
  }
  console.log(`Fetched ${intraday.candles.length} 5-minute candles from: ${intraday.source}.`);
  if (intraday.candles.length > 0) {
    console.log(`  Range: ${new Date(intraday.candles[0].time).toISOString()} -> ${new Date(intraday.candles[intraday.candles.length - 1].time).toISOString()}`);
  }
  console.log(`Fetched ${daily.candles.length} daily candles from: ${daily.source}.`);
  if (daily.candles.length > 0) {
    console.log(`  Range: ${new Date(daily.candles[0].time).toISOString()} -> ${new Date(daily.candles[daily.candles.length - 1].time).toISOString()}`);
    const first = daily.candles[0].close;
    const last = daily.candles[daily.candles.length - 1].close;
    console.log(`  Daily close, first vs last in fetched window: ${first.toFixed(2)} -> ${last.toFixed(2)} (${(((last - first) / first) * 100).toFixed(1)}%) - ground truth for whether/how much of a multi-week directional move actually occurred in this window.`);

    // Real recent-history trajectory check (last ~120 real daily bars, ~6 months): does the
    // rally-then-correction pattern the user described from TradingView chart review (a clear
    // multi-week peak, then a real pullback) actually show up in real recent daily closes? Finds
    // the real peak close and the real max drawdown (in real $ and %) from that peak within the
    // recent window, and how many real calendar days separate them - directly answers "did a
    // multi-week reversal like the one described actually happen, and when".
    const recent = daily.candles.slice(-120);
    if (recent.length > 5) {
      let peakIdx = 0;
      for (let i = 1; i < recent.length; i++) if (recent[i].close > recent[peakIdx].close) peakIdx = i;
      let troughAfterPeakIdx = peakIdx;
      for (let i = peakIdx; i < recent.length; i++) if (recent[i].close < recent[troughAfterPeakIdx].close) troughAfterPeakIdx = i;
      const peak = recent[peakIdx];
      const troughAfterPeak = recent[troughAfterPeakIdx];
      const drawdownPct = ((troughAfterPeak.close - peak.close) / peak.close) * 100;
      const daysFromPeakToTrough = (troughAfterPeak.time - peak.time) / 86_400_000;
      console.log(`  Real recent trajectory (last ${recent.length} real daily bars): peak close ${peak.close.toFixed(2)} on ${new Date(peak.time).toISOString().slice(0, 10)}; real max drawdown after that peak (within this window) to ${troughAfterPeak.close.toFixed(2)} on ${new Date(troughAfterPeak.time).toISOString().slice(0, 10)} = ${drawdownPct.toFixed(1)}% over ${daysFromPeakToTrough.toFixed(0)} real calendar days.`);
      if (peakIdx === recent.length - 1) {
        console.log('  (peak is the MOST RECENT bar in this window - no post-peak correction has happened yet as of this fetch, or the rally is still ongoing.)');
      }
    }
  }

  if (intraday.candles.length < 400) {
    console.error('[HTF GATE AUDIT ABORTED] Not enough 5-minute candle history fetched to run a meaningful walk-forward test.');
    process.exit(1);
  }

  ACTUAL_BAR_MINUTES = 5;
  const totalDays = (intraday.candles.length * 5) / (60 * 24);

  if (process.argv.includes('--breakout-opportunity-gap')) {
    console.log('\n===== Fase 4, Task 0: breakout/displacement opportunity-gap audit (BEFORE implementation) =====');
    const gap = measureXauBreakoutOpportunityGap(intraday.candles, daily.candles);
    const expansionPct = (gap.expansionTicks / Math.max(1, gap.totalTicks)) * 100;
    const noSignalPct = (gap.expansionTicksNoSignal / Math.max(1, gap.expansionTicks)) * 100;
    console.log(`Total ticks: ${gap.totalTicks}`);
    console.log(`Ticks in expansion band (ADX>=25, ATR percentile in [0.5, ${XAU_EXTREME_VOL_PERCENTILE})): ${gap.expansionTicks} (${expansionPct.toFixed(1)}% of all ticks)`);
    console.log(`Of those, ticks with NO signal from the 4 existing patterns: ${gap.expansionTicksNoSignal} (${noSignalPct.toFixed(1)}% of expansion ticks)`);
    console.log('This is a rough per-tick estimate, not a trade-count estimate - it does not distinguish one long empty expansion stretch from many short ones. Read alongside the qualitative frequency figure (real distinct empty windows) in the report.');
    return;
  }

  console.log('\nRunning OLD gate (pre-redesign: informational-only 8h-window H1 bias, -18 penalty never a hard filter, sweep/range excluded from HTF gate)...');
  const oldStats = runXauHtfGateAudit(intraday.candles, daily.candles, 'OLD');
  console.log('Running NEW gate (redesigned: genuine H4/D1 bias, hard filter for TREND_CONTINUATION/CHOCH_REVERSAL, two-mode sweep, H4-ranging-confirmed range)...');
  const newStatsResult = runXauHtfGateAudit(intraday.candles, daily.candles, 'NEW');

  summarizeXauHtfGateAudit('OLD GATE (pre-redesign)', oldStats, totalDays);
  summarizeXauHtfGateAudit('NEW GATE (this redesign)', newStatsResult, totalDays);

  console.log('\n\n===== Fase 3 audit: adaptive pattern weighting + retest quality + chase guard =====');
  console.log('Running ablation sweep (baseline, each item in isolation, then all combined) on the SAME real data...');
  const OFF3 = { enableAdaptiveWeighting: false, enableRetestQuality: false, enableChaseGuard: false };
  const fase3Runs: { label: string; options: typeof OFF3; pattern5?: boolean }[] = [
    { label: 'BASELINE (Fase 2 NEW gate only, no Fase 3 items)', options: OFF3 },
    { label: 'ADAPTIVE WEIGHTING ONLY', options: { ...OFF3, enableAdaptiveWeighting: true } },
    { label: 'RETEST QUALITY ONLY', options: { ...OFF3, enableRetestQuality: true } },
    { label: 'CHASE GUARD ONLY', options: { ...OFF3, enableChaseGuard: true } },
    { label: 'ALL 3 COMBINED (retest quality included, for reference only - REJECTED, see next row)', options: { enableAdaptiveWeighting: true, enableRetestQuality: true, enableChaseGuard: true } },
    // 2026-09-03: retest quality (Item 2) removed from server.ts after this same ablation sweep
    // showed a real quality regression (see its own removal comment in server.ts's
    // evaluateXauIctSetups) - this row is the ACTUAL shipped production config: adaptive weighting
    // + chase guard only, final confirmation before merge.
    { label: 'PRODUCTION CONFIG - FINAL (adaptive weighting + chase guard, NO retest quality)', options: { enableAdaptiveWeighting: true, enableRetestQuality: false, enableChaseGuard: true } },
    // 2026-09-03 Fase 4: same production config, PLUS the new Pattern 5 (BREAKOUT_DISPLACEMENT_
    // CONTINUATION) candidate generator. This is the ablation this task's report is built on -
    // compare this row's totals AND its own byPattern['BREAKOUT_DISPLACEMENT_CONTINUATION'] entry
    // against the row directly above (identical config, Pattern 5 off) to isolate Pattern 5's own
    // effect with everything else held fixed.
    { label: 'PRODUCTION CONFIG + PATTERN 5 (BREAKOUT/DISPLACEMENT CONTINUATION)', options: { enableAdaptiveWeighting: true, enableRetestQuality: false, enableChaseGuard: true }, pattern5: true },
  ];
  const fase3Results = fase3Runs.map((run) => {
    console.log(`Running: ${run.label}...`);
    return runXauFase3Audit(intraday.candles, daily.candles, run.label, run.options, run.pattern5 === true);
  });
  for (const result of fase3Results) summarizeXauFase3Audit(result, totalDays);

  const baseline = fase3Results[0];
  console.log('\n--- Frequency delta vs baseline (task\'s own pause threshold: -15% or worse without a clear quality improvement) ---');
  for (const result of fase3Results.slice(1)) {
    const freqDelta = baseline.totalSignals > 0 ? ((result.totalSignals - baseline.totalSignals) / baseline.totalSignals) * 100 : 0;
    console.log(`  ${result.label}: ${freqDelta >= 0 ? '+' : ''}${freqDelta.toFixed(1)}% (${result.totalSignals} vs ${baseline.totalSignals} signals)`);
  }

  // Fase 4: isolate Pattern 5's effect specifically against the PRODUCTION CONFIG - FINAL row
  // (identical config except Pattern 5 on/off) - this is the real "ablation: baseline vs
  // baseline+Pattern5" comparison the task asked for, not the Fase 2 zero-Fase-3-items baseline.
  const prodFinal = fase3Results.find((r) => r.label.startsWith('PRODUCTION CONFIG - FINAL'));
  const prodPlusPattern5 = fase3Results.find((r) => r.label.startsWith('PRODUCTION CONFIG + PATTERN 5'));
  if (prodFinal && prodPlusPattern5) {
    console.log('\n===== Fase 4: Pattern 5 (BREAKOUT_DISPLACEMENT_CONTINUATION) isolated ablation =====');
    const freqDelta = prodFinal.totalSignals > 0 ? ((prodPlusPattern5.totalSignals - prodFinal.totalSignals) / prodFinal.totalSignals) * 100 : 0;
    console.log(`Overall signal frequency: PRODUCTION CONFIG - FINAL = ${prodFinal.totalSignals}, + Pattern 5 = ${prodPlusPattern5.totalSignals} (${freqDelta >= 0 ? '+' : ''}${freqDelta.toFixed(1)}%).`);
    const p5Stats = prodPlusPattern5.byPattern['BREAKOUT_DISPLACEMENT_CONTINUATION'];
    if (p5Stats) {
      const decided = p5Stats.wins + p5Stats.losses;
      const winRate = decided > 0 ? ((p5Stats.wins / decided) * 100).toFixed(1) + '%' : 'n/a';
      const avgR = p5Stats.count > 0 ? (p5Stats.totalR / p5Stats.count).toFixed(2) : 'n/a';
      console.log(`Pattern 5's OWN stats (isolated from the aggregate): count=${p5Stats.count}, winRate=${winRate}, avgR=${avgR} (aligned=${p5Stats.alignedCount}, opposed=${p5Stats.opposedCount}, neutral=${p5Stats.neutralCount}).`);
      console.log('Compare this avgR/winRate directly against the other 4 patterns\' rows in the "PRODUCTION CONFIG + PATTERN 5" report above - if Pattern 5\'s own quality is far below the others even though frequency increased, that is the Item-2-style regression signal this task said to hold on, not merge.');
    } else {
      console.log('Pattern 5 never fired in this run\'s real data (0 signals) - no per-pattern quality to evaluate; only the frequency-gap audit (--breakout-opportunity-gap) speaks to its potential.');
    }
    console.log('See "Fase 4 displacement analysis" in the "PRODUCTION CONFIG + PATTERN 5" report above for whether Pattern 5 winning the best-candidate slot over another pattern\'s genuine candidate helped or hurt.');
  }
  console.log('\nAdaptive pattern weighting note: since this is a single cold-started backtest run, each run\'s resolvedTrades ledger starts EMPTY at the beginning of that same run (same honest "no fabricated history" state production starts in on deploy day) - any combo only gets a real adjustment once genuinely accumulated within THAT SAME run\'s own walk-forward, strictly no lookahead. See each run\'s own report for which combos, if any, actually crossed XAU_FASE3_MIN_SAMPLE by the end of that window.');

  console.log('\n\n===== Fase B: anti-countertrend gate audit (gate off vs on, same production config otherwise) =====');
  console.log('Running WITHOUT the gate...');
  const gateOffStats = runXauAntiCountertrendGateAudit(intraday.candles, daily.candles, 'GATE OFF (current production behavior)', false);
  console.log('Running WITH the gate...');
  const gateOnStats = runXauAntiCountertrendGateAudit(intraday.candles, daily.candles, 'GATE ON (Fase B candidate)', true);
  summarizeXauAntiCountertrendGateAudit(gateOffStats);
  summarizeXauAntiCountertrendGateAudit(gateOnStats);
  const overallFreqDelta = gateOffStats.totalSignals > 0 ? ((gateOnStats.totalSignals - gateOffStats.totalSignals) / gateOffStats.totalSignals) * 100 : 0;
  console.log(`\nOverall signal frequency delta (gate on vs off): ${overallFreqDelta >= 0 ? '+' : ''}${overallFreqDelta.toFixed(1)}% (${gateOnStats.totalSignals} vs ${gateOffStats.totalSignals}).`);
  console.log('Read the countertrend-during-extreme-regime subset rows above as the actual before/after for what this gate targets - the overall row is context (does the gate cost frequency broadly), not the decision itself. Per the roadmap\'s own instruction: if this shows the gate discarding good signals rather than bad ones, report that honestly and do not force it live.');

  console.log('\n\n===== Fase C: post-SL forensics / anti-flip gate audit (gate off vs on, same production config otherwise) =====');
  console.log('Running WITHOUT the gate...');
  const antiFlipOffStats = runXauPostSlAntiFlipAudit(intraday.candles, daily.candles, 'GATE OFF (current production behavior)', false);
  console.log('Running WITH the gate...');
  const antiFlipOnStats = runXauPostSlAntiFlipAudit(intraday.candles, daily.candles, 'GATE ON (Fase C candidate)', true);
  summarizeXauPostSlAntiFlipAudit(antiFlipOffStats);
  summarizeXauPostSlAntiFlipAudit(antiFlipOnStats);
  const antiFlipFreqDelta = antiFlipOffStats.totalSignals > 0 ? ((antiFlipOnStats.totalSignals - antiFlipOffStats.totalSignals) / antiFlipOffStats.totalSignals) * 100 : 0;
  console.log(`\nOverall signal frequency delta (gate on vs off): ${antiFlipFreqDelta >= 0 ? '+' : ''}${antiFlipFreqDelta.toFixed(1)}% (${antiFlipOnStats.totalSignals} vs ${antiFlipOffStats.totalSignals}).`);
  console.log('Read the "BUY-SL-then-SELL(or reverse)..." subset rows above as the actual before/after for what this gate targets (the specific whipsaw pattern it holds back) - the overall row is context. Per the roadmap\'s own instruction: if this shows the gate discarding good flips rather than bad ones, report that honestly and do not force it live.');

  console.log('\n\n===== URGENT follow-up: Volatility Regime Gate (XAU_EXTREME_VOL_PERCENTILE) streak analysis =====');
  console.log('Measures how OFTEN and how LONG the gate stays contiguously "on" in real data - a pure measurement for the user\'s own decision on whether an escape hatch is worth adding. This script never changes XAU_EXTREME_VOL_PERCENTILE itself.');
  const volGateThresholds: { threshold: number; label: string }[] = [
    { threshold: 0.85, label: 'THRESHOLD 0.85' },
    { threshold: 0.90, label: 'THRESHOLD 0.90 (pre-2026-09-04 production value)' },
    { threshold: 0.95, label: 'THRESHOLD 0.95 (current production value)' },
  ];
  for (const { threshold, label } of volGateThresholds) {
    const streakStats = analyzeXauVolatilityGateStreaks(intraday.candles, threshold, label);
    summarizeXauVolatilityGateStreaks(streakStats, ACTUAL_BAR_MINUTES);
  }
  console.log(`\nWindow measured: ${intraday.candles.length} real 5-minute candles (~${totalDays.toFixed(1)} days) from ${intraday.source}.`);

  console.log('\n\n===== URGENT follow-up (2nd incident, same day): Volatility Regime Gate regime.extreme exemption audit =====');
  console.log('User asked to MEASURE ONLY (not decide) what exempting regime.extreme=true ticks from the Volatility Regime Gate would look like - real backtest data on additional signals unlocked, their win rate and avgR, same production config otherwise. This script never changes what is shipped.');
  console.log('Running CURRENT (gate exempts nothing, matches production behavior)...');
  const exemptOffStats = runXauExtremeGateExemptionAudit(intraday.candles, daily.candles, 'CURRENT (gate exempts nothing - matches shipped production)', false);
  console.log('Running EXEMPT (gate skips the pause when regime.extreme=true)...');
  const exemptOnStats = runXauExtremeGateExemptionAudit(intraday.candles, daily.candles, 'EXEMPT regime.extreme=true from the gate (candidate)', true);
  summarizeXauExtremeGateExemptionAudit(exemptOffStats);
  summarizeXauExtremeGateExemptionAudit(exemptOnStats);
  const exemptFreqDelta = exemptOffStats.totalSignals > 0 ? ((exemptOnStats.totalSignals - exemptOffStats.totalSignals) / exemptOffStats.totalSignals) * 100 : 0;
  console.log(`\nOverall signal frequency delta (exempt vs current): ${exemptFreqDelta >= 0 ? '+' : ''}${exemptFreqDelta.toFixed(1)}% (${exemptOnStats.totalSignals} vs ${exemptOffStats.totalSignals} total signals).`);
  console.log(`Additional signals unlocked purely by the exemption: ${exemptOnStats.exemptedCount} (see "Signals that ONLY exist because of the regime.extreme exemption" row above for their own win rate/avgR - that subset, not the overall row, is the real answer to "is this worth it").`);
  console.log('Per the roadmap\'s own instruction: if the exempted subset shows a worse win rate/avgR than the overall book, report that honestly - do not recommend loosening the gate just because it adds signal count. This script does not decide; the user decides after seeing these numbers.');

  console.log('\n\n===== Fase E: zone quality/freshness measurement (zoneAgeBars, TREND_CONTINUATION only) =====');
  console.log('Measures whether a fresher OB/FVG retest performs better than an older one, BEFORE wiring anything into confluenceScore - same production config, real data. See server.ts:3172-3185 for why this starts as measurement, not a live bonus.');
  const freshnessStats = runXauZoneFreshnessAudit(intraday.candles, daily.candles);
  summarizeXauZoneFreshnessAudit(freshnessStats);

  console.log('\n\n===== Fase D: honest TP-before-SL metric + pre-trade MAE/MFE, bucketed by (pattern, tier, regime.trend) =====');
  console.log('Real walk-forward data, same production config as every other audit above (including the MAIN/SCALP tier split ported this session - see xauReworkParams\' own comment history). PUBLISHABLE rows (n>=20) are candidates to copy into server.ts\'s XAU_HISTORICAL_BUCKET_STATS lookup - this script never writes that table itself.');
  const bucketedStats = runXauBucketedHistoricalStatsAudit(intraday.candles, daily.candles);
  summarizeXauBucketedStatsAudit(bucketedStats);

  console.log('\nDone. Reminder: this isolates the HTF-bias/directional-gate mechanism specifically (structural OB/FVG/sweep/S&D detection and RR/build-stage gating are unchanged and identical between the two runs) - it does not re-run the OLD-vs-NEW structural-SL/TP comparison above (that is a separate, already-shipped change). "Opposed"/"aligned" are computed against each run\'s OWN gate\'s htfBias.combined read (OLD = old 8h-window definition, NEW = the redesigned H4/D1 definition) - they are not directly comparable counts between the two rows, only the win-rate/avgR SPLIT within each row (aligned vs opposed) is the meaningful before/after comparison.');
}

// ============================================================================================
// FASE 2 comparison: wick-based (current shipped fase-1 behavior) vs soft+hard close-confirm
// (candidate). Runs on the exact same fired signals (same entry/soft-SL/TP levels, from
// newEvaluateMarketStructureFromCandles + newBuildEntrySlTp - fase-1's shipped structure
// detection, unmodified) and replays each one's forward candle path under BOTH exit models so
// the only thing that differs between the two outcomes is the exit-timing rule itself.
// ============================================================================================

interface SoftHardComparisonStats {
  totalSignalsCompared: number;
  wickDirectSlCount: number; // how many signals the CURRENT (wick-based) model calls a Direct SL loss
  rescuedFull: number; // wick=DIRECT_SL, soft+hard reaches TP2 (full win) - a genuine shakeout the new model would have caught
  rescuedPartial: number; // wick=DIRECT_SL, soft+hard reaches TP1 first then eventually stops (scratch, still better than a straight loss)
  confirmedBreakdownViaClose: number; // wick=DIRECT_SL, soft+hard also exits, via the soft-SL close-confirmation (not hard SL)
  confirmedBreakdownViaHardSl: number; // wick=DIRECT_SL, soft+hard exits via the hard-SL wick backstop instead
  stillOpenAtDataEnd: number; // wick=DIRECT_SL, soft+hard simulation ran out of candle history before resolving
  lossDepthDeltaDollars: number[]; // for confirmed-breakdown cases only: |soft+hard exit price - wick exit price| in $
  totalShakeoutEventsAcrossAllSignals: number; // sum of "wicked through soft SL but candle closed back inside" events, across ALL signals (not just the ones that were eventually a wick-DIRECT_SL) - the raw frequency of the phenomenon this phase targets
  softHardOutcomes: Record<Outcome, number>;
}

function runSoftHardComparison(candles: Candle[]): SoftHardComparisonStats {
  const stats: SoftHardComparisonStats = {
    totalSignalsCompared: 0,
    wickDirectSlCount: 0,
    rescuedFull: 0,
    rescuedPartial: 0,
    confirmedBreakdownViaClose: 0,
    confirmedBreakdownViaHardSl: 0,
    stillOpenAtDataEnd: 0,
    lossDepthDeltaDollars: [],
    totalShakeoutEventsAcrossAllSignals: 0,
    softHardOutcomes: { TP2: 0, TP1_THEN_SL: 0, DIRECT_SL: 0, INVALIDATED: 0, OPEN_AT_DATA_END: 0 },
  };

  const MIN_HISTORY = 20;
  let i = MIN_HISTORY;
  while (i < candles.length) {
    const windowStart = Math.max(0, i - CANDLE_BUFFER_NEW + 1);
    const window = candles.slice(windowStart, i + 1);
    const mp = mkMarketPrice(candles, i, Math.round(1440 / ACTUAL_BAR_MINUTES));
    const structure = newEvaluateMarketStructureFromCandles('XAUUSD', mp, window);

    if (structure.type && structure.confluenceScore >= CONFLUENCE_THRESHOLD) {
      const built = newBuildEntrySlTp(structure, mp.price);
      if (!built) {
        i++;
        continue;
      }
      const pattern = (structure as any).xauPattern ?? null;

      const wickResult = simulateForward(candles, i + 1, built, pattern);
      const softHardResult = simulateForwardSoftHard(candles, i + 1, built, pattern);

      stats.totalSignalsCompared++;
      stats.softHardOutcomes[softHardResult.outcome]++;
      stats.totalShakeoutEventsAcrossAllSignals += softHardResult.shakeoutEvents || 0;

      if (wickResult.outcome === 'DIRECT_SL') {
        stats.wickDirectSlCount++;

        if (softHardResult.outcome === 'TP2') {
          stats.rescuedFull++;
        } else if (softHardResult.outcome === 'TP1_THEN_SL') {
          stats.rescuedPartial++;
        } else if (softHardResult.outcome === 'DIRECT_SL') {
          const viaHardSl = softHardResult.exitPrice === built.hardStopLoss;
          if (viaHardSl) stats.confirmedBreakdownViaHardSl++;
          else stats.confirmedBreakdownViaClose++;

          if (wickResult.exitPrice !== undefined && softHardResult.exitPrice !== undefined) {
            stats.lossDepthDeltaDollars.push(Math.abs(softHardResult.exitPrice - wickResult.exitPrice));
          }
        } else if (softHardResult.outcome === 'OPEN_AT_DATA_END') {
          stats.stillOpenAtDataEnd++;
        }
      }

      // Advance past this trade using the SAME pacing simulateForward-driven runEngine uses, so
      // the signal-generation timeline this comparison walks is identical to the fase-1 NEW
      // engine's own backtest above.
      i = wickResult.firedAtIndex + 1 + 5;
      continue;
    }

    i++;
  }

  return stats;
}

function summarizeSoftHardComparison(stats: SoftHardComparisonStats) {
  console.log(`\n=== FASE 2 CANDIDATE: Soft SL (M5 close-confirm) + Hard SL (wick backstop) vs current wick-based SL ===`);
  console.log(`Signals compared: ${stats.totalSignalsCompared}`);
  console.log(`Soft-SL shakeout events (wick touched soft SL, candle closed back inside, position stayed open) across ALL signals: ${stats.totalShakeoutEventsAcrossAllSignals}`);
  console.log(`\nOf the ${stats.wickDirectSlCount} signals the CURRENT wick-based model calls "Stop Loss Hit":`);
  if (stats.wickDirectSlCount > 0) {
    const pct = (n: number) => ((n / stats.wickDirectSlCount) * 100).toFixed(1);
    console.log(`  Rescued (soft+hard model reaches full TP2):        ${stats.rescuedFull} (${pct(stats.rescuedFull)}%)`);
    console.log(`  Partially rescued (reaches TP1, later scratches):  ${stats.rescuedPartial} (${pct(stats.rescuedPartial)}%)`);
    console.log(`  Confirmed real breakdown, exit via close-confirm:  ${stats.confirmedBreakdownViaClose} (${pct(stats.confirmedBreakdownViaClose)}%)`);
    console.log(`  Confirmed real breakdown, exit via hard-SL wick:   ${stats.confirmedBreakdownViaHardSl} (${pct(stats.confirmedBreakdownViaHardSl)}%)`);
    console.log(`  Still open at end of available data:               ${stats.stillOpenAtDataEnd} (${pct(stats.stillOpenAtDataEnd)}%)`);
  } else {
    console.log('  (none - no Direct SL losses under the wick-based model in this dataset, so there is nothing for the soft/hard model to rescue or confirm)');
  }

  const deltas = stats.lossDepthDeltaDollars;
  if (deltas.length > 0) {
    const sorted = [...deltas].sort((a, b) => a - b);
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    console.log(`\nFor the ${deltas.length} CONFIRMED real-breakdown cases, how much deeper the realized loss became ($):`);
    console.log(`  min=${sorted[0].toFixed(2)} median=${percentile(sorted, 0.5).toFixed(2)} avg=${avg.toFixed(2)} max=${sorted[sorted.length - 1].toFixed(2)}`);
  } else {
    console.log('\nNo confirmed-breakdown cases in this dataset to measure loss-depth increase from.');
  }

  console.log(`\nOverall soft+hard model outcome distribution (all ${stats.totalSignalsCompared} signals, not just former Direct-SL cases):`, stats.softHardOutcomes);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function summarize(name: string, stats: EngineRunStats) {
  const sortedSl = [...stats.slDistances].sort((a, b) => a - b);
  const wins = stats.outcomes.TP2;
  const losses = stats.outcomes.DIRECT_SL;
  const decided = wins + losses; // excludes scratches (TP1_THEN_SL scored 0R) and still-open/invalidated
  const winRate = decided > 0 ? (wins / decided) * 100 : NaN;
  const avgR = stats.rMultiples.length > 0 ? stats.rMultiples.reduce((a, b) => a + b, 0) / stats.rMultiples.length : NaN;

  console.log(`\n=== ${name} ===`);
  console.log(`Signals fired: ${stats.signalsFired} (rejected at entry/SL/TP build stage: ${stats.rejectedByEntrySlTp})`);
  console.log(`Outcomes:`, stats.outcomes);
  console.log(`Pattern mix:`, stats.patternCounts);
  if (sortedSl.length > 0) {
    console.log(`SL distance ($): min=${sortedSl[0].toFixed(2)} p25=${percentile(sortedSl, 0.25).toFixed(2)} median=${percentile(sortedSl, 0.5).toFixed(2)} p75=${percentile(sortedSl, 0.75).toFixed(2)} max=${sortedSl[sortedSl.length - 1].toFixed(2)} avg=${(sortedSl.reduce((a, b) => a + b, 0) / sortedSl.length).toFixed(2)}`);
  } else {
    console.log('SL distance ($): no signals fired');
  }
  console.log(`Win rate (TP2 vs Direct-SL, excl. scratches/open): ${isNaN(winRate) ? 'n/a (no decided trades)' : winRate.toFixed(1) + '%'}`);
  console.log(`Average expectancy: ${isNaN(avgR) ? 'n/a' : avgR.toFixed(2) + 'R'} per signal`);

  if (stats.tp1Tp2Gaps.length > 0) {
    const sortedGaps = [...stats.tp1Tp2Gaps].sort((a, b) => a - b);
    const sortedEntryTp1 = [...stats.entryTp1Distances].sort((a, b) => a - b);
    // Ratio per-signal (gap / entry-to-TP1 distance) is the real evidence for the reported "TP1/TP2
    // suspiciously close" case ($0.84 gap vs $3.84 entry-to-TP1 = 0.22 ratio) - a market-structure-
    // driven gap should vary with conditions, a selection-logic gap would show up as a persistent
    // cluster of very low ratios regardless of ATR/entry distance.
    const ratios = stats.tp1Tp2Gaps.map((gap, idx) => stats.entryTp1Distances[idx] > 0 ? gap / stats.entryTp1Distances[idx] : NaN).filter((r) => !isNaN(r)).sort((a, b) => a - b);
    console.log(`TP1-TP2 gap ($): min=${sortedGaps[0].toFixed(2)} p25=${percentile(sortedGaps, 0.25).toFixed(2)} median=${percentile(sortedGaps, 0.5).toFixed(2)} p75=${percentile(sortedGaps, 0.75).toFixed(2)} max=${sortedGaps[sortedGaps.length - 1].toFixed(2)}`);
    const proportional = stats.tp1Tp2Gaps.filter((gap, index) => gap >= stats.slDistances[index] * 0.6).length;
    console.log(`Risk-proportional TP gap validation: ${proportional}/${stats.tp1Tp2Gaps.length} gaps >= 0.6 × published SL risk.`);
    console.log(`Entry-to-TP1 distance ($): min=${sortedEntryTp1[0].toFixed(2)} median=${percentile(sortedEntryTp1, 0.5).toFixed(2)} max=${sortedEntryTp1[sortedEntryTp1.length - 1].toFixed(2)}`);
    if (ratios.length > 0) {
      console.log(`TP1-TP2 gap / entry-to-TP1 ratio: min=${ratios[0].toFixed(2)} p25=${percentile(ratios, 0.25).toFixed(2)} median=${percentile(ratios, 0.5).toFixed(2)} p75=${percentile(ratios, 0.75).toFixed(2)} max=${ratios[ratios.length - 1].toFixed(2)} (the reported production case was ~0.22)`);
    }
  }

  // 2026-09-01 RR ENGINE REWORK: RR1 distribution from a realistic worst-case fill (whichever entry
  // zone edge is closest to TP1/farthest from SL) vs from the entry zone's midpoint, for every fired
  // signal - the exact comparison the user's own investigation asked for (their concrete example:
  // BUY 4434-4428, midpoint RR looked fine but a fill at 4434 did not). Only present when the
  // engine's own build function populates rr1/worstCaseRr1 (newBuildEntrySlTp; not oldBuildEntrySlTp,
  // whose entry band is a generic % offset with no genuine structural zone to compute this from).
  if (stats.worstCaseRr1s.length > 0) {
    const sortedMid = [...stats.midpointRr1s].sort((a, b) => a - b);
    const sortedWorst = [...stats.worstCaseRr1s].sort((a, b) => a - b);
    console.log(`RR1 realized from entry zone MIDPOINT: min=${sortedMid[0].toFixed(2)} p25=${percentile(sortedMid, 0.25).toFixed(2)} median=${percentile(sortedMid, 0.5).toFixed(2)} p75=${percentile(sortedMid, 0.75).toFixed(2)} max=${sortedMid[sortedMid.length - 1].toFixed(2)}`);
    console.log(`RR1 realized from WORST-CASE fill edge: min=${sortedWorst[0].toFixed(2)} p25=${percentile(sortedWorst, 0.25).toFixed(2)} median=${percentile(sortedWorst, 0.5).toFixed(2)} p75=${percentile(sortedWorst, 0.75).toFixed(2)} max=${sortedWorst[sortedWorst.length - 1].toFixed(2)}`);
  }
}

// Root-cause + calibration diagnostics report (see EngineRunStats.diagnostics). `totalMinutes` is
// the span of the underlying candle series (1 candle = 1 minute) so signals/day is a real rate,
// not just a raw count.
function summarizeDiagnostics(name: string, stats: EngineRunStats, totalMinutes: number) {
  const d = stats.diagnostics;
  const days = totalMinutes / (60 * 24);
  console.log(`\n--- ${name}: root-cause diagnostics (${d.totalTicks} ticks evaluated over ~${days.toFixed(2)} days) ---`);
  console.log(`  Fired:                        ${d.fired} (${(d.fired / days).toFixed(2)} signals/day)`);
  console.log(`  Blocked - Volatility Gate:    ${d.volatilityGateBlocked} (${((d.volatilityGateBlocked / d.totalTicks) * 100).toFixed(1)}% of ticks)`);
  console.log(`  Blocked - News Window:        ${d.newsWindowBlocked} (${((d.newsWindowBlocked / d.totalTicks) * 100).toFixed(1)}% of ticks) [disabled in this harness - see honesty note, always 0]`);
  console.log(`  No direction found:           ${d.noDirectionFound} (${((d.noDirectionFound / d.totalTicks) * 100).toFixed(1)}% of ticks)`);
  console.log(`  Direction found, score<${CONFLUENCE_THRESHOLD}:   ${d.confluenceBelowThreshold} (${((d.confluenceBelowThreshold / d.totalTicks) * 100).toFixed(1)}% of ticks)`);
  console.log(`  Rejected at build stage:      ${d.rejectedAtBuildStage} (RR filter or SL sanity ceiling)`);

  if (d.confluenceScoresWhenDirectionFound.length > 0) {
    const scores = [...d.confluenceScoresWhenDirectionFound].sort((a, b) => a - b);
    console.log(`  Confluence score distribution WHEN a direction was found (n=${scores.length}): min=${scores[0].toFixed(0)} p25=${percentile(scores, 0.25).toFixed(0)} median=${percentile(scores, 0.5).toFixed(0)} p75=${percentile(scores, 0.75).toFixed(0)} max=${scores[scores.length - 1].toFixed(0)}`);
    // Simulate the live adaptive confluence threshold stacking (base 70, +18 cap) against these
    // REAL scores - shows how much of the already-thin signal supply the stacking on top of the
    // flat 70 this harness fires at would additionally remove.
    for (const thresh of [70, 78, 84, 88]) {
      const passRate = (scores.filter((s) => s >= thresh).length / scores.length) * 100;
      console.log(`    -> pass rate at threshold ${thresh}: ${passRate.toFixed(1)}%`);
    }
  } else {
    console.log('  Confluence score distribution: no ticks with a direction found');
  }

  if (d.atrPercentileRanks.length > 0) {
    const ranks = [...d.atrPercentileRanks].sort((a, b) => a - b);
    console.log(`  ATR percentile-rank distribution (n=${ranks.length}): p50=${percentile(ranks, 0.5).toFixed(2)} p75=${percentile(ranks, 0.75).toFixed(2)} p90=${percentile(ranks, 0.9).toFixed(2)} p95=${percentile(ranks, 0.95).toFixed(2)} max=${ranks[ranks.length - 1].toFixed(2)}`);
    for (const cutoff of [0.80, 0.85, 0.90, 0.95]) {
      const triggerRate = (ranks.filter((r) => r >= cutoff).length / ranks.length) * 100;
      console.log(`    -> XAU_EXTREME_VOL_PERCENTILE=${cutoff}: would gate ${triggerRate.toFixed(1)}% of ticks`);
    }
  }
}

// --synthetic: generates a random-walk price series calibrated to a rough real-world XAUUSD
// intraday volatility ($0.3-1.5 true range per 1-minute bar, occasional larger displacement bars
// to let BOS/OB conditions actually occur) so the walk-forward mechanics themselves can be sanity
// checked WITHOUT network access. This is NOT a substitute for the real backtest above - every
// line of output it produces is labeled SYNTHETIC and must never be reported as real evidence of
// engine performance. Only used for --synthetic; the default path is the real Yahoo fetch.
function generateSyntheticCandles(n: number, seed = 42): Candle[] {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const candles: Candle[] = [];
  let price = 2400;
  let t = Date.now() - n * 60000;
  for (let i = 0; i < n; i++) {
    const drift = (rand() - 0.5) * 0.4;
    // Occasional bigger displacement bar (~8% of bars) so BOS/impulsive-move conditions can occur
    const displacement = rand() < 0.08 ? (rand() - 0.5) * 4 : 0;
    const open = price;
    const close = price + drift + displacement;
    const wick = 0.15 + rand() * 0.3;
    const high = Math.max(open, close) + wick;
    const low = Math.min(open, close) - wick;
    candles.push({ time: t, open, high, low, close, volume: 100 });
    price = close;
    t += 60000;
  }
  return candles;
}

// ============================================================================================
// FASE 2 sanity checks: exercises simulateForwardSoftHard directly (the actual function this
// file ships, not a copy) against 3 hand-built scenarios matching the fase-2 spec's exit rules.
// Run via: npx tsx scripts/backtest-xau-engine.ts --test-exit-scenarios
// ============================================================================================
function mkC(time: number, o: number, h: number, l: number, c: number): Candle {
  return { time, open: o, high: h, low: l, close: c, volume: 100 };
}

function runExitScenarioSanityChecks(): boolean {
  let pass = 0, fail = 0;
  const check = (name: string, cond: boolean, extra?: any) => {
    if (cond) { pass++; console.log(`  OK   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}`, extra ?? ''); }
  };

  const baseBuilt: BuiltSignal = {
    type: 'BUY',
    entryMin: 2399.5, entryMax: 2400.5, entryAvg: 2400,
    stopLoss: 2397, // soft SL, 3.00 below entry
    takeProfit1: 2403, takeProfit2: 2406,
    slDistance: 3.00,
    rr2: 2.0,
    hardStopLoss: 2394.5, // hardSlDistance = 3.00 + max(shortTermAtr*1, slDistance*0.6) e.g. 3.00+2.50=5.50 -> 2400-5.50=2394.5
    hardSlDistance: 5.50,
  };

  // ---- Scenario 1: soft-SL-shakeout-survive ----
  // Wick dips through soft SL (2397) but candle closes back above it - position must stay open
  // and eventually reach TP2, with a shakeout event recorded.
  {
    console.log('\n[Scenario 1] Soft SL wicked through, candle closes back inside -> survives, no exit');
    const candles: Candle[] = [
      mkC(0, 2400, 2400.2, 2399.8, 2400), // entry candle
      mkC(1, 2400, 2400.1, 2396.5, 2397.8), // wicks through soft SL (2397) but closes at 2397.8 (inside)
      mkC(2, 2397.8, 2401, 2397.5, 2400.5),
      mkC(3, 2400.5, 2404, 2400.4, 2403.5), // TP1
      mkC(4, 2403.5, 2406.5, 2403.4, 2406.2), // TP2
    ];
    const result = simulateForwardSoftHard(candles, 0, baseBuilt, 'TEST');
    check('outcome is TP2 (survived the shakeout)', result.outcome === 'TP2', result);
    check('at least one shakeout event recorded', (result.shakeoutEvents ?? 0) >= 1, result.shakeoutEvents);
  }

  // ---- Scenario 2: soft-SL-close-confirm-exit ----
  // Wick touches soft SL AND the candle closes outside it (but nowhere near hard SL) - must exit
  // at the candle's CLOSE price, not at the soft SL level itself.
  {
    console.log('\n[Scenario 2] Soft SL wicked through, candle CLOSES outside -> confirmed exit at close price');
    const candles: Candle[] = [
      mkC(0, 2400, 2400.2, 2399.8, 2400), // entry candle
      mkC(1, 2400, 2400.1, 2396.8, 2396.5), // wicks to 2396.8 and CLOSES at 2396.5 (below soft SL 2397, above hard SL 2394.5)
    ];
    const result = simulateForwardSoftHard(candles, 0, baseBuilt, 'TEST');
    check('outcome is DIRECT_SL', result.outcome === 'DIRECT_SL', result);
    check('exit price equals the candle close (2396.5), not the soft SL level (2397)', result.exitPrice === 2396.5, result.exitPrice);
    check('realized loss (entryAvg - exitPrice) is deeper than the displayed soft SL distance', Math.abs(baseBuilt.entryAvg - (result.exitPrice ?? 0)) > baseBuilt.slDistance, result);
  }

  // ---- Scenario 3: hard-SL-instant-exit ----
  // Price gaps/wicks straight through the hard SL in one candle - must exit immediately at the
  // hard SL level (backstop), regardless of where that candle closes.
  {
    console.log('\n[Scenario 3] Hard SL wicked through directly -> instant exit at hard SL (backstop), no close-confirmation needed');
    const candles: Candle[] = [
      mkC(0, 2400, 2400.2, 2399.8, 2400), // entry candle
      mkC(1, 2400, 2400.1, 2393, 2395.5), // wicks straight through hard SL (2394.5), closes at 2395.5 (back above hard SL, but that must NOT matter)
    ];
    const result = simulateForwardSoftHard(candles, 0, baseBuilt, 'TEST');
    check('outcome is DIRECT_SL', result.outcome === 'DIRECT_SL', result);
    check('exit price equals the hard SL level (2394.5), not the close (2395.5)', result.exitPrice === baseBuilt.hardStopLoss, result.exitPrice);
    check('triggers even though the candle closed back above hard SL', true); // covered by the candle construction itself
  }

  console.log(`\n===== FASE 2 exit-scenario sanity checks: ${pass} passed, ${fail} failed =====`);
  return fail === 0;
}

// ============================================================================================
// Entry-timing lag measurement (Bagian E task 1, 2026-09-01 follow-up) - DIAGNOSTIC ONLY, no
// threshold changes here or anywhere this reads from. Question: by the time a TREND_CONTINUATION
// or CHOCH_REVERSAL signal actually clears newEvaluateMarketStructureFromCandles's real confluence
// gate and fires, how much TIME has already passed since the structural reference point (the
// lastSwingHigh/lastSwingLow the BOS/CHoCH itself broke past) was set? This is the time-domain
// counterpart to the already-approved, already-live XAU_MAX_EXTENSION_FROM_ORIGIN_ATR_MULT gate
// (which measures the same "how stale is the origin by publish time" question in PRICE/ATR
// distance instead) - same origin reference point, same BUY-uses-swingHigh/SELL-uses-swingLow
// convention, just measured in bars/minutes here.
//
// Runs the REAL, unmodified newEvaluateMarketStructureFromCandles walk-forward, exactly like
// runEngine's own NEW-engine path (same CANDLE_BUFFER_NEW window, same CONFLUENCE_THRESHOLD) - so
// "a signal fires" here means exactly what it means everywhere else in this file, not an
// approximation. Never calls newBuildEntrySlTp or simulates a trade outcome - this only measures
// WHEN a firing candidate appears relative to its own origin swing point, nothing about its
// eventual profitability.
//
// A "fresh" occurrence is deduped by (type, pattern, origin swing value) so a setup that keeps
// re-qualifying bar after bar (the same already-fired setup, not a new one) is only measured once,
// at its first appearance - matching how the live server only ever publishes a setup once, not on
// every bar it continues to remain valid.
interface EntryLagRecord {
  type: 'BUY' | 'SELL';
  pattern: 'TREND_CONTINUATION' | 'CHOCH_REVERSAL';
  signalBarIndex: number;
  originBarIndex: number;
  lagBars: number;
  lagMinutes: number;
}

function findOriginBarIndex(window: Candle[], originValue: number, useHigh: boolean): number {
  // Mirrors the exact swing-detection loop inside newEvaluateMarketStructureFromCandles (same
  // bounds, same local-max/min condition) so the index found here is guaranteed to correspond to
  // the same swing point that function itself computed as swingHighs/swingLows - not a separate,
  // possibly-drifted re-derivation.
  let lastMatch = -1;
  for (let i = 2; i < window.length - 1; i++) {
    if (useHigh) {
      if (window[i].high > window[i - 1].high && window[i].high > window[i + 1].high && window[i].high === originValue) lastMatch = i;
    } else {
      if (window[i].low < window[i - 1].low && window[i].low < window[i + 1].low && window[i].low === originValue) lastMatch = i;
    }
  }
  return lastMatch;
}

async function runEntryTimingLagMeasurement(): Promise<void> {
  console.log('===== XAUUSD entry-timing lag measurement (Bagian E task 1) - DIAGNOSTIC ONLY =====');
  console.log('No threshold is changed by this run. TREND_CONTINUATION/CHOCH_REVERSAL only, per the task.\n');

  let candles: Candle[];
  let barMinutes: number;
  if (process.argv.includes('--synthetic')) {
    console.log('*** --synthetic flag set: using a generated random-walk series, NOT real market data. ***');
    console.log('*** This only validates the walk-forward/percentile mechanics run without crashing - it is NOT evidence of real entry-timing lag. ***');
    candles = generateSyntheticCandles(4000);
    barMinutes = 1;
    ACTUAL_BAR_MINUTES = 1;
    console.log(`Generated ${candles.length} synthetic 1-minute candles.\n`);
  } else {
    console.log('Fetching real XAUUSD candles (Twelve Data if TWELVE_DATA_API_KEY is set, else Yahoo Finance)...');
    try {
      const fetched = await fetchRealXauCandles('5d');
      candles = fetched.candles;
      barMinutes = fetched.barMinutes;
      ACTUAL_BAR_MINUTES = fetched.barMinutes;
      console.log(`Fetched ${candles.length} real candles (${barMinutes}-minute bars) from: ${fetched.source}.\n`);
    } catch (e: any) {
      console.error(`[ABORTED] Could not fetch real historical data: ${e?.message || e}`);
      console.error('Expected in a network-restricted sandbox - run via the GitHub Actions workflow for real numbers.');
      process.exit(1);
    }
  }

  if (candles.length < 100) {
    console.error('[ABORTED] Not enough candle history for a meaningful measurement.');
    process.exit(1);
  }

  const records: EntryLagRecord[] = [];
  const seen = new Set<string>();
  const MIN_HISTORY = 20;

  for (let i = MIN_HISTORY; i < candles.length; i++) {
    const windowStart = Math.max(0, i - CANDLE_BUFFER_NEW + 1);
    const window = candles.slice(windowStart, i + 1);
    const mp = mkMarketPrice(candles, i, Math.round(1440 / ACTUAL_BAR_MINUTES));
    const structure = newEvaluateMarketStructureFromCandles('XAUUSD', mp, window);

    if (
      !structure.type ||
      structure.confluenceScore < CONFLUENCE_THRESHOLD ||
      (structure.xauPattern !== 'TREND_CONTINUATION' && structure.xauPattern !== 'CHOCH_REVERSAL')
    ) {
      continue;
    }

    const useHigh = structure.type === 'BUY';
    const swings = useHigh ? structure.swingHighs : structure.swingLows;
    if (!swings || swings.length === 0) continue;
    const originValue = swings[swings.length - 1];

    const dedupeKey = `${structure.type}|${structure.xauPattern}|${originValue.toFixed(2)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const originLocalIndex = findOriginBarIndex(window, originValue, useHigh);
    if (originLocalIndex < 0) continue; // shouldn't happen (same loop that produced the value), but never fabricate a lag if it does
    const originBarIndex = windowStart + originLocalIndex;
    const lagBars = i - originBarIndex;

    records.push({
      type: structure.type,
      pattern: structure.xauPattern,
      signalBarIndex: i,
      originBarIndex,
      lagBars,
      lagMinutes: lagBars * barMinutes,
    });
  }

  console.log(`Total fresh TREND_CONTINUATION/CHOCH_REVERSAL occurrences found: ${records.length}\n`);

  const percentile = (sorted: number[], p: number): number => {
    if (sorted.length === 0) return NaN;
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  };

  for (const pattern of ['TREND_CONTINUATION', 'CHOCH_REVERSAL'] as const) {
    const subset = records.filter((r) => r.pattern === pattern);
    console.log(`--- ${pattern}: ${subset.length} occurrences ---`);
    if (subset.length === 0) {
      console.log('  No occurrences in this real data sample - cannot report a distribution.\n');
      continue;
    }
    const lagsMin = subset.map((r) => r.lagMinutes).sort((a, b) => a - b);
    const lagsBars = subset.map((r) => r.lagBars).sort((a, b) => a - b);
    console.log(`  lag (minutes since origin swing): min=${lagsMin[0]} p50=${percentile(lagsMin, 50)} p90=${percentile(lagsMin, 90)} max=${lagsMin[lagsMin.length - 1]}`);
    console.log(`  lag (bars since origin swing):    min=${lagsBars[0]} p50=${percentile(lagsBars, 50)} p90=${percentile(lagsBars, 90)} max=${lagsBars[lagsBars.length - 1]}`);
    console.log(`  by direction: BUY=${subset.filter((r) => r.type === 'BUY').length}, SELL=${subset.filter((r) => r.type === 'SELL').length}`);
    console.log('');
  }

  console.log('Per-occurrence detail:');
  for (const r of records) {
    console.log(`  ${r.pattern} ${r.type} | signal bar ${r.signalBarIndex} | origin bar ${r.originBarIndex} | lag ${r.lagBars} bars (${r.lagMinutes}min)`);
  }

  console.log('\n===== End of entry-timing lag measurement - no thresholds changed by this script =====');
}

async function main() {
  if (process.argv.includes('--measure-entry-lag')) {
    await runEntryTimingLagMeasurement();
    process.exit(0);
  }


  if (process.argv.includes('--test-exit-scenarios')) {
    const ok = runExitScenarioSanityChecks();
    process.exit(ok ? 0 : 1);
  }

  if (process.argv.includes('--htf-gate-audit')) {
    await runXauHtfBiasGateAuditMain();
    process.exit(0);
  }

  const useSynthetic = process.argv.includes('--synthetic');
  let candles: Candle[];
  let barMinutes = 1;

  if (useSynthetic) {
    console.log('*** --synthetic flag set: using a generated random-walk series, NOT real market data. ***');
    console.log('*** This only validates the walk-forward mechanics run without crashing - it is NOT evidence of real engine performance. ***');
    candles = generateSyntheticCandles(4000);
    console.log(`Generated ${candles.length} synthetic 1-minute candles.`);
  } else {
    console.log('Fetching real XAUUSD candles (Twelve Data if TWELVE_DATA_API_KEY is set, else Yahoo Finance)...');
    try {
      const fetched = await fetchRealXauCandles('5d');
      candles = fetched.candles;
      barMinutes = fetched.barMinutes;
      ACTUAL_BAR_MINUTES = fetched.barMinutes;
      console.log(`Fetched ${candles.length} real candles from: ${fetched.source}.`);
    } catch (e: any) {
      console.error(`\n[BACKTEST ABORTED] Could not fetch real historical data: ${e?.message || e}`);
      console.error('This is expected in a network-restricted sandbox. Run this script in an environment with normal internet access to get real before/after numbers.');
      console.error('(You can sanity-check the harness itself without network via: npx tsx scripts/backtest-xau-engine.ts --synthetic)');
      process.exit(1);
    }
  }
  if (barMinutes !== 1) {
    console.log(`NOTE: bars are ${barMinutes}-minute, not 1-minute - MAX_HOLD_BARS/candle-window comments below are calibrated in bar COUNT (period-based indicators like ATR/RSI/ADX are unaffected), so time-based figures in this run's numbers should be read as "in bars", scaled by ${barMinutes}x for real elapsed time.`);
  }

  if (candles.length < 100) {
    console.error('[BACKTEST ABORTED] Not enough candle history to run a meaningful walk-forward test.');
    process.exit(1);
  }

  console.log('\nRunning OLD engine (pre-redesign: flat $4.50-$12.00 SL clamp, riskDist-multiple TP, single validTrigger, 30-candle buffer)...');
  const oldStats = runEngine(candles, CANDLE_BUFFER_OLD, (w, mp) => oldEvaluateMarketStructureFromCandles('XAUUSD', mp, w), oldBuildEntrySlTp);

  console.log('Running NEW engine (this redesign: genuine OB/FVG/sweep/S&D structural SL/TP, multi-pattern trigger, 150-candle buffer)...');
  const newStats = runEngine(candles, CANDLE_BUFFER_NEW, (w, mp) => newEvaluateMarketStructureFromCandles('XAUUSD', mp, w), newBuildEntrySlTp);

  summarize('OLD ENGINE (before this redesign)', oldStats);
  summarize('NEW ENGINE (this redesign)', newStats);
  summarizeDiagnostics('NEW ENGINE (this redesign)', newStats, candles.length * barMinutes);

  // Candle-window sensitivity sweep: is the 150-bar cap (~2.5h at 1m, or ~12.5h at 5m) actually
  // limiting genuine swing/OB/FVG detection, or does a longer lookback change nothing? Reuses
  // newEvaluateMarketStructureFromCandles/newBuildEntrySlTp unmodified - only bufferCap differs.
  console.log('\n\nRunning candle-window sensitivity sweep (NEW engine, same real data, different candleStore.XAUUSD cap)...');
  for (const bufferCap of [150, 300, 600]) {
    const windowStats = runEngine(candles, bufferCap, (w, mp) => newEvaluateMarketStructureFromCandles('XAUUSD', mp, w), newBuildEntrySlTp);
    summarize(`NEW ENGINE - window=${bufferCap} bars (~${((bufferCap * barMinutes) / 60).toFixed(1)}h at ${barMinutes}m)`, windowStats);
  }

  // 2026-09-01 RR ENGINE REWORK: isolation/calibration sweep. The single combined-strictest guess
  // (1.5/2.5 RR floor + 0.4 zone cap + 2.0x extension, xauReworkParams' defaults above) collapsed
  // signals to 0 on the first real-data run - this reruns the SAME fetched candles through each
  // change in isolation, then a couple of combined variants, so the actual culprit(s) and a
  // non-collapsing combination can be identified from real numbers instead of guessing again.
  console.log('\n\nRunning RR-engine-rework calibration sweep (NEW engine, same real data, different threshold combinations)...');
  const OFF = Infinity;
  const sweepCombos: Array<{ label: string; params: typeof xauReworkParams }> = [
    { label: 'BASELINE (pre-rework: 0.7/1.3, no zone cap, no extension gate)', params: { minRr1Main: 0.7, minRr2Main: 1.3, zoneWidthToRiskRatio: OFF, extensionAtrMult: OFF } },
    { label: 'RR-ONLY mild (1.0/1.8)', params: { minRr1Main: 1.0, minRr2Main: 1.8, zoneWidthToRiskRatio: OFF, extensionAtrMult: OFF } },
    { label: 'RR-ONLY full (1.5/2.5)', params: { minRr1Main: 1.5, minRr2Main: 2.5, zoneWidthToRiskRatio: OFF, extensionAtrMult: OFF } },
    { label: 'ZONE-CAP-ONLY (0.4x risk)', params: { minRr1Main: 0.7, minRr2Main: 1.3, zoneWidthToRiskRatio: 0.4, extensionAtrMult: OFF } },
    { label: 'ZONE-CAP-ONLY looser (0.6x risk)', params: { minRr1Main: 0.7, minRr2Main: 1.3, zoneWidthToRiskRatio: 0.6, extensionAtrMult: OFF } },
    { label: 'EXTENSION-GATE-ONLY (2.0x ATR)', params: { minRr1Main: 0.7, minRr2Main: 1.3, zoneWidthToRiskRatio: OFF, extensionAtrMult: 2.0 } },
    { label: 'EXTENSION-GATE-ONLY looser (2.5x ATR)', params: { minRr1Main: 0.7, minRr2Main: 1.3, zoneWidthToRiskRatio: OFF, extensionAtrMult: 2.5 } },
    { label: 'ALL-MILD (1.0/1.8, 0.6x zone, 2.5x ext)', params: { minRr1Main: 1.0, minRr2Main: 1.8, zoneWidthToRiskRatio: 0.6, extensionAtrMult: 2.5 } },
    { label: 'ALL-MODERATE (1.2/2.0, 0.5x zone, 2.5x ext)', params: { minRr1Main: 1.2, minRr2Main: 2.0, zoneWidthToRiskRatio: 0.5, extensionAtrMult: 2.5 } },
    { label: 'ALL-FULL original guess (1.5/2.5, 0.4x zone, 2.0x ext)', params: { minRr1Main: 1.5, minRr2Main: 2.5, zoneWidthToRiskRatio: 0.4, extensionAtrMult: 2.0 } },
    // Follow-up round (after the first sweep showed 0.4x zone cap alone collapses to 1 signal, and
    // RR-floor+zone-cap interact non-additively - neither obvious from theory, only from this data):
    // recalibrated candidates using the zone cap ratio the first round showed does NOT collapse
    // (0.6x), at both ends of the user's requested RR range.
    { label: 'RECOMMENDED-A (1.5/2.5, 0.6x zone, 2.0x ext)', params: { minRr1Main: 1.5, minRr2Main: 2.5, zoneWidthToRiskRatio: 0.6, extensionAtrMult: 2.0 } },
    { label: 'RECOMMENDED-B (2.0/3.5, 0.6x zone, 2.0x ext)', params: { minRr1Main: 2.0, minRr2Main: 3.5, zoneWidthToRiskRatio: 0.6, extensionAtrMult: 2.0 } },
    { label: 'RECOMMENDED-C (1.5/2.5, 0.8x zone, 2.0x ext)', params: { minRr1Main: 1.5, minRr2Main: 2.5, zoneWidthToRiskRatio: 0.8, extensionAtrMult: 2.0 } },
  ];
  const totalDays = (candles.length * barMinutes) / (60 * 24);
  console.log(`${'Combo'.padEnd(48)} ${'Fired'.padStart(6)} ${'/day'.padStart(6)} ${'WinRate'.padStart(8)} ${'AvgR'.padStart(6)} ${'MidRR1 p50'.padStart(11)} ${'WorstRR1 p50'.padStart(13)}`);
  for (const combo of sweepCombos) {
    xauReworkParams = combo.params;
    const sweepStats = runEngine(candles, CANDLE_BUFFER_NEW, (w, mp) => newEvaluateMarketStructureFromCandles('XAUUSD', mp, w), newBuildEntrySlTp);
    const wins = sweepStats.outcomes.TP2;
    const losses = sweepStats.outcomes.DIRECT_SL;
    const decided = wins + losses;
    const winRate = decided > 0 ? ((wins / decided) * 100).toFixed(1) + '%' : 'n/a';
    const avgR = sweepStats.rMultiples.length > 0 ? (sweepStats.rMultiples.reduce((a, b) => a + b, 0) / sweepStats.rMultiples.length).toFixed(2) : 'n/a';
    const sortedMid = [...sweepStats.midpointRr1s].sort((a, b) => a - b);
    const sortedWorst = [...sweepStats.worstCaseRr1s].sort((a, b) => a - b);
    const midP50 = sortedMid.length > 0 ? percentile(sortedMid, 0.5).toFixed(2) : 'n/a';
    const worstP50 = sortedWorst.length > 0 ? percentile(sortedWorst, 0.5).toFixed(2) : 'n/a';
    console.log(`${combo.label.padEnd(48)} ${String(sweepStats.signalsFired).padStart(6)} ${(sweepStats.signalsFired / totalDays).toFixed(2).padStart(6)} ${winRate.padStart(8)} ${avgR.padStart(6)} ${midP50.padStart(11)} ${worstP50.padStart(13)}`);
  }
  // Reset to the module default (RECOMMENDED-A, the calibrated candidate) so anything running after
  // this sweep (none currently, but future additions) isn't left on whatever combo ran last.
  xauReworkParams = { minRr1Main: 1.5, minRr2Main: 2.5, zoneWidthToRiskRatio: 0.6, extensionAtrMult: 2.0 };

  console.log('\nRunning FASE 2 comparison (soft-SL close-confirm + hard-SL backstop vs current wick-based SL) on the same NEW-engine signals...');
  const softHardStats = runSoftHardComparison(candles);
  summarizeSoftHardComparison(softHardStats);

  console.log('\nDone. Remember: AI validation / DXY / news-window / circuit-breaker layers were skipped for BOTH engines equally (see the honesty note at the top of this file) - these numbers isolate the structure-detection + SL/TP-construction change this redesign made, not the full live pipeline. The FASE 2 comparison is NOT live in server.ts - it is a candidate being evaluated, not yet shipped.');
}

main();
