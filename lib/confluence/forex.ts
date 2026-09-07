import type { EconomicEvent } from '../../types';
import type {
  ConfluenceFactor,
  ConfluenceResult,
  CrossAssetAnomaly,
  InvalidationCondition,
  UnavailableInput,
} from './types';
import { assembleConfluence, buildAnalog, clamp, fmt, stanceOf } from './core';
import type { ForexSpec } from './forexSpecs';

/**
 * Confluence Engine for the FX majors (§4, replicated from XAU).
 *
 * Everything that decides what may be published lives in ./core. What is specific to FX is that
 * every factor has to be expressed in the PAIR's direction, not the dollar's: the same DXY print
 * is bullish for USD/CHF and bearish for EUR/USD. That sign lives in the spec, and the assertions
 * pin it, because a sign error here produces a read that is confidently backwards rather than
 * visibly broken.
 *
 * Two pairs run without a rate differential. No SNB or BoC policy rate is wired in this build, so
 * USD/CHF and USD/CAD carry no differential factor at all - and the absence is published rather
 * than filled with a stand-in rate (§10).
 */

export interface ForexConfluenceInputs {
  spec: ForexSpec;
  /** Live quote from the terminal's own price feed. */
  quote: { price: number | null; change24h: number | null; lastUpdated: string | null };
  /** DXY level and its 15-minute trend. */
  dxy: { price: number | null; trend15m: number | null; lastUpdated: string | null };
  /** US short rate (FRED EFFR) and the counterpart policy rate, when one is wired. */
  usRate: { latest: number | null; date: string | null };
  counterRate: { latest: number | null; previous: number | null; date: string | null; label: string | null };
  /** CFTC positioning for the counterpart currency's futures contract. */
  cot: { net: number | null; percentile: number | null; reportDate: string | null };
  /** VIX close (FRED VIXCLS). */
  vix: { latest: number | null; date: string | null };
  /** WTI front-month, for USD/CAD only. */
  oil: { price: number | null; changePercent: number | null; quoteTime: string | null };
  /** Yahoo daily closes for this pair, oldest first. */
  history: Array<{ date: string; close: number }>;
  events: EconomicEvent[];
  now?: number;
}

/** Named absences per pair, so a thinner read never looks like a complete one (§10). */
export const forexUnavailableInputs = (spec: ForexSpec): UnavailableInput[] =>
  spec.counterRateIndicator === null
    ? [
        {
          label: `Suku bunga kebijakan ${spec.counterCurrency}`,
          status: 'Provider not wired',
          detail:
            `Tidak ada sumber suku bunga ${spec.counterCurrency} yang tersambung di build ini, jadi pembacaan ini ` +
            'jalan tanpa faktor selisih suku bunga — bukan diisi angka pengganti.',
        },
      ]
    : [];

