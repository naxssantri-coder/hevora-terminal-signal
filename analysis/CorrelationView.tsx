import React, { useMemo, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import { useEndpoint } from '../../lib/useEndpoint';
import { CandlesResponse, CorrelationCell, correlationMatrix, toReturns } from '../../lib/analytics';
import { statusFromAge } from '../../lib/dataState';
import { PAIRS_MAP } from '../../data/pairs';
import type { CrossAssetCorrelationResponse, PairId } from '../../types';
import { Heatmap } from '../charts';
import { Badge, type BadgeTone, DataQualityBadge, EmptyState, ErrorState, LoadingState, Panel, PanelHeader } from '../ui';
import { CorrelationNetwork, InfoTooltip, type NetworkAsset, type NetworkEdgeValue } from '../viz';

const NETWORK_ASSETS: Array<{ id: PairId; label: string; x: number; y: number }> = [
  { id: 'BTCUSDT', label: 'BTC', x: 50, y: 14 },
  { id: 'SOLUSDT', label: 'SOL', x: 14, y: 86 },
  { id: 'ETHUSDT', label: 'ETH', x: 86, y: 86 },
];

/** Spec §J's own example labels - a stated convention over the real |correlation|, the same kind
 *  of fixed cutoff this codebase already uses for RSI overbought/oversold. */
const strengthLabel = (value: number): { label: string; tone: BadgeTone } => {
  const abs = Math.abs(value);
  if (abs >= 0.8) return { label: 'EXTREME', tone: 'warning' };
  if (abs >= 0.5) return { label: 'HIGH', tone: 'info' };
  return { label: 'LOW', tone: 'neutral' };
};

/**
 * Correlation + Correlation Network (specs §J and §K merged into one module - spec §C's page
 * order lists "CORRELATION NETWORK" once, not as two separate modules).
 *
 * Default view is the compact top-correlations list plus the BTC/SOL/ETH network graph; the full
 * pair matrix (still the existing Heatmap component, unchanged) opens behind "OPEN FULL MATRIX"
 * rather than rendering by default - spec §J's own instruction.
 *
 * The network (§K) only renders once BTC/SOL/ETH all have enough candle overlap to compute a real
 * pearson value between every pair - no synthetic edge is ever drawn. Window length stays short by
 * construction (the engine's fixed 30-bar 5m store) and is disclosed via tooltip, not implied to
 * be a daily/weekly read - the same honesty rule this file already documented for AnalysisHub's
 * "no 1H/1D toggle" note.
 *
 * CROSS-ASSET · DAILY (added 2026-08-26): a second, independently-fetched matrix behind its own
 * "OPEN CROSS-ASSET (DAILY)" toggle, covering Gold/DXY/10Y yield change/equity indices/BTC - none
 * of which exist in the engine's candle store above (see server.ts's own comment on
 * /api/analysis/cross-asset-correlation for why). Deliberately never merged into the 5m matrix's
 * numbers: different frequency, different source, and blending them would let a slow daily read
 * masquerade as the same kind of figure as a live 5m one.
 */
export const CorrelationView: React.FC = () => {
  const { data, error, isLoading, reload } = useEndpoint<CandlesResponse>('/api/market/candles', 60_000);
  const [showFullMatrix, setShowFullMatrix] = useState(false);

  // Daily-frequency cross-asset read (Gold/DXY/10Y yield change/equity indices/BTC) - a genuinely
  // different data source and cadence from the 5m engine candle matrix above, so it gets its own
  // fetch, its own toggle and its own labelled section rather than being blended into one number.
  // Server-cached 6h (daily closes don't move faster than that); polled hourly here just in case
  // that cache rolls over mid-session.
  const crossAsset = useEndpoint<CrossAssetCorrelationResponse>('/api/analysis/cross-asset-correlation', 60 * 60_000);
  const [showCrossAsset, setShowCrossAsset] = useState(false);

  const { symbols, cells, observations } = useMemo(() => {
    const candles = data?.candles ?? {};
    const usable = Object.keys(candles).filter((symbol) => (candles[symbol] ?? []).length >= 4);
    const returnsBySymbol: Record<string, number[]> = {};
    for (const symbol of usable) returnsBySymbol[symbol] = toReturns(candles[symbol]);

    const minObs = usable.length ? Math.min(...usable.map((symbol) => returnsBySymbol[symbol].length)) : 0;

    return { symbols: usable, cells: correlationMatrix(returnsBySymbol, usable), observations: minObs };
  }, [data]);

  const topPairs = useMemo(() => {
    const seen = new Map<string, CorrelationCell>();
    for (const cell of cells) {
      if (cell.a >= cell.b || cell.value === null) continue;
      seen.set(`${cell.a}|${cell.b}`, cell);
    }
    return Array.from(seen.values())
      .sort((a, b) => Math.abs(b.value as number) - Math.abs(a.value as number))
      .slice(0, 4);
  }, [cells]);

  const networkReady = NETWORK_ASSETS.every((a) => symbols.includes(a.id));
  const networkEdges: NetworkEdgeValue[] = useMemo(() => {
    if (!networkReady) return [];
    const lookup = new Map(cells.map((c) => [`${c.a}|${c.b}`, c.value]));
    const pairs: Array<[PairId, PairId]> = [
      ['BTCUSDT', 'SOLUSDT'],
      ['BTCUSDT', 'ETHUSDT'],
      ['SOLUSDT', 'ETHUSDT'],
    ];
    return pairs.map(([from, to]) => ({ from, to, value: lookup.get(`${from}|${to}`) ?? lookup.get(`${to}|${from}`) ?? null }));
  }, [cells, networkReady]);

  if (isLoading && !data) return <LoadingState variant="table" />;
  if (error && !data) return <ErrorState title="Correlation unavailable" detail={error} source="/api/market/candles" onRetry={reload} />;

  return (
    <Panel className="flex flex-col h-full">
      <PanelHeader
        eyebrow="ANALYSIS"
        title="CORRELATION NETWORK"
        icon={<Grid3x3 className="w-4 h-4" />}
        actions={
          <div className="flex items-center gap-2">
            <DataQualityBadge
              meta={{
                source: data?.source ?? 'HEVORA Engine Candle Store',
                lastUpdated: data?.newestAt ?? null,
                status: statusFromAge(data?.newestAt, 6 * 60_000, 30 * 60_000),
              }}
            />
            <InfoTooltip
              text={`Pearson correlation over ${observations} overlapping ${data?.interval ?? '5m'} bars - a short window by construction (the engine's own fixed candle store), not a daily/weekly read. EXTREME >=0.8, HIGH >=0.5, LOW below that, by |correlation|.`}
            />
          </div>
        }
      />

      {symbols.length < 2 ? (
        <div className="mt-4 flex-1 min-h-0 flex items-center justify-center">
          <EmptyState className="w-full" title="Collecting correlation history" detail="Not enough overlapping candles yet." />
        </div>
      ) : (
        <div className="mt-4 flex-1 min-h-0 flex flex-col gap-3">
          <div className="shrink-0">
            {networkReady ? (
              <CorrelationNetwork assets={NETWORK_ASSETS as NetworkAsset[]} edges={networkEdges} height={150} />
            ) : (
              <p className="text-[10px] text-[var(--text-muted)]">BTC/SOL/ETH network needs more candle overlap to compute.</p>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
            <div className="space-y-1.5">
              {topPairs.map((cell) => {
                const strength = strengthLabel(cell.value as number);
                return (
                  <div key={`${cell.a}-${cell.b}`} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-[var(--text-secondary)] truncate">
                      {PAIRS_MAP[cell.a as PairId]?.name ?? cell.a} &harr; {PAIRS_MAP[cell.b as PairId]?.name ?? cell.b}
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <span className={`font-bold tabular-nums ${(cell.value as number) >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                        {(cell.value as number).toFixed(2)}
                      </span>
                      <Badge tone={strength.tone}>{strength.label}</Badge>
                    </span>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setShowFullMatrix((v) => !v)}
              className="self-start text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              {showFullMatrix ? 'HIDE FULL MATRIX' : 'OPEN FULL MATRIX'}
            </button>

            {showFullMatrix && (
              <Heatmap
                symbols={symbols}
                cells={cells}
                labelFor={(symbol) => PAIRS_MAP[symbol as PairId]?.name ?? symbol}
                legend="— = not enough overlapping data"
                scrollHint="Scroll to see more pairs"
              />
            )}

            <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowCrossAsset((v) => !v)}
                className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                {showCrossAsset ? 'HIDE CROSS-ASSET (DAILY)' : 'OPEN CROSS-ASSET (DAILY)'}
              </button>
              {showCrossAsset && crossAsset.data?.fetchedAt && (
                <div className="flex items-center gap-1.5">
                  <DataQualityBadge
                    compact
                    meta={{
                      source: crossAsset.data.source,
                      lastUpdated: crossAsset.data.fetchedAt,
                      status: crossAsset.data.stale ? 'STALE' : statusFromAge(crossAsset.data.fetchedAt, 8 * 60 * 60_000, 30 * 60 * 60_000),
                    }}
                  />
                  <InfoTooltip
                    text={`CROSS-ASSET · DAILY - Pearson correlation of DAILY returns (Gold, DXY, equity indices, BTC) or daily CHANGE (10Y yield, not the level), over ${crossAsset.data.observations} common trading days${crossAsset.data.firstDate ? ` (${crossAsset.data.firstDate} to ${crossAsset.data.lastDate})` : ''}. A genuinely different frequency from the 5m matrix above - not the same number, not blended into it. Source: Yahoo Finance daily closes + FRED DGS10.`}
                  />
                </div>
              )}
            </div>

            {showCrossAsset && (
              <>
                {crossAsset.isLoading && !crossAsset.data ? (
                  <p className="text-[10px] text-[var(--text-muted)]">Loading cross-asset history…</p>
                ) : crossAsset.data?.unavailable || (crossAsset.data?.symbols.length ?? 0) < 2 ? (
                  <EmptyState
                    className="w-full"
                    title="Cross-asset correlation unavailable"
                    detail={crossAsset.data?.error ?? 'Not enough daily history overlap yet.'}
                  />
                ) : (
                  <>
                    <Heatmap
                      symbols={crossAsset.data!.symbols}
                      cells={crossAsset.data!.cells}
                      labelFor={(symbol) => crossAsset.data!.labels[symbol] ?? symbol}
                      legend="— = not enough overlapping daily history"
                      scrollHint="Scroll to see more assets"
                    />
                    {crossAsset.data!.unavailableSeries.length > 0 && (
                      <p className="mt-1 text-[9px] text-[var(--text-muted)]">
                        Unavailable this run: {crossAsset.data!.unavailableSeries.map((s) => crossAsset.data!.labels[s] ?? s).join(', ')}
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
};
