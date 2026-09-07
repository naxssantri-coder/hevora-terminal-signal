import { useCallback, useEffect, useState } from 'react';
import type { MarketPrice, PairId } from '../types';

/**
 * Paper trading positions.
 *
 * Local to the browser, exactly like the watchlist: this is the user's own practice record, not
 * platform data, and it needs no server schema. The important honesty rule lives in openPosition
 * below - a position can only be opened at a price the live feed is actually quoting right now.
 * There is no manual entry price field, because a "fill" at a price the market never printed
 * while you were watching is a fabricated trade, and a track record built from those is worse
 * than no track record.
 */

export type PaperSide = 'BUY' | 'SELL';

export interface PaperPosition {
  id: string;
  pairId: PairId;
  side: PaperSide;
  /** Units of the instrument. Free-form: this is practice sizing, not broker lot validation. */
  size: number;
  entryPrice: number;
  entryAt: string;
  exitPrice?: number;
  closedAt?: string;
  note?: string;
}

const STORAGE_KEY = 'hev_paper_positions';
const CHANGE_EVENT = 'hev:paper-change';

const readStorage = (): PaperPosition[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PaperPosition[]) : [];
  } catch {
    return [];
  }
};

const writeStorage = (positions: PaperPosition[]): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // Private mode / quota - the session still works from memory.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
};

/** Signed P&L in quote-currency units. Null whenever a required price is missing. */
export const positionPnl = (position: PaperPosition, market: MarketPrice | undefined): number | null => {
  const exit = position.exitPrice ?? market?.price;
  if (typeof exit !== 'number' || !Number.isFinite(exit)) return null;
  const direction = position.side === 'BUY' ? 1 : -1;
  return (exit - position.entryPrice) * direction * position.size;
};

export const positionPnlPercent = (position: PaperPosition, market: MarketPrice | undefined): number | null => {
  const exit = position.exitPrice ?? market?.price;
  if (typeof exit !== 'number' || !Number.isFinite(exit) || position.entryPrice === 0) return null;
  const direction = position.side === 'BUY' ? 1 : -1;
  return ((exit - position.entryPrice) / position.entryPrice) * direction * 100;
};

export const usePaperTrading = () => {
  const [positions, setPositions] = useState<PaperPosition[]>(() => readStorage());

  useEffect(() => {
    const sync = () => setPositions(readStorage());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  /**
   * Opens at the price currently quoted by the live feed. Returns null - and opens nothing - when
   * there is no live quote for that asset, rather than falling back to a stale or typed-in price.
   */
  const openPosition = useCallback(
    (pairId: PairId, side: PaperSide, size: number, market: MarketPrice | undefined): PaperPosition | null => {
      if (!market || !Number.isFinite(market.price) || market.price <= 0) return null;
      if (!Number.isFinite(size) || size <= 0) return null;

      const position: PaperPosition = {
        id: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        pairId,
        side,
        size,
        entryPrice: market.price,
        entryAt: new Date().toISOString(),
      };
      writeStorage([...readStorage(), position]);
      return position;
    },
    []
  );

  /** Closes at the live quote, same rule as opening - no close is recorded without one. */
  const closePosition = useCallback((id: string, market: MarketPrice | undefined): boolean => {
    if (!market || !Number.isFinite(market.price)) return false;
    const next = readStorage().map((position) =>
      position.id === id && !position.closedAt
        ? { ...position, exitPrice: market.price, closedAt: new Date().toISOString() }
        : position
    );
    writeStorage(next);
    return true;
  }, []);

  const removePosition = useCallback((id: string) => {
    writeStorage(readStorage().filter((position) => position.id !== id));
  }, []);

  const clearAll = useCallback(() => writeStorage([]), []);

  return {
    positions,
    open: positions.filter((position) => !position.closedAt),
    closed: positions.filter((position) => Boolean(position.closedAt)),
    openPosition,
    closePosition,
    removePosition,
    clearAll,
  };
};
