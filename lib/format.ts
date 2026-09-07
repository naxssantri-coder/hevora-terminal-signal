/**
 * Number/text formatting rules (§5) in one place so every module renders figures identically:
 * monospace, tabular figures, thousands separators, and a fixed decimal count per asset class
 * (never mixed within a column).
 */

import { PAIRS_MAP } from '../data/pairs';
import type { PairId } from '../types';

/** Decimals by asset class. XAUUSD/commodities 2, forex 5, crypto by price magnitude. */
export const digitsForPrice = (price: number, category?: string): number => {
  if (category === 'forex') return 5;
  if (category === 'commodities') return 2;
  if (price >= 1000) return 2;
  if (price >= 1) return 3;
  if (price >= 0.01) return 5;
  return 8;
};

export const digitsForPair = (pairId: PairId): number => PAIRS_MAP[pairId]?.digits ?? 2;

/** 63574.1 -> '63,574.10'. Returns em dash for anything non-finite - never '0', never 'NaN'. */
export const formatNumber = (
  value: number | null | undefined,
  digits = 2,
  options?: { signed?: boolean }
): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (options?.signed && value > 0) return `+${formatted}`;
  return formatted;
};

export const formatPercent = (
  value: number | null | undefined,
  digits = 2,
  options?: { signed?: boolean }
): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${formatNumber(value, digits, { signed: options?.signed ?? true })}%`;
};

/** 1_234_567 -> '1.23M'. For volumes/market caps where full precision is noise. */
export const formatCompact = (value: number | null | undefined, digits = 2): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const units: Array<[number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [threshold, suffix] of units) {
    if (abs >= threshold) return `${formatNumber(value / threshold, digits)}${suffix}`;
  }
  return formatNumber(value, digits);
};

/** Jakarta-time clock string used across the terminal header and timestamps. */
export const formatJakartaTime = (input?: string | number | Date | null): string => {
  const date = input ? new Date(input) : new Date();
  if (Number.isNaN(date.getTime())) return '—';
  return `${new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)} WIB`;
};

/** 'BTC/USDT Perpetual' -> 'BTC', 'DOGE/USDT' -> 'DOGE', 'XAU/USD' -> 'XAU', 'USD/CHF' -> 'USD/CHF'
 *  (left as-is - only a trailing /USD or /USDT quote leg is stripped). Anchored to the END of the
 *  string on purpose: a naive `.replace('/USD', '')` also matches the '/USD' prefix inside
 *  '/USDT', turning 'DOGE/USDT' into the wrong 'DOGET'. */
export const shortSymbol = (name: string): string => name.replace(/\/USDT( Perpetual)?$/, '').replace(/\/USD$/, '');

export const directionClass = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return 'text-[var(--text-secondary)]';
  }
  return value > 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]';
};
