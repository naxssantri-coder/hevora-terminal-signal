import React, { useMemo } from 'react';
import { Gauge } from 'lucide-react';
import { CryptoDerivativesResponse } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { statusFromAge } from '../../lib/dataState';
import { formatCompact, formatNumber } from '../../lib/format';
import { LineChart } from '../charts';
import { DataQualityBadge, LoadingState, Panel, PanelHeader, StatTile, UnavailableState } from '../ui';
import type { OrderBookSymbol } from './BtcUsdtOrderBookView';

/**
 * Funding Rate / Open Interest / Long-Short Ratio (Roadmap §A1, highest-impact item on the doc).
 *
 * Same OKX endpoint BtcConfluencePanel already reads for the BTC Market State factor
 * (`/api/crypto/derivatives`) - this is that same data given its own dedicated, visible home
 * instead of being buried as one weighted factor line. Deliberately placed next to Order Book &
 * Liquidity (both "order flow" reads for the same symbol switcher) rather than duplicated into
 * Analysis - one data point, one home (§7 house rule).
 *
 * The interpretive sentence below the numbers is context, not a signal: it states what the
 * reading historically means (crowded long/short, OI confirming or not confirming a move), using
 * the exact same thresholds crypto.ts's own confluence factor already scores by, never a new
 * entry/exit call.
 */
/** Wider than OrderBookSymbol (BTC/ETH only, no SOL order-book relay exists) - this view has no
 *  such dependency, it only reads OKX's derivatives endpoint, which already serves SOL-USDT-SWAP
 *  too (server.ts ALLOWED set). Institutional Watchlist detail panel (Dashboard) is the first
 *  caller that needs SOL here. BNB/XRP/ADA/DOGE added for the same panel's Part B bug fix - see
 *  server.ts's /api/crypto/derivatives ALLOWED set comment for why these four are a reasonable
 *  fail-closed bet on OKX's swap listings, not an invented data source. */
export type DerivativesSymbol = OrderBookSymbol | 'SOL-USDT' | 'BNB-USDT' | 'XRP-USDT' | 'ADA-USDT' | 'DOGE-USDT';

const SYMBOL_TO_INSTRUMENT: Record<DerivativesSymbol, string> = {
  'BTC-USDT': 'BTC-USDT-SWAP',
  'ETH-USDT': 'ETH-USDT-SWAP',
  'SOL-USDT': 'SOL-USDT-SWAP',
  'BNB-USDT': 'BNB-USDT-SWAP',
  'XRP-USDT': 'XRP-USDT-SWAP',
  'ADA-USDT': 'ADA-USDT-SWAP',
  'DOGE-USDT': 'DOGE-USDT-SWAP',
};

