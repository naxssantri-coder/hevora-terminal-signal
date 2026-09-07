import type { EconomicEvent } from '../../types';
import type {
  ConfluenceFactor,
  ConfluenceResult,
  CrossAssetAnomaly,
  InvalidationCondition,
  UnavailableInput,
} from './types';
import { assembleConfluence, buildAnalog, clamp, fmt, stanceOf } from './core';

/**
 * Confluence Engine for BTC/USDT (§4, replicated from XAU).
 *
 * Same core rules, same enforcement point (./core). What is specific to crypto is that its most
 * informative inputs are POSITIONING inputs - funding, open interest, dominance, sentiment - and
 * every one of them is read contrarian at the extremes: a market where everyone is already long
 * and paying to stay long has less fuel, not more. That is the opposite of how a momentum reader
 * would score them, and it is deliberate.
 *
 * The one input this read is missing is spot ETF flow, and it is NAMED rather than quietly left
 * out (§10). Farside returned 403 and both Yahoo share-count alternatives returned 401 on every
 * verified probe run, so there is no honest free derivation of it in this build - and flow is the
 * single most tempting number to invent, which is why its absence is published.
 */

export interface CryptoConfluenceInputs {
  /** Live BTC quote from the terminal's own price feed. */
  quote: { price: number | null; change24h: number | null; lastUpdated: string | null };
  /** OKX perpetual funding and open interest. */
  derivatives: {
    fundingRate: number | null;
    fundingTime: string | null;
    openInterestChange24h: number | null;
    openInterestTime: string | null;
  };
  /** CFTC CME bitcoin futures positioning. */
  cot: { net: number | null; percentile: number | null; reportDate: string | null };
  /** alternative.me Crypto Fear & Greed - a crypto-scope index, never labelled market-wide. */
  fearGreed: { value: number | null; classification: string | null; timestamp: string | null };
  /** CoinGecko BTC dominance, and the previous reading when one is held. */
  dominance: { btc: number | null; previousBtc: number | null; updatedAt: string | null };
  /** DefiLlama total stablecoin supply, oldest first. */
  stablecoins: Array<{ date: string; totalUsd: number }>;
  /** Daily closes for the analog, oldest first. Empty until a real series is wired. */
  dailyHistory: Array<{ date: string; close: number }>;
  events: EconomicEvent[];
  now?: number;
}

/** Named absences, so the read never looks more complete than it is (§10). */
export const CRYPTO_UNAVAILABLE_INPUTS: UnavailableInput[] = [
  {
    label: 'Spot BTC ETF net flow',
    status: 'Provider not wired',
    detail:
      'Farside menolak akses (403) dan dua alternatif Yahoo menolak (401) di setiap run verifikasi. Tidak ada turunan gratis yang bisa dipercaya, jadi faktor ini tidak dibangun — bukan diisi angka.',
  },
];

