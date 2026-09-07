import type { MarketPrice, PairId } from '../types';

/**
 * Derivation layer for the Analysis modules (Fase 3).
 *
 * Every function here is a pure computation over numbers the backend already publishes - engine
 * candles, live quotes, FRED prints, the DXY tracker. Nothing invents a datapoint, and nothing
 * extrapolates a short observation window into an annualised figure: what is measured is what is
 * reported, with the window stated alongside it.
 */

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface CandlesResponse {
  candles: Record<string, Candle[]>;
  interval: string;
  source: string;
  newestAt: string | null;
  fetchedAt: string;
}

/** Simple close-to-close returns in percent. Needs at least two candles to produce anything. */
export const toReturns = (candles: Candle[]): number[] => {
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const prev = candles[i - 1].c;
    const curr = candles[i].c;
    if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev === 0) continue;
    returns.push(((curr - prev) / prev) * 100);
  }
  return returns;
};

export const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;

/** Sample standard deviation (n-1). Returns null below two observations rather than a fake 0. */
export const stdev = (values: number[]): number | null => {
  if (values.length < 2) return null;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

/**
 * Pearson correlation over the overlapping length of two return series. Returns null when there
 * is too little overlap or either series is flat (zero variance) - a correlation of "0" would
 * read as "uncorrelated", which is a different claim from "not computable".
 */
export const pearson = (a: number[], b: number[]): number | null => {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const x = a.slice(-n);
  const y = b.slice(-n);
  const mx = mean(x);
  const my = mean(y);

  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const vx = x[i] - mx;
    const vy = y[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
};

export interface CorrelationCell {
  a: string;
  b: string;
  value: number | null;
  observations: number;
}

export const correlationMatrix = (
  returnsBySymbol: Record<string, number[]>,
  symbols: string[]
): CorrelationCell[] => {
  const cells: CorrelationCell[] = [];
  for (const a of symbols) {
    for (const b of symbols) {
      const seriesA = returnsBySymbol[a] ?? [];
      const seriesB = returnsBySymbol[b] ?? [];
      cells.push({
        a,
        b,
        value: a === b ? 1 : pearson(seriesA, seriesB),
        observations: Math.min(seriesA.length, seriesB.length),
      });
    }
  }
  return cells;
};

export interface VolatilityRow {
  symbol: string;
  /** Standard deviation of one candle's return, in percent. Per bar - never annualised. */
  perBarStdev: number | null;
  /** Average true range across the window, in price units and as a percent of last price. */
  atr: number | null;
  atrPercent: number | null;
  /** (high24h - low24h) / price, straight from the live quote. */
  dayRangePercent: number | null;
  observations: number;
  returns: number[];
}

/** Average true range over the observed candles (Wilder's TR, simple mean - window stated by caller). */
export const averageTrueRange = (candles: Candle[]): number | null => {
  if (candles.length < 2) return null;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const prevClose = candles[i - 1].c;
    const { h, l } = candles[i];
    trueRanges.push(Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose)));
  }
  return trueRanges.length === 0 ? null : mean(trueRanges);
};

export const volatilityRow = (
  symbol: string,
  candles: Candle[],
  market: MarketPrice | undefined
): VolatilityRow => {
  const returns = toReturns(candles);
  const atr = averageTrueRange(candles);
  const last = candles[candles.length - 1]?.c ?? market?.price ?? null;

  const dayRangePercent =
    market && Number.isFinite(market.high24h) && Number.isFinite(market.low24h) && market.price
      ? ((market.high24h - market.low24h) / market.price) * 100
      : null;

  return {
    symbol,
    perBarStdev: stdev(returns),
    atr,
    atrPercent: atr !== null && last ? (atr / last) * 100 : null,
    dayRangePercent,
    observations: returns.length,
    returns,
  };
};

export interface CurrencyStrengthRow {
  currency: string;
  /** Mean of this currency's signed contribution across every covered pair it appears in. */
  score: number;
  /** Which pairs fed the score, so the basis is auditable rather than a black box. */
  contributors: Array<{ pair: PairId; contribution: number }>;
}

/**
 * Relative currency strength from the 24h change of the covered FX pairs.
 *
 * Scope is deliberately narrow and stated in the UI: this terminal covers seven USD pairs (§B3),
 * so USD is measured against seven counterparts and each counterpart against USD alone. It is not a
 * G10-wide strength index and must not be presented as one.
 */
export const currencyStrength = (
  prices: Record<PairId, MarketPrice>,
  fxPairs: PairId[]
): CurrencyStrengthRow[] => {
  const contributions = new Map<string, Array<{ pair: PairId; contribution: number }>>();

  const push = (currency: string, pair: PairId, contribution: number) => {
    if (!contributions.has(currency)) contributions.set(currency, []);
    contributions.get(currency)!.push({ pair, contribution });
  };

  for (const pair of fxPairs) {
    const market = prices[pair];
    if (!market || !Number.isFinite(market.change24h)) continue;
    const base = pair.slice(0, 3);
    const quote = pair.slice(3, 6);
    // A rise in BASEQUOTE is the base strengthening and the quote weakening by the same amount.
    push(base, pair, market.change24h);
    push(quote, pair, -market.change24h);
  }

  return Array.from(contributions.entries())
    .map(([currency, rows]) => ({
      currency,
      score: mean(rows.map((row) => row.contribution)),
      contributors: rows,
    }))
    .sort((a, b) => b.score - a.score);
};

