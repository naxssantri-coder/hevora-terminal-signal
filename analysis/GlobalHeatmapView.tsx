import React, { useMemo, useState } from 'react';
import { LayoutGrid, ArrowDownUp } from 'lucide-react';
import { IndicesResponse, MarketPrice, PairId } from '../../types';
import { aggregateFeedMeta } from '../../lib/dataState';
import { shortSymbol } from '../../lib/format';
import { useEndpoint } from '../../lib/useEndpoint';
import { PAIRS_LIST } from '../../data/pairs';
import { DataQualityBadge, EmptyState, Panel, PanelHeader } from '../ui';
import { HeatmapGrid, type HeatRow, InfoTooltip } from '../viz';
import { IndicesView } from '../market/IndicesView';

const GROUPS: Array<{ id: string; label: string; category: string }> = [
  { id: 'crypto', label: 'CRYPTO', category: 'crypto' },
  { id: 'metals', label: 'METALS', category: 'commodities' },
  { id: 'fx', label: 'FX', category: 'forex' },
];

/**
 * Global Market Heatmap (spec §F, new module - no earlier equivalent existed in this tab).
 *
 * Built entirely from the live `prices` prop every other Analysis card already reads - no new
 * fetch for the CRYPTO/METALS/FX groups. Grouped by the same `category` field PairMetadata
 * already carries, not a fabricated taxonomy. A pair with no live price simply is not in `prices`
 * and is left out of its group rather than rendered as a dash row (spec §AG: never pad a list
 * with placeholders) - PAIRS_LIST is used only to know each pair's category and display name,
 * `prices` decides which rows actually exist.
 *
 * INDICES group (Markets relocation, item 2 of the mobile cleanup): sourced from `/api/indices`,
 * the exact same endpoint IndicesView.tsx already reads - a new fetch here (this codebase's
 * useEndpoint has no shared cache to dedupe through, the same already-established pattern every
 * other Analysis card duplicating a fetch follows), not new data. Index rows are NOT clickable:
 * unlike the other three groups' rows, an index symbol is not a PairId this terminal has an asset
 * detail page for, so wiring onSelectRow to it would open nothing real - the row shows its return
 * and nothing more, same honesty rule as any other value this tab won't fabricate a destination
 * for.
 *
 * "Indices" used to be its own filterable class in Markets (MarketsPage's CLASS_TABS), rendering
 * IndicesView.tsx's full region-grouped table (with per-symbol watchlist stars and error detail).
 * Moved here per the user's chosen relocation option (a compact tile, not the full table by
 * default) - but IndicesView.tsx's own detail is real, working functionality that must not just
 * disappear, so "OPEN FULL INDICES" reveals the exact same IndicesView component inline instead
 * of rebuilding a second, thinner version of it - the same compact-by-default/expand-for-detail
 * pattern CorrelationView's "OPEN FULL MATRIX" and LiquidityFlowView's "VIEW FULL COT" already use
 * elsewhere in this same tab.
 */
export const GlobalHeatmapView: React.FC<{
  prices: Record<PairId, MarketPrice>;
  onOpenAsset: (pairId: PairId) => void;
}> = ({ prices, onOpenAsset }) => {
  const [sortByName, setSortByName] = useState(false);
  const [showFullIndices, setShowFullIndices] = useState(false);
  const indicesFeed = useEndpoint<IndicesResponse>('/api/indices', 60_000);

  const groups = useMemo(() => {
    const priceGroups = GROUPS.map((group) => {
      const rows: HeatRow[] = PAIRS_LIST.filter((pair) => pair.category === group.category)
        .map((pair) => {
          const market = prices[pair.id];
          if (!market || !Number.isFinite(market.change24h)) return null;
          const row: HeatRow = {
            id: pair.id,
            label: shortSymbol(pair.name),
            value: market.change24h,
          };
          return row;
        })
        .filter((row): row is HeatRow => row !== null)
        .sort((a, b) => (sortByName ? a.label.localeCompare(b.label) : b.value - a.value));
      return { ...group, rows, selectable: true };
    });

    const indicesRows: HeatRow[] = (indicesFeed.data?.indices ?? [])
      .filter((quote) => quote.changePercent !== null)
      .map((quote) => ({ id: quote.symbol, label: quote.name, value: quote.changePercent as number }))
      .sort((a, b) => (sortByName ? a.label.localeCompare(b.label) : b.value - a.value));

    return [...priceGroups, { id: 'indices', label: 'INDICES', rows: indicesRows, selectable: false }].filter(
      (group) => group.rows.length > 0
    );
  }, [prices, indicesFeed.data, sortByName]);

  const allQuotes = PAIRS_LIST.map((pair) => prices[pair.id]);

  return (
    <Panel className="flex flex-col h-full">
      <PanelHeader
        eyebrow="ANALYSIS"
        title="GLOBAL MARKET HEATMAP"
        icon={<LayoutGrid className="w-4 h-4" />}
        actions={
          <div className="flex items-center gap-2">
            <DataQualityBadge meta={aggregateFeedMeta('HEVORA Price Feed', allQuotes, 15_000, 120_000)} />
            <button
              type="button"
              onClick={() => setSortByName((v) => !v)}
              title={sortByName ? 'Sorted A-Z - click to sort by 24h change' : 'Sorted by 24h change - click to sort A-Z'}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors cursor-pointer"
            >
              <ArrowDownUp className="w-3 h-3" />
              {sortByName ? 'A-Z' : 'CHG'}
            </button>
            <InfoTooltip text="24h price change across every live-quoted asset this terminal covers, grouped by class. Click a row to open that asset." />
          </div>
        }
      />

      {groups.length === 0 ? (
        <div className="mt-4 flex-1 min-h-0 flex items-center justify-center">
          <EmptyState className="w-full" title="No live price data" detail="Waiting for the price feed." />
        </div>
      ) : (
        <div className="mt-4 flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
          {groups.map((group) => (
            <div key={group.id}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  {group.label}
                </div>
                {group.id === 'indices' && (
                  <button
                    type="button"
                    onClick={() => setShowFullIndices((v) => !v)}
                    className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  >
                    {showFullIndices ? 'HIDE FULL INDICES' : 'OPEN FULL INDICES'}
                  </button>
                )}
              </div>
              <HeatmapGrid
                rows={group.rows}
                diverging
                unit="%"
                digits={2}
                onSelectRow={group.selectable ? (id) => onOpenAsset(id as PairId) : undefined}
              />
              {group.id === 'indices' && showFullIndices && (
                <div className="mt-3">
                  <IndicesView />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
};
