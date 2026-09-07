import type { EconomicEvent } from '../../types';
import type {
  ConfluenceFactor,
  ConfluenceResult,
  CrossAssetAnomaly,
  InvalidationCondition,
} from './types';
import { assembleConfluence, buildAnalog, clamp, fmt, stanceOf } from './core';
import type { CommoditySpec } from './commoditySpecs';

/**
 * Confluence Engine for the commodity board (§4, replicated from XAU).
 *
 * Same three rules as the gold engine, enforced in ./core so they cannot drift: a factor with no
 * live input is excluded rather than scored zero, nothing is published below three live factors,
 * and the historical analog carries its sample size instead of a probability.
 *
 * What differs per contract lives in ./commoditySpecs.ts. The important asymmetry: risk-off is
 * BULLISH for a precious metal and BEARISH for a barrel of oil, so the VIX factor is signed by
 * the spec rather than assumed - and where the link is too weak to claim (agriculture) the factor
 * is not built at all.
 */

export interface CommodityQuoteInput {
  price: number | null;
  changePercent: number | null;
  quoteTime: string | null;
}

export interface CommodityConfluenceInputs {
  spec: CommoditySpec;
  quote: CommodityQuoteInput;
  /** DXY level and its 15-minute trend from the engine's own tracker. */
  dxy: { price: number | null; trend15m: number | null; lastUpdated: string | null };
  /** CFTC non-commercial net position for THIS contract, plus its percentile. */
  cot: { net: number | null; percentile: number | null; reportDate: string | null };
  /** VIX close (FRED VIXCLS). */
  vix: { latest: number | null; date: string | null };
  /** 10Y real yield (FRED DFII10) - only consumed by the non-yielding metals. */
  realYield: { latest: number | null; previous: number | null; date: string | null };
  /** EIA weekly crude stocks, oldest first, in thousand barrels. */
  crudeStocks: Array<{ period: string; value: number }>;
  /** Yahoo daily closes for this contract, oldest first. */
  history: Array<{ date: string; close: number }>;
  events: EconomicEvent[];
  now?: number;
}

/** Simple moving average over the last `length` closes, or null when the series is too short. */
export const sma = (closes: number[], length: number): number | null => {
  if (closes.length < length) return null;
  const window = closes.slice(-length);
  return window.reduce((sum, c) => sum + c, 0) / length;
};

