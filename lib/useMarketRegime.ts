import { useMemo } from 'react';
import { DxyResponse, EconHistoryResponse, MarketPrice, PairId } from '../types';
import { useEndpoint, EndpointState } from './useEndpoint';
import { computeRegime, RegimeResult } from './analytics';

/**
 * Market Regime (Fase 11 §3): pulled out of MarketRegimeView.tsx so the Dashboard's Market Regime
 * card and Macro Snapshot badges can read the exact same composite score - and the DXY/VIX raw
 * feeds behind it - instead of re-implementing the fetch and the five-driver weighting a second
 * time. One regime, computed once, read from wherever it needs to show up.
 */
export interface MarketRegimeData {
  regime: RegimeResult;
  isLoading: boolean;
  dxy: EndpointState<DxyResponse>;
  vix: EndpointState<EconHistoryResponse>;
  /** The DXY index level itself (not the 15m trend the regime score uses), for display badges. */
  dxyPrice: number | null;
  /** Latest VIX reading, for display badges - same series the regime score already reads. */
  vixValue: number | null;
}

const latestOf = (payload: EconHistoryResponse | null): number | null => {
  const points = (payload?.points ?? []).filter((point) => point.actual !== null);
  return points.length === 0 ? null : (points[points.length - 1].actual as number);
};

export const useMarketRegime = (prices: Record<PairId, MarketPrice>): MarketRegimeData => {
  const dxy = useEndpoint<DxyResponse>('/api/macro/dxy', 30_000);
  const vix = useEndpoint<EconHistoryResponse>('/api/economic-history?indicator=VIXCLS&currency=USD&months=6', 15 * 60_000);
  const realYield = useEndpoint<EconHistoryResponse>('/api/economic-history?indicator=DFII10&currency=USD&months=6', 15 * 60_000);

  const realYieldChange = useMemo(() => {
    const points = (realYield.data?.points ?? []).filter((point) => point.actual !== null);
    if (points.length < 2) return null;
    return (points[points.length - 1].actual as number) - (points[points.length - 2].actual as number);
  }, [realYield.data]);

  const regime = useMemo(
    () =>
      computeRegime({
        // Roadmap §D audit: session-relative change, not the 15-minute trend - see
        // DxyResponse.changeSessionPct's doc comment (types.ts) for why the composite needs a
        // window that matches the other daily-scale drivers instead of 15-minute noise.
        dxySessionChangePct: dxy.data?.unavailable ? null : (dxy.data?.changeSessionPct ?? null),
        vix: latestOf(vix.data),
        realYieldChange,
        // isSeeded gate (audit 2026-08-30): the server's currentPrices seed value has never been
        // genuinely fetched - its change24h is a boot-time placeholder, not a real reading. Same
        // "excluded, not defaulted to neutral" rule as every other missing driver here.
        btcChange24h: prices.BTCUSDT && !prices.BTCUSDT.isSeeded ? (prices.BTCUSDT.change24h ?? null) : null,
        goldChange24h: prices.XAUUSD && !prices.XAUUSD.isSeeded ? (prices.XAUUSD.change24h ?? null) : null,
      }),
    [dxy.data, vix.data, realYieldChange, prices.BTCUSDT, prices.XAUUSD]
  );

  return {
    regime,
    isLoading: dxy.isLoading && vix.isLoading && realYield.isLoading,
    dxy,
    vix,
    dxyPrice: dxy.data?.unavailable ? null : (dxy.data?.price ?? null),
    vixValue: latestOf(vix.data),
  };
};
