import type { EconIndicatorId, EconHistoryPoint } from '../types';

/**
 * Shared Macro Regime classification - the single source of truth for EconomicHistoryView's
 * "Macro Regime" strip. Lives in its own module (rather than inline in that view) so any future
 * consumer reads the exact same categorical direction from the exact same underlying FRED data.
 */

export type CategoryId = 'inflation' | 'employment' | 'pmi' | 'rates' | 'growth';
export type TrendDir = 'up' | 'down' | 'stable' | 'collecting';

/** One "lead" indicator per category - the same indicator each category's regime direction has
 * always been computed from (first entry of EconomicHistoryView's original CATEGORIES list). */
export const MACRO_CATEGORIES: { id: CategoryId; labelKey: string; shortLabelKey: string; primaryIndicator: EconIndicatorId }[] = [
  { id: 'inflation', labelKey: 'econHistory.cat.inflation', shortLabelKey: 'econHistory.cat.inflationShort', primaryIndicator: 'CPI' },
  { id: 'employment', labelKey: 'econHistory.cat.employment', shortLabelKey: 'econHistory.cat.employmentShort', primaryIndicator: 'NFP' },
  { id: 'pmi', labelKey: 'econHistory.cat.pmi', shortLabelKey: 'econHistory.cat.pmiShort', primaryIndicator: 'PMI_MFG' },
  { id: 'rates', labelKey: 'econHistory.cat.rates', shortLabelKey: 'econHistory.cat.ratesShort', primaryIndicator: 'FOMC' },
  { id: 'growth', labelKey: 'econHistory.cat.growth', shortLabelKey: 'econHistory.cat.growthShort', primaryIndicator: 'GDP' },
];

export const REGIME_LABEL_KEYS: Record<CategoryId, Record<Exclude<TrendDir, 'collecting'>, string>> = {
  inflation: { up: 'econHistory.regime.inflation.up', down: 'econHistory.regime.inflation.down', stable: 'econHistory.regime.inflation.stable' },
  employment: { up: 'econHistory.regime.employment.up', down: 'econHistory.regime.employment.down', stable: 'econHistory.regime.employment.stable' },
  pmi: { up: 'econHistory.regime.pmi.up', down: 'econHistory.regime.pmi.down', stable: 'econHistory.regime.pmi.stable' },
  rates: { up: 'econHistory.regime.rates.up', down: 'econHistory.regime.rates.down', stable: 'econHistory.regime.rates.stable' },
  growth: { up: 'econHistory.regime.growth.up', down: 'econHistory.regime.growth.down', stable: 'econHistory.regime.growth.stable' },
};

/** Classifies a category's real trend direction by comparing its latest reading against the
 * reading ~3 releases back, relative to a small deadzone (10% of that indicator's own historical
 * range) so noise near zero doesn't flip-flop between "up"/"down". Purely a categorical direction
 * label from real deltas - never a numeric score. */
export function classifyCategoryTrend(points: EconHistoryPoint[]): TrendDir {
  const valid = points.filter((p) => p.actual !== null);
  if (valid.length < 4) return 'collecting';
  const values = valid.map((p) => p.actual as number);
  const latest = values[values.length - 1];
  const past = values[Math.max(0, values.length - 4)];
  const range = Math.max(...values) - Math.min(...values) || 1;
  const delta = latest - past;
  const deadzone = range * 0.1;
  if (delta > deadzone) return 'up';
  if (delta < -deadzone) return 'down';
  return 'stable';
}

/**
 * Generalized version of classifyCategoryTrend's own direction rule (Terminal redesign, Momentum
 * heatmap) - same deadzone-over-own-range logic, but at a caller-chosen release lookback instead
 * of the fixed "3 releases back" classifyCategoryTrend hard-codes. `classifyCategoryTrend(points)`
 * is exactly `classifyTrendAtLookback(points, 3)` with a slightly different minimum-sample guard;
 * both stay as separate functions so classifyCategoryTrend's existing callers/behaviour are
 * untouched. Returns null (not a guessed direction) when there aren't enough real points for this
 * specific lookback - the caller is expected to simply not render that window rather than fill it
 * in with a placeholder.
 */
export function classifyTrendAtLookback(points: EconHistoryPoint[], lookback: number): TrendDir | null {
  const valid = points.filter((p) => p.actual !== null);
  if (valid.length < lookback + 1) return null;
  const values = valid.map((p) => p.actual as number);
  const latest = values[values.length - 1];
  const past = values[values.length - 1 - lookback];
  const range = Math.max(...values) - Math.min(...values) || 1;
  const delta = latest - past;
  const deadzone = range * 0.1;
  if (delta > deadzone) return 'up';
  if (delta < -deadzone) return 'down';
  return 'stable';
}
