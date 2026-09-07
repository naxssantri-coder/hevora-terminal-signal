import React, { useMemo } from 'react';
import { Boxes } from 'lucide-react';
import { MarketPrice, PairId, Signal } from '../../types';
import { useEndpoint } from '../../lib/useEndpoint';
import { breadthOf, CandlesResponse, rsi } from '../../lib/analytics';
import { aggregateFeedMeta } from '../../lib/dataState';
import { formatNumber, formatPercent, shortSymbol } from '../../lib/format';
import { isActiveSignal } from '../../lib/signals';
import { PAIRS_LIST, PAIRS_MAP } from '../../data/pairs';
import { useStableCandles } from '../../lib/useStableCandles';
import { Badge, DataQualityBadge, EmptyState, LoadingState, Panel, PanelHeader } from '../ui';
import { HeatmapGrid, type HeatRow, InfoTooltip, MiniCandle } from '../viz';

/**
 * Setup Quality grading (spec §Q) - a deterministic, auditable rule, not a subjective/AI score.
 *
 * Counts how many of the signal engine's own 6 structure flags (structureBreakdown - the exact
 * same field SweepWatchView reads for its BUY/SELL flag strings) are true for a given active
 * signal, then buckets by count:
 *   4-6 flags -> A+   |   3 flags -> A   |   2 flags -> B   |   0-1 flags -> NO VALID SETUP
 *
 * This mapping is fixed and printed here so it is checkable against the raw flags, never a black
 * box. Only assets with an ACTIVE signal are graded - an asset with no active signal has nothing
 * to grade and is not counted in any bucket (including NO VALID SETUP).
 */
const STRUCTURE_FLAG_KEYS: Array<keyof NonNullable<Signal['structureBreakdown']>> = [
  'mss',
  'bos',
  'fvg',
  'liquiditySweep',
  'orderBlock',
  'supplyDemand',
];

type SetupGrade = 'A+' | 'A' | 'B' | 'NO VALID SETUP';

const gradeForFlagCount = (count: number): SetupGrade => (count >= 4 ? 'A+' : count === 3 ? 'A' : count === 2 ? 'B' : 'NO VALID SETUP');

const GRADE_ORDER: SetupGrade[] = ['A+', 'A', 'B', 'NO VALID SETUP'];

/** Spec §Z hero tiles - real OHLC mini-candles, not decoration. Fixed to the app's three most
 *  closely-watched assets rather than every pair, matching the spec's own example (BTC/XAU/SOL). */
const HERO_ASSETS: PairId[] = ['BTCUSDT', 'XAUUSD', 'SOLUSDT'];
const TOP_MOMENTUM_N = 6;

