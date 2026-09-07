import type { EconomicEvent } from '../../types';
import type {
  ConfluenceFactor,
  ConfluenceResult,
  CrossAssetAnomaly,
  FactorStance,
  HistoricalAnalog,
  InvalidationCondition,
  MarketStateBias,
  NextCatalyst,
  TrendChart,
  UnavailableInput,
} from './types';

/**
 * Shared Confluence Engine machinery.
 *
 * The per-asset files (xau.ts, commodity.ts, ...) decide WHICH factors exist and how each one is
 * scored - that is genuine domain knowledge and differs per market. Everything that decides what
 * the reader is allowed to be told lives here, in one copy, on purpose: the coverage floor, the
 * exclusion rule, the bias thresholds, the confidence discount and the analog's sample-size floor
 * are the rules that keep this layer honest, and a second copy of them is a second chance to
 * drift away from them.
 */

/** Below this many live factors no direction is published at all. */
export const REQUIRED_FACTORS = 3;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const fmt = (v: number | null, digits = 2): string =>
  v === null || !Number.isFinite(v) ? '—' : v.toFixed(digits);

/** A factor only takes a side once it is off the fence; small scores stay explicitly neutral. */
export const stanceOf = (score: number): FactorStance =>
  score > 0.1 ? 'supporting' : score < -0.1 ? 'contradicting' : 'neutral';

export const biasFrom = (weighted: number, supporting: number, contradicting: number): MarketStateBias => {
  // A genuinely split book is reported as a conflict rather than averaged into a bland neutral -
  // "four reasons up, four reasons down" is a different situation from "nothing is happening".
  if (supporting > 0 && contradicting > 0 && Math.abs(weighted) < 0.12 && Math.min(supporting, contradicting) >= 2) {
    return 'Signal Conflict';
  }
  if (weighted >= 0.45) return 'Bullish';
  if (weighted <= -0.45) return 'Bearish';
  if (weighted >= 0.15) return 'Transition';
  if (weighted <= -0.15) return 'Transition';
  if (supporting > 0 && contradicting > 0) return 'Mixed';
  return 'Neutral';
};

/**
 * Historical analog over a series of daily closes.
 *
 * Method, stated plainly because the number is meaningless without it: find every past day whose
 * 5-day return had the same sign as today's, then count how often the NEXT 5 days went up. That
 * is a coarse comparison and it is labelled as one. Below 8 comparable periods it returns null
 * rather than a ratio built on nothing - and it never converts the count into a probability.
 */
export const buildAnalog = (
  history: Array<{ close: number }>,
  assetNoun: string,
  archiveNote?: string
): HistoricalAnalog | null => {
  const MIN_SAMPLE = 8;
  const WINDOW = 5;
  if (history.length < WINDOW * 3) return null;

  const closes = history.map((p) => p.close).filter((c) => Number.isFinite(c));
  if (closes.length < WINDOW * 3) return null;

  const ret = (i: number) => (closes[i] - closes[i - WINDOW]) / closes[i - WINDOW];
  const currentDirection = Math.sign(ret(closes.length - 1));
  if (currentDirection === 0) return null;

  let up = 0;
  let down = 0;
  for (let i = WINDOW; i < closes.length - WINDOW; i += 1) {
    if (Math.sign(ret(i)) !== currentDirection) continue;
    const forward = closes[i + WINDOW] - closes[i];
    if (forward > 0) up += 1;
    else if (forward < 0) down += 1;
  }

  const sampleSize = up + down;
  if (sampleSize < MIN_SAMPLE) return null;

  return {
    sampleSize,
    up,
    down,
    lookbackDays: closes.length,
    summary:
      `Dari ${sampleSize} periode serupa dalam ${closes.length} hari data, ${up} kali ${assetNoun} naik dan ` +
      `${down} kali turun di 5 hari berikutnya.${archiveNote ? ` ${archiveNote}` : ''}`,
  };
};

