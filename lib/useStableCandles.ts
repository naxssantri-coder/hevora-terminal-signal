import { useEffect, useRef } from 'react';
import type { Candle, CandlesResponse } from './analytics';

/**
 * Bridges a single momentarily-empty poll of `/api/market/candles`, per pair, instead of letting
 * every table that reads it flash to all-dashes.
 *
 * server.ts's own candleStore is a plain in-memory object that starts fully empty on every server
 * restart/eviction (see its "candleStore persistence across restarts" comment) - a real event on
 * an ephemeral host, not a client bug - and a fetch landing during that window still resolves
 * 200 OK with a genuinely empty per-pair array, which would otherwise stomp whatever real data a
 * table was already showing. A pair that regresses to zero candles keeps its last known-good
 * array here until a real refetch repopulates it; a pair with fresh non-empty candles updates
 * immediately, same as before - this only bridges the gap, it never freezes the whole table.
 */
export const useStableCandles = (data: CandlesResponse | null | undefined): Record<string, Candle[]> => {
  const lastGood = useRef<Record<string, Candle[]>>({});

  useEffect(() => {
    const candles = data?.candles;
    if (!candles) return;
    for (const pairId of Object.keys(candles)) {
      if ((candles[pairId]?.length ?? 0) > 0) lastGood.current[pairId] = candles[pairId];
    }
  }, [data]);

  const fresh = data?.candles ?? {};
  const merged: Record<string, Candle[]> = { ...lastGood.current };
  for (const pairId of Object.keys(fresh)) {
    if (fresh[pairId].length > 0) merged[pairId] = fresh[pairId];
  }
  return merged;
};
