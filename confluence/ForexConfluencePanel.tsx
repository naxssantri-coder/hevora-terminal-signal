import React, { useMemo } from 'react';
import {
  CommoditiesResponse,
  CotResponse,
  DxyResponse,
  EconHistoryResponse,
  EconomicEvent,
  FxHistoryResponse,
  MarketPrice,
} from '../../types';
import { useEndpoint } from '../../lib/useEndpoint';
import { latestPoint, latestValue } from '../../lib/useFredSeries';
import { buildForexConfluence } from '../../lib/confluence/forex';
import type { ForexSpec } from '../../lib/confluence/forexSpecs';
import { LoadingState } from '../ui';
import { ConfluenceView } from './ConfluenceView';

const RATE_LABEL: Record<string, string> = {
  ECBDFR: 'FRED ECBDFR (ECB deposit facility)',
  BOEBR: 'FRED IRSTCI01GBM156N (UK immediate rate)',
  BOJPR: 'FRED IRSTCI01JPM156N (Japan immediate rate)',
};

/**
 * MARKET STATE block for one FX major (§4): data wiring only, rendered by the shared
 * ConfluenceView.
 *
 * The counterpart policy rate is fetched only when the pair has one wired. USD/CHF and USD/CAD do
 * not, so no request is made and the read publishes that gap instead of filling it.
 */
export const ForexConfluencePanel: React.FC<{
  spec: ForexSpec;
  quote: MarketPrice | undefined;
  events: EconomicEvent[];
  onOpen: (route: string) => void;
}> = ({ spec, quote, events, onOpen }) => {
  const dxy = useEndpoint<DxyResponse>('/api/macro/dxy', 60_000);
  const cot = useEndpoint<CotResponse>('/api/positioning/cot', 60 * 60_000);
  const vix = useEndpoint<EconHistoryResponse>(
    '/api/economic-history?indicator=VIXCLS&currency=USD&months=12',
    15 * 60_000
  );
  const usRate = useEndpoint<EconHistoryResponse>(
    '/api/economic-history?indicator=EFFR&currency=USD&months=12',
    60 * 60_000
  );
  // null, not an empty string: a pair with no counterpart rate wired makes no request at all.
  const counterRate = useEndpoint<EconHistoryResponse>(
    spec.counterRateIndicator ? `/api/economic-history?indicator=${spec.counterRateIndicator}&months=24` : null,
    60 * 60_000
  );
  const history = useEndpoint<FxHistoryResponse>(
    `/api/market/fx-history?pair=${encodeURIComponent(spec.id)}`,
    30 * 60_000
  );
  // Only USD/CAD reads crude, and only then is the board fetched.
  const commodities = useEndpoint<CommoditiesResponse>(spec.usesOil ? '/api/market/commodities' : null, 5 * 60_000);

  const result = useMemo(() => {
    const counterPoints = (counterRate.data?.points ?? []).filter((p) => p.actual !== null);
    const pairCot = cot.data?.positions?.[spec.id];
    const wti = commodities.data?.commodities?.find((c) => c.symbol === 'CL=F');
    // History belongs to this pair or it is not used: the endpoint is re-fetched on every switch,
    // and one render with the previous pair's closes would put another market's trend under this
    // pair's name.
    const points = history.data?.pair === spec.id ? (history.data?.points ?? []) : [];

    return buildForexConfluence({
      spec,
      quote: {
        price: quote?.price ?? null,
        change24h: quote?.change24h ?? null,
        lastUpdated: quote?.lastUpdated ?? null,
      },
      dxy: {
        price: dxy.data?.unavailable ? null : (dxy.data?.price ?? null),
        trend15m: dxy.data?.unavailable ? null : (dxy.data?.trend15m ?? null),
        lastUpdated: dxy.data?.lastUpdated ?? null,
      },
      usRate: {
        latest: latestValue(usRate.data ?? undefined),
        date: latestPoint(usRate.data ?? undefined)?.date ?? null,
      },
      counterRate: {
        latest: counterPoints.length ? (counterPoints[counterPoints.length - 1].actual as number) : null,
        previous: counterPoints.length > 1 ? (counterPoints[counterPoints.length - 2].actual as number) : null,
        date: counterPoints.length ? counterPoints[counterPoints.length - 1].date : null,
        label: spec.counterRateIndicator ? RATE_LABEL[spec.counterRateIndicator] : null,
      },
      cot: {
        net: pairCot?.netContracts ?? null,
        percentile: pairCot?.percentile ?? null,
        reportDate: pairCot?.reportDate ?? null,
      },
      vix: { latest: latestValue(vix.data ?? undefined), date: latestPoint(vix.data ?? undefined)?.date ?? null },
      oil: {
        price: wti?.price ?? null,
        changePercent: wti?.changePercent ?? null,
        quoteTime: wti?.quoteTime ?? null,
      },
      history: points,
      events,
    });
  }, [spec, quote, dxy.data, cot.data, vix.data, usRate.data, counterRate.data, history.data, commodities.data, events]);

  const stillLoading = dxy.isLoading && cot.isLoading && usRate.isLoading;
  if (stillLoading) return <LoadingState variant="cards" />;

  return <ConfluenceView result={result} onOpen={onOpen} />;
};
