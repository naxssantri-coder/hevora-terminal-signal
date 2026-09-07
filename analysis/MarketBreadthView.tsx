import React, { useMemo } from 'react';
import { BarChart2 } from 'lucide-react';
import { MarketPrice, PairId } from '../../types';
import { breadthOf } from '../../lib/analytics';
import { aggregateFeedMeta } from '../../lib/dataState';
import { formatPercent } from '../../lib/format';
import { PAIRS_LIST } from '../../data/pairs';
import { DivergingBar } from '../charts';
import { DataQualityBadge, EmptyState, Panel, PanelHeader } from '../ui';
import { InfoTooltip } from '../viz';

/**
 * Market Breadth (spec §I) as its own module - AA's desktop grid gives it a dedicated cell
 * separate from Technical Setup Overview. Same `breadthOf()` computation TechnicalOverviewView's
 * summary row already uses (Roadmap's own advance/decline read over PAIRS_LIST's 24h change), not
 * a second breadth definition - this view is a presentation split, not a new metric.
 */
export const MarketBreadthView: React.FC<{ prices: Record<PairId, MarketPrice> }> = ({ prices }) => {
  const breadth = useMemo(() => breadthOf(PAIRS_LIST.map((pair) => prices[pair.id]?.change24h ?? null)), [prices]);

  return (
    <Panel className="flex flex-col h-full">
      <PanelHeader
        eyebrow="ANALYSIS"
        title="MARKET BREADTH"
        icon={<BarChart2 className="w-4 h-4" />}
        actions={
          <div className="flex items-center gap-2">
            <DataQualityBadge
              meta={aggregateFeedMeta('HEVORA Price Feed', PAIRS_LIST.map((pair) => prices[pair.id]), 15_000, 120_000)}
            />
            <InfoTooltip text={`Advance/decline across the ${PAIRS_LIST.length} assets this terminal covers live - not a market-wide breadth index.`} />
          </div>
        }
      />

      {breadth.total === 0 ? (
        <div className="mt-4 flex-1 min-h-0 flex items-center justify-center">
          <EmptyState className="w-full" title="Breadth unavailable" detail="No live 24h change data yet." />
        </div>
      ) : (
        <div className="mt-4 flex-1 min-h-0 flex flex-col justify-center gap-4">
          <DivergingBar
            label="ADV / DEC"
            leftValue={breadth.declining}
            rightValue={breadth.advancing}
            leftLabel="DECLINING"
            rightLabel="ADVANCING"
            digits={0}
          />
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <div>
              <span className="block text-[8px] uppercase tracking-wider text-[var(--text-muted)]">Advancing</span>
              <span className="block text-lg font-black tabular-nums text-[var(--color-up)]">{breadth.advancing}</span>
            </div>
            <div>
              <span className="block text-[8px] uppercase tracking-wider text-[var(--text-muted)]">Declining</span>
              <span className="block text-lg font-black tabular-nums text-[var(--color-down)]">{breadth.declining}</span>
            </div>
            <div>
              <span className="block text-[8px] uppercase tracking-wider text-[var(--text-muted)]">Net</span>
              <span
                className={`block text-lg font-black tabular-nums ${
                  (breadth.netPercent ?? 0) >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'
                }`}
              >
                {breadth.netPercent === null ? '—' : formatPercent(breadth.netPercent, 0, { signed: true })}
              </span>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
};
