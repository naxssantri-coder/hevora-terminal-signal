import type { DailyPricePoint, EconomicEvent } from '../../types';
import type {
  ConfluenceFactor,
  ConfluenceResult,
  CrossAssetAnomaly,
  HistoricalAnalog,
  InvalidationCondition,
} from './types';
import { assembleConfluence, buildAnalog, clamp, fmt, stanceOf } from './core';

/**
 * Confluence Engine for XAU/USD.
 *
 * A pure function over inputs the terminal already publishes, so it is unit-testable and can
 * never reach for a number that is not on screen somewhere else. Three rules shape everything
 * below:
 *
 *  1. A factor with no live input is EXCLUDED, not scored zero - a missing input must not be able
 *     to drag the read toward neutral and look like a real neutral (the same rule Market Regime
 *     uses in Fase 3).
 *  2. Below three live factors the bias is 'Insufficient Evidence' and no confidence is shown.
 *  3. The historical analog is context with its sample size attached, never a probability. When
 *     the archive is too thin, it returns null instead of a reassuring-looking ratio.
 */

export interface XauConfluenceInputs {
  /** Latest 10Y real yield and the previous print (FRED DFII10). */
  realYield: { latest: number | null; previous: number | null; date: string | null };
  /** DXY level and its 15-minute trend from the engine's own tracker. */
  dxy: { price: number | null; trend15m: number | null; lastUpdated: string | null };
  /** CFTC non-commercial net position plus its percentile within the archive we hold. */
  cot: { net: number | null; percentile: number | null; reportDate: string | null };
  /** VIX close (FRED VIXCLS). */
  vix: { latest: number | null; date: string | null };
  /** Live gold quote. */
  gold: { price: number | null; change24h: number | null; lastUpdated: string | null };
  /** Forward-archived daily closes, oldest first (/api/market/xau-daily). */
  dailyHistory: DailyPricePoint[];
  /** Upcoming calendar events, used only to name the next catalyst - never to predict it. */
  events: EconomicEvent[];
  now?: number;
}

/**
 * Builds the factor list. Each entry is scored in GOLD's direction: positive = supportive of a
 * higher gold price. The reasoning strings are trader-language on purpose (§11) - they are the
 * text a reader actually sees next to the number.
 */
