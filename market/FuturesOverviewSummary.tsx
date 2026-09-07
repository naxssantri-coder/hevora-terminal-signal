import React from 'react';
import { Gauge } from 'lucide-react';
import type { CryptoDerivativesResponse, CryptoDerivativesSymbol, LiquidationsResponse } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { formatCompact, formatNumber } from '../../lib/format';
import { Panel, PanelHeader, StatTile } from '../ui';

/**
 * Compact futures summary for the Overview tab (Institutional Watchlist full-page detail, Fase 2
 * Lampiran 2 §1.4) - CoinGlass keeps funding/OI/long-short/liquidation visible on its Overview tab
 * rather than gating it behind a Futures tab; this mirrors that without a second render of the
 * full CryptoDerivativesView/FuturesDataAnalysis/LiquidationTracker panels.
 *
 * Funding rate / open interest / long-short ratio are passed down from the SAME
 * /api/crypto/derivatives call the page's own sticky header already made (headerDerivatives) - no
 * extra OKX round-trip. Liquidation is its own light fetch here: /api/crypto/liquidations reads an
 * in-memory WebSocket relay server-side (bybitLiquidationRelay.getSummary), not a per-request
 * external call, so a second GET alongside the Futures tab's own LiquidationTracker costs nothing
 * real.
 */
export const FuturesOverviewSummary: React.FC<{
  symbol: CryptoDerivativesSymbol;
  pairId: string;
  derivatives: CryptoDerivativesResponse | null;
  isLoading: boolean;
}> = ({ symbol, pairId, derivatives, isLoading }) => {
  const { t } = useTranslation();
  const { data: liq } = useEndpoint<LiquidationsResponse>(`/api/crypto/liquidations?symbol=${symbol}`, 30_000);

  const bps =
    derivatives?.fundingRate !== null && derivatives?.fundingRate !== undefined ? derivatives.fundingRate * 10_000 : null;
  const longShort = derivatives?.longShortRatio ?? null;
  const coinLabel = pairId.replace(/USDT$/, '');

  if (isLoading && !derivatives) return null;

  return (
    <Panel>
      <PanelHeader eyebrow={t('category.market')} title={t('futuresOverviewSummary.title')} icon={<Gauge className="w-4 h-4" />} />

      <div className="mt-3 grid grid-cols-3 gap-2.5">
        <StatTile
          label={t('derivatives.fundingRate')}
          value={bps === null ? '—' : `${formatNumber(bps, 2, { signed: true })} bps`}
          tone={bps === null ? undefined : bps >= 0 ? 'up' : 'down'}
          size="lg"
        />
        <StatTile
          label={t('derivatives.openInterest')}
          value={
            derivatives?.openInterestCcy === null || derivatives?.openInterestCcy === undefined
              ? '—'
              : `${formatCompact(derivatives.openInterestCcy, 2)} ${coinLabel}`
          }
          size="lg"
        />
        <StatTile
          label={t('futuresOverviewSummary.longShortRatio')}
          value={longShort === null ? '—' : longShort.toFixed(2)}
          tone={longShort === null ? undefined : longShort >= 1 ? 'up' : 'down'}
          size="lg"
        />
      </div>

      {liq && !liq.unavailable && (
        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          {(['1h', '24h'] as const).map((key) => {
            const w = liq.windows[key];
            const total = w.longUsd + w.shortUsd;
            return (
              <div key={key} className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[10px] p-2.5">
                <span className="text-[8px] uppercase tracking-wider text-[var(--text-muted)]">
                  {t('futuresOverviewSummary.liquidation')} {key.toUpperCase()}
                </span>
                {total === 0 ? (
                  <div className="mt-1 text-[10px] text-[var(--text-muted)]">{t('liquidationTracker.noEvents')}</div>
                ) : (
                  <div className="mt-1 flex items-center justify-between text-[10px]">
                    <span className="font-bold text-[var(--color-up)] tabular-nums">${formatCompact(w.longUsd, 1)}</span>
                    <span className="font-bold text-[var(--color-down)] tabular-nums">${formatCompact(w.shortUsd, 1)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
};