export const TechnicalOverviewView: React.FC<{
  prices: Record<PairId, MarketPrice>;
  signals: Record<PairId, Signal | null>;
  onOpenAsset: (pairId: PairId) => void;
}> = ({ prices, signals, onOpenAsset }) => {
  const { data, isLoading } = useEndpoint<CandlesResponse>('/api/market/candles', 60_000);
  const candles = useStableCandles(data);

  const { breadth, momentum, gradeCounts } = useMemo(() => {
    const changes = PAIRS_LIST.map((pair) => prices[pair.id]?.change24h ?? null);

    const rows = PAIRS_LIST.map((pair) => {
      const series = candles[pair.id] ?? [];
      const change24h = prices[pair.id]?.change24h ?? null;
      const rawSignal = signals[pair.id];
      const activeSignal = rawSignal && isActiveSignal(rawSignal) ? rawSignal : null;
      const flagCount = activeSignal?.structureBreakdown
        ? STRUCTURE_FLAG_KEYS.filter((key) => activeSignal.structureBreakdown?.[key]).length
        : 0;
      return {
        pair,
        change24h,
        rsiValue: rsi(series),
        signal: activeSignal,
        grade: activeSignal?.structureBreakdown ? gradeForFlagCount(flagCount) : null,
      };
    }).sort((a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity));

    const counts: Record<SetupGrade, number> = { 'A+': 0, A: 0, B: 0, 'NO VALID SETUP': 0 };
    for (const row of rows) if (row.grade) counts[row.grade] += 1;

    return { breadth: breadthOf(changes), momentum: rows.slice(0, TOP_MOMENTUM_N), gradeCounts: counts };
  }, [candles, prices, signals]);

  if (isLoading && !data) return <LoadingState variant="table" />;

  const gradeRows: HeatRow[] = GRADE_ORDER.map((grade) => ({
    id: grade,
    label: grade,
    value: gradeCounts[grade],
    color: grade === 'A+' ? 'var(--color-up)' : grade === 'A' ? 'var(--color-up)' : grade === 'B' ? 'var(--color-warn)' : 'var(--text-muted)',
  }));
  const totalGraded = GRADE_ORDER.reduce((sum, g) => sum + gradeCounts[g], 0);

  return (
    <Panel flush className="flex flex-col font-mono">
      <div className="p-4 sm:p-5">
        <PanelHeader
          eyebrow="ANALYSIS"
          title="TECHNICAL SETUP OVERVIEW"
          icon={<Boxes className="w-4 h-4" />}
          actions={
            <div className="flex items-center gap-2">
              <DataQualityBadge
                meta={aggregateFeedMeta('HEVORA Price Feed', PAIRS_LIST.map((pair) => prices[pair.id]), 15_000, 120_000)}
              />
              <InfoTooltip text="Breadth: advance/decline over this terminal's own asset universe. Momentum: RSI over the engine's candle window. Setup Quality: count of the signal engine's own structure flags (MSS/BOS/FVG/Sweep/OB/S&D) on each active signal - 4-6 flags = A+, 3 = A, 2 = B, 0-1 = No Valid Setup." />
            </div>
          }
        />

        {breadth.total > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-2">
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
              <span className={`block text-lg font-black tabular-nums ${(breadth.netPercent ?? 0) >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                {breadth.netPercent === null ? '—' : formatPercent(breadth.netPercent, 0, { signed: true })}
              </span>
            </div>
          </div>
        )}
      </div>

      {breadth.total === 0 ? (
        <div className="px-4 sm:px-5 pb-4">
          <EmptyState title="No breadth data" detail="Live 24h change data unavailable." />
        </div>
      ) : (
        <>
          {/* Spec §Z - real OHLC mini-candle tiles for the three most-watched assets. */}
          <div className="px-4 sm:px-5 pb-3 grid grid-cols-3 gap-2">
            {HERO_ASSETS.map((id) => {
              const market = prices[id];
              const pair = PAIRS_MAP[id];
              return (
                <div key={id} className="hev-card-v2 !p-2.5 flex flex-col gap-1">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{pair && shortSymbol(pair.name)}</span>
                  <span className="text-xs font-black tabular-nums text-[var(--text-primary)]">
                    {market ? formatNumber(market.price, pair?.digits ?? 2) : '—'}
                  </span>
                  <span className={`text-[10px] font-bold tabular-nums ${(market?.change24h ?? 0) >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                    {market ? formatPercent(market.change24h, 2, { signed: true }) : '—'}
                  </span>
                  <MiniCandle candles={candles[id] ?? []} width={100} height={32} />
                </div>
              );
            })}
          </div>

          <div className="px-4 sm:px-5 pb-3 pt-2 border-t border-[var(--border-subtle)]">
            <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">TOP TECHNICAL MOMENTUM</div>
            <div className="space-y-1.5">
              {momentum.map((row) => (
                <button
                  key={row.pair.id}
                  type="button"
                  onClick={() => onOpenAsset(row.pair.id)}
                  className="w-full flex items-center justify-between gap-2 text-[11px] hover:bg-[var(--card-hover-bg)] rounded px-1 py-1 -mx-1 transition-colors cursor-pointer text-left"
                >
                  <span className="font-bold text-[var(--text-primary)] w-20 truncate">{shortSymbol(row.pair.name)}</span>
                  <span className={`w-16 text-right tabular-nums font-bold ${(row.change24h ?? 0) >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                    {row.change24h === null ? '—' : formatPercent(row.change24h, 2, { signed: true })}
                  </span>
                  <span className="w-16 text-right tabular-nums text-[var(--text-secondary)]">
                    {row.rsiValue === null ? '—' : `RSI ${formatNumber(row.rsiValue, 1)}`}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {row.signal ? <Badge tone={row.signal.type === 'BUY' ? 'up' : 'down'}>{row.signal.type}</Badge> : <Badge tone="neutral">SCANNING</Badge>}
                    {row.grade && <Badge tone={row.grade === 'NO VALID SETUP' ? 'neutral' : 'info'}>{row.grade}</Badge>}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {totalGraded > 0 && (
            <div className="px-4 sm:px-5 pb-4 pt-2 border-t border-[var(--border-subtle)]">
              <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">SETUP QUALITY</div>
              <HeatmapGrid rows={gradeRows} diverging={false} unit="" digits={0} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
};