const buildFactors = (inputs: CommodityConfluenceInputs): ConfluenceFactor[] => {
  const { spec } = inputs;
  const factors: ConfluenceFactor[] = [];
  const closes = inputs.history.map((p) => p.close).filter((c) => Number.isFinite(c));

  // --- Dollar: every one of these contracts is priced in USD, so this factor applies to all.
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
      weight: spec.dollarWeight,
      reasoning:
        inputs.dxy.trend15m < 0
          ? `Dolar melemah — buat pembeli non-dolar, ${spec.name.toLowerCase()} jadi lebih murah.`
          : inputs.dxy.trend15m > 0
            ? `Dolar menguat — ini biasanya menekan permintaan ${spec.name.toLowerCase()}.`
            : 'Dolar bergerak datar.',
      route: '/macro/dxy',
    });
  }

  // --- Inventories: the one input that makes an energy read an energy read rather than a generic
  // dollar-and-positioning read. A build is bearish, a draw is bullish.
  if (spec.usesCrudeInventories && inputs.crudeStocks.length >= 2) {
    const latest = inputs.crudeStocks[inputs.crudeStocks.length - 1];
    const previous = inputs.crudeStocks[inputs.crudeStocks.length - 2];
    const delta = latest.value - previous.value;
    // A 3 million barrel weekly swing is a decisive print for this series.
    const score = clamp(-delta / 3000, -1, 1);
    factors.push({
      id: 'crude-stocks',
      label: 'Stok minyak mentah AS',
      rawValue: `${Math.round(latest.value).toLocaleString('en-US')} rb barel`,
      change: `${delta >= 0 ? '+' : ''}${Math.round(delta).toLocaleString('en-US')} rb barel w/w`,
      source: 'EIA WCESTUS1',
      timestamp: latest.period,
      frequency: 'Weekly',
      stance: stanceOf(score),
      score,
      weight: 0.25,
      reasoning:
        delta > 0
          ? 'Stok naik — pasokan menumpuk, ini sisi yang menekan harga.'
          : delta < 0
            ? 'Stok turun — barang terserap, ini yang biasanya menopang harga.'
            : 'Stok praktis tidak berubah minggu ini.',
      route: '/market/commodities',
    });
  }

  // --- Positioning: crowding is a risk regardless of direction, same reading as the gold engine.
  if (inputs.cot.net !== null && inputs.cot.percentile !== null) {
    const p = inputs.cot.percentile;
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
      weight: spec.cotWeight,
      reasoning:
        p >= 80
          ? 'Posisi long institusi sudah ramai — ruang tambah beli menipis, rawan koreksi.'
          : p <= 20
            ? 'Posisi institusi sudah sepi di sisi long — biasanya ruang naiknya justru lebih lega.'
            : 'Posisi institusi belum ekstrem, belum jadi sinyal balik.',
      route: '/macro/cot',
    });
  }

  // --- Real yield: only for the non-yielding metals, where the cost of holding is the whole point.
  if (spec.usesRealYield && inputs.realYield.latest !== null) {
    const delta =
      inputs.realYield.previous === null ? null : inputs.realYield.latest - inputs.realYield.previous;
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
      weight: 0.2,
      reasoning:
        delta === null
          ? 'Real yield terbaca, tapi belum ada pembanding rilis sebelumnya.'
          : delta < 0
            ? `Real yield turun — biaya memegang ${spec.name.toLowerCase()} jadi lebih murah.`
            : delta > 0
              ? `Real yield naik — ini yang biasanya menekan logam tanpa imbal hasil seperti ${spec.name.toLowerCase()}.`
              : 'Real yield praktis tidak bergerak.',
      route: '/macro/yield-curve',
    });
  }

  // --- Risk appetite. Signed by the spec: fear is a bid for a safe haven and a problem for a
  // demand asset. Where the link is too weak to claim, the spec says null and nothing is built.
  if (spec.riskDirection !== null && inputs.vix.latest !== null) {
    const raw = clamp((inputs.vix.latest - 20) / 10, -1, 1);
    const score = raw * spec.riskDirection;
    const tense = inputs.vix.latest > 25;
    const calm = inputs.vix.latest < 15;
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
        spec.riskDirection === 1
          ? tense
            ? 'Pasar lagi tegang, biasanya ada aliran ke aset safe haven.'
            : calm
              ? 'Pasar tenang, permintaan safe haven tipis.'
              : 'Volatilitas di kisaran normal.'
          : tense
            ? 'Pasar lagi tegang — yang pertama dipangkas biasanya ekspektasi permintaan.'
            : calm
              ? 'Pasar tenang, ekspektasi permintaan belum terganggu.'
              : 'Volatilitas di kisaran normal.',
      route: '/analysis/volatility',
    });
  }

  // --- Trend versus its own 50-day average: the market's own vote, measured from real closes.
  const ma50 = sma(closes, 50);
  if (ma50 !== null && inputs.quote.price !== null && ma50 !== 0) {
    const distance = (inputs.quote.price - ma50) / ma50;
    // 5% away from the average is a full-strength trend read for these contracts.
    const score = clamp(distance / 0.05, -1, 1);
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
      route: '/market/commodities',
    });
  }

  // --- The session's own move, weighted lightest because it is the thing being explained.
  if (inputs.quote.changePercent !== null) {
    const score = clamp(inputs.quote.changePercent / 2, -1, 1);
    factors.push({
      id: 'price',
      label: 'Perubahan sesi terakhir',
      rawValue: fmt(inputs.quote.price, spec.digits),
      change: `${inputs.quote.changePercent >= 0 ? '+' : ''}${fmt(inputs.quote.changePercent)}%`,
      source: 'Yahoo Finance (futures)',
      timestamp: inputs.quote.quoteTime,
      frequency: 'Delayed',
      stance: stanceOf(score),
      score,
      weight: 0.1,
      reasoning:
        inputs.quote.changePercent > 0
          ? 'Sesi terakhir ditutup menguat.'
          : 'Sesi terakhir ditutup melemah.',
      route: '/market/commodities',
    });
  }

  return factors;
};