/**
 * Price against its own moving average (§9), for the ConfluenceView chart.
 *
 * This exists ONLY to illustrate a factor the engine already scored - it is not a second,
 * independent claim about the trend. `window` full periods of lead-in are required before the
 * FIRST plotted point, so every point on the average line is a real average, never one computed
 * from a partial, too-short window. The plotted range is capped for legibility, not for honesty:
 * a chart with 500 points on a card-sized SVG is not more informative, just more crowded.
 */
export const buildTrendChart = (
  rawHistory: Array<{ date: string; close: number }>,
  window: number,
  digits: number,
  maxPoints = 120
): TrendChart | null => {
  // Same defensive filter the trend factor itself and buildAnalog apply - a non-finite close
  // would otherwise poison every rolling sum that includes it, turning one bad row into a run of
  // NaN averages rather than one skipped point.
  const history = rawHistory.filter((p) => Number.isFinite(p.close));
  if (history.length < window) return null;

  const rollingAverage: Array<{ date: string; close: number; ma: number }> = [];
  for (let i = window - 1; i < history.length; i += 1) {
    let sum = 0;
    for (let j = i - window + 1; j <= i; j += 1) sum += history[j].close;
    rollingAverage.push({ date: history[i].date, close: history[i].close, ma: sum / window });
  }
  if (rollingAverage.length === 0) return null;

  const slice = rollingAverage.slice(-maxPoints);
  const shortLabel = (date: string) => {
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? date.slice(5, 10) : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  };

  return {
    price: slice.map((p) => ({ label: shortLabel(p.date), value: p.close })),
    movingAverage: slice.map((p) => ({ label: shortLabel(p.date), value: p.ma })),
    window,
    digits,
  };
};

export interface AssembleInput {
  asset: string;
  factors: ConfluenceFactor[];
  invalidation: InvalidationCondition[];
  events: EconomicEvent[];
  /**
   * Currencies whose high-impact releases actually move this asset. Null means "any high-impact
   * release", which is right for dollar-denominated commodities and wrong for nothing so far.
   */
  eventCurrencies?: string[] | null;
  analog: HistoricalAnalog | null;
  anomaly: CrossAssetAnomaly | null;
  /** Fallback sentence when no catalyst and no invalidation exist. */
  fallbackWatch?: string;
  /** Inputs this read should have had and does not - published, never silently dropped (§10). */
  unavailableInputs?: UnavailableInput[];
  /**
   * Daily closes to chart against a moving average (§9) - pass this ONLY when `factors` already
   * includes the trend/MA factor built from the same series and window, so the chart never shows
   * a line the engine did not itself score. Omit entirely for an asset with no such factor (XAU,
   * BTC as of Fase 8) rather than charting a trend nothing else on the page refers to.
   */
  chartHistory?: Array<{ date: string; close: number }>;
  chartMaWindow?: number;
  /** The asset's own quoted precision - required whenever chartHistory is passed. */
  chartDigits?: number;
  now?: number;
}

/**
 * Turns a scored factor list into the published read.
 *
 * The one rule worth restating here: a factor whose input is missing was never pushed into this
 * list by the caller, so it is EXCLUDED from the weighting rather than scored zero. Scoring it
 * zero would let a dead feed masquerade as a neutral opinion and quietly drag the read toward the
 * middle - which is a fabricated data point wearing a conservative disguise.
 */
