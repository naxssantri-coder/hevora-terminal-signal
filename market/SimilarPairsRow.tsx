import React, { useMemo } from 'react';
import { Layers } from 'lucide-react';
import type { Candle } from '../../lib/analytics';
import type { PairId } from '../../types';
import { PAIRS_LIST } from '../../data/pairs';
import { useTranslation } from '../../i18n/LanguageContext';
import { digitsForPair, shortSymbol } from '../../lib/format';
import type { MarketPrice } from '../../types';
import { Panel, PanelHeader } from '../ui';
import { Sparkline } from '../charts';
import { PairIcon } from '../PairIcon';

/** Sparkline window - last N candles of whatever interval /api/market/candles already returns
 *  (same feed the Dashboard watchlist sparklines use), not a separate fetch. */
const SPARKLINE_CANDLES = 30;

/**
 * "Koin Serupa" / Similar Coins (Institutional Watchlist full-page detail, Fase 2 Lampiran 2
 * §1.3) - a CoinGlass "Similar Coins to Bitcoin" equivalent, but scoped honestly to the 7 crypto
 * pairs this terminal actually supports (PAIRS_LIST, category 'crypto') rather than an arbitrary
 * CoinGlass-style top-N list of coins HEV has no data for. Every number here (price, 24h change,
 * sparkline) is the SAME multi-pair candle/price feed already fetched once by the page this
 * renders inside (InstitutionalDetailPage) - no second network call.
 */
export const SimilarPairsRow: React.FC<{
  currentPairId: PairId;
  prices: Record<PairId, MarketPrice>;
  candles: Record<string, Candle[]>;
  onSelectPair: (id: PairId) => void;
}> = ({ currentPairId, prices, candles, onSelectPair }) => {
  const { t } = useTranslation();

  const others = useMemo(
    () =>
      PAIRS_LIST.filter((p) => p.category === 'crypto' && p.id !== currentPairId && prices[p.id]).map((p) => {
        const market = prices[p.id];
        const closes = (candles[p.id] ?? []).slice(-SPARKLINE_CANDLES).map((c) => c.c);
        return { pair: p, market, closes };
      }),
    [candles, currentPairId, prices]
  );

  if (others.length === 0) return null;

  return (
    <Panel>
      <PanelHeader
        eyebrow={t('category.market')}
        title={t('similarPairs.title')}
        subtitle={t('similarPairs.subtitle')}
        icon={<Layers className="w-4 h-4" />}
      />
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {others.map(({ pair, market, closes }) => (
          <button
            key={pair.id}
            type="button"
            onClick={() => onSelectPair(pair.id)}
            className="text-left bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[10px] p-2.5 hover:border-[var(--border-strong)] transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <PairIcon pairId={pair.id} size={16} className="shrink-0" />
              <span className="text-[11px] font-bold text-[var(--text-primary)] truncate">{shortSymbol(pair.name)}</span>
            </div>
            <div className="mt-1.5 flex items-end justify-between gap-2">
              <div className="min-w-0">
                <span className="block text-xs font-bold tabular-nums text-[var(--text-primary)] truncate">
                  {market.price.toFixed(digitsForPair(pair.id))}
                </span>
                <span className={`block text-[10px] font-bold tabular-nums ${market.change24h >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                  {market.change24h >= 0 ? '+' : ''}
                  {market.change24h.toFixed(2)}%
                </span>
              </div>
              {closes.length >= 2 && <Sparkline values={closes} width={64} height={24} />}
            </div>
          </button>
        ))}
      </div>
    </Panel>
  );
};
