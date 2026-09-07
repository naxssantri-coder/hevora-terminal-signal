import type { EconIndicatorId } from '../types';

/**
 * Client-side keyword detection for the macro-indicator cards in HevaiPanel (chart-redesign pass) -
 * same word-boundary-regex shape as detectMentionedPairs (PR 7)/server.ts's own
 * ASK_AI_ECON_INDICATOR_KEYWORDS (PR 9), scoped to the four indicators that have a real historical
 * series already reachable through the existing /api/economic-history endpoint (the same one
 * useMarketRegime.ts/PolicyRatesHub/CommodityBoard already call) - no new backend route.
 */
const MACRO_INDICATOR_KEYWORDS: Partial<Record<EconIndicatorId, string[]>> = {
  VIXCLS: ['vix', 'volatilitas'],
  DFII10: ['real yield', 'yield riil', 'tips'],
  DGS10: ['yield 10y', '10-year treasury', 'yield 10 tahun', 'obligasi 10 tahun', 'treasury 10 tahun'],
  FOMC: ['fed funds', 'suku bunga fed', 'suku bunga acuan', 'fomc'],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectMentionedEconIndicators(text: string): EconIndicatorId[] {
  const lower = text.toLowerCase();
  const found: EconIndicatorId[] = [];
  for (const id of Object.keys(MACRO_INDICATOR_KEYWORDS) as EconIndicatorId[]) {
    const keywords = MACRO_INDICATOR_KEYWORDS[id] || [];
    if (keywords.some((kw) => new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i').test(lower))) found.push(id);
  }
  return found;
}

/** DXY has no historical series reachable without a new endpoint shape (see investigation notes) -
 *  detected separately so its card can show a current-level stat without a chart, rather than
 *  being silently absent. */
export function isDxyMentioned(text: string): boolean {
  return /\bdxy\b/i.test(text) || /\bdollar index\b/i.test(text) || /\bindeks dolar\b/i.test(text);
}
