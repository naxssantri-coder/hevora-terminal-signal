import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { MarketPrice, PairId } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { searchModules, getModuleById } from '../../modules/registry';
import { searchAssets, isEnginePair } from '../../lib/assets/universe';
import { formatNumber } from '../../lib/format';
import { PairIcon } from '../PairIcon';
import { useShell } from './ShellContext';

/**
 * Global search / command center (§7.8).
 *
 * Replaces the Navbar's pair-only ⌘K search: results are grouped, and the same query now
 * reaches modules as well as assets (searching "gold" surfaces XAUUSD *and* COT, Positioning,
 * Commodities). Grouping is by result kind now; later phases add news/event/signal groups by
 * registering additional result providers here - the shell and keyboard handling stay put.
 */

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  prices: Record<PairId, MarketPrice>;
  onSelectAsset: (pairId: PairId) => void;
}

const MAX_PER_GROUP = 6;

// Tahap C: EXTRA_ASSETS (commodities, indices) are real search results now, but they are NOT
// PairId values - the engine's candleStore/currentPrices/PAIRS_LIST have no entry for 'GC=F' or
// '^GSPC'. Routing them through onSelectAsset (which casts to PairId) would silently select a
// pair the engine has never heard of. They already have their own module (Commodities board,
// Markets > Indices) with real detail - route there instead of pretending they're tradable pairs.
const NON_ENGINE_ASSET_MODULE: Record<string, string> = {
  commodities: 'market-commodities',
  indices: 'market-indices',
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, prices, onSelectAsset }) => {
  const { t } = useTranslation();
  const { navigateToModule } = useShell();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      // Autofocus after the overlay paints, otherwise iOS Safari drops the focus call.
      const id = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [isOpen]);

  const moduleResults = useMemo(() => searchModules(query).slice(0, MAX_PER_GROUP), [query]);
  const assetResults = useMemo(() => searchAssets(query).slice(0, MAX_PER_GROUP), [query]);

  if (!isOpen) return null;

  const hasResults = moduleResults.length > 0 || assetResults.length > 0;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-start justify-center pt-20 sm:pt-28 px-4 bg-[var(--overlay-backdrop)] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[var(--bg-panel)] border border-[var(--border-strong)] rounded-[18px] shadow-2xl overflow-hidden font-mono"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--border-subtle)]">
          <Search className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('shell.searchPlaceholder')}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={t('shell.close')}
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {!hasResults && (
            <div className="p-6 text-center text-xs text-[var(--text-muted)]">{t('shell.noResults')}</div>
          )}

          {assetResults.length > 0 && (
            <div>
              <div className="px-4 pt-3 pb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                {t('shell.groupAssets')}
              </div>
              {assetResults.map((asset) => {
                const market = prices[asset.id as PairId];
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      if (isEnginePair(asset.id)) {
                        onSelectAsset(asset.id as PairId);
                      } else {
                        const targetModuleId = NON_ENGINE_ASSET_MODULE[asset.assetClass];
                        const targetModule = targetModuleId ? getModuleById(targetModuleId) : undefined;
                        if (targetModule) navigateToModule(targetModule);
                      }
                      onClose();
                    }}
                    className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[var(--card-hover-bg)] transition-colors cursor-pointer text-left"
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <PairIcon pairId={asset.id as PairId} size={18} className="shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-[var(--text-primary)] truncate">
                          {asset.name}
                        </span>
                        <span className="block text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                          {asset.assetClass} · {asset.provider}
                        </span>
                      </span>
                    </span>
                    {market && (
                      <span className="text-xs font-bold text-[var(--text-secondary)] tabular-nums shrink-0">
                        {formatNumber(market.price, market.digits)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {moduleResults.length > 0 && (
            <div>
              <div className="px-4 pt-3 pb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                {t('shell.groupModules')}
              </div>
              {moduleResults.map((mod) => {
                const Icon = mod.icon;
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => {
                      navigateToModule(mod);
                      onClose();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--card-hover-bg)] transition-colors cursor-pointer text-left"
                  >
                    <Icon className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-[var(--text-primary)] truncate">
                          {t(mod.nameKey)}
                        </span>
                        {mod.status === 'planned' && (
                          <span className="text-[8px] font-bold tracking-wider text-[var(--text-muted)] border border-[var(--border-subtle)] rounded px-1 py-px">
                            {t('shell.soon')}
                          </span>
                        )}
                      </span>
                      <span className="block text-[10px] text-[var(--text-muted)] truncate">
                        {t(mod.descriptionKey)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-[var(--border-subtle)] text-[9px] text-[var(--text-muted)] uppercase tracking-wider flex items-center justify-between">
          <span>{t('shell.searchHint')}</span>
          <kbd className="bg-[var(--bg-base)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)]">ESC</kbd>
        </div>
      </div>
    </div>
  );
};