const buildFactors = (inputs: CryptoConfluenceInputs): ConfluenceFactor[] => {
  const factors: ConfluenceFactor[] = [];

  // --- Funding: what longs are paying to stay long. Read contrarian at the extremes.
  if (inputs.derivatives.fundingRate !== null) {
    const bps = inputs.derivatives.fundingRate * 10_000;
    // ~1bp per 8h is the neutral resting rate; 5bp is a crowded, expensive long.
    const score = clamp(-(bps - 1) / 4, -1, 1);
    factors.push({
      id: 'funding',
      label: 'Funding rate perpetual',
      rawValue: `${fmt(bps, 2)} bps / 8j`,
      change: null,
      source: 'OKX (BTC-USDT-SWAP)',
      timestamp: inputs.derivatives.fundingTime,
      frequency: 'Near-realtime',
      stance: stanceOf(score),
      score,
      weight: 0.2,
      reasoning:
        bps > 5
          ? 'Long bayar mahal buat bertahan — posisi sudah ramai di satu sisi, ini yang biasanya kena squeeze duluan.'
          : bps < -1
            ? 'Short yang bayar — sisi jual lagi ramai, dan itu bahan bakar buat naik.'
            : 'Funding di kisaran normal, belum ada sisi yang kepenuhan.',
      route: '/analysis/positioning',
    });
  }

  // --- Open interest, read WITH price: new money behind a move is different from a move on air.
  if (inputs.derivatives.openInterestChange24h !== null && inputs.quote.change24h !== null) {
    const oiPct = inputs.derivatives.openInterestChange24h * 100;
    const priceUp = inputs.quote.change24h > 0;
    // OI expanding into a rising market backs the move; expanding into a falling one is shorts
    // pressing. Contracting OI in either direction is positions being closed, not conviction.
    const magnitude = clamp(Math.abs(oiPct) / 8, 0, 1);
    const score = oiPct >= 0 ? (priceUp ? magnitude : -magnitude) : priceUp ? -magnitude * 0.5 : magnitude * 0.5;
    factors.push({
      id: 'open-interest',
      label: 'Open interest 24 jam',
      rawValue: `${oiPct >= 0 ? '+' : ''}${fmt(oiPct)}%`,
      change: `${priceUp ? 'harga naik' : 'harga turun'} di periode yang sama`,
      source: 'OKX open interest history',
      timestamp: inputs.derivatives.openInterestTime,
      frequency: 'Near-realtime',
      stance: stanceOf(score),
      score,
      weight: 0.15,
      reasoning:
        oiPct >= 0
          ? priceUp
            ? 'Posisi baru masuk sambil harga naik — ada uang baru di balik gerakan ini.'
            : 'Posisi baru masuk sambil harga turun — sisi jual yang lagi nambah.'
          : priceUp
            ? 'Harga naik tapi posisi justru ditutup — lebih mirip tutup short daripada beli baru.'
            : 'Posisi ditutup sambil harga turun — tekanan jualnya mereda, bukan bertambah.',
      route: '/analysis/positioning',
    });
  }

  // --- CME positioning: the institutional side of the same question.
  if (inputs.cot.net !== null && inputs.cot.percentile !== null) {
    const p = inputs.cot.percentile;
    const score = p >= 80 ? -clamp((p - 80) / 20, 0, 1) : p <= 20 ? clamp((20 - p) / 20, 0, 1) : 0;
    factors.push({
      id: 'cot',
      label: 'COT bitcoin CME',
      rawValue: `net ${inputs.cot.net >= 0 ? '+' : ''}${Math.round(inputs.cot.net).toLocaleString('en-US')}`,
      change: `percentile ${Math.round(p)}/100`,
      source: 'CFTC Commitment of Traders',
      timestamp: inputs.cot.reportDate,
      frequency: 'Weekly',
      stance: stanceOf(score),
      score,
      weight: 0.15,
      reasoning:
        p >= 80
          ? 'Posisi long institusi di CME sudah ramai — ruang tambah beli menipis.'
          : p <= 20
            ? 'Institusi lagi sepi di sisi long — ruang naiknya justru lebih lega.'
            : 'Posisi institusi belum ekstrem.',
      route: '/macro/cot',
    });
  }

  // --- Retail sentiment, also contrarian at the extremes.
  if (inputs.fearGreed.value !== null) {
    const v = inputs.fearGreed.value;
    const score = v >= 75 ? -clamp((v - 75) / 25, 0, 1) : v <= 25 ? clamp((25 - v) / 25, 0, 1) : 0;
    factors.push({
      id: 'fear-greed',
      label: 'Fear & Greed (crypto)',
      rawValue: `${Math.round(v)}${inputs.fearGreed.classification ? ` (${inputs.fearGreed.classification})` : ''}`,
      change: null,
      source: 'alternative.me Crypto Fear & Greed',
      timestamp: inputs.fearGreed.timestamp,
      frequency: 'Daily',
      stance: stanceOf(score),
      score,
      weight: 0.15,
      reasoning:
        v >= 75
          ? 'Pasar lagi serakah — biasanya di titik ini yang beli belakangan sudah kehabisan tempat.'
          : v <= 25
            ? 'Pasar lagi takut — historisnya justru di sini yang jual duluan sudah habis.'
            : 'Sentimen di kisaran tengah, belum jadi sinyal contrarian.',
      route: '/analysis/liquidity-flow',
    });
  }

  // --- Dominance: whether money is rotating INTO bitcoin or out along the risk curve.
  if (inputs.dominance.btc !== null && inputs.dominance.previousBtc !== null) {
    const delta = inputs.dominance.btc - inputs.dominance.previousBtc;
    const score = clamp(delta / 0.5, -1, 1);
    factors.push({
      id: 'dominance',
      label: 'Dominasi BTC',
      rawValue: `${fmt(inputs.dominance.btc)}%`,
      change: `${delta >= 0 ? '+' : ''}${fmt(delta)} pt`,
      source: 'CoinGecko global',
      timestamp: inputs.dominance.updatedAt,
      frequency: 'Daily',
      stance: stanceOf(score),
      score,
      weight: 0.1,
      reasoning:
        delta > 0
          ? 'Dominasi BTC naik — uang lagi masuk ke bitcoin, bukan menyebar ke altcoin.'
          : 'Dominasi BTC turun — uang lagi geser ke aset yang lebih spekulatif.',
      route: '/analysis/liquidity-flow',
    });
  }

  // --- Stablecoin supply: dry powder sitting on exchanges.
  if (inputs.stablecoins.length >= 8) {
    const latest = inputs.stablecoins[inputs.stablecoins.length - 1];
    const weekAgo = inputs.stablecoins[inputs.stablecoins.length - 8];
    if (weekAgo.totalUsd > 0) {
      const pct = ((latest.totalUsd - weekAgo.totalUsd) / weekAgo.totalUsd) * 100;
      const score = clamp(pct / 1.5, -1, 1);
      factors.push({
        id: 'stablecoins',
        label: 'Suplai stablecoin',
        rawValue: `$${(latest.totalUsd / 1e9).toFixed(1)}B`,
        change: `${pct >= 0 ? '+' : ''}${fmt(pct)}% / 7h`,
        source: 'DefiLlama stablecoin supply',
        timestamp: latest.date,
        frequency: 'Daily',
        stance: stanceOf(score),
        score,
        weight: 0.1,
        reasoning:
          pct > 0
            ? 'Suplai stablecoin naik — amunisi beli di pasar bertambah.'
            : 'Suplai stablecoin menyusut — uang justru keluar dari sistem.',
        route: '/analysis/liquidity-flow',
      });
    }
  }

  // --- The market's own vote, weighted lightest.
  if (inputs.quote.change24h !== null) {
    const score = clamp(inputs.quote.change24h / 4, -1, 1);
    factors.push({
      id: 'price',
      label: 'Momentum harga 24 jam',
      rawValue: inputs.quote.price === null ? '—' : fmt(inputs.quote.price),
      change: `${inputs.quote.change24h >= 0 ? '+' : ''}${fmt(inputs.quote.change24h)}%`,
      source: 'HEVORA price feed',
      timestamp: inputs.quote.lastUpdated,
      frequency: 'Realtime',
      stance: stanceOf(score),
      score,
      weight: 0.1,
      reasoning:
        inputs.quote.change24h > 0 ? 'Harga sendiri masih menguat 24 jam terakhir.' : 'Harga melemah 24 jam terakhir.',
      route: '/market/crypto',
    });
  }

  return factors;
};

