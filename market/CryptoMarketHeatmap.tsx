import React, { useMemo } from 'react';
import { Flame } from 'lucide-react';
import type { CryptoMarketHeatmapResponse } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { statusFromAge } from '../../lib/dataState';
import { formatCompact } from '../../lib/format';
import { DataQualityBadge, LoadingState, Panel, PanelHeader, UnavailableState } from '../ui';
import { Treemap, type TreemapBlock } from '../viz';

/**
 * Volume heatmap - CoinGecko top ~30 coins by 24h volume (server.ts's /api/crypto/market-heatmap),
 * rendered with the same Treemap component this app's own Liquidity & Flow zones already use
 * (that component's own header comment explicitly calls out "reusable later for liquidation
 * clusters once a real feed exists" - this is that reuse). General crypto market context, not
 * specific to one pair, so the same heatmap is shown on every crypto pair's Institutional
 * Watchlist detail panel rather than refetched/recomputed per pair.
 */
export const CryptoMarketHeatmap: React.FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useEndpoint<CryptoMarketHeatmapResponse>('/api/crypto/market-heatmap', 10 * 60_000);

  const blocks: TreemapBlock[] = useMemo(
    () =>
      (data?.coins ?? []).map((c) => ({
        id: c.id,
        label: c.symbol,
        value: c.volume24hUsd,
        tone: c.change24hPercent === null ? 'neutral' : c.change24hPercent >= 0 ? 'up' : 'down',
        sublabel: c.change24hPercent === null ? undefined : `${c.change24hPercent >= 0 ? '+' : ''}${c.change24hPercent.toFixed(1)}%`,
      })),
    [data?.coins]
  );

  if (isLoading && !data) return <LoadingState variant="cards" />;

  return (
    <Panel variant="flat" flush className="pt-4 border-t border-[var(--border-subtle)]">
      {/* CoinGlass parity ROUND 3 (typography): size/color encoding moved into the one-line legend
          below the heatmap instead of a full sentence in the card header. */}
      <PanelHeader
        eyebrow={t('category.market')}
        title={t('cryptoHeatmap.title')}
        icon={<Flame className="w-4 h-4" />}
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

      {blocks.length === 0 ? (
        <div className="mt-3">
          <UnavailableState source="CoinGecko" title={t('cryptoHeatmap.unavailable')} detail={data?.error ?? undefined} />
        </div>
      ) : (
        <div className="mt-3">
          <Treemap blocks={blocks} height={150} valueFormatter={(v) => `$${formatCompact(v, 1)}`} />
          <p className="mt-2 text-[9px] text-[var(--text-muted)]">{t('cryptoHeatmap.legend')}</p>
        </div>
      )}
    </Panel>
  );
};
