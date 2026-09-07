import { PAIRS_LIST } from '../data/pairs';
import { COMMODITY_SPECS } from './confluence/commoditySpecs';
import { INDEX_SPECS } from './market/indexSpecs';

/**
 * USD Index + equity index COT symbols that are NOT quoted anywhere via PAIRS_LIST/COMMODITY_SPECS
 * under the exact key COT_MARKET_CODES (server.ts) uses for them - see that map's own comment for
 * why. '^NDX' (Nasdaq-100) has no entry in INDEX_SPECS at all (this app only quotes the Nasdaq
 * COMPOSITE, ^IXIC, elsewhere), so it needs its display name here rather than falling back to the
 * raw code.
 */
const COT_ONLY_DISPLAY_NAMES: Record<string, string> = {
  '^NDX': 'Nasdaq-100',
};

/**
 * Trader-facing display name for a COT symbol, shared by every surface that reads
 * `/api/positioning/cot` (the dedicated COT page and the Institutional Flow section of
 * Liquidity & Flow) so a market is never labelled two different ways in two different places.
 *
 * Falls back to the symbol itself for a market that gains a COT code before it gains a display
 * pair/spec - a plain fallback beats a blank row.
 */
export const cotMarketDisplayName = (symbol: string): string => {
  const pair = PAIRS_LIST.find((p) => p.id === symbol);
  if (pair) return pair.name;
  const commodity = COMMODITY_SPECS.find((c) => c.symbol === symbol);
  if (commodity) return commodity.name;
  const index = INDEX_SPECS.find((i) => i.symbol === symbol);
  if (index) return index.name;
  if (COT_ONLY_DISPLAY_NAMES[symbol]) return COT_ONLY_DISPLAY_NAMES[symbol];
  return symbol;
};

/**
 * A tighter label for the fixed-width chart rows in Institutional Flow. The CFTC contract behind
 * BTCUSDT is CME's cash-settled bitcoin future, not the perpetual this terminal prices from - so
 * it is labelled 'BTC (CME)' here rather than borrowing the perpetual's full pair name, which
 * would misstate what the position actually is.
 */
export const cotShortLabel = (symbol: string): string => {
  if (symbol === 'BTCUSDT') return 'BTC (CME)';
  // Same reasoning as BTCUSDT above: '^NDX' has no live quote counterpart anywhere else in this
  // app (INDEX_SPECS only carries the Nasdaq COMPOSITE, ^IXIC) - labelled distinctly rather than
  // through the generic index/pair lookups below so it never reads as that unrelated quote.
  if (symbol === '^NDX') return 'Nasdaq-100';
  const pair = PAIRS_LIST.find((p) => p.id === symbol);
  if (pair) return pair.name;
  const commodity = COMMODITY_SPECS.find((c) => c.symbol === symbol);
  if (commodity) return commodity.name;
  const index = INDEX_SPECS.find((i) => i.symbol === symbol);
  if (index) return index.name;
  return symbol;
};
