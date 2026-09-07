import React, { useMemo } from 'react';
import {
  CotResponse,
  EconHistoryResponse,
  EconomicEvent,
  DxyResponse,
  MarketPrice,
  XauDailyResponse,
} from '../../types';
import { useEndpoint } from '../../lib/useEndpoint';
import { latestPoint, latestValue } from '../../lib/useFredSeries';
import { buildXauConfluence } from '../../lib/confluence/xau';
import { LoadingState } from '../ui';
import { ConfluenceView } from './ConfluenceView';

/**
 * MARKET STATE block for XAU/USD (§4): the data wiring only - the layout lives in ConfluenceView,
 * shared with the commodity board so both reads are rendered by the same rules.
 *
 * Every input below is an endpoint this terminal already publishes elsewhere, so this panel can
 * never reach for a number that is not visible somewhere else in the app.
 */
export const ConfluencePanel: React.FC<{
  gold: MarketPrice | undefined;
  events: EconomicEvent[];
  onOpen: (route: string) => void;
}> = ({ gold, events, onOpen }) => {
  const realYield = useEndpoint<EconHistoryResponse>('/api/economic-history?indicator=DFII10&currency=USD&months=12', 15 * 60_000);
  const vix = useEndpoint<EconHistoryResponse>('/api/economic-history?indicator=VIXCLS&currency=USD&months=12', 15 * 60_000);
  const dxy = useEndpoint<DxyResponse>('/api/macro/dxy', 60_000);
  const cot = useEndpoint<CotResponse>('/api/positioning/cot', 60 * 60_000);
  const daily = useEndpoint<XauDailyResponse>('/api/market/xau-daily', 30 * 60_000);

  const result = useMemo(() => {
    const ryPoints = (realYield.data?.points ?? []).filter((p) => p.actual !== null);
    const gc = cot.data?.positions?.XAUUSD;

    return buildXauConfluence({
      realYield: {
        latest: ryPoints.length ? (ryPoints[ryPoints.length - 1].actual as number) : null,
        previous: ryPoints.length > 1 ? (ryPoints[ryPoints.length - 2].actual as number) : null,
        date: latestPoint(realYield.data ?? undefined)?.date ?? null,
      },
      dxy: {
        price: dxy.data?.unavailable ? null : (dxy.data?.price ?? null),
        trend15m: dxy.data?.unavailable ? null : (dxy.data?.trend15m ?? null),
        lastUpdated: dxy.data?.lastUpdated ?? null,
      },
      cot: {
        net: gc?.netContracts ?? null,
        percentile: gc?.percentile ?? null,
        reportDate: gc?.reportDate ?? null,
      },
      vix: { latest: latestValue(vix.data ?? undefined), date: latestPoint(vix.data ?? undefined)?.date ?? null },
      gold: {
        price: gold?.price ?? null,
        change24h: gold?.change24h ?? null,
        lastUpdated: gold?.lastUpdated ?? null,
      },
      dailyHistory: daily.data?.points ?? [],
      events,
    });
  }, [realYield.data, vix.data, dxy.data, cot.data, daily.data, gold, events]);

  const stillLoading = realYield.isLoading && dxy.isLoading && cot.isLoading;
  if (stillLoading) return <LoadingState variant="cards" />;

  return <ConfluenceView result={result} onOpen={onOpen} />;
};