const buildFactors = (inputs: ForexConfluenceInputs): ConfluenceFactor[] => {
  const { spec } = inputs;
  const factors: ConfluenceFactor[] = [];
  const closes = inputs.history.map((p) => p.close).filter((c) => Number.isFinite(c));
  // Sign that converts a DOLLAR-direction score into this PAIR's direction.
  const usdSign = spec.usdIsBase ? 1 : -1;

  // --- Rate differential: the counterpart's policy rate against the US short rate.
  if (inputs.counterRate.latest !== null && inputs.usRate.latest !== null) {
    const diff = inputs.counterRate.latest - inputs.usRate.latest;
    const previousDiff =
      inputs.counterRate.previous === null ? null : inputs.counterRate.previous - inputs.usRate.latest;
    // A wider differential in the counterpart's favour lifts the counterpart currency, which moves
    // the pair up when USD is the quote and down when USD is the base.
    const score = clamp(diff / 2, -1, 1) * -usdSign;
    factors.push({
      id: 'rate-differential',
      label: `Selisih suku bunga ${spec.counterCurrency} − USD`,
      rawValue: `${diff >= 0 ? '+' : ''}${fmt(diff)}%`,
      change:
        previousDiff === null ? null : `${diff - previousDiff >= 0 ? '+' : ''}${fmt((diff - previousDiff) * 100, 0)} bps`,
      source: inputs.counterRate.label ?? 'FRED',
      timestamp: inputs.counterRate.date,
      // These OECD/ECB series publish monthly. Labelling them live would be the lie that matters
      // most here, because a rate differential looks like a market price and is not one.
      frequency: 'Monthly',
      stance: stanceOf(score),
      score,
      weight: 0.3,
      reasoning:
        diff > 0
          ? `Bunga ${spec.counterCurrency} masih di atas USD — uang cenderung parkir di sisi itu.`
          : diff < 0
            ? `Bunga USD masih di atas ${spec.counterCurrency} — dolar yang dibayar lebih tinggi.`
            : 'Bunga kedua sisi praktis sejajar.',
      route: '/macro/interest-rates',
    });
  }

  // --- The dollar leg, signed for this pair.
  if (inputs.dxy.trend15m !== null) {
    const score = clamp(inputs.dxy.trend15m / 0.15, -1, 1) * usdSign;
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
        inputs.dxy.trend15m > 0
          ? spec.usdIsBase
            ? 'Dolar menguat — dan di pasangan ini dolar ada di depan, jadi arahnya ikut naik.'
            : 'Dolar menguat — di pasangan ini dolar ada di belakang, jadi ini menekan harga.'
          : spec.usdIsBase
            ? 'Dolar melemah — di pasangan ini itu menekan harga.'
            : 'Dolar melemah — dan itu yang mengangkat pasangan ini.',
      route: '/macro/dxy',
    });
  }

  // --- Positioning on the counterpart's futures, read contrarian at the extremes.
  if (inputs.cot.net !== null && inputs.cot.percentile !== null) {
    const p = inputs.cot.percentile;
    // The percentile describes the COUNTERPART currency's contract, so a crowded long there is a
    // warning for the counterpart - which points at the pair through the same usdSign.
    const counterScore = p >= 80 ? -clamp((p - 80) / 20, 0, 1) : p <= 20 ? clamp((20 - p) / 20, 0, 1) : 0;
    const score = counterScore * -usdSign;
    factors.push({
      id: 'cot',
      label: `COT ${spec.counterCurrency} futures`,
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
          ? `Posisi long ${spec.counterCurrency} sudah ramai — ruang tambah beli di sisi itu menipis.`
          : p <= 20
            ? `Posisi long ${spec.counterCurrency} sudah sepi — biasanya ruang baliknya lebih lega.`
            : 'Posisi institusi belum ekstrem di sisi mana pun.',
      route: '/macro/cot',
    });
  }

  // --- Risk appetite, signed per pair by the spec.
  if (spec.riskDirection !== null && inputs.vix.latest !== null) {
    const score = clamp((inputs.vix.latest - 20) / 10, -1, 1) * spec.riskDirection;
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
          ? 'Pasar tegang — uang lari ke mata uang safe haven dulu.'
          : inputs.vix.latest < 15
            ? 'Pasar tenang — belum ada dorongan cari aman.'
            : 'Volatilitas di kisaran normal.',
      route: '/analysis/volatility',
    });
  }

  // --- Oil, for CAD only. A terms-of-trade driver, not a general commodity proxy.
  if (spec.usesOil && inputs.oil.changePercent !== null) {
    // Stronger crude strengthens CAD, which pushes USD/CAD DOWN.
    const score = clamp(-inputs.oil.changePercent / 3, -1, 1);
    factors.push({
      id: 'oil',
      label: 'Minyak WTI',
      rawValue: inputs.oil.price === null ? '—' : fmt(inputs.oil.price),
      change: `${inputs.oil.changePercent >= 0 ? '+' : ''}${fmt(inputs.oil.changePercent)}%`,
      source: 'Yahoo Finance (CL=F)',
      timestamp: inputs.oil.quoteTime,
      frequency: 'Delayed',
      stance: stanceOf(score),
      score,
      weight: 0.2,
      reasoning:
        inputs.oil.changePercent > 0
          ? 'Minyak menguat — ini biasanya menopang dolar Kanada, jadi menekan USD/CAD.'
          : 'Minyak melemah — dolar Kanada kehilangan salah satu penopang utamanya.',
      route: '/market/commodities',
    });
  }

  // --- Trend versus its own 50-day average, measured from real closes.
  const window = closes.slice(-50);
  if (window.length === 50 && inputs.quote.price !== null) {
    const ma50 = window.reduce((sum, c) => sum + c, 0) / 50;
    if (ma50 !== 0) {
      const distance = (inputs.quote.price - ma50) / ma50;
      // FX moves in far smaller percentages than commodities; 1.5% off the average is a strong
      // medium-term trend for a major pair, not the 5% a barrel of crude needs.
      const score = clamp(distance / 0.015, -1, 1);
      factors.push({
        id: 'trend',
        label: 'Posisi harga vs rata-rata 50 hari',
        rawValue: fmt(inputs.quote.price, spec.digits),
        change: `${distance >= 0 ? '+' : ''}${fmt(distance * 100)}% vs MA50 ${fmt(ma50, spec.digits)}`,
        source: 'Yahoo Finance (daily closes)',
        timestamp: inputs.history[inputs.history.length - 1]?.date ?? null,
        frequency: 'Daily',
        stance: stanceOf(score),
        score,
        weight: 0.2,
        reasoning:
          distance > 0
            ? 'Harga masih di atas rata-rata 50 harinya — tren menengah belum patah.'
            : 'Harga di bawah rata-rata 50 harinya — tren menengah sedang tertekan.',
        route: '/market/forex',
      });
    }
  }

  // --- The pair's own move, weighted lightest.
  if (inputs.quote.change24h !== null) {
    const score = clamp(inputs.quote.change24h / 0.8, -1, 1);
    factors.push({
      id: 'price',
      label: 'Momentum harga 24 jam',
      rawValue: fmt(inputs.quote.price, spec.digits),
      change: `${inputs.quote.change24h >= 0 ? '+' : ''}${fmt(inputs.quote.change24h)}%`,
      source: 'HEVORA price feed',
      timestamp: inputs.quote.lastUpdated,
      frequency: 'Realtime',
      stance: stanceOf(score),
      score,
      weight: 0.1,
      reasoning:
        inputs.quote.change24h > 0 ? 'Harga sendiri masih menguat 24 jam terakhir.' : 'Harga melemah 24 jam terakhir.',
      route: '/market/forex',
    });
  }

  return factors;
};

