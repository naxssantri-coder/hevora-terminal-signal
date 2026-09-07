import React from 'react';
import { Waves } from 'lucide-react';
import { DxyResponse, MarketPrice, PairId } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { aggregateFeedMeta } from '../../lib/dataState';
import { formatNumber, formatPercent } from '../../lib/format';
import { DataQualityBadge, Panel, PanelHeader } from '../ui';
import { InfoTooltip } from '../viz';

/**
 * Risk-on/Risk-off Flow (Roadmap §5) - Gold vs BTC vs USD, side by side.
 *
 * Deliberately NOT a fourth "risk-on/risk-off" badge on gold's own tile: analytics.ts's
 * computeRegime already documents (and halved the weight of) gold's own dual nature - it rallies
 * both on safe-haven risk-off bids AND on a weak dollar/falling real yields, which is a risk-ON
 * read. Slapping a directional risk label on gold's raw price change here would reintroduce
 * exactly the confound that composite score was built to avoid. So this card shows each asset's
 * own literal price direction (green up / red down, the same convention every other price tile in
 * this app already uses) and leaves the risk-on/off READING to one static explanatory note, not a
 * computed per-asset verdict.
 *
 * All three inputs are already fetched elsewhere in this app (BTCUSDT/XAUUSD from the shared
 * `prices` prop AnalysisHub already passes to every card in this row, DXY via the same
 * `/api/macro/dxy` endpoint MarketRegimeView/CorrelationView already call) - no new data source.
 */
export const RiskFlowView: React.FC<{ prices: Record<PairId, MarketPrice> }> = ({ prices }) => {
  const { t } = useTranslation();
  const dxy = useEndpoint<DxyResponse>('/api/macro/dxy', 30_000);

  const gold = prices.XAUUSD;
  const btc = prices.BTCUSDT;
  const dxyPrice = dxy.data?.unavailable ? null : (dxy.data?.price ?? null);
  const dxyChange = dxy.data?.unavailable ? null : (dxy.data?.changeSessionPct ?? null);

  const tiles: Array<{ id: string; label: string; price: number | null; change: number | null; digits: number }> = [
    { id: 'gold', label: 'XAU/USD', price: gold?.price ?? null, change: gold?.change24h ?? null, digits: 2 },
    { id: 'btc', label: 'BTC/USDT', price: btc?.price ?? null, change: btc?.change24h ?? null, digits: 0 },
    { id: 'usd', label: 'DXY', price: dxyPrice, change: dxyChange, digits: 3 },
  ];

  return (
    <Panel className="h-full flex flex-col font-mono">
      <PanelHeader
        eyebrow={t('category.analysis')}
        title={t('analysis.riskFlowTitle')}
        icon={<Waves className="w-4 h-4" />}
        actions={
          <div className="flex items-center gap-2">
            <DataQualityBadge
              meta={aggregateFeedMeta(
                'HEVORA composite',
                [gold, btc, dxy.data?.lastUpdated ? { lastUpdated: dxy.data.lastUpdated } : undefined],
                60_000,
                10 * 60_000
              )}
            />
            <InfoTooltip text={t('analysis.riskFlowNote')} />
          </div>
        }
      />

      <div className="mt-4 flex-1 grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div key={tile.id} className="hev-card-v2 !p-3 flex flex-col items-start gap-1">
            <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{tile.label}</span>
            <span className="text-sm font-black tabular-nums text-[var(--text-primary)]">
              {tile.price === null ? '—' : formatNumber(tile.price, tile.digits)}
            </span>
            <span
              className={`text-[11px] font-bold tabular-nums ${
                tile.change === null ? 'text-[var(--text-muted)]' : tile.change >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'
              }`}
            >
              {tile.change === null ? '—' : formatPercent(tile.change, 2, { signed: true })}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
};