export type RegimeDriverId = 'dxy' | 'vix' | 'real_yield' | 'crypto' | 'gold';

export interface RegimeDriver {
  id: RegimeDriverId;
  label: string;
  /** The provider's own number, shown as-is next to the interpretation. */
  raw: number | null;
  rawLabel: string;
  source: string;
  /** -1 (risk-off) .. +1 (risk-on). null when the input is unavailable. */
  score: number | null;
  weight: number;
}

export interface RegimeResult {
  /** 0-100, 50 = neutral. null when too few drivers are live to say anything. */
  score: number | null;
  drivers: RegimeDriver[];
  availableDrivers: number;
  requiredDrivers: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Composite risk-on/risk-off reading.
 *
 * This is an interpretation, not a quoted market figure, so the UI shows every driver's raw value
 * and source beside the gauge and names the model. Drivers whose input is unavailable are
 * excluded from the weighted mean rather than defaulted to neutral - a missing input must not be
 * able to quietly drag the score toward 50 and look like a real reading. Below three live drivers
 * the score is withheld entirely.
 *
 * Roadmap §D audit (two reported inconsistencies, both root-caused and fixed here rather than
 * patched in the UI):
 *
 *  1. "DXY shows neutral while the market is actually correcting" - the dxy driver used to read
 *     `dxyTrend15m`, a trailing 15-MINUTE window, while every other driver here reads a daily-
 *     scale change (VIX level, day-over-day real yield, 24h crypto/gold). A real intraday move
 *     that already happened can sit entirely outside the last 15 minutes and read as ~0 (neutral)
 *     even while the session is clearly trending. Fixed by switching to `dxySessionChangePct`
 *     (today's session-open-to-now change, matching the other drivers' timeframe) - see
 *     DxyResponse.changeSessionPct's doc comment in types.ts. trend15m itself is untouched and
 *     still used by signal generation and the XAU confluence engine's DXY factor, where a fast
 *     momentum read genuinely is what's wanted.
 *
 *  2. "XAU regime shows risk-off while XAU price is actually bullish" - the gold driver scored
 *     ANY 24h gold price rise as "safe-haven bid" (risk-off), but gold's own price is already
 *     jointly driven by real yield and the dollar - both of which are independently scored above
 *     by the real_yield and dxy drivers. When gold rallies on a real-yield/dollar move those two
 *     drivers already read correctly (often as risk-ON: falling yields, weak dollar), the gold
 *     driver fired an independent, sometimes opposite-signed "risk-off" reading from price action
 *     alone, muddying the composite with a confounded, partially circular signal. Fixed by
 *     cutting its weight from 0.15 to 0.08 (redistributed to the two cleaner, non-circular
 *     drivers it was conflicting with) rather than deleting it outright - a large, sudden gold
 *     move is still real information worth a small nudge, just not enough to fight two drivers
 *     that already explain the same move correctly.
 */
export const computeRegime = (inputs: {
  dxySessionChangePct: number | null;
  vix: number | null;
  realYieldChange: number | null;
  btcChange24h: number | null;
  goldChange24h: number | null;
}): RegimeResult => {
  const drivers: RegimeDriver[] = [
    {
      id: 'dxy',
      label: 'US Dollar momentum',
      raw: inputs.dxySessionChangePct,
      rawLabel: inputs.dxySessionChangePct === null ? '—' : `${inputs.dxySessionChangePct.toFixed(2)}% today`,
      source: 'Yahoo Finance (DX-Y.NYB)',
      // A firming dollar is the classic risk-off tell; 0.3% intraday is a decisive session move.
      score: inputs.dxySessionChangePct === null ? null : clamp(-inputs.dxySessionChangePct / 0.3, -1, 1),
      weight: 0.28,
    },
    {
      id: 'vix',
      label: 'Equity volatility (VIX)',
      raw: inputs.vix,
      rawLabel: inputs.vix === null ? '—' : inputs.vix.toFixed(2),
      source: 'FRED VIXCLS',
      // 20 is the long-run pivot; 10 either side spans calm to stressed.
      score: inputs.vix === null ? null : clamp((20 - inputs.vix) / 10, -1, 1),
      weight: 0.25,
    },
    {
      id: 'real_yield',
      label: '10Y real yield change',
      raw: inputs.realYieldChange,
      rawLabel: inputs.realYieldChange === null ? '—' : `${inputs.realYieldChange.toFixed(2)} pp`,
      source: 'FRED DFII10',
      // Rising real yields tighten financial conditions.
      score: inputs.realYieldChange === null ? null : clamp(-inputs.realYieldChange / 0.15, -1, 1),
      weight: 0.24,
    },
    {
      id: 'crypto',
      label: 'Crypto risk appetite (BTC 24h)',
      raw: inputs.btcChange24h,
      rawLabel: inputs.btcChange24h === null ? '—' : `${inputs.btcChange24h.toFixed(2)}%`,
      source: 'HEVORA price feed',
      score: inputs.btcChange24h === null ? null : clamp(inputs.btcChange24h / 3, -1, 1),
      weight: 0.15,
    },
    {
      id: 'gold',
      label: 'Safe-haven bid (XAU 24h)',
      raw: inputs.goldChange24h,
      rawLabel: inputs.goldChange24h === null ? '—' : `${inputs.goldChange24h.toFixed(2)}%`,
      source: 'HEVORA price feed',
      // Weight cut 0.15 -> 0.08 (see the §D audit note above): this reading is a confounded proxy
      // for what the dxy/real_yield drivers already capture more directly, so it should nudge the
      // composite, not fight it.
      score: inputs.goldChange24h === null ? null : clamp(-inputs.goldChange24h / 1.5, -1, 1),
      weight: 0.08,
    },
  ];

  const live = drivers.filter((driver) => driver.score !== null);
  const requiredDrivers = 3;

  if (live.length < requiredDrivers) {
    return { score: null, drivers, availableDrivers: live.length, requiredDrivers };
  }

  const totalWeight = live.reduce((sum, driver) => sum + driver.weight, 0);
  const weighted = live.reduce((sum, driver) => sum + (driver.score as number) * driver.weight, 0) / totalWeight;

  return {
    score: Math.round(((weighted + 1) / 2) * 100),
    drivers,
    availableDrivers: live.length,
    requiredDrivers,
  };
};

export const regimeLabelKey = (score: number | null): string => {
  if (score === null) return 'analysis.regime.unknown';
  if (score >= 70) return 'analysis.regime.riskOn';
  if (score >= 55) return 'analysis.regime.mildRiskOn';
  if (score > 45) return 'analysis.regime.neutral';
  if (score > 30) return 'analysis.regime.mildRiskOff';
  return 'analysis.regime.riskOff';
};

/**
 * Rate of change across the observed candle window, in percent. Deliberately not annualised and
 * not smoothed - it is the move from the first stored bar to the last, and the caller states how
 * many bars that covers.
 */
export const rateOfChange = (candles: Candle[]): number | null => {
  if (candles.length < 2) return null;
  const first = candles[0].c;
  const last = candles[candles.length - 1].c;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return ((last - first) / first) * 100;
};

/**
 * Wilder-style RSI over close-to-close returns. Returns null below `period` observations rather
 * than a value computed from a shorter window - an RSI quoted from four bars is not an RSI.
 */
export const rsi = (candles: Candle[], period = 14): number | null => {
  const returns = toReturns(candles);
  if (returns.length < period) return null;
  const window = returns.slice(-period);
  const gains = window.filter((value) => value > 0);
  const losses = window.filter((value) => value < 0).map((value) => Math.abs(value));
  const avgGain = gains.length === 0 ? 0 : gains.reduce((sum, v) => sum + v, 0) / period;
  const avgLoss = losses.length === 0 ? 0 : losses.reduce((sum, v) => sum + v, 0) / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

/**
 * How unusual the most recent bar's return is, in standard deviations of the window's own
 * distribution. Null when the window is too short or has no variance - flagging an "anomaly"
 * from three observations would be noise dressed as a finding.
 */
export const latestZScore = (candles: Candle[], minObservations = 8): { z: number | null; observations: number } => {
  const returns = toReturns(candles);
  if (returns.length < minObservations) return { z: null, observations: returns.length };
  const history = returns.slice(0, -1);
  const sd = stdev(history);
  if (sd === null || sd === 0) return { z: null, observations: returns.length };
  return { z: (returns[returns.length - 1] - mean(history)) / sd, observations: returns.length };
};

export interface BreadthResult {
  advancing: number;
  declining: number;
  unchanged: number;
  total: number;
  /** Advancing minus declining, as a percentage of the covered universe. */
  netPercent: number | null;
}

/**
 * Advance/decline across the assets THIS terminal covers.
 *
 * Scope is stated wherever this is rendered: eight instruments is a breadth read on our own
 * universe, not S&P internals, and calling it "market breadth" without that qualifier would claim
 * coverage that does not exist.
 */
export const breadthOf = (changes: Array<number | null | undefined>): BreadthResult => {
  const usable = changes.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const advancing = usable.filter((value) => value > 0).length;
  const declining = usable.filter((value) => value < 0).length;
  return {
    advancing,
    declining,
    unchanged: usable.length - advancing - declining,
    total: usable.length,
    netPercent: usable.length === 0 ? null : ((advancing - declining) / usable.length) * 100,
  };
};