/** Stated, never explained. */
export const detectForexAnomaly = (inputs: ForexConfluenceInputs): CrossAssetAnomaly | null => {
  const { spec } = inputs;
  const move = inputs.quote.change24h ?? 0;
  const dxy = inputs.dxy.trend15m ?? 0;
  // A major moving WITH the dollar when the dollar is on the wrong side of the quote.
  const expectedSign = spec.usdIsBase ? 1 : -1;
  if (Math.abs(move) > 0.3 && Math.abs(dxy) > 0.05 && Math.sign(move) !== Math.sign(dxy) * expectedSign) {
    return {
      description: `${spec.name} bergerak berlawanan dengan DXY`,
      detail:
        'Pasangan mayor biasanya bergerak sesuai arah dolar di sisinya. Dicatat apa adanya — penyebabnya tidak disimpulkan di sini.',
    };
  }
  return null;
};

export const buildForexConfluence = (inputs: ForexConfluenceInputs): ConfluenceResult => {
  const { spec } = inputs;
  const closes = inputs.history.map((p) => p.close).filter((c) => Number.isFinite(c));
  const window = closes.slice(-50);
  const ma50 = window.length === 50 ? window.reduce((sum, c) => sum + c, 0) / 50 : null;

  const invalidation: InvalidationCondition[] = [];
  if (ma50 !== null && inputs.quote.price !== null) {
    invalidation.push({
      condition: `Harga ${inputs.quote.price >= ma50 ? 'tutup di bawah' : 'tutup di atas'} ${fmt(ma50, spec.digits)}`,
      basis: `Rata-rata 50 hari dari ${closes.length} penutupan harian Yahoo, bukan angka bulat pilihan sendiri`,
    });
  }
  if (inputs.dxy.price !== null) {
    invalidation.push({
      condition: 'Tren DXY 15 menit berbalik dan bertahan',
      basis: `Sekarang ${fmt(inputs.dxy.trend15m)}% / 15m di level ${fmt(inputs.dxy.price, 3)}`,
    });
  }
  if (inputs.counterRate.latest !== null && inputs.usRate.latest !== null) {
    invalidation.push({
      condition: `Selisih suku bunga ${spec.counterCurrency} − USD berbalik arah`,
      basis: `Sekarang ${fmt(inputs.counterRate.latest - inputs.usRate.latest)}% (${fmt(inputs.counterRate.latest)}% vs ${fmt(inputs.usRate.latest)}%)`,
    });
  }

  return assembleConfluence({
    asset: spec.name,
    factors: buildFactors(inputs),
    invalidation,
    events: inputs.events,
    eventCurrencies: spec.eventCurrencies,
    analog: buildAnalog(inputs.history, spec.name),
    anomaly: detectForexAnomaly(inputs),
    unavailableInputs: forexUnavailableInputs(spec),
    fallbackWatch: 'perubahan arah dolar dan selisih suku bunga',
    // Same series and window as the 'trend' factor above (§9) - the chart illustrates that score,
    // it does not introduce a second one.
    chartHistory: inputs.history,
    chartMaWindow: 50,
    chartDigits: spec.digits,
    now: inputs.now,
  });
};