/**
 * Cross-asset anomalies. Both of these are STATED, never explained: naming a cause we cannot
 * measure would be the fabrication this module exists to avoid.
 */
export const detectCommodityAnomaly = (inputs: CommodityConfluenceInputs): CrossAssetAnomaly | null => {
  const move = inputs.quote.changePercent ?? 0;
  const dxy = inputs.dxy.trend15m ?? 0;

  if (move > 0.3 && dxy > 0.05) {
    return {
      description: `${inputs.spec.name} dan DXY sama-sama naik`,
      detail: 'Komoditas berdenominasi dolar biasanya bergerak berlawanan dengan DXY. Dicatat apa adanya — penyebabnya tidak disimpulkan di sini.',
    };
  }

  if (inputs.spec.usesCrudeInventories && inputs.crudeStocks.length >= 2) {
    const latest = inputs.crudeStocks[inputs.crudeStocks.length - 1].value;
    const previous = inputs.crudeStocks[inputs.crudeStocks.length - 2].value;
    if (latest - previous > 2000 && move > 0.3) {
      return {
        description: 'Harga naik padahal stok menumpuk',
        detail: 'Stok mingguan naik tajam tapi harga tetap menguat. Dicatat sebagai anomali, bukan sebagai kesimpulan sebab-akibat.',
      };
    }
  }

  return null;
};

export const buildCommodityConfluence = (inputs: CommodityConfluenceInputs): ConfluenceResult => {
  const { spec } = inputs;
  const closes = inputs.history.map((p) => p.close).filter((c) => Number.isFinite(c));
  const ma50 = sma(closes, 50);

  const invalidation: InvalidationCondition[] = [];
  if (ma50 !== null && inputs.quote.price !== null) {
    const above = inputs.quote.price >= ma50;
    invalidation.push({
      condition: `Harga ${above ? 'tutup di bawah' : 'tutup di atas'} ${fmt(ma50, spec.digits)}`,
      basis: `Rata-rata 50 hari dari ${closes.length} penutupan harian Yahoo, bukan angka bulat pilihan sendiri`,
    });
  }
  if (inputs.dxy.price !== null) {
    invalidation.push({
      condition: 'Tren DXY 15 menit berbalik dan bertahan',
      basis: `Sekarang ${fmt(inputs.dxy.trend15m)}% / 15m di level ${fmt(inputs.dxy.price, 3)}`,
    });
  }
  if (spec.usesCrudeInventories && inputs.crudeStocks.length >= 1) {
    const latest = inputs.crudeStocks[inputs.crudeStocks.length - 1];
    invalidation.push({
      condition: 'Rilis stok EIA berikutnya berbalik arah dari minggu ini',
      basis: `Print terakhir ${latest.period}: ${Math.round(latest.value).toLocaleString('en-US')} rb barel`,
    });
  }

  return assembleConfluence({
    asset: `${spec.name} (${spec.symbol})`,
    factors: buildFactors(inputs),
    invalidation,
    events: inputs.events,
    // These are dollar-denominated contracts; a high-impact release in another currency is not a
    // catalyst we can honestly name for them.
    eventCurrencies: ['USD'],
    analog: buildAnalog(inputs.history, spec.name.toLowerCase()),
    anomaly: detectCommodityAnomaly(inputs),
    fallbackWatch: 'perubahan pada faktor-faktor di atas',
    // Same series and window as the 'trend' factor above (§9) - the chart illustrates that score,
    // it does not introduce a second one.
    chartHistory: inputs.history,
    chartMaWindow: 50,
    chartDigits: spec.digits,
    now: inputs.now,
  });
};
