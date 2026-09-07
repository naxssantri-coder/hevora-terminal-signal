import React, { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import type { CryptoDerivativesSymbol, ExchangeRankingRow, FuturesHistoryPoint, FuturesHistoryResponse } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { statusFromAge } from '../../lib/dataState';
import { formatCompact, formatNumber } from '../../lib/format';
import { DataQualityBadge, LoadingState, Panel, PanelHeader, TabBar, UnavailableState } from '../ui';
import { DualAxisAreaChart, HBarChart, type HBarDatum } from '../charts';
import { LiquidationTracker } from './LiquidationTracker';

/** Top N rows for the two per-exchange bar charts (§1.2) - matches the CoinGlass reference's own
 *  "biggest few, sorted desc" framing rather than every exchange this terminal happens to fetch. */
const TOP_EXCHANGE_ROWS = 8;

function toExchangeBars<F extends 'openInterestUsd' | 'volume24hUsd'>(rows: ExchangeRankingRow[], field: F): HBarDatum[] {
  return rows
    .filter((r): r is ExchangeRankingRow & Record<F, number> => r[field] !== null && (r[field] as number) > 0)
    .sort((a, b) => (b[field] as number) - (a[field] as number))
    .slice(0, TOP_EXCHANGE_ROWS)
    .map((r) => ({ label: r.exchange, value: (r[field] as number) / 1e6, tone: 'up' as const }));
}

type FuturesTab = 'funding' | 'oi' | 'volume' | 'liquidation';

const TABS: FuturesTab[] = ['funding', 'oi', 'volume', 'liquidation'];

/** Below this many samples the trailing history is still genuinely short (server.ts's own history
 *  now persists to Redis at a low frequency and survives redeploys - see that file's header
 *  comment above futuresHistoryStore - so this keeps growing across restarts instead of resetting
 *  to near-zero every session like before). The chart itself is ALWAYS the full axis+grid
 *  DualAxisAreaChart regardless of sample count (visual fix: a compact sparkline-only mode used to
 *  kick in below this threshold, which is exactly what made the chart look permanently
 *  unfinished/broken every time the in-memory history reset) - this constant only gates the extra
 *  honest caption below the chart. */
const FEW_SAMPLES_THRESHOLD = 20;

/** One label/value/price row shared by all three metric charts - built once per points array,
 *  price-paired so DualAxisAreaChart's primary/secondary series always stay index-aligned. */
interface ChartRow {
  label: string;
  value: number;
  price: number;
}

function toChartRows(points: FuturesHistoryPoint[], valueOf: (p: FuturesHistoryPoint) => number | null, scale: number): ChartRow[] {
  const usable = points.filter((p) => valueOf(p) !== null && p.price !== null);
  // CoinGlass parity (Bagian B upgrade): once this pair's history spans more than a day (samples
  // land roughly every ~20min - server.ts's futuresHistoryStore persistence cadence - so this is a
  // real multi-day series, not a low-resolution one), the tooltip/x-axis label needs the DATE too,
  // not just "hh:mm" repeating across different days. Under a day, the time-only label stays
  // exactly as it was - never show a date for data that's genuinely still same-day.
  const spanMs =
    usable.length >= 2 ? new Date(usable[usable.length - 1].time).getTime() - new Date(usable[0].time).getTime() : 0;
  const includeDate = spanMs > 24 * 60 * 60 * 1000;
  return usable.map((p) => {
    const d = new Date(p.time);
    const label = includeDate
      ? `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
      : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return {
      label,
      value: (valueOf(p) as number) * scale,
      price: p.price as number,
    };
  });
}

/**
 * Futures Data Analysis (Institutional Watchlist full-page detail, Part G) - 4 sub-tabs (Weighted
 * Funding Rate / Open Interest / Volume / Liquidation), mirroring the CoinGlass reference's
 * structure. The first 3 are derived purely from numbers /api/crypto/exchange-ranking (Part C)
 * already fetched this cycle - server.ts's /api/crypto/futures-history reads the SAME
 * cachedExternalFeed cache key, so switching between these tabs (or this panel refreshing)
 * NEVER triggers a second round of exchange calls. History is now persisted to Redis at a low
 * frequency and restored on boot (server.ts), so it genuinely accumulates across restarts
 * wherever Redis is configured, rather than resetting to near-zero every redeploy.
 *
 * Liquidation reuses LiquidationTracker as-is (already real, source-labeled dynamically from the
 * API's own response) - not duplicated or re-implemented here.
 *
 * Visual fix (root-cause, "chart kelihatan kecil/sparkline terus"): each of the 3 metric charts is
 * now ALWAYS the full-width DualAxisAreaChart with this pair's own price as an independent-axis
 * overlay (CoinGlass reference) and a gradient fill on the primary metric - never the compact
 * sparkline-only mode a low sample count used to fall back to, which read as a permanently
 * unfinished chart every time the (formerly in-memory-only) history reset on redeploy.
 *
 * Fase 2 (Lampiran 2 §1.2): two small per-exchange bar charts above the sub-tabs - Open Interest
 * and 24h Volume, both sorted desc, from the SAME `rows` the Futures tab's own ranking
 * table/heatmap already fetched (passed down as a prop, not fetched again here). "Trade Count" per
 * exchange from the CoinGlass reference is deliberately skipped - this terminal has no such field
 * from any of its exchange fetchers.
 */
export const FuturesDataAnalysis: React.FC<{ symbol: CryptoDerivativesSymbol; rows?: ExchangeRankingRow[] }> = ({
  symbol,
  rows = [],
}) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<FuturesTab>('funding');
  const { data, isLoading } = useEndpoint<FuturesHistoryResponse>(`/api/crypto/futures-history?symbol=${symbol}`, 2 * 60_000);

  const points = data?.points ?? [];
  const latest = points[points.length - 1];

  const oiBars = useMemo(() => toExchangeBars(rows, 'openInterestUsd'), [rows]);
  const volumeBars = useMemo(() => toExchangeBars(rows, 'volume24hUsd'), [rows]);

  // Percent -> bps for funding (x100), USD -> $M for OI/volume (/1e6) - same scaling the old
  // per-tab useMemos used, now shared by one row builder.
  const fundingRows = useMemo(() => toChartRows(points, (p) => p.weightedFundingRatePercent, 100), [points]);
  const oiRows = useMemo(() => toChartRows(points, (p) => p.totalOpenInterestUsd, 1 / 1e6), [points]);
  const volumeRows = useMemo(() => toChartRows(points, (p) => p.totalVolume24hUsd, 1 / 1e6), [points]);

  const isChartTab = tab !== 'liquidation';
  const chartUnavailable = isChartTab && (!data || data.unavailable);

  const activeRows = tab === 'funding' ? fundingRows : tab === 'oi' ? oiRows : tab === 'volume' ? volumeRows : [];
  // FIX WARNA DUA-NADA: Weighted Funding Rate is the one metric here that genuinely crosses zero
  // (OI/Volume never go negative, so they keep one flat color) - `activeConfig.color` used to be a
  // single flat `--color-warn` for the whole funding line regardless of sign, which is exactly the
  // "chart Funding Rate cuma ORANGE semua, padahal funding rate-nya sempat negatif" bug. It now
  // only sizes/labels the axis (DualAxisAreaChart's `baseline={0}` below drives the real green/red
  // per-point color), so it's `--text-muted` rather than a color that would clash with dynamic
  // per-point green/red.
  const activeConfig =
    tab === 'funding'
      ? { color: 'var(--text-muted)', digits: 1, suffix: ' bps', label: t('futuresAnalysis.tab.funding') }
      : tab === 'oi'
        ? { color: 'var(--color-brand)', digits: 0, suffix: 'M', label: t('futuresAnalysis.tab.oi') }
        : { color: 'var(--color-up)', digits: 0, suffix: 'M', label: t('futuresAnalysis.tab.volume') };
  const coinLabel = symbol.replace(/USDT$/, '');

  return (
    <Panel variant="flat" flush className="pt-4 border-t border-[var(--border-subtle)]">
      {/* CoinGlass parity ROUND 3 (typography): the old subtitle spelled out the methodology in a
          full sentence - the sub-tab labels (Funding Rate/Open Interest/Volume/Liquidation) and
          this section's own aggregationNote footnote already cover it. */}
      <PanelHeader
        eyebrow={t('category.market')}
        title={t('futuresAnalysis.title')}
        icon={<BarChart3 className="w-4 h-4" />}
        actions={
          isChartTab && data?.fetchedAt ? (
            <DataQualityBadge
              compact
              meta={{
                source: data.source,
                lastUpdated: data.fetchedAt,
                status: data.stale ? 'STALE' : statusFromAge(data.fetchedAt, 5 * 60_000, 30 * 60_000),
              }}
            />
          ) : undefined
        }
      />

      {(oiBars.length > 0 || volumeBars.length > 0) && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {oiBars.length > 0 && (
            <div>
              <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                {t('futuresAnalysis.oiPerExchange')}
              </span>
              <HBarChart data={oiBars} diverging={false} unit="M" digits={0} />
            </div>
          )}
          {volumeBars.length > 0 && (
            <div>
              <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                {t('futuresAnalysis.volumePerExchange')}
              </span>
              <HBarChart data={volumeBars} diverging={false} unit="M" digits={0} />
            </div>
          )}
        </div>
      )}

      <div className="mt-3">
        <TabBar
          tabs={TABS.map((key) => ({ id: key, label: t(`futuresAnalysis.tab.${key}`) }))}
          active={tab}
          onChange={(id) => setTab(id as FuturesTab)}
          variant="underline"
        />
      </div>

      <div key={tab} className="mt-4 hev-tab-fade">
        {tab === 'liquidation' ? (
          <LiquidationTracker symbol={symbol} bare />
        ) : isLoading && !data ? (
          <LoadingState variant="cards" />
        ) : chartUnavailable ? (
          <UnavailableState source="14 exchanges" detail={data?.error ?? undefined} />
        ) : activeRows.length < 2 ? (
          <p className="text-[11px] text-[var(--text-muted)]">{t('futuresAnalysis.collecting')}</p>
        ) : (
          <>
            {tab === 'funding' &&
              latest?.weightedFundingRatePercent !== null &&
              latest?.weightedFundingRatePercent !== undefined && (
                <div className="mb-3 text-[11px] text-[var(--text-secondary)]">
                  {t('futuresAnalysis.weightedFundingNow')}{' '}
                  <span
                    className={`font-bold tabular-nums ${
                      latest.weightedFundingRatePercent >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'
                    }`}
                  >
                    {(latest.weightedFundingRatePercent * 100).toFixed(2)} bps
                  </span>
                </div>
              )}
            {tab === 'oi' && latest?.totalOpenInterestUsd !== null && latest?.totalOpenInterestUsd !== undefined && (
              <div className="mb-3 text-[11px] text-[var(--text-secondary)]">
                {t('futuresAnalysis.totalOiNow')}{' '}
                <span className="font-bold tabular-nums text-[var(--text-primary)]">${formatCompact(latest.totalOpenInterestUsd, 2)}</span>{' '}
                <span className="text-[var(--text-muted)]">
                  ({latest.exchangeCount} {t('futuresAnalysis.exchanges')})
                </span>
              </div>
            )}
            {tab === 'volume' && latest?.totalVolume24hUsd !== null && latest?.totalVolume24hUsd !== undefined && (
              <div className="mb-3 text-[11px] text-[var(--text-secondary)]">
                {t('futuresAnalysis.totalVolumeNow')}{' '}
                <span className="font-bold tabular-nums text-[var(--text-primary)]">${formatCompact(latest.totalVolume24hUsd, 2)}</span>
              </div>
            )}

            <DualAxisAreaChart
              height={260}
              areaFill
              baseline={tab === 'funding' ? 0 : undefined}
              // CoinGlass parity (Bagian B upgrade): Volume renders as bars/histogram, matching the
              // reference - Funding Rate/Open Interest stay the smooth area line.
              barMode={tab === 'volume'}
              primary={{
                points: activeRows.map((r) => ({ label: r.label, value: r.value })),
                color: activeConfig.color,
                label: activeConfig.label,
                valueDigits: activeConfig.digits,
                valueSuffix: activeConfig.suffix,
              }}
              secondary={{
                points: activeRows.map((r) => ({ label: r.label, value: r.price })),
                color: 'var(--text-primary)',
                label: `${coinLabel} ${t('instPanel.price')}`,
                valueDigits: activeRows.some((r) => r.price < 10) ? 4 : 2,
                valuePrefix: '$',
              }}
            />

            {activeRows.length < FEW_SAMPLES_THRESHOLD && (
              <p className="mt-2 text-[9px] text-[var(--text-muted)] leading-relaxed">
                {t('futuresAnalysis.shortHistoryNote').replace('{time}', activeRows[0]?.label ?? '—')}
              </p>
            )}
          </>
        )}
      </div>

      {isChartTab && !chartUnavailable && (
        <p className="mt-3 text-[9px] text-[var(--text-muted)] leading-relaxed">{t('futuresAnalysis.historyNote')}</p>
      )}
    </Panel>
  );
};
