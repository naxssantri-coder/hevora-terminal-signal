import React from 'react';
import { Star } from 'lucide-react';
import { MarketPrice, PairId, PairMetadata } from '../../types';
import { PairIcon } from '../PairIcon';
import { BlurredValue } from '../BlurredValue';
import { useWatchlist } from '../../lib/watchlist';
import { useTranslation } from '../../i18n/LanguageContext';

interface WatchlistSidebarProps {
  pairs: PairMetadata[];
  prices: Record<PairId, MarketPrice>;
  selectedPairId: PairId;
  onSelectPair: (pairId: PairId) => void;
  signalsBlurred?: boolean;
}

/**
 * Pasar page left rail (2026-09-02, Pasar visual-polish round 3): a vertical list of the same
 * pairs the horizontal ticker strip/pair switcher above already shows, matching the reference
 * layout's "DAFTAR WATCHLIST" column. Selecting a row drives the same `onSelectPair` callback the
 * ticker strip and mobile picker already use, so all three stay in sync automatically.
 *
 * The star toggle is real, working "pin to top of my own list" state via `useWatchlist` (existing
 * hook, already used by the Dashboard's own watchlist) - not decorative chrome. Deliberately no
 * "+" add-symbol control: `pairs` here is always the full engine pair list already, so there is
 * nothing else with real live price data to add. The reference mockup shows extra symbols
 * (USD/JPY, XRP/USDT, DOGE/USDT, etc.) that have no live feed wired anywhere in this codebase -
 * inventing rows for them would mean fabricating prices, which this project's data rules forbid.
 *
 * Hidden below lg: the mobile active-pair chip + full-screen picker sheet (MarketView.tsx, just
 * above the chart) already covers pair switching on narrow viewports; stacking this list above the
 * chart there too would just push the chart another ~9 rows down for no added function.
 */
export const WatchlistSidebar: React.FC<WatchlistSidebarProps> = ({ pairs, prices, selectedPairId, onSelectPair, signalsBlurred }) => {
  const { t } = useTranslation();
  const { has, toggle } = useWatchlist();

  const starred = pairs.filter((p) => has(p.id));
  const rest = pairs.filter((p) => !has(p.id));
  const ordered = [...starred, ...rest];

  return (
    <div className="hidden lg:flex flex-col w-full hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] overflow-hidden font-mono">
      <div className="px-3.5 py-3 border-b border-[var(--border-subtle)]">
        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-[var(--text-muted)]">
          {t('market.watchlistTitle')}
        </span>
      </div>
      <div className="flex items-center gap-2 px-3.5 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
        <span className="flex-1">{t('market.watchlistSymbol')}</span>
        <span className="text-right">{t('market.watchlistChange')}</span>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[54vh] lg:max-h-[60vh]">
        {ordered.map((pair) => {
          const p = prices[pair.id];
          const isSelected = pair.id === selectedPairId;
          const isPositive = p ? p.change24h >= 0 : true;
          const isStarred = has(pair.id);

          return (
            <button
              key={pair.id}
              type="button"
              onClick={() => onSelectPair(pair.id)}
              className={`w-full flex items-center gap-2 px-3.5 py-2.5 text-left transition-colors duration-150 cursor-pointer border-l-2 ${
                isSelected
                  ? 'bg-[var(--bg-surface)] border-l-[var(--color-brand)]'
                  : 'border-l-transparent hover:bg-[var(--card-hover-bg)]'
              }`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(pair.id);
                }}
                aria-label={isStarred ? t('market.watchlistUnpin') : t('market.watchlistPin')}
                aria-pressed={isStarred}
                className="shrink-0 cursor-pointer p-0.5"
              >
                <Star
                  className={`w-3 h-3 ${isStarred ? 'fill-[#F5B942] text-[#F5B942]' : 'text-[var(--text-muted)]'}`}
                />
              </button>
              <PairIcon pairId={pair.id} size={14} className="shrink-0" />
              <span
                className={`flex-1 min-w-0 truncate text-[11px] ${
                  isSelected ? 'text-[var(--text-primary)] font-black' : 'text-[var(--text-secondary)] font-bold'
                }`}
              >
                {pair.name}
              </span>
              {p ? (
                <span className="flex flex-col items-end shrink-0">
                  <span className="text-[10px] font-black tabular-nums text-[var(--text-primary)]">
                    <BlurredValue blurred={signalsBlurred}>{p.price.toFixed(pair.digits)}</BlurredValue>
                  </span>
                  <span className={`text-[9px] font-bold tabular-nums ${isPositive ? 'text-[#2ECC71]' : 'text-[#FF4D4F]'}`}>
                    {isPositive ? '+' : ''}
                    {p.change24h.toFixed(2)}%
                  </span>
                </span>
              ) : (
                <span className="text-[9px] text-[var(--text-muted)] shrink-0">—</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
