import React, { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { AssetCategory, EconomicEvent, MarketPrice, PairId, ScanStatus, Signal } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { MarketView } from '../MarketView';

type MarketClass = AssetCategory | 'all';

/**
 * Markets page (Fase 10 §2, extended Nav Consolidation Fase 4a): what used to be five separate
 * nav entries - Market Overview, Forex, Commodities, Crypto and Indices - is one page now, with
 * the asset-class filter as an in-page segmented control instead of five routes. The filter is
 * mirrored into the URL (?class=) by the caller via `onClassChange` so a specific class is still
 * deep-linkable and survives a reload.
 *
 * Live Signals was never really a second thing; it is the per-asset entry/stop/target card
 * MarketView already renders under the chart for whichever pair is selected.
 *
 * Scalping Radar's drill-in button (Fase 10 §2 - every covered pair at once, ranked by proximity
 * to entry) is removed as of the mobile pill-row cleanup: on a 390px viewport it was a fourth
 * chip stacked on top of an already dense page-tab/class-filter/pair-switcher stack, and it was
 * an occasional drill-in feature, not core Markets navigation. ScalpingRadarView itself is
 * untouched and still exists (`components/signals/ScalpingRadarView.tsx`) in case this entry
 * point returns elsewhere; it is simply not reachable from this page anymore.
 *
 * 'indices' is no longer one of the classes here either (same mobile cleanup, item 2): global
 * equity indices are not signal-engine pairs and had no filter/pair-select behaviour in common
 * with the other four classes, so they now live in Analysis > Global Market Heatmap as their own
 * card instead (a compact tile by default, "OPEN FULL INDICES" reveals the exact same
 * IndicesView.tsx table this page used to render directly - nothing about that component changed,
 * only where it is reached from). App.tsx's VALID_MARKET_CLASSES no longer whitelists 'indices'
 * either, so an old ?class=indices deep link falls back to 'all' instead of a dead filter chip.
 *
 * The Commodities futures board (Oil Intelligence, the full futures table, the Market State
 * confluence read) is item 3 of the same cleanup: it moved to its own Macro hub, Commodities
 * Intelligence (/macro/commodities), sibling to Gold Intelligence - the same reasoning as
 * indices, plus its confluence read runs the same engine XAU/BTC/Forex already use elsewhere in
 * this app, which belongs with the rest of that intelligence rather than under a pair-trading
 * page. XAU/USD - the only commodities-category signal pair - is unaffected and still renders via
 * MarketView below exactly as before; only the futures board underneath it moved, replaced by a
 * one-line link to its new home.
 */
export const MarketsPage: React.FC<{
  prices: Record<PairId, MarketPrice>;
  signals: Record<PairId, Signal | null>;
  scanStatus: Partial<Record<PairId, ScanStatus>>;
  selectedPairId: PairId;
  onSelectPair: (pairId: PairId) => void;
  signalsBlurred: boolean;
  initialCategory: MarketClass;
  calendarEvents: EconomicEvent[];
  onNavigate: (route: string) => void;
  /** Mirrors an asset-class filter change into the URL (?class=) - omit to leave the URL as-is. */
  onClassChange?: (category: MarketClass) => void;
}> = ({
  prices,
  signals,
  scanStatus,
  selectedPairId,
  onSelectPair,
  signalsBlurred,
  initialCategory,
  calendarEvents,
  onNavigate,
  onClassChange,
}) => {
  const { t } = useTranslation();
  const [assetClass, setAssetClass] = useState<MarketClass>(initialCategory);

  // A deep link (?class=...) landing on an already-mounted page still applies - same pattern
  // MarketView itself already uses for its own initialCategory sync.
  useEffect(() => {
    setAssetClass(initialCategory);
  }, [initialCategory]);

  const changeClass = (cls: MarketClass) => {
    setAssetClass(cls);
    onClassChange?.(cls);
  };

  const CLASS_TABS: Array<{ id: MarketClass; labelKey: string }> = [
    { id: 'all', labelKey: 'market.classAll' },
    { id: 'forex', labelKey: 'market.classForex' },
    { id: 'commodities', labelKey: 'market.classCommodities' },
    { id: 'crypto', labelKey: 'market.classCrypto' },
  ];

  return (
    // 2026-09-02 (Pasar page visual polish, round 2): space-y-4 - MarketView's own internal
    // rhythm below is space-y-5 now (tightened from space-y-8 the same pass, see its own comment -
    // "kotak-kotak terpisah, gak menyatu" feedback), so this stays one notch under it rather than
    // matching exactly (a page-level filter row and an in-module section gap are still different
    // things), close enough that the seam between them doesn't read as a bigger jump than anything
    // inside MarketView itself.
    <div className="space-y-4">
      <div className="flex items-center gap-1 p-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-full shadow-sm w-fit overflow-x-auto no-scrollbar">
        {CLASS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => changeClass(tab.id)}
            aria-current={assetClass === tab.id ? 'page' : undefined}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-mono font-bold transition-colors duration-150 cursor-pointer ${
              assetClass === tab.id
                ? 'bg-[var(--text-primary)] text-[var(--bg-base)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <MarketView
          prices={prices}
          signals={signals}
          scanStatus={scanStatus}
          selectedPairId={selectedPairId}
          onSelectPair={onSelectPair}
          signalsBlurred={signalsBlurred}
          initialCategory={assetClass}
          calendarEvents={calendarEvents}
          onNavigate={onNavigate}
        />
        {/* The wider commodity complex (Oil Intelligence, the futures board, the Market State
            confluence read) lives at Commodities Intelligence now - see this file's header
            comment. This link is the only trace of it left here. */}
        {assetClass === 'commodities' && (
          <button
            type="button"
            onClick={() => onNavigate('/macro/commodities')}
            className="w-full flex items-center gap-1.5 px-4 py-2.5 rounded-[12px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors cursor-pointer"
          >
            <Flame className="w-3 h-3" />
            {t('market.viewCommoditiesIntelligence')}
          </button>
        )}
      </div>
    </div>
  );
};
