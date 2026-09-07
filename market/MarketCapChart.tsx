import React, { useMemo } from 'react';
import { LineChart as LineChartIcon } from 'lucide-react';
import type { CryptoDerivativesSymbol, MarketCapHistoryResponse } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { statusFromAge } from '../../lib/dataState';
import { DataQualityBadge, LoadingState, Panel, PanelHeader, UnavailableState } from '../ui';
import { DualAxisAreaChart } from '../charts';

/**
 * Market cap history (Institutional Watchlist full-page detail, Part E) - CoinGecko daily market
 * cap + price, up to 1 year (server.ts's /api/crypto/market-cap-history). The easy, genuinely-free
 * part of the CoinGlass reference - real historical data, no proxy or estimate involved.
 *
 * Fase 2 (Lampiran 2 §1.1): dual-axis - Market Cap on the left axis, this coin's own price
 * (already in the same response, index-aligned with marketCapUsd) on an independent right axis,
 * matching the CoinGlass reference chart. Both numbers come from the one CoinGecko response
 * already fetched here - no second call, no estimate.
 */
export const MarketCapChart: React.FC<{
  symbol: CryptoDerivativesSymbol;
  /** Institutional Detail Page's Overview tab now needs this SAME response for its own price/
   *  market-cap chart (Fase 3) and fetches it once up top, passing it down here too - same
   *  data?/isLoading? override pattern ExchangeRankingTable already uses, so this never triggers a
   *  second round-trip for data the page already has. Omit (every other/older caller) and this
   *  component fetches for itself exactly as it always has. */
  data?: MarketCapHistoryResponse | null;
  isLoading?: boolean;
}> = ({ symbol, data: externalData, isLoading: externalIsLoading }) => {
  const { t } = useTranslation();
  const selfFetch = externalData === undefined;
  const fetched = useEndpoint<MarketCapHistoryResponse>(
    selfFetch ? `/api/crypto/market-cap-history?symbol=${symbol}` : null,
    60 * 60_000
  );
  const data = selfFetch ? fetched.data : externalData ?? null;
  const isLoading = selfFetch ? fetched.isLoading : Boolean(externalIsLoading);

  const labels = useMemo(
    () => (data?.points ?? []).map((p) => new Date(p.time).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })),
    [data?.points]
  );

  // Scaled to $ billions for the chart's own y-axis/tooltip labels - a market cap in the hundreds
  // of billions/low trillions reads as an unbroken 12-13 digit string otherwise.
  const marketCapPoints = useMemo(
    () => (data?.points ?? []).map((p, i) => ({ label: labels[i], value: p.marketCapUsd / 1e9 })),
    [data?.points, labels]
  );
  const pricePoints = useMemo(
    () => (data?.points ?? []).map((p, i) => ({ label: labels[i], value: p.price })),
    [data?.points, labels]
  );

  const coinLabel = symbol.replace(/USDT$/, '');

  if (isLoading && !data) return <LoadingState variant="cards" />;

  const unavailable = !data || data.unavailable || marketCapPoints.length < 2;

  return (
    <Panel variant="flat" className="border-t border-[var(--border-subtle)]">
      <PanelHeader
        eyebrow={t('category.market')}
        title={t('marketCapChart.title')}
        subtitle={t('marketCapChart.subtitle')}
        icon={<LineChartIcon className="w-4 h-4" />}
        actions={
          data?.fetchedAt ? (
            <DataQualityBadge
              compact
              meta={{
                source: data.source,
                lastUpdated: data.fetchedAt,
                status: data.stale ? 'STALE' : statusFromAge(data.fetchedAt, 12 * 60 * 60_000, 48 * 60 * 60_000),
              }}
            />
          ) : undefined
        }
      />

      {unavailable ? (
        <div className="mt-3">
          <UnavailableState source="CoinGecko" detail={data?.error ?? undefined} />
        </div>
      ) : (
        <div className="mt-3">
          <DualAxisAreaChart
            height={220}
            primary={{
              points: marketCapPoints,
              color: 'var(--color-brand)',
              label: t('marketCapChart.title'),
              valueDigits: 1,
              valuePrefix: '$',
              valueSuffix: 'B',
            }}
            secondary={{
              points: pricePoints,
              color: 'var(--text-secondary)',
              label: `${coinLabel} ${t('instPanel.price')}`,
              valueDigits: pricePoints.some((p) => p.value < 10) ? 4 : 2,
              valuePrefix: '$',
            }}
          />
        </div>
      )}
    </Panel>
  );
};