export const assembleConfluence = (input: AssembleInput): ConfluenceResult => {
  const { factors } = input;
  const live = factors.filter((f) => Number.isFinite(f.score));

  const base: Omit<ConfluenceResult, 'bias' | 'confidence' | 'convictionLabel' | 'narrative'> = {
    asset: input.asset,
    factors,
    supporting: factors.filter((f) => f.stance === 'supporting'),
    contradicting: factors.filter((f) => f.stance === 'contradicting'),
    whatChanged: factors.filter((f) => f.change !== null).slice(0, 4),
    conflictNote: '',
    invalidation: [],
    nextCatalyst: null,
    analog: null,
    anomaly: input.anomaly,
    liveFactorCount: live.length,
    requiredFactorCount: REQUIRED_FACTORS,
    unavailableInputs: input.unavailableInputs ?? [],
    // Illustrates a factor, not a separate opinion - computed whenever data allows regardless of
    // whether the overall read cleared the coverage floor below, same as `anomaly` above.
    trendChart: input.chartHistory
      ? buildTrendChart(input.chartHistory, input.chartMaWindow ?? 50, input.chartDigits ?? 2)
      : null,
  };

  if (live.length < REQUIRED_FACTORS) {
    return {
      ...base,
      bias: 'Insufficient Evidence',
      confidence: null,
      convictionLabel: '',
      conflictNote: `Baru ${live.length} dari ${REQUIRED_FACTORS} faktor minimum yang punya data. Belum cukup untuk menyimpulkan arah.`,
      narrative:
        'Data pendukungnya belum cukup untuk bilang arahnya ke mana. Yang perlu diawasi: begitu feed yang mati kembali hidup, pembacaan ini otomatis terisi.',
    };
  }

  const totalWeight = live.reduce((sum, f) => sum + f.weight, 0);
  const weighted = live.reduce((sum, f) => sum + f.score * f.weight, 0) / totalWeight;
  const supporting = base.supporting.length;
  const contradicting = base.contradicting.length;
  const bias = biasFrom(weighted, supporting, contradicting);

  // Confidence is the strength of agreement, discounted by how few factors are reporting - a
  // strong read from three inputs is not the same as a strong read from five.
  const agreement = Math.abs(weighted);
  const coverage = live.length / factors.length || 1;
  const confidence = Math.round(clamp(agreement * 100 * (0.6 + 0.4 * coverage), 0, 100));
  const convictionLabel =
    confidence >= 70 ? 'High Conviction' : confidence >= 45 ? 'Moderate Conviction' : 'Reduced Conviction';

  const now = input.now ?? Date.now();
  const currencies = input.eventCurrencies ?? null;
  const upcoming = input.events
    .filter((e) => e.impact === 'High' && new Date(e.dateISO).getTime() >= now)
    .filter((e) => currencies === null || currencies.includes(e.currency))
    .sort((a, b) => new Date(a.dateISO).getTime() - new Date(b.dateISO).getTime())[0];
  const nextCatalyst: NextCatalyst | null = upcoming
    ? { event: upcoming.event, dateISO: upcoming.dateISO, impact: upcoming.impact, currency: upcoming.currency }
    : null;

  const conflictNote =
    supporting > 0 || contradicting > 0
      ? `${supporting} faktor mendukung vs ${contradicting} menentang → ${
          bias === 'Signal Conflict'
            ? 'terbelah, belum ada arah yang menang'
            : weighted > 0
              ? 'condong naik'
              : weighted < 0
                ? 'condong turun'
                : 'seimbang'
        }, keyakinan ${convictionLabel.toLowerCase()}`
      : 'Belum ada faktor yang cukup kuat ke salah satu arah.';

  // Narrative: assembled from the strongest real factors, closing with what to watch (§11).
  const strongest = [...live].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 2);
  const watchFor = nextCatalyst
    ? `Yang perlu diawasi: ${nextCatalyst.event} (${nextCatalyst.currency}) — rilis berdampak tinggi berikutnya.`
    : input.invalidation[0]
      ? `Yang perlu diawasi: ${input.invalidation[0].condition.toLowerCase()}.`
      : `Yang perlu diawasi: ${input.fallbackWatch ?? 'perubahan pada faktor-faktor di atas'}.`;

  const narrative =
    bias === 'Signal Conflict'
      ? `${strongest.map((f) => f.reasoning).join(' ')} Faktornya saling tarik, jadi belum ada arah yang jelas. ${watchFor}`
      : `${strongest.map((f) => f.reasoning).join(' ')} ${watchFor}`;

  return {
    ...base,
    bias,
    confidence,
    convictionLabel,
    conflictNote,
    invalidation: input.invalidation,
    nextCatalyst,
    analog: input.analog,
    narrative,
  };
};

export type { CrossAssetAnomaly };
