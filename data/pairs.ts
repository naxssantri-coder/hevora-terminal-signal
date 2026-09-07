import { PairMetadata, PairId } from '../types';

export const PAIRS_LIST: PairMetadata[] = [
  {
    id: 'XAUUSD',
    name: 'XAU/USD',
    category: 'commodities',
    tradingViewSymbol: 'OANDA:XAUUSD',
    digits: 2,
    description: 'Gold Spot vs US Dollar - High Liquidity Scalping Asset',
    brokerProvider: 'Gold Spot Market',
    signalEngineEnabled: true
  },
  {
    id: 'BTCUSDT',
    name: 'BTC/USDT Perpetual',
    category: 'crypto',
    tradingViewSymbol: 'BINANCE:BTCUSDT.P',
    digits: 2,
    description: 'Bitcoin USDT Futures - Binance Derivatives',
    brokerProvider: 'Binance Futures',
    signalEngineEnabled: true
  },
  {
    id: 'ETHUSDT',
    name: 'ETH/USDT Perpetual',
    category: 'crypto',
    tradingViewSymbol: 'BINANCE:ETHUSDT.P',
    digits: 2,
    description: 'Ethereum USDT Futures - Binance Derivatives',
    brokerProvider: 'Binance Futures',
    signalEngineEnabled: true
  },
  {
    id: 'SOLUSDT',
    name: 'SOL/USDT Perpetual',
    category: 'crypto',
    tradingViewSymbol: 'BINANCE:SOLUSDT.P',
    digits: 2,
    description: 'Solana USDT Futures - Binance Derivatives',
    brokerProvider: 'Binance Futures',
    signalEngineEnabled: true
  },
  {
    id: 'EURUSD',
    name: 'EUR/USD',
    category: 'forex',
    tradingViewSymbol: 'OANDA:EURUSD',
    digits: 5,
    description: 'Euro vs US Dollar - Core Forex Major Pair',
    brokerProvider: 'Yahoo Finance FX',
    signalEngineEnabled: true
  },
  {
    id: 'USDCHF',
    name: 'USD/CHF',
    category: 'forex',
    tradingViewSymbol: 'OANDA:USDCHF',
    digits: 5,
    description: 'US Dollar vs Swiss Franc - Institutional Safe Haven Pair',
    brokerProvider: 'Yahoo Finance FX',
    signalEngineEnabled: true
  },
  {
    id: 'USDCAD',
    name: 'USD/CAD',
    category: 'forex',
    tradingViewSymbol: 'OANDA:USDCAD',
    digits: 5,
    description: 'US Dollar vs Canadian Dollar - Commodity Currency Pair',
    brokerProvider: 'Yahoo Finance FX',
    signalEngineEnabled: true
  },
  {
    id: 'GBPUSD',
    name: 'GBP/USD',
    category: 'forex',
    tradingViewSymbol: 'OANDA:GBPUSD',
    digits: 5,
    description: 'British Pound vs US Dollar - High Volatility Forex Major',
    brokerProvider: 'Yahoo Finance FX',
    signalEngineEnabled: true
  },

  // --- Tahap C (blueprint §2-5): asset universe expansion ---------------------------------------
  //
  // Every pair below was verified via GitHub Actions before being added here
  // (scripts/verify-sources.ts, groups 'Asset universe - Forex'/'Asset universe - Crypto') - live
  // feed density AND historical depth both checked, not just "the endpoint answers 200". All
  // passed comfortably (forex: 108-222 1m bars/day, 258-259 daily closes; crypto: full 30/30 5m
  // candles via OKX).
  //
  // signalEngineEnabled: false on all seven - data flows (price, candles, search, watchlist), but
  // no BUY/SELL card. The confluence engine's SL/TP sizing is hand-tuned per specific symbol (see
  // PairMetadata.signalEngineEnabled's doc comment); none of these seven have had that research
  // done. Turning signals on for any of them is a separate, deliberate follow-up, not a flag flip.
  {
    id: 'USDJPY',
    name: 'USD/JPY',
    category: 'forex',
    tradingViewSymbol: 'OANDA:USDJPY',
    digits: 3,
    description: 'US Dollar vs Japanese Yen - Forex Major (data-only, no signal engine yet)',
    brokerProvider: 'Yahoo Finance FX',
    signalEngineEnabled: false
  },
  {
    id: 'AUDUSD',
    name: 'AUD/USD',
    category: 'forex',
    tradingViewSymbol: 'OANDA:AUDUSD',
    digits: 5,
    description: 'Australian Dollar vs US Dollar - Commodity Currency (data-only, no signal engine yet)',
    brokerProvider: 'Yahoo Finance FX',
    signalEngineEnabled: false
  },
  {
    id: 'NZDUSD',
    name: 'NZD/USD',
    category: 'forex',
    tradingViewSymbol: 'OANDA:NZDUSD',
    digits: 5,
    description: 'New Zealand Dollar vs US Dollar - Commodity Currency (data-only, no signal engine yet)',
    brokerProvider: 'Yahoo Finance FX',
    signalEngineEnabled: false
  },
  {
    id: 'BNBUSDT',
    name: 'BNB/USDT',
    category: 'crypto',
    tradingViewSymbol: 'OKX:BNBUSDT',
    digits: 2,
    description: 'BNB vs USDT Spot - OKX (data-only, no signal engine yet)',
    brokerProvider: 'OKX',
    signalEngineEnabled: false
  },
  {
    id: 'XRPUSDT',
    name: 'XRP/USDT',
    category: 'crypto',
    tradingViewSymbol: 'OKX:XRPUSDT',
    digits: 4,
    description: 'XRP vs USDT Spot - OKX (data-only, no signal engine yet)',
    brokerProvider: 'OKX',
    signalEngineEnabled: false
  },
  {
    id: 'ADAUSDT',
    name: 'ADA/USDT',
    category: 'crypto',
    tradingViewSymbol: 'OKX:ADAUSDT',
    digits: 4,
    description: 'Cardano vs USDT Spot - OKX (data-only, no signal engine yet)',
    brokerProvider: 'OKX',
    signalEngineEnabled: false
  },
  {
    id: 'DOGEUSDT',
    name: 'DOGE/USDT',
    category: 'crypto',
    tradingViewSymbol: 'OKX:DOGEUSDT',
    digits: 5,
    description: 'Dogecoin vs USDT Spot - OKX (data-only, no signal engine yet)',
    brokerProvider: 'OKX',
    signalEngineEnabled: false
  }
];

export const PAIRS_MAP = PAIRS_LIST.reduce<Record<PairId, PairMetadata>>((acc, item) => {
  acc[item.id] = item;
  return acc;
}, {} as Record<PairId, PairMetadata>);