/** Stated, never explained - the same rule the gold and commodity engines follow. */
export const detectCryptoAnomaly = (inputs: CryptoConfluenceInputs): CrossAssetAnomaly | null => {
  const bps = inputs.derivatives.fundingRate === null ? null : inputs.derivatives.fundingRate * 10_000;
  const change = inputs.quote.change24h;

  if (bps !== null && change !== null && bps > 5 && change < -1) {
    return {
      description: 'Funding masih mahal padahal harga turun',
      detail: 'Long belum keluar meski harga melemah. Dicatat apa adanya — penyebabnya tidak disimpulkan di sini.',
    };
  }
  if (inputs.fearGreed.value !== null && change !== null && inputs.fearGreed.value >= 75 && change < -2) {
    return {
      description: 'Sentimen masih serakah padahal harga jatuh',
      detail: 'Indeks sentimen belum menyesuaikan dengan gerakan harga. Dicatat sebagai anomali, bukan sebagai sebab-akibat.',
    };
  }
  return null;
};

export const buildBtcConfluence = (inputs: CryptoConfluenceInputs): ConfluenceResult => {
  const invalidation: InvalidationCondition[] = [];

  if (inputs.derivatives.fundingRate !== null) {
    const bps = inputs.derivatives.fundingRate * 10_000;
    invalidation.push({
      condition: bps > 1 ? 'Funding turun ke bawah 1 bps / 8 jam' : 'Funding naik tembus 5 bps / 8 jam',
      basis: `Sekarang ${fmt(bps, 2)} bps; 1 bps adalah tarif istirahat kontrak ini, 5 bps batas ramai`,
    });
  }
  if (inputs.fearGreed.value !== null) {
    invalidation.push({
      condition: `Fear & Greed keluar dari zona ${inputs.fearGreed.classification ?? 'sekarang'}`,
      basis: `Bacaan terakhir ${Math.round(inputs.fearGreed.value)}/100 per ${inputs.fearGreed.timestamp?.slice(0, 10) ?? 'tanggal tidak dipublikasikan'}`,
    });
  }

  return assembleConfluence({
    asset: 'BTC/USDT',
    factors: buildFactors(inputs),
    invalidation,
    events: inputs.events,
    // Crypto trades through every session, but the releases that actually move it are the US
    // macro prints - the same ones that move the dollar.
    eventCurrencies: ['USD'],
    analog: buildAnalog(inputs.dailyHistory, 'bitcoin'),
    anomaly: detectCryptoAnomaly(inputs),
    unavailableInputs: CRYPTO_UNAVAILABLE_INPUTS,
    fallbackWatch: 'perubahan funding dan open interest',
    now: inputs.now,
  });
};
