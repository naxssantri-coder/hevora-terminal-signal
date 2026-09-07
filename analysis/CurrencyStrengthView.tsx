import React, { useMemo } from 'react';
import { Scale } from 'lucide-react';
import { MarketPrice, PairId } from '../../types';
import { currencyStrength } from '../../lib/analytics';
import { aggregateFeedMeta } from '../../lib/dataState';
import { HBarChart } from '../charts';
import { DataQualityBadge, EmptyState, Panel, PanelHeader } from '../ui';
import { InfoTooltip } from '../viz';

// Roadmap §B3: all seven FX pairs this terminal tracks live prices for.
const FX_PAIRS: PairId[] = ['EURUSD', 'GBPUSD', 'USDCHF', 'USDCAD', 'USDJPY', 'AUDUSD', 'NZDUSD'];

/**
 * FX Relative Strength (spec §G) from the 24h change of the covered FX pairs.
 *
 * Scope stays disclosed on the panel: seven USD pairs, so USD is measured against seven
 * counterparts and each counterpart against USD alone - not a full G10 index.
 *
 * Spec §G asks for a 1D | 5D | 20D timeframe toggle "if historical data is available". It is not:
 * this build has no multi-day FX history store anywhere (only the live 24h change on the quote
 * itself), the same gap AnalysisHub.tsx's own header comment already documents for the
 * Correlation window toggle. Per §AG ("never fabricate a control that can't actually change the
 * data"), the toggle is omitted rather than added as a non-functional decoration.
 */
export const CurrencyStrengthView: React.FC<{ prices: Record<PairId, MarketPrice> }> = ({ prices }) => {
  const rows = useMemo(() => currencyStrength(prices, FX_PAIRS), [prices]);

  const data = rows.map((row) => ({
    label: row.currency,
    value: row.score,
    sublabel: `${row.contributors.length} pairs`,
  }));

  return (
    <Panel className="flex flex-col h-full">
      <PanelHeader
        eyebrow="ANALYSIS"
        title="FX RELATIVE STRENGTH"
        icon={<Scale className="w-4 h-4" />}
        actions={
          <div className="flex items-center gap-2">
            <DataQualityBadge
              meta={aggregateFeedMeta('HEVORA Price Feed', FX_PAIRS.map((pair) => prices[pair]), 15_000, 120_000)}
            />
            <InfoTooltip text="Mean 24h contribution across the 7 USD pairs this terminal tracks live - not a full G10 strength index. No multi-day history is stored, so a 1D/5D/20D toggle is left off rather than shown non-functional." />
          </div>
        }
      />

      <div className="mt-4 flex-1 min-h-0 flex flex-col">
        {data.length === 0 ? (
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <EmptyState className="w-full" title="No FX data" detail="Live FX quotes unavailable." />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <HBarChart data={data} diverging unit="%" digits={2} />
          </div>
        )}
      </div>
    </Panel>
  );
};
