import React from 'react';
import { Landmark } from 'lucide-react';
import type { CryptoEtfOverviewResponse } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { statusFromAge } from '../../lib/dataState';
import { formatCompact, formatNumber } from '../../lib/format';
import { DataQualityBadge, LoadingState, Panel, PanelHeader, UnavailableState } from '../ui';

/**
 * Crypto ETF Overview (Institutional Watchlist full-page detail, Part H) - server.ts's
 * /api/crypto/etf-overview. BTCUSDT only, since every ticker this covers is a spot Bitcoin ETF (no
 * equivalent free/keyless data exists for any other pair on this terminal).
 *
 * AUM and expense ratio are shown as an honest "—" for every row, not estimated or omitted - a
 * live audit (scripts/audit-etf-sources.ts) confirmed neither field exists anywhere in the Yahoo
 * Finance response this endpoint reads, and no other free source was found. Daily net flow
 * (Farside Investors) is surfaced as the same fixed note the endpoint reports, since that source
 * returns HTTP 403 to this deployment - never worked around.
 */
export const CryptoEtfOverview: React.FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useEndpoint<CryptoEtfOverviewResponse>('/api/crypto/etf-overview', 10 * 60_000);

  if (isLoading && !data) return <LoadingState variant="table" />;

  const rows = data?.etfs ?? [];
  const answered = rows.filter((r) => r.price !== null);

  return (
    <Panel variant="flat" flush className="pt-4 border-t border-[var(--border-subtle)]">
      <PanelHeader
        eyebrow={t('category.market')}
        title={t('cryptoEtf.title')}
        subtitle={t('cryptoEtf.subtitle')}
        icon={<Landmark className="w-4 h-4" />}
        actions={
          data?.fetchedAt ? (
            <DataQualityBadge
              compact
              meta={{
                source: data.source,
                lastUpdated: data.fetchedAt,
                status: data.stale ? 'STALE' : statusFromAge(data.fetchedAt, 15 * 60_000, 60 * 60_000),
              }}
            />
          ) : undefined
        }
      />

      {answered.length === 0 ? (
        <div className="mt-3">
          <UnavailableState source="Yahoo Finance" title={t('cryptoEtf.unavailable')} detail={data?.error ?? undefined} />
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto max-h-[360px] overflow-y-auto">
          <table className="w-full text-[11px] border-collapse min-w-[640px]">
            <thead className="sticky top-0 bg-[var(--bg-panel)] z-10">
              <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                <th className="text-left font-bold py-2 pr-2">{t('cryptoEtf.colTicker')}</th>
                <th className="text-left font-bold py-2 pr-2">{t('cryptoEtf.colName')}</th>
                <th className="text-right font-bold py-2 px-2">{t('cryptoEtf.colPrice')}</th>
                <th className="text-right font-bold py-2 px-2">{t('cryptoEtf.colChange')}</th>
                <th className="text-right font-bold py-2 px-2">{t('cryptoEtf.colVolume')}</th>
                <th className="text-right font-bold py-2 px-2">{t('cryptoEtf.colAum')}</th>
                <th className="text-right font-bold py-2 pl-2">{t('cryptoEtf.colExpenseRatio')}</th>
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .filter((r) => r.price !== null)
                .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1))
                .map((row) => (
                  <tr key={row.ticker} className="border-b border-[var(--border-subtle)] last:border-0">
                    <td className="py-2.5 pr-2 font-bold text-[var(--text-primary)]">{row.ticker}</td>
                    <td className="py-2.5 pr-2 text-[var(--text-secondary)] truncate max-w-[200px]">{row.name ?? '—'}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-[var(--text-primary)] font-bold">
                      {row.price === null ? '—' : formatNumber(row.price, 2)}
                    </td>
                    <td
                      className={`py-2.5 px-2 text-right tabular-nums font-bold ${
                        row.changePercent === null ? 'text-[var(--text-muted)]' : row.changePercent >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'
                      }`}
                    >
                      {row.changePercent === null ? '—' : `${formatNumber(row.changePercent, 2, { signed: true })}%`}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-[var(--text-secondary)]">
                      {row.volume === null ? '—' : formatCompact(row.volume, 2)}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-[var(--text-muted)]">
                      {row.aumUsd === null ? '—' : `$${formatCompact(row.aumUsd, 2)}`}
                    </td>
                    <td className="py-2.5 pl-2 text-right tabular-nums text-[var(--text-muted)]">
                      {row.expenseRatioPercent === null ? '—' : `${formatNumber(row.expenseRatioPercent, 2)}%`}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

          {data?.totalVolumeUsd !== null && data?.totalVolumeUsd !== undefined && (
            <p className="mt-2.5 text-[10px] text-[var(--text-secondary)]">
              {t('cryptoEtf.totalVolume')} <span className="font-bold text-[var(--text-primary)]">${formatCompact(data.totalVolumeUsd, 2)}</span>
            </p>
          )}
          <p className="mt-2 text-[9px] text-[var(--text-muted)] leading-relaxed">{t('cryptoEtf.aumNote')}</p>
          <p className="mt-1 text-[9px] text-[var(--text-muted)] leading-relaxed">{data?.flowNote ?? t('cryptoEtf.flowNoteFallback')}</p>
        </div>
      )}
    </Panel>
  );
};
