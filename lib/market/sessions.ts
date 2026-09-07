import type { Candle } from '../analytics';

/**
 * Session Intelligence (Tahap E §22). Pure computation from the current UTC clock plus candles
 * this app already fetches (/api/market/candles) - no new provider, no server-side change.
 *
 * Session windows below are the commonly-cited FIXED UTC hours used by most retail trading
 * platforms - NOT DST-adjusted (London/New York shift with their own local DST twice a year;
 * modelling that correctly needs a timezone database, which is out of scope here). This is stated
 * in the UI rather than silently baked in, so a session boundary being off by an hour during a
 * DST transition reads as a known approximation, not a bug.
 */

export type TradingSessionId = 'sydney' | 'tokyo' | 'london' | 'newyork';

export interface TradingSessionDef {
  id: TradingSessionId;
  labelKey: string;
  /** Fixed UTC hour, 0-23. `closeUtcHour <= openUtcHour` means the session wraps past midnight. */
  openUtcHour: number;
  closeUtcHour: number;
}

export const TRADING_SESSIONS: TradingSessionDef[] = [
  { id: 'sydney', labelKey: 'session.sydney', openUtcHour: 22, closeUtcHour: 7 },
  { id: 'tokyo', labelKey: 'session.tokyo', openUtcHour: 0, closeUtcHour: 9 },
  { id: 'london', labelKey: 'session.london', openUtcHour: 8, closeUtcHour: 17 },
  { id: 'newyork', labelKey: 'session.newyork', openUtcHour: 13, closeUtcHour: 22 },
];

export interface SessionStatus {
  id: TradingSessionId;
  labelKey: string;
  isOpen: boolean;
  /** Ms since this session opened, only when isOpen. */
  elapsedMs: number | null;
  /** Ms until close (if open) or until next open (if closed). Null only if computation failed. */
  remainingMs: number | null;
  /** The open/close boundary Date objects for whichever window `now` is being measured against. */
  windowOpen: Date;
  windowClose: Date;
}

/** Builds yesterday/today/tomorrow's window for a session def, so a wrap-past-midnight session
 * (e.g. Sydney 22:00->07:00) is checked correctly without modular-arithmetic edge cases. */
function windowsAround(now: Date, def: TradingSessionDef): { open: Date; close: Date }[] {
  const windows: { open: Date; close: Date }[] = [];
  for (const dayOffset of [-1, 0, 1]) {
    const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset);
    const open = new Date(base + def.openUtcHour * 3_600_000);
    let close = new Date(base + def.closeUtcHour * 3_600_000);
    if (def.closeUtcHour <= def.openUtcHour) close = new Date(close.getTime() + 24 * 3_600_000);
    windows.push({ open, close });
  }
  return windows;
}

export function getSessionStatus(def: TradingSessionDef, now: Date = new Date()): SessionStatus {
  const windows = windowsAround(now, def);
  const nowMs = now.getTime();
  const current = windows.find((w) => nowMs >= w.open.getTime() && nowMs < w.close.getTime());
  if (current) {
    return {
      id: def.id,
      labelKey: def.labelKey,
      isOpen: true,
      elapsedMs: nowMs - current.open.getTime(),
      remainingMs: current.close.getTime() - nowMs,
      windowOpen: current.open,
      windowClose: current.close,
    };
  }
  const upcoming = windows
    .filter((w) => w.open.getTime() > nowMs)
    .sort((a, b) => a.open.getTime() - b.open.getTime())[0];
  return {
    id: def.id,
    labelKey: def.labelKey,
    isOpen: false,
    elapsedMs: null,
    remainingMs: upcoming ? upcoming.open.getTime() - nowMs : null,
    windowOpen: upcoming?.open ?? now,
    windowClose: upcoming?.close ?? now,
  };
}

export const getAllSessionStatuses = (now: Date = new Date()): SessionStatus[] =>
  TRADING_SESSIONS.map((def) => getSessionStatus(def, now));

/** Sessions currently open together - the overlap windows traders actually watch for liquidity. */
export const getOpenOverlaps = (now: Date = new Date()): SessionStatus[] =>
  getAllSessionStatuses(now).filter((s) => s.isOpen);

export interface SessionRangeResult {
  high: number;
  low: number;
  /** True only when the candle window's oldest bar is at/before the session's own open - i.e. the
   * range below is the REAL full-session range, not a partial one. Never claim "session range"
   * in the UI when this is false; the candle store only keeps a rolling ~2.5h window (30x 5m
   * bars, server.ts's candleStore), which is shorter than most sessions run for. */
  coversFullSession: boolean;
  windowStartMs: number;
}

/** Range over whatever portion of the current session's candles are actually available - capped
 * honestly by the candle window depth, never backfilled or estimated beyond what was fetched. */
export function sessionRangeFromCandles(candles: Candle[], sessionOpenMs: number): SessionRangeResult | null {
  if (candles.length === 0) return null;
  const oldestCandleMs = candles[0].t;
  const windowStartMs = Math.max(sessionOpenMs, oldestCandleMs);
  const inWindow = candles.filter((c) => c.t >= windowStartMs);
  if (inWindow.length === 0) return null;
  return {
    high: Math.max(...inWindow.map((c) => c.h)),
    low: Math.min(...inWindow.map((c) => c.l)),
    coversFullSession: oldestCandleMs <= sessionOpenMs,
    windowStartMs,
  };
}