const buildFactors = (inputs: XauConfluenceInputs): ConfluenceFactor[] => {
  const factors: ConfluenceFactor[] = [];

  // --- Real yield: the single most reliable driver of gold. Falling real yield = supportive.
  if (inputs.realYield.latest !== null) {
    const delta =
      inputs.realYield.previous === null ? null : inputs.realYield.latest - inputs.realYield.previous;
    // 15bps between prints is a decisive move for a daily series.
    const score = delta === null ? 0 : clamp(-delta / 0.15, -1, 1);
    factors.push({
      id: 'real-yield',
      label: 'Real yield 10Y',
      rawValue: `${fmt(inputs.realYield.latest)}%`,
      change: delta === null ? null : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(0)} bps`,
      source: 'FRED DFII10',
      timestamp: inputs.realYield.date,
      frequency: 'Daily',
      stance: stanceOf(score),
      score,
      weight: 0.3,
      reasoning:
        delta === null
          ? 'Real yield terbaca, tapi belum ada pembanding rilis sebelumnya.'
          : delta < 0
            ? 'Real yield turun, biaya memegang emas jadi lebih murah.'
            : delta > 0
              ? 'Real yield naik, ini yang biasanya menekan emas.'
              : 'Real yield praktis tidak bergerak.',
      route: '/macro/yield-curve',
    });
  }

  // --- Dollar: gold is priced in it, so a firming dollar is a direct headwind.
  if (inputs.dxy.trend15m !== null) {
    const score = clamp(-inputs.dxy.trend15m / 0.15, -1, 1);
    factors.push({
      id: 'dxy',
      label: 'DXY momentum',
      rawValue: inputs.dxy.price === null ? '—' : fmt(inputs.dxy.price, 3),
      change: `${inputs.dxy.trend15m >= 0 ? '+' : ''}${fmt(inputs.dxy.trend15m)}% / 15m`,
      source: 'Yahoo Finance (DX-Y.NYB)',
      timestamp: inputs.dxy.lastUpdated,
      frequency: 'Near-realtime',
      stance: stanceOf(score),
      score,
      weight: 0.25,
      reasoning:
        inputs.dxy.trend15m < 0
          ? 'Dolar melemah, ini melonggarkan tekanan ke emas.'
          : inputs.dxy.trend15m > 0
            ? 'Dolar menguat, emas jadi lebih mahal buat pemegang mata uang lain.'
            : 'Dolar bergerak datar.',
      route: '/macro/dxy',
    });
  }

  // --- Positioning: crowding is a risk regardless of direction, so an extreme net long is read
  // as a contradicting factor even when price is rising.
  if (inputs.cot.net !== null && inputs.cot.percentile !== null) {
    const p = inputs.cot.percentile;
    // Middle of the range is neutral; the closer to either extreme, the stronger the warning.
    const score = p >= 80 ? -clamp((p - 80) / 20, 0, 1) : p <= 20 ? clamp((20 - p) / 20, 0, 1) : 0;
    factors.push({
      id: 'cot',
      label: 'COT posisi institusi',
      rawValue: `net ${inputs.cot.net >= 0 ? '+' : ''}${Math.round(inputs.cot.net).toLocaleString('en-US')}`,
      change: `percentile ${Math.round(p)}/100`,
      source: 'CFTC Commitment of Traders',
      timestamp: inputs.cot.reportDate,
      frequency: 'Weekly',
      stance: stanceOf(score),
      score,
      weight: 0.2,
      reasoning:
        p >= 80
          ? 'Posisi long institusi sudah ramai — ruang tambah beli menipis, rawan koreksi.'
          : p <= 20
            ? 'Posisi institusi sudah sepi di sisi long — biasanya ruang naiknya justru lebih lega.'
            : 'Posisi institusi belum ekstrem, belum jadi sinyal balik.',
      route: '/macro/cot',
    });
  }

  // --- Volatility: gold catches a bid when equity vol spikes.
  if (inputs.vix.latest !== null) {
    const score = clamp((inputs.vix.latest - 20) / 10, -1, 1);
    factors.push({
      id: 'vix',
      label: 'Volatilitas ekuitas (VIX)',
      rawValue: fmt(inputs.vix.latest),
      change: null,
      source: 'FRED VIXCLS',
      timestamp: inputs.vix.date,
      frequency: 'Daily',
      stance: stanceOf(score),
      score,
      weight: 0.15,
      reasoning:
        inputs.vix.latest > 25
          ? 'Pasar lagi tegang, biasanya ada aliran ke aset safe haven.'
          : inputs.vix.latest < 15
            ? 'Pasar tenang, permintaan safe haven tipis.'
            : 'Volatilitas di kisaran normal.',
      route: '/analysis/volatility',
    });
  }

  // --- Price itself: the market's own vote, weighted lightest because it is the thing being
  // explained, not an explanation.
  if (inputs.gold.change24h !== null) {
    const score = clamp(inputs.gold.change24h / 1.5, -1, 1);
    factors.push({
      id: 'price',
      label: 'Momentum harga 24 jam',
      rawValue: inputs.gold.price === null ? '—' : fmt(inputs.gold.price),
      change: `${inputs.gold.change24h >= 0 ? '+' : ''}${fmt(inputs.gold.change24h)}%`,
      source: 'HEVORA price feed',
      timestamp: inputs.gold.lastUpdated,
      frequency: 'Realtime',
      stance: stanceOf(score),
      score,
      weight: 0.1,
      reasoning:
        inputs.gold.change24h > 0 ? 'Harga sendiri masih menguat 24 jam terakhir.' : 'Harga melemah 24 jam terakhir.',
      route: '/market/commodities',
    });
  }

  return factors;
};

/**
 * Historical analog over the forward-archived daily closes.
 *
 * Method, stated plainly because the number is meaningless without it: find every past day whose
 * 5-day gold return had the same sign as today's, then count how often the NEXT 5 days went up.
 * That is a coarse comparison and it is labelled as one. Below 8 comparable periods it returns
 * null rather than a ratio built on nothing.
 */
export const buildHistoricalAnalog = (history: DailyPricePoint[]): HistoricalAnalog | null =>
  buildAnalog(
    history,
    'emas',
    'Arsip ini tumbuh maju dari hari ke hari dan tidak pernah diisi mundur.'
  );

/** Gold and the dollar normally move against each other; both rising is worth flagging, nothing more. */
export const detectAnomaly = (inputs: XauConfluenceInputs): CrossAssetAnomaly | null => {
  const goldUp = (inputs.gold.change24h ?? 0) > 0.2;
  const dxyUp = (inputs.dxy.trend15m ?? 0) > 0.05;
  const goldDown = (inputs.gold.change24h ?? 0) < -0.2;
  const dxyDown = (inputs.dxy.trend15m ?? 0) < -0.05;

  if (goldUp && dxyUp) {
    return {
      description: 'Emas dan DXY sama-sama naik',
      detail: 'Historisnya keduanya bergerak berlawanan. Ini dicatat apa adanya - penyebabnya tidak disimpulkan di sini.',
    };
  }
  if (goldDown && dxyDown) {
    return {
      description: 'Emas dan DXY sama-sama turun',
      detail: 'Pola yang tidak biasa. Dicatat sebagai anomali, bukan sebagai kesimpulan sebab-akibat.',
    };
  }
  return null;
};

export const buildXauConfluence = (inputs: XauConfluenceInputs): ConfluenceResult => {
  const invalidation: InvalidationCondition[] = [];
  if (inputs.realYield.latest !== null) {
    invalidation.push({
      condition: `Real yield naik di atas ${fmt(inputs.realYield.latest + 0.1)}%`,
      basis: `Level sekarang ${fmt(inputs.realYield.latest)}% + 10bps, besaran yang cukup membalik skor faktor ini`,
    });
  }
  if (inputs.dxy.price !== null) {
    invalidation.push({
      condition: 'Tren DXY 15 menit berbalik jadi positif dan bertahan',
      basis: `Sekarang ${fmt(inputs.dxy.trend15m)}% / 15m di level ${fmt(inputs.dxy.price, 3)}`,
    });
  }

  return assembleConfluence({
    asset: 'XAU/USD',
    factors: buildFactors(inputs),
    invalidation,
    events: inputs.events,
    analog: buildHistoricalAnalog(inputs.dailyHistory),
    anomaly: detectAnomaly(inputs),
    now: inputs.now,
  });
};
