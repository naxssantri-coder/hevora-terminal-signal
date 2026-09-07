import type { MarketPrice, Signal, SignalStatus } from '../types';
import type { BadgeTone } from '../components/ui/Badge';

/**
 * Shared signal presentation logic.
 *
 * This is a ranking/derivation layer over what the engine already publishes on /api/signals -
 * there is no signal generation here and there never should be: the backend stays the single
 * source of truth (§8). It lives in lib/ rather than inside one view because Overview, Live
 * Signals, Scalping Radar and Watchlist all rank and label the same signals, and three copies of
 * this ordering would eventually disagree with each other.
 */

/**
 * Outcome tier - a realised result always outranks an unrealised one:
 * TP2 Hit > TP1 Hit > Running > Waiting Entry. Stop Loss Hit / Invalidated are absent on purpose:
 * they never qualify for "top signals" ranking.
 */
export const STATUS_RANK: Partial<Record<SignalStatus, number>> = {
  'TP2 Hit': 4,
  'TP1 Hit': 3,
  Running: 2,
  'Waiting Entry': 1,
};

/**
 * Two-key ordering, priority explicit on inspection:
 *   1. status tier (above) always decides first;
 *   2. aiConfidenceScore breaks ties ONLY between signals already in the same tier. It is the
 *      AI's confidence at signal creation, not proof of an outcome, so it must never let a
 *      "Running" signal outrank a "TP1 Hit" one - and it can't: server.ts clamps the score to
 *      78-96 for every signal, far too narrow a spread to bridge a tier gap.
 */
export const compareSignals = (a: Signal, b: Signal): number => {
  const rankDiff = (STATUS_RANK[b.status] || 0) - (STATUS_RANK[a.status] || 0);
  if (rankDiff !== 0) return rankDiff;
  return (b.aiConfidenceScore || 0) - (a.aiConfidenceScore || 0);
};

export const isRankedStatus = (signal: Signal): boolean => STATUS_RANK[signal.status] !== undefined;

/** Live setups: everything the engine still considers in play. */
export const isActiveSignal = (signal: Signal): boolean =>
  signal.status === 'Waiting Entry' || signal.status === 'Running' || signal.status === 'TP1 Hit';

/**
 * Best N signals, one per asset category first so crypto/forex/commodities each get a slot, then
 * remaining slots backfilled by the next-highest ranked overall.
 */
export const pickTopSignals = (signals: Signal[], limit = 4): Signal[] => {
  const qualifying = signals.filter(isRankedStatus).sort(compareSignals);
  const picked: Signal[] = [];
  const seenCategories = new Set<string>();

  for (const signal of qualifying) {
    if (picked.length >= limit) break;
    if (!seenCategories.has(signal.category)) {
      seenCategories.add(signal.category);
      picked.push(signal);
    }
  }
  for (const signal of qualifying) {
    if (picked.length >= limit) break;
    if (!picked.includes(signal)) picked.push(signal);
  }

  return picked.sort(compareSignals);
};

/** Badge colour per status - green for a realised gain, red for a loss, amber while pending. */
export const statusTone = (status: SignalStatus): BadgeTone => {
  switch (status) {
    case 'TP2 Hit':
    case 'TP1 Hit':
      return 'up';
    case 'Stop Loss Hit':
      return 'down';
    case 'Running':
      return 'info';
    case 'Waiting Entry':
      return 'warning';
    default:
      return 'neutral';
  }
};

/**
 * How far price currently sits from the entry zone, as a percentage of price. Negative means
 * price is already inside (or past) the zone. Returns null when either side is missing - callers
 * render an em dash rather than a zero.
 */
export const distanceToEntryPercent = (signal: Signal, market?: MarketPrice): number | null => {
  if (!market || !Number.isFinite(market.price) || market.price === 0) return null;
  const { entryMin, entryMax } = signal;
  if (!Number.isFinite(entryMin) || !Number.isFinite(entryMax)) return null;

  const price = market.price;
  if (price >= entryMin && price <= entryMax) return 0;
  const gap = price < entryMin ? entryMin - price : price - entryMax;
  return (gap / price) * 100;
};

/** Risk:reward as a number when the engine's string is parseable ('1:2.4' -> 2.4). */
export const parseRiskReward = (riskReward: string | undefined): number | null => {
  if (!riskReward) return null;
  const match = riskReward.match(/([\d.]+)\s*$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};
