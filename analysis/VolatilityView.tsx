import React, { useMemo } from 'react';
import { Waves } from 'lucide-react';
import { MarketPrice, PairId } from '../../types';
import { useEndpoint } from '../../lib/useEndpoint';
import { CandlesResponse, volatilityRow } from '../../lib/analytics';
import { statusFromAge } from '../../lib/dataState';
import { shortSymbol } from '../../lib/format';
import { PAIRS_LIST } from '../../data/pairs';
import { useStableCandles } from '../../lib/useStableCandles';
import { DataQualityBadge, ErrorState, LoadingState, Panel, PanelHeader } from '../ui';
import { HeatmapGrid, type HeatRow, InfoTooltip } from '../viz';

/**
 * Realised-volatility ranking, per bar's ATR% of price - nothing here is annualised, same honesty
 * rule the previous table version already followed (a short 5m-bar window scaled up to a yearly
 * figure would turn a small real measurement into a large invented one).
 *
 * Regime bucket thresholds (spec §H "VOLATILITY REGIME: CRYPTO ELEVATED / FX LOW / METALS
 * MODERATE") are a stated convention over the real ATR% numbers, the same kind of fixed cutoff
 * this codebase already uses elsewhere for RSI overbought/oversold (>=70 / <=30 in
 * TechnicalOverviewView) - the underlying ATR% is measured, only the LOW/MODERATE/ELEVATED label
 * boundary is a chosen band, documented here rather than left implicit. Bands differ per asset
 * class because crypto's baseline volatility is naturally an order of magnitude above forex's.
 */
const REGIME_BANDS: Record<string, { moderate: number; elevated: number }> = {
  crypto: { moderate: 2, elevated: 5 },
  commodities: { moderate: 0.8, elevated: 2 },
  forex: { moderate: 0.15, elevated: 0.4 },
};

const CATEGORY_LABEL: Record<string, string> = { crypto: 'CRYPTO', commodities: 'METALS', forex: 'FX' };

const regimeFor = (avgAtrPercent: number | null, category: string): { label: string; tone: 'up' | 'down' | 'neutral' } => {
  if (avgAtrPercent === null) return { label: '—', tone: 'neutral' };
  const band = REGIME_BANDS[category] ?? REGIME_BANDS.forex;
  if (avgAtrPercent >= band.elevated) return { label: 'ELEVATED', tone: 'down' };
  if (avgAtrPercent >= band.moderate) return { label: 'MODERATE', tone: 'neutral' };
  return { label: 'LOW', tone: 'up' };
};

export const VolatilityView: React.FC<{ prices: Record<PairId, MarketPrice> }> = ({ prices }) => {
  const { data, error, isLoading, reload } = useEndpoint<CandlesResponse>('/api/market/candles', 60_000);
  const candles = useStableCandles(data);

  const { rows, regimes } = useMemo(() => {
    const computed = PAIRS_LIST.map((pair) => ({
      pair,
      row: volatilityRow(pair.id, candles[pair.id] ?? [], prices[pair.id]),
    })).filter((r) => r.row.atrPercent !== null);

    const rankedRows: HeatRow[] = computed
      .sort((a, b) => (b.row.atrPercent ?? 0) - (a.row.atrPercent ?? 0))
      .slice(0, 8)
      .map(({ pair, row }) => ({
        id: pair.id,
        label: shortSymbol(pair.name),
        value: row.atrPercent as number,
        color: 'var(--color-warn)',
      }));

    const byCategory: Record<string, number[]> = {};
    for (const { pair, row } of computed) {
      if (row.atrPercent === null) continue;
      (byCategory[pair.category] ??= []).push(row.atrPercent);
    }
    const regimeRows = Object.entries(byCategory).map(([category, values]) => {
      const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      const regime = regimeFor(avg, category);
      return { category, categoryLabel: CATEGORY_LABEL[category] ?? category.toUpperCase(), regimeLabel: regime.label, tone: regime.tone };
    });

    return { rows: rankedRows, regimes: regimeRows };
  }, [candles, prices]);

  if (isLoading && !data) return <LoadingState variant="table" />;
  if (error && !data) {
    return <ErrorState title="Volatility unavailable" detail={error} source="/api/market/candles" onRetry={reload} />;
  }

  return (
    <Panel className="flex flex-col h-full">
      <PanelHeader
        eyebrow="ANALYSIS"
        title="VOLATILITY"
        icon={<Waves className="w-4 h-4" />}
        actions={
          <div className="flex items-center gap-2">
            <DataQualityBadge
              meta={{
                source: data?.source ?? 'HEVORA Engine Candle Store',
                lastUpdated: data?.newestAt ?? null,
                status: statusFromAge(data?.newestAt, 6 * 60_000, 30 * 60_000),
              }}
            />
            <InfoTooltip text={`Average True Range as a percent of price, over the engine's own ${data?.interval ?? '5m'} candle window - never annualised. Ranked highest to lowest, top 8 shown.`} />
          </div>
        }
      />

      {rows.length === 0 ? (
        <div className="mt-4 flex-1 min-h-0 flex items-center justify-center">
          <p className="text-[11px] text-[var(--text-muted)]">Collecting candle history.</p>
        </div>
      ) : (
        <div className="mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
          <HeatmapGrid rows={rows} diverging={false} unit="%" digits={2} />
        </div>
      )}

      {regimes.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] grid grid-cols-3 gap-2">
          {regimes.map((r) => (
            <div key={r.category}>
              <span className="block text-[8px] uppercase tracking-wider text-[var(--text-muted)]">{r.categoryLabel}</span>
              <span
                className={`block text-[11px] font-black uppercase tabular-nums ${
                  r.tone === 'down' ? 'text-[var(--color-down)]' : r.tone === 'up' ? 'text-[var(--color-up)]' : 'text-[var(--color-warn)]'
                }`}
              >
                {r.regimeLabel}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
};
