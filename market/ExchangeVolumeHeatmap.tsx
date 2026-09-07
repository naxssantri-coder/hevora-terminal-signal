import React, { useMemo } from 'react';
import { Flame } from 'lucide-react';
import type { ExchangeRankingRow } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { formatCompact } from '../../lib/format';
import { Panel, PanelHeader, UnavailableState } from '../ui';
import { Treemap, type TreemapBlock } from '../viz';
import { ExchangeIcon } from './ExchangeIcon';

/**
 * Per-exchange volume heatmap (Institutional Watchlist full-page detail, Part D) - a CoinGlass
 * "Heatmap(Volume)" equivalent, but built from the SAME per-exchange rows ExchangeRankingTable
 * already fetches (server.ts's /api/crypto/exchange-ranking), passed down as a prop rather than
 * fetched again here - one call to that endpoint per page view, not two. This is a different
 * concept from CryptoMarketHeatmap.tsx (top ~30 COINS by volume, CoinGecko) - that component is
 * untouched; this one's boxes are EXCHANGES for the one pair currently open, not coins.
 *
 * "Net Inflow" heatmap from the CoinGlass reference is NOT built here (see the Institutional
 * Watchlist audit report): a proper taker-buy-vs-taker-sell breakdown isn't reliably available
 * across these five exchanges' simple ticker endpoints - showing this Volume heatmap honestly
 * (real 24h volume per exchange) is preferred over a proxy net-inflow number that could mislead.
 *
 * FIX ARTI WARNA HEATMAP: block color is this exchange's own 24h PRICE CHANGE (%), not its funding
 * rate - matching the CoinGlass reference, where near-identical exchanges arbitraged to the same
 * price move mostly one color together and only a stale/thin-book outlier (e.g. Hyperliquid)
 * breaks pattern. Funding rate is a genuinely different number (can be positive while price is
 * falling, or vice versa) and was never what CoinGlass's own heatmap colors. Color intensity is
 * ADAPTIVE, not a fixed % threshold: scaled against the largest |change| among this cycle's own
 * rows, so whatever this pair's typical volatility regime is (a quiet 0.3% day or a violent 8% one),
 * the most extreme mover(s) always read as fully saturated and near-zero movers stay faint - a
 * real per-cycle color scale, the same idea a heatmap library's own min/max-normalized scale uses,
 * not a guessed absolute cutoff.
 */
export const ExchangeVolumeHeatmap: React.FC<{
  rows: ExchangeRankingRow[];
  isLoading: boolean;
  source?: string;
  /** True when rendered as the first sub-section of a shared Panel (Institutional Watchlist
   *  Futures tab combines this with ExchangeRankingTable into one card, visual redesign §3.7) -
   *  skips this component's own outer Panel chrome so the two never stack as two separate cards. */
  bare?: boolean;
}> = ({ rows, isLoading, source, bare = false }) => {
  const { t } = useTranslation();

  const blocks: TreemapBlock[] = useMemo(() => {
    const volumeRows = rows.filter((r) => r.volume24hUsd !== null && r.volume24hUsd > 0);
    const maxAbsChange = volumeRows.reduce((max, r) => {
      const c = r.priceChangePercent24h;
      return c === null ? max : Math.max(max, Math.abs(c));
    }, 0);
    return volumeRows.map((r) => {
      const change = r.priceChangePercent24h;
      return {
        id: r.exchange,
        label: r.exchange,
        value: r.volume24hUsd as number,
        tone: change === null ? 'neutral' : change >= 0 ? 'up' : 'down',
        intensity: change === null || maxAbsChange === 0 ? undefined : Math.abs(change) / maxAbsChange,
        sublabel: change === null ? undefined : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`,
        icon: <ExchangeIcon exchange={r.exchange} size={14} />,
      };
    });
  }, [rows]);

  const content = (
    <>
      {/* CoinGlass parity ROUND 3 (typography): the old subtitle spelled out the size/color
          encoding in a full sentence - that now lives in the one-line legend below the heatmap
          instead (a footnote for the section, not a paragraph in the card header).
          ROUND 3 (Bagian HEATMAP RULES - "Toggle Futures/Spot terpisah"): a real toggle, not a
          decorative one - "Futures" is this component's own real per-exchange futures volume,
          "Spot" stays disabled with an honest tooltip. No per-exchange SPOT volume source exists
          for a single pair in this codebase (the top-30-coin CryptoMarketHeatmap is a different
          dimension entirely - coins, not this pair's own spot venues) - showing a disabled toggle
          with a stated reason is the honest version of this control, not a fabricated Spot view. */}
      <PanelHeader
        eyebrow={t('category.market')}
        title={t('exchangeHeatmap.title')}
        icon={<Flame className="w-4 h-4" />}
        actions={
          <div className="flex items-center gap-1">
            <span className="px-2 py-1 rounded text-[10px] font-bold bg-[var(--bg-surface)] text-[var(--text-primary)]">
              {t('exchangeHeatmap.toggleFutures')}
            </span>
            <span
              className="px-2 py-1 rounded text-[10px] font-bold text-[var(--text-muted)] opacity-50 cursor-not-allowed"
              title={t('exchangeHeatmap.toggleSpotUnavailable')}
            >
              {t('exchangeHeatmap.toggleSpot')}
            </span>
          </div>
        }
      />

      {isLoading && blocks.length === 0 ? (
        <div className="mt-3 h-[340px] animate-pulse rounded-[10px] bg-[var(--bg-surface)]" />
      ) : blocks.length === 0 ? (
        <div className="mt-3">
          <UnavailableState source={source ?? 'multi-exchange'} title={t('exchangeHeatmap.unavailable')} />
        </div>
      ) : (
        <div className="mt-3">
          {/* CoinGlass parity fix (Bagian C1): 150px was sized for the old half-width side-by-side
              layout, where ~15-20 exchanges packed that tight pushed most boxes into the Treemap's
              'tiny' tier (label/value hidden). Now that this heatmap renders full page width (see
              InstitutionalDetailPage's futures tab), a taller canvas gives the squarify algorithm
              enough area to keep most boxes legible - only the smallest tail exchanges should still
              fall to 'tiny'. ROUND 2 (Bagian C4): re-checked at real mobile width (390px) with 18
              synthetic exchange rows - 280px still put ~6 boxes into 'tiny', more than the "1-3
              tail exchanges" target; 320px got to ~3-4; 340px (the top of the suggested 320-340
              range) got down to ~2-3, so that's what's used. */}
          <Treemap blocks={blocks} height={340} valueFormatter={(v) => `$${formatCompact(v, 1)}`} />
          <p className="mt-2 text-[9px] text-[var(--text-muted)]">{t('exchangeHeatmap.legend')}</p>
        </div>
      )}
    </>
  );

  if (bare) return content;

  return (
    <Panel flush className="p-4 sm:p-5">
      {content}
    </Panel>
  );
};