export const CryptoDerivativesView: React.FC<{
  symbol: DerivativesSymbol;
  /** Institutional Detail Page's Futures tab (visual fix, Bug #2) passes this to drop the panel to
   *  a flat, thin-separator surface instead of the default hev-card-v2 card - OrderBookLiquidityHub
   *  (this component's other caller) omits it and keeps the exact default look. */
  dense?: boolean;
  /** CoinGlass parity ROUND 2 (Bagian A - "Funding Rate/Open Interest muncul di TIGA tempat
   *  berbeda di satu halaman"): Institutional Detail Page's Futures tab already shows the same
   *  two metrics again, aggregated across ~14 exchanges with a price overlay and crosshair, in
   *  FuturesDataAnalysis right below this panel - this component's own OKX-only history charts and
   *  interpretive sentence were pure duplication, not additional information. When true, renders
   *  only the 3 stat tiles (a quick OKX-sourced snapshot) and drops both LineCharts + the
   *  `fundingReading` sentence. Default false - OrderBookLiquidityHub (this component's other
   *  caller) is unaffected. */
  chartless?: boolean;
}> = ({ symbol, dense = false, chartless = false }) => {
  const { t } = useTranslation();
  const instId = SYMBOL_TO_INSTRUMENT[symbol];
  const derivatives = useEndpoint<CryptoDerivativesResponse>(`/api/crypto/derivatives?instId=${instId}`, 5 * 60_000);

  const bps = derivatives.data?.fundingRate !== null && derivatives.data?.fundingRate !== undefined
    ? derivatives.data.fundingRate * 10_000
    : null;

  const fundingHistoryPoints = useMemo(
    () =>
      (derivatives.data?.fundingHistory ?? []).map((row) => ({
        label: new Date(row.time).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
        value: row.rate * 10_000,
      })),
    [derivatives.data?.fundingHistory]
  );

  // Trailing hourly OI readings OKX's open-interest-history endpoint already returns (same series
  // openInterestChange24h is computed from server-side) - no price overlay here, since this
  // endpoint never fetched a matching price series to plot alongside it (never invent one).
  const oiHistoryPoints = useMemo(
    () =>
      (derivatives.data?.openInterestHistory ?? []).map((row) => ({
        label: new Date(row.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
        value: row.oi,
      })),
    [derivatives.data?.openInterestHistory]
  );

  // Same read crypto.ts's own funding factor already scores by (§ shared thresholds, never a
  // second, disagreeing interpretation of the same number).
  const fundingReading =
    bps === null ? null : bps > 5 ? 'crowdedLong' : bps < -1 ? 'crowdedShort' : 'neutral';

  const oiPct =
    derivatives.data?.openInterestChange24h !== null && derivatives.data?.openInterestChange24h !== undefined
      ? derivatives.data.openInterestChange24h * 100
      : null;

  if (derivatives.isLoading && !derivatives.data) return <LoadingState variant="cards" />;

  const unavailable = !derivatives.data || derivatives.data.unavailable;

  return (
    <Panel variant={dense ? 'flat' : 'default'}>
      {/* CoinGlass parity ROUND 3 (typography - "hapus kalimat penjelasan di dalam kartu"): the
          subtitle used to restate the title in a full sentence ("BTC-USDT perpetual - funding
          rate, open interest, and long/short ratio from OKX") - the title already says what this
          is, and the DataQualityBadge already names the source. */}
      <PanelHeader
        eyebrow={t('category.market')}
        title={t('derivatives.title')}
        icon={<Gauge className="w-4 h-4" />}
        actions={
          derivatives.data?.fetchedAt ? (
            <DataQualityBadge
              meta={{
                source: derivatives.data.source,
                lastUpdated: derivatives.data.fetchedAt,
                status: derivatives.data.stale ? 'STALE' : statusFromAge(derivatives.data.fetchedAt, 10 * 60_000, 60 * 60_000),
              }}
            />
          ) : undefined
        }
      />

      {unavailable ? (
        <div className="mt-4">
          <UnavailableState source="OKX" detail={derivatives.data?.error ?? derivatives.error ?? undefined} />
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatTile
              size="lg"
              label={t('derivatives.fundingRate')}
              value={bps === null ? '—' : `${formatNumber(bps, 2, { signed: true })} bps`}
              tone={bps === null ? undefined : bps >= 0 ? 'up' : 'down'}
              hint={t('derivatives.per8h')}
            />

            <StatTile
              size="lg"
              label={t('derivatives.openInterest')}
              value={
                derivatives.data?.openInterestCcy === null || derivatives.data?.openInterestCcy === undefined
                  ? '—'
                  : `${formatCompact(derivatives.data.openInterestCcy, 2)} ${symbol.split('-')[0]}`
              }
              hint={oiPct !== null ? `${formatNumber(oiPct, 2, { signed: true })}% ${t('derivatives.oi24h')}` : undefined}
              hintTone={oiPct === null ? undefined : oiPct >= 0 ? 'up' : 'down'}
            />

            <StatTile
              size="lg"
              label={t('derivatives.longShortRatio')}
              value={
                derivatives.data?.longShortRatio === null || derivatives.data?.longShortRatio === undefined
                  ? '—'
                  : formatNumber(derivatives.data.longShortRatio, 2)
              }
              hint={t('derivatives.longShortHint')}
            />
          </div>

          {!chartless && fundingReading && (
            <p className="mt-3 text-[11px] text-[var(--text-secondary)] leading-relaxed">
              {t(`derivatives.reading.${fundingReading}`)}
            </p>
          )}

          {!chartless && oiHistoryPoints.length > 1 && (
            <div className="mt-4">
              <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
                {t('derivatives.oiHistoryTitle')}
              </span>
              <LineChart
                points={oiHistoryPoints}
                height={130}
                valueDigits={0}
                valueSuffix={` ${symbol.split('-')[0]}`}
                color="var(--color-brand)"
                areaFill
                xAxisTicks={4}
              />
            </div>
          )}

          {!chartless && fundingHistoryPoints.length > 1 && (
            <div className="mt-4">
              <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
                {t('derivatives.fundingHistoryTitle')}
              </span>
              <LineChart points={fundingHistoryPoints} height={130} valueDigits={2} valueSuffix=" bps" color="var(--color-warn)" xAxisTicks={4} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
};
