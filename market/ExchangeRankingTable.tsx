import React, { useMemo } from 'react';
import { Building2 } from 'lucide-react';
import type { CryptoDerivativesSymbol, ExchangeRankingResponse } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { statusFromAge } from '../../lib/dataState';
import { formatCompact, formatNumber } from '../../lib/format';
import { DataQualityBadge, LoadingState, Panel, PanelHeader, UnavailableState } from '../ui';
import { ExchangeIcon } from './ExchangeIcon';

/**
 * Multi-exchange ranking table (OKX + Bybit + KuCoin + Gate.io + Bitget + Kraken + Coinbase +
 * MEXC + Bitstamp + Gemini + Crypto.com) for the Institutional
 * Watchlist full-page detail's crypto pairs - server.ts's /api/crypto/exchange-ranking. Binance is
 * never a row here (already recorded HTTP 451 from this hosting region - see that endpoint's own
 * comment). A row is simply absent when its exchange failed to answer this cycle - this component
 * never renders a zero/blank row in its place, so what's on screen is always real.
 */
export const ExchangeRankingTable: React.FC<{
  symbol: CryptoDerivativesSymbol;
  /** Institutional Watchlist full-page detail passes its own already-fetched ranking response
   *  down here (it needs the same rows for ExchangeVolumeHeatmap/FuturesDataAnalysis too) so this
   *  table never triggers a second HTTP round-trip for data the page already has. Omit (every
   *  other/older caller) and this component fetches for itself exactly as it always has. */
  data?: ExchangeRankingResponse | null;
  isLoading?: boolean;
  /** True when rendered as the second sub-section of a shared Panel (Institutional Watchlist
   *  Futures tab combines this with ExchangeVolumeHeatmap into one card, visual redesign §3.7) -
   *  skips this component's own outer Panel chrome so the two never stack as two separate cards. */
  bare?: boolean;
}> = ({ symbol, data: externalData, isLoading: externalIsLoading, bare = false }) => {
  const { t } = useTranslation();
  const selfFetch = externalData === undefined;
  const fetched = useEndpoint<ExchangeRankingResponse>(
    selfFetch ? `/api/crypto/exchange-ranking?symbol=${symbol}` : null,
    2 * 60_000
  );
  const data = selfFetch ? fetched.data : externalData ?? null;
  const isLoading = selfFetch ? fetched.isLoading : Boolean(externalIsLoading);

  const rows = data?.rows ?? [];
  const sortedRows = useMemo(() => [...rows].sort((a, b) => (b.volume24hUsd ?? -1) - (a.volume24hUsd ?? -1)), [rows]);
  const maxVolume = sortedRows[0]?.volume24hUsd ?? 0;
  // CoinGlass parity ROUND 3 ("OI tampilkan USD + % share"): each row's share of THIS pair's total
  // open interest across the exchanges that reported it this cycle - real, derived from the same
  // rows already on screen, not a separate fetch.
  const totalOiUsd = useMemo(
    () => sortedRows.reduce((sum, r) => (r.openInterestUsd !== null ? sum + r.openInterestUsd : sum), 0),
    [sortedRows]
  );

  // CoinGlass parity ROUND 3 ("sembunyikan kolom yang 80%+ kosong untuk row itu"): OI/funding/
  // long-short come from each exchange's own ticker payload and aren't universally available (see
  // this file's own header comment) - a column where 4/5 of this cycle's rows are genuinely "—"
  // reads as a broken table, not an honest gap. Hidden per-cycle based on the REAL rows this
  // response actually has, not a fixed assumption - a provider that starts reporting OI, say, un-
  // hides that column again on its own next cycle.
  const emptyRatio = (pick: (r: (typeof sortedRows)[number]) => unknown) =>
    sortedRows.length === 0 ? 0 : sortedRows.filter((r) => pick(r) === null).length / sortedRows.length;
  const showOi = emptyRatio((r) => r.openInterestUsd) < 0.8;
  const showFunding = emptyRatio((r) => r.fundingRatePercent) < 0.8;
  const showLongShort = emptyRatio((r) => r.longShortRatio) < 0.8;

  if (isLoading && !data) return <LoadingState variant="table" />;

  const header = (
    <PanelHeader
      eyebrow={t('category.market')}
      title={t('exchangeRanking.title')}
      subtitle={t('exchangeRanking.subtitle')}
      icon={<Building2 className="w-4 h-4" />}
      actions={
        data?.fetchedAt ? (
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
  );

  const body =
    rows.length === 0 ? (
      <div className="mt-3">
        <UnavailableState source="14 exchanges" title={t('exchangeRanking.unavailable')} detail={data?.error ?? undefined} />
      </div>
    ) : (
      // CoinGlass parity ROUND 3 (macOS lampiran): scrollbar-gutter:stable reserves the
      // scrollbar's width up front, so a Mac user with "Show scrollbars: Always" set doesn't see
      // this table's content width jump ~15px when the vertical scrollbar appears/disappears.
      <div className="mt-3 overflow-x-auto max-h-[360px] overflow-y-auto [scrollbar-gutter:stable]">
        <table className="w-full text-[11px] border-collapse min-w-[560px]">
          <thead className="sticky top-0 bg-[var(--bg-panel)] z-10">
            <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
              <th className="text-left font-bold py-2 pr-2">{t('exchangeRanking.colRank')}</th>
              <th className="text-left font-bold py-2 pr-2">{t('exchangeRanking.colExchange')}</th>
              <th className="text-right font-bold py-2 px-2">{t('exchangeRanking.colPrice')}</th>
              <th className="text-right font-bold py-2 px-2">{t('exchangeRanking.colVolume')}</th>
              {showOi && <th className="text-right font-bold py-2 px-2">{t('exchangeRanking.colOi')}</th>}
              {showFunding && <th className="text-right font-bold py-2 px-2">{t('exchangeRanking.colFunding')}</th>}
              {showLongShort && <th className="text-right font-bold py-2 pl-2">{t('exchangeRanking.colLongShort')}</th>}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, index) => {
              const volPct = row.volume24hUsd !== null && maxVolume > 0 ? Math.max((row.volume24hUsd / maxVolume) * 100, 2) : 0;
              return (
                <tr
                  key={row.exchange}
                  className="border-b border-[var(--border-subtle)] last:border-0 odd:bg-[var(--bg-surface)]/30 hover:bg-[var(--card-hover-bg)] transition-colors"
                >
                  <td className="py-2 pr-2 text-[var(--text-muted)] tabular-nums">{index + 1}</td>
                  <td className="py-2 pr-2 font-bold text-[var(--text-primary)]">
                    <span className="flex items-center gap-1.5">
                      <ExchangeIcon exchange={row.exchange} size={16} />
                      {row.exchange}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-[var(--text-primary)] font-bold">
                    {row.price === null ? '—' : formatNumber(row.price, row.price < 10 ? 4 : 2)}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-[var(--text-secondary)]">
                    {row.volume24hUsd === null ? (
                      '—'
                    ) : (
                      <span className="relative flex items-center justify-end">
                        <span
                          className="absolute inset-y-0 left-0 rounded-sm bg-[var(--color-brand)]/12"
                          style={{ width: `${volPct}%` }}
                          aria-hidden="true"
                        />
                        <span className="relative pr-1">${formatCompact(row.volume24hUsd, 2)}</span>
                      </span>
                    )}
                  </td>
                  {showOi && (
                    <td className="py-2 px-2 text-right tabular-nums text-[var(--text-secondary)]">
                      {row.openInterestUsd === null ? (
                        '—'
                      ) : (
                        <>
                          ${formatCompact(row.openInterestUsd, 2)}
                          {totalOiUsd > 0 && (
                            <span className="text-[var(--text-muted)]"> ({formatNumber((row.openInterestUsd / totalOiUsd) * 100, 0)}%)</span>
                          )}
                        </>
                      )}
                    </td>
                  )}
                  {showFunding && (
                    <td
                      className={`py-2 px-2 text-right tabular-nums font-bold ${
                        row.fundingRatePercent === null
                          ? 'text-[var(--text-muted)]'
                          : row.fundingRatePercent >= 0
                            ? 'text-[var(--color-up)]'
                            : 'text-[var(--color-down)]'
                      }`}
                    >
                      {row.fundingRatePercent === null ? '—' : `${formatNumber(row.fundingRatePercent, 4, { signed: true })}%`}
                    </td>
                  )}
                  {showLongShort && (
                    <td className="py-2 pl-2 text-right tabular-nums text-[var(--text-secondary)]">
                      {row.longShortRatio === null ? '—' : formatNumber(row.longShortRatio, 2)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length < 5 && (
          <p className="mt-2 text-[9px] text-[var(--text-muted)]">{t('exchangeRanking.partialNote')}</p>
        )}
      </div>
    );

  if (bare) {
    return (
      <div>
        {header}
        {body}
      </div>
    );
  }

  return (
    <Panel flush className="p-4 sm:p-5">
      {header}
      {body}
    </Panel>
  );
};
