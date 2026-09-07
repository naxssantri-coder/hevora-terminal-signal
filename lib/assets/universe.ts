/**
 * Asset universe (§7.1).
 *
 *   Asset -> Asset Class -> Symbol -> Provider -> Market -> Region -> Currency -> Session
 *
 * Tahap C (blueprint §2-5) is the "later phase" this file's own original comment was written
 * for: Commodities (15 symbols) and Indices (10 symbols) already have real, live-verified data
 * behind them (commoditySpecs.ts / server.ts's INDEX_SYMBOLS) but were never surfaced to
 * search/watchlist/command palette - EXTRA_ASSETS below is pure wiring of data that already
 * exists, not a new provider or a new module.
 */

import { PAIRS_LIST } from '../../data/pairs';
import { COMMODITY_SPECS } from '../confluence/commoditySpecs';
import { INDEX_SPECS, type IndexSpec } from '../market/indexSpecs';
import type { AssetCategory, PairId } from '../../types';

export type AssetClass =
  | 'forex'
  | 'commodities'
  | 'crypto'
  | 'equities'
  | 'indices'
  | 'bonds'
  | 'etfs'
  | 'onchain'
  | 'stablecoins';

export type Region = 'global' | 'us' | 'eu' | 'uk' | 'jp' | 'cn' | 'apac';

export type TradingSession = '24x7' | '24x5' | 'us-cash' | 'eu-cash' | 'apac-cash';

export interface AssetDescriptor {
  /** Stable internal id. For engine-covered pairs this equals the PairId. */
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  /** Provider id that owns the primary quote for this asset. */
  provider: string;
  market: string;
  region: Region;
  quoteCurrency: string;
  session: TradingSession;
  digits: number;
  /** True when the signal engine currently produces signals for this asset. */
  tradable: boolean;
  tradingViewSymbol?: string;
  /** Extra search terms so 'gold' or 'emas' finds XAUUSD, 'bitcoin' finds BTCUSDT, etc. */
  keywords?: string[];
}

const CLASS_BY_CATEGORY: Record<AssetCategory, AssetClass> = {
  forex: 'forex',
  crypto: 'crypto',
  commodities: 'commodities',
};

const sessionForClass = (assetClass: AssetClass): TradingSession => {
  if (assetClass === 'crypto' || assetClass === 'onchain' || assetClass === 'stablecoins') return '24x7';
  if (assetClass === 'equities' || assetClass === 'etfs') return 'us-cash';
  return '24x5';
};

/** The engine-covered pairs, lifted into the universe shape. */
/**
 * Search aliases per engine pair. The registry's own name ('XAU/USD') is not what a trader types
 * - keeping the common names here is what makes searching 'gold' or 'emas' return the asset.
 */
export const PAIR_KEYWORDS: Record<string, string[]> = {
  XAUUSD: ['gold', 'emas', 'xau', 'bullion', 'spot gold'],
  BTCUSDT: ['bitcoin', 'btc'],
  ETHUSDT: ['ethereum', 'eth', 'ether'],
  SOLUSDT: ['solana', 'sol'],
  EURUSD: ['euro', 'eur', 'fiber'],
  USDCHF: ['swiss franc', 'chf', 'swissy'],
  USDCAD: ['canadian dollar', 'cad', 'loonie'],
  GBPUSD: ['pound', 'sterling', 'gbp', 'cable'],
  // Tahap C - data-only pairs (see PairMetadata.signalEngineEnabled)
  USDJPY: ['japanese yen', 'jpy', 'yen'],
  AUDUSD: ['australian dollar', 'aud', 'aussie'],
  NZDUSD: ['new zealand dollar', 'nzd', 'kiwi'],
  BNBUSDT: ['binance coin', 'bnb'],
  XRPUSDT: ['ripple', 'xrp'],
  ADAUSDT: ['cardano', 'ada'],
  DOGEUSDT: ['dogecoin', 'doge'],
};

export const ENGINE_ASSETS: AssetDescriptor[] = PAIRS_LIST.map((pair) => {
  const assetClass = CLASS_BY_CATEGORY[pair.category];
  return {
    id: pair.id,
    symbol: pair.id,
    name: pair.name,
    assetClass,
    provider: pair.brokerProvider,
    market: assetClass === 'crypto' ? 'Perpetual Futures' : 'Spot',
    region: 'global' as Region,
    quoteCurrency: pair.id.endsWith('USDT') ? 'USDT' : 'USD',
    session: sessionForClass(assetClass),
    digits: pair.digits,
    // Data-only pairs are real, searchable, watchlistable assets - just without a BUY/SELL card.
    // See PairMetadata.signalEngineEnabled for why some pairs never reach createInstitutional-
    // ScalpingSignal even though their price/candle data is fully live.
    tradable: pair.signalEngineEnabled,
    tradingViewSymbol: pair.tradingViewSymbol,
    keywords: PAIR_KEYWORDS[pair.id] ?? [],
  };
});

