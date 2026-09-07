/**
 * Alert system scaffold (§7.9).
 *
 * Types and the rule shape only - no delivery, no persistence, no UI yet (that is a later
 * phase). It exists now so modules built in the coming phases can declare the alerts they are
 * capable of raising against a fixed contract instead of each inventing its own.
 */

export type AlertKind =
  | 'price'
  | 'signal'
  | 'macro'
  | 'news'
  | 'volatility'
  | 'liquidity'
  | 'regime'
  | 'watchlist';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertComparator = 'above' | 'below' | 'crosses' | 'changes-by' | 'equals';

export interface AlertRule {
  id: string;
  kind: AlertKind;
  /** Asset id for asset-scoped alerts, module id for module-scoped ones. */
  subject: string;
  comparator: AlertComparator;
  threshold?: number;
  /** Module that owns evaluation of this rule, matching a ModuleDefinition id. */
  ownerModuleId: string;
  enabled: boolean;
  createdAt: string;
}

export interface AlertEvent {
  ruleId: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  /** Provenance is mandatory - an alert fired off unverified data is worse than no alert. */
  source: string;
  triggeredAt: string;
  /** Where clicking the alert should take the user. */
  route?: string;
}

export const ALERT_KINDS: AlertKind[] = [
  'price',
  'signal',
  'macro',
  'news',
  'volatility',
  'liquidity',
  'regime',
  'watchlist',
];
