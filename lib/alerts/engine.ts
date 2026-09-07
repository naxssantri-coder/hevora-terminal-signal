import type { MarketPrice, PairId, Signal } from '../../types';
import type { AlertEvent, AlertRule } from './types';

/**
 * Alert evaluation.
 *
 * A pure function over the live state the shell already holds - no fetching, no timers, no
 * side effects - so it can be unit-tested and so a rule can only ever fire on a value the feed
 * actually reported. When the input for a rule is missing, the rule simply does not evaluate:
 * silence is the correct behaviour for an alert that cannot be checked, and firing on a stale or
 * assumed value would be worse than not firing at all.
 */

export interface AlertContext {
  prices: Record<PairId, MarketPrice>;
  signals: Record<PairId, Signal | null>;
  /** Rule id -> last fired ISO timestamp, so a rule does not re-fire every poll. */
  lastFiredAt: Record<string, string>;
  /** Minimum gap between two firings of the same rule. */
  cooldownMs: number;
  now?: number;
}

const withinCooldown = (rule: AlertRule, ctx: AlertContext): boolean => {
  const last = ctx.lastFiredAt[rule.id];
  if (!last) return false;
  const now = ctx.now ?? Date.now();
  return now - new Date(last).getTime() < ctx.cooldownMs;
};

export const evaluateRules = (rules: AlertRule[], ctx: AlertContext): AlertEvent[] => {
  const now = ctx.now ?? Date.now();
  const triggeredAt = new Date(now).toISOString();
  const events: AlertEvent[] = [];

  for (const rule of rules) {
    if (!rule.enabled || withinCooldown(rule, ctx)) continue;

    if (rule.kind === 'price') {
      const market = ctx.prices[rule.subject as PairId];
      if (!market || !Number.isFinite(market.price) || rule.threshold === undefined) continue;

      const above = rule.comparator === 'above' && market.price > rule.threshold;
      const below = rule.comparator === 'below' && market.price < rule.threshold;
      if (!above && !below) continue;

      events.push({
        ruleId: rule.id,
        kind: 'price',
        severity: 'info',
        title: `${rule.subject} ${above ? 'above' : 'below'} ${rule.threshold}`,
        detail: `Last traded ${market.price} (${market.name}).`,
        source: 'HEVORA Price Feed',
        triggeredAt,
        route: `/market/overview?symbol=${encodeURIComponent(rule.subject)}`,
      });
      continue;
    }

    if (rule.kind === 'signal') {
      const signal = ctx.signals[rule.subject as PairId];
      if (!signal) continue;
      // Fires on the arrival of a setup, not on every poll while one exists - the cooldown plus
      // the "waiting entry" gate keeps this to the moment the engine publishes something new.
      if (signal.status !== 'Waiting Entry') continue;

      events.push({
        ruleId: rule.id,
        kind: 'signal',
        severity: 'warning',
        title: `${signal.pairName}: new ${signal.type} setup`,
        detail: `Entry ${signal.entryMin}–${signal.entryMax}, stop ${signal.stopLoss}.`,
        source: 'HEVORA Signal Engine',
        triggeredAt,
        // The signal is now a card on the asset's own Markets page (Fase 10 §2), not a standalone
        // list - route straight to the pair that fired, same pattern as the price rule above.
        route: `/market/overview?symbol=${encodeURIComponent(rule.subject)}`,
      });
      continue;
    }

    if (rule.kind === 'volatility') {
      const market = ctx.prices[rule.subject as PairId];
      if (!market || rule.threshold === undefined) continue;
      if (!Number.isFinite(market.high24h) || !Number.isFinite(market.low24h) || !market.price) continue;

      const rangePercent = ((market.high24h - market.low24h) / market.price) * 100;
      if (rule.comparator === 'above' && rangePercent <= rule.threshold) continue;
      if (rule.comparator === 'below' && rangePercent >= rule.threshold) continue;

      events.push({
        ruleId: rule.id,
        kind: 'volatility',
        severity: 'warning',
        title: `${rule.subject} 24h range ${rangePercent.toFixed(2)}%`,
        detail: `High ${market.high24h}, low ${market.low24h}.`,
        source: 'HEVORA Price Feed',
        triggeredAt,
        route: '/analysis/volatility',
      });
    }
  }

  return events;
};