export const COMMODITY_KEYWORDS: Record<string, string[]> = {
  'CL=F': ['wti', 'crude', 'oil'],
  'BZ=F': ['brent', 'crude', 'oil'],
  'NG=F': ['natural gas', 'gas'],
  'GC=F': ['gold futures', 'gold'],
  'SI=F': ['silver'],
  'HG=F': ['copper'],
  'PL=F': ['platinum'],
  'PA=F': ['palladium'],
  'ZW=F': ['wheat'],
  'ZC=F': ['corn'],
  'ZS=F': ['soybeans', 'soy'],
  'KC=F': ['coffee'],
  'SB=F': ['sugar'],
  'CC=F': ['cocoa'],
  'CT=F': ['cotton'],
};

/**
 * Commodities Board (15 symbols, commoditySpecs.ts - already probed live, see that file's own
 * header comment) surfaced to search/watchlist. Not signal-engine pairs - same "context, not a
 * BUY/SELL instrument" status commodities have always had here (only XAU/USD gets a confluence
 * signal card; futures get analysis, not a trade call).
 */
const COMMODITY_ASSETS: AssetDescriptor[] = COMMODITY_SPECS.map((spec) => ({
  id: spec.symbol,
  symbol: spec.symbol,
  name: spec.name,
  assetClass: 'commodities' as AssetClass,
  provider: 'Yahoo Finance',
  market: 'Futures',
  region: 'global' as Region,
  quoteCurrency: 'USD',
  session: sessionForClass('commodities'),
  digits: spec.digits,
  tradable: false,
  // No verified TradingView symbol for these futures contracts - omitted rather than guessed.
  keywords: COMMODITY_KEYWORDS[spec.symbol] ?? [],
}));

const INDEX_QUOTE_CURRENCY: Record<IndexSpec['region'], string> = { US: 'USD', EU: 'EUR', UK: 'GBP', JP: 'JPY' };
const INDEX_REGION: Record<IndexSpec['region'], Region> = { US: 'us', EU: 'eu', UK: 'uk', JP: 'jp' };
const INDEX_KEYWORDS: Record<string, string[]> = {
  '^GSPC': ['s&p 500', 'sp500', 'spx'],
  '^IXIC': ['nasdaq', 'nasdaq composite'],
  '^DJI': ['dow jones', 'dow', 'djia'],
  '^RUT': ['russell 2000', 'russell'],
  '^VIX': ['volatility index', 'fear index'],
  'DX-Y.NYB': ['dollar index', 'dxy', 'usd index'],
  '^N225': ['nikkei', 'nikkei 225'],
  '^GDAXI': ['dax', 'germany 40'],
  '^FTSE': ['ftse 100', 'ftse', 'uk 100'],
  '^STOXX50E': ['euro stoxx', 'stoxx 50'],
};

/**
 * Markets > Indices (10 symbols, indexSpecs.ts mirroring server.ts's INDEX_SYMBOLS) surfaced to
 * search/watchlist. "Context instruments, not tradable symbols" per IndicesView.tsx's own header
 * comment - tradable: false here matches that existing, already-shipped framing exactly.
 */
const INDEX_ASSETS: AssetDescriptor[] = INDEX_SPECS.map((spec) => ({
  id: spec.symbol,
  symbol: spec.symbol,
  name: spec.name,
  assetClass: 'indices' as AssetClass,
  provider: 'Yahoo Finance',
  market: 'Index',
  region: INDEX_REGION[spec.region],
  quoteCurrency: INDEX_QUOTE_CURRENCY[spec.region],
  session: sessionForClass('indices'),
  digits: 2,
  tradable: false,
  keywords: INDEX_KEYWORDS[spec.symbol] ?? [],
}));

/** Registered non-engine assets go here as later phases add them (macro series, ETFs, etc.). */
const EXTRA_ASSETS: AssetDescriptor[] = [...COMMODITY_ASSETS, ...INDEX_ASSETS];

export const registerAssets = (assets: AssetDescriptor[]): void => {
  for (const asset of assets) {
    if (!EXTRA_ASSETS.some((a) => a.id === asset.id) && !ENGINE_ASSETS.some((a) => a.id === asset.id)) {
      EXTRA_ASSETS.push(asset);
    }
  }
};

export const listAssets = (): AssetDescriptor[] => [...ENGINE_ASSETS, ...EXTRA_ASSETS];

export const getAsset = (id: string): AssetDescriptor | undefined =>
  listAssets().find((a) => a.id.toLowerCase() === id.toLowerCase());

export const listAssetsByClass = (assetClass: AssetClass): AssetDescriptor[] =>
  listAssets().filter((a) => a.assetClass === assetClass);

export const isEnginePair = (id: string): id is PairId => ENGINE_ASSETS.some((a) => a.id === id);

export const searchAssets = (query: string): AssetDescriptor[] => {
  const q = query.trim().toLowerCase();
  if (!q) return listAssets();
  return listAssets().filter(
    (a) =>
      a.id.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      a.assetClass.toLowerCase().includes(q) ||
      (a.keywords ?? []).some((k) => k.includes(q))
  );
};
