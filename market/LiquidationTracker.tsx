import React from 'react';
import { MinusCircle, Zap } from 'lucide-react';
import type { CryptoDerivativesSymbol, LiquidationsResponse } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { formatCompact } from '../../lib/format';
import { Badge, EmptyState, LoadingState, Panel, PanelHeader, UnavailableState } from '../ui';

const WINDOW_KEYS = ['1h', '4h', '12h', '24h'] as const;

/**
 * Liquidation tracker - server.ts's per-exchange liquidation WS relays (Bybit, OKX - see
 * createBybitLiquidationRelay/createOkxLiquidationRelay) aggregated by /api/crypto/liquidations.
 * The source badge renders the API's own `source` string verbatim rather than a hardcoded
 * exchange name - it lists only the relays actually connected right now and self-adjusts if one
 * drops, so a reader never sees a coverage claim wider than what is really live this moment.
 */
export const LiquidationTracker: React.FC<{
  symbol: CryptoDerivativesSymbol;
  /** True when rendered as the "Liquidation" sub-tab of FuturesDataAnalysis (Institutional Detail
   *  Page's Futures tab, visual fix Bug #2) - that component already wraps this content in its own
   *  flat Panel, so this skips its own Panel entirely instead of nesting a second card inside it. */
  bare?: boolean;
}> = ({ symbol, bare = false }) => {
  const { t } = useTranslation();
  const { data, isLoading } = useEndpoint<LiquidationsResponse>(`/api/crypto/liquidations?symbol=${symbol}`, 30_000);

  if (isLoading && !data) return <LoadingState variant="cards" />;

  const unavailable = !data || data.unavailable;

  // Partial-window honesty: a window whose span exceeds how long the in-memory aggregator has
  // actually been tracking (server boot / last restart) is not a real trailing period yet - e.g.
  // right after a restart, the "24h" bucket may really only cover the last few minutes.
  const trackingMs = data?.trackingSince ? Date.now() - new Date(data.trackingSince).getTime() : null;

  const header = (
    <PanelHeader
      eyebrow={t('category.market')}
      title={t('liquidationTracker.title')}
      subtitle={t('liquidationTracker.subtitle')}
      icon={<Zap className="w-4 h-4" />}
      actions={<Badge tone="neutral">{data?.source ? `Source: ${data.source}` : t('liquidationTracker.sourceBadge')}</Badge>}
    />
  );

  const body = (
    <>
      {unavailable ? (
        <div className="mt-3">
          <UnavailableState
            source={data?.source ?? 'liquidation exchanges'}
            title={t('liquidationTracker.disconnectedTitle')}
            detail={t('liquidationTracker.disconnectedDetail')}
          />
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {WINDOW_KEYS.map((key) => {
            const w = data!.windows[key];
            const total = w.longUsd + w.shortUsd;
            const longPct = total > 0 ? (w.longUsd / total) * 100 : 50;
            const isPartial = trackingMs !== null && trackingMs < windowMs(key);
            return (
              <div key={key} className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[10px] p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{key.toUpperCase()}</span>
                  {isPartial && (
                    <span className="text-[8px] text-[var(--text-muted)] italic" title={t('liquidationTracker.partialHint')}>
                      {t('liquidationTracker.partialShort')}
                    </span>
                  )}
                </div>
                {total === 0 ? (
                  // Styled as a deliberate, quiet "nothing happened" read (bg-base tint + a neutral
                  // icon), not a floating gray line that could be mistaken for a broken/error cell -
                  // this is the normal state for a quiet window, not a fetch failure.
                  <div className="mt-2 flex flex-col items-center justify-center gap-1 rounded-[8px] bg-[var(--bg-base)]/50 py-3">
                    <MinusCircle className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    <span className="text-[10px] text-[var(--text-muted)]">{t('liquidationTracker.noEvents')}</span>
                  </div>
                ) : (
                  <>
                    <div className="h-1.5 rounded-full overflow-hidden bg-[var(--color-down)]/30 mt-2 flex">
                      <div className="h-full bg-[var(--color-up)]" style={{ width: `${longPct}%` }} />
                    </div>
                    <div className="flex items-center justify-between mt-1.5 text-[10px]">
                      <span className="font-bold text-[var(--color-up)] tabular-nums">${formatCompact(w.longUsd, 1)}</span>
                      <span className="font-bold text-[var(--color-down)] tabular-nums">${formatCompact(w.shortUsd, 1)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[8px] text-[var(--text-muted)] uppercase tracking-wide">
                      <span>{t('liquidationTracker.long')}</span>
                      <span>{t('liquidationTracker.short')}</span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!unavailable && data?.lastEventAt === null && (
        <p className="mt-2.5 text-[9px] text-[var(--text-muted)]">{t('liquidationTracker.noEventsYetNote')}</p>
      )}
    </>
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

function windowMs(key: (typeof WINDOW_KEYS)[number]): number {
  switch (key) {
    case '1h':
      return 60 * 60_000;
    case '4h':
      return 4 * 60 * 60_000;
    case '12h':
      return 12 * 60 * 60_000;
    case '24h':
      return 24 * 60 * 60_000;
  }
}
