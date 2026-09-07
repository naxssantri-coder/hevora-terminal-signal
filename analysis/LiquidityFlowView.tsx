import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Droplets, Layers } from 'lucide-react';
import { CotResponse, StablecoinResponse } from '../../types';
import { useEndpoint } from '../../lib/useEndpoint';
import { statusFromAge } from '../../lib/dataState';
import { formatCompact, formatPercent } from '../../lib/format';
import { cotShortLabel } from '../../lib/cotMarkets';
import { Sparkline } from '../charts';
import { Badge, type BadgeTone, DataQualityBadge, Panel, PanelHeader, UnavailableState } from '../ui';
import { AnimatedNumber, InfoTooltip } from '../viz';

const STATUS_THRESHOLD = 1;
const TOP_N = 4;

const supplyStatus = (change30d: number | null): { label: string; tone: 'up' | 'down' | 'neutral' } => {
  if (change30d === null) return { label: '—', tone: 'neutral' };
  if (change30d >= STATUS_THRESHOLD) return { label: 'EXPANDING', tone: 'up' };
  if (change30d <= -STATUS_THRESHOLD) return { label: 'CONTRACTING', tone: 'down' };
  return { label: 'STABLE', tone: 'neutral' };
};

const positioningBand = (percentile: number): { label: string; tone: BadgeTone } => {
  if (percentile >= 90) return { label: 'STRONG', tone: 'up' };
  if (percentile >= 60) return { label: 'BULLISH', tone: 'up' };
  if (percentile <= 10) return { label: 'WEAK', tone: 'down' };
  if (percentile <= 40) return { label: 'BEARISH', tone: 'down' };
  return { label: 'NEUTRAL', tone: 'neutral' };
};

/**
 * Liquidity & Flow (spec §C module 8, merging §N Stablecoin Liquidity + §O Institutional
 * Positioning into ONE card) - previously two separate Panels (StablecoinLiquidityView +
 * InstitutionalFlowView) stacked in the same grid cell via a wrapper div. That worked when every
 * grid cell could grow to its own natural height, but broke once every 3-column grid cell got a
 * uniform fixed height (user feedback): a cell holding two full cards needs roughly double the
 * space of a cell holding one, which is exactly the "why does this column have 2 cards and its
 * neighbour only 1" mismatch that was flagged. Merged into a single Panel with two compact
 * internal sections instead - both endpoints still fetched independently (same as before, no
 * shared-cache pattern anywhere in this codebase), just one card, one header, one fixed height
 * budget shared between both sections rather than each claiming its own.
 */
export const LiquidityFlowView: React.FC<{ onOpen?: (route: string) => void }> = ({ onOpen }) => {
  const stablecoins = useEndpoint<StablecoinResponse>('/api/flow/stablecoins', 30 * 60_000);
  const cot = useEndpoint<CotResponse>('/api/positioning/cot', 60 * 60_000);
  const [expanded, setExpanded] = useState(false);

  const { sparkline, latest, change30d } = useMemo(() => {
    const rows = stablecoins.data?.points ?? [];
    const values = rows.map((p) => p.totalUsd);
    const last = rows[rows.length - 1] ?? null;
    const prior = rows.length > 30 ? rows[rows.length - 31] : rows[0];
    const delta = last && prior && prior.totalUsd ? ((last.totalUsd - prior.totalUsd) / prior.totalUsd) * 100 : null;
    return { sparkline: values, latest: last, change30d: delta };
  }, [stablecoins.data]);
  const status = supplyStatus(change30d);

  const { ranked, thin } = useMemo(() => {
    const positions = Object.values(cot.data?.positions ?? {});
    const withPercentile = positions.filter((p) => p.percentile !== null);
    const sorted = [...withPercentile].sort((a, b) => Math.abs((b.percentile as number) - 50) - Math.abs((a.percentile as number) - 50));
    return {
      ranked: sorted.map((p) => ({ symbol: cotShortLabel(p.symbol), percentile: p.percentile as number })),
      thin: positions.filter((p) => p.percentile === null).length,
    };
  }, [cot.data]);
  const visible = expanded ? ranked : ranked.slice(0, TOP_N);

  return (
    <Panel className="flex flex-col h-full">
      <PanelHeader
        eyebrow="ANALYSIS"
        title="LIQUIDITY & FLOW"
        icon={<Droplets className="w-4 h-4" />}
        actions={<InfoTooltip text="Stablecoin supply (DefiLlama) - a proxy for dry powder in crypto, not a capital-flow measure. Institutional positioning: CFTC Commitment of Traders crowdedness percentile." />}
      />

      <div className="mt-3 flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--text-muted)]">STABLECOIN SUPPLY</span>
            {stablecoins.data?.fetchedAt && (
              <DataQualityBadge
                compact
                meta={{
                  source: stablecoins.data.source,
                  lastUpdated: stablecoins.data.fetchedAt,
                  status: stablecoins.data.stale ? 'STALE' : statusFromAge(stablecoins.data.fetchedAt, 2 * 60 * 60_000, 24 * 60 * 60_000),
                }}
              />
            )}
          </div>

          {stablecoins.data?.unavailable || !latest ? (
            <div className="mt-2 flex items-center justify-center min-h-[64px]">
              <UnavailableState className="w-full" source={stablecoins.data?.source ?? 'DefiLlama'} detail={stablecoins.data?.error} />
            </div>
          ) : (
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <div>
                <AnimatedNumber value={latest.totalUsd} format={(v) => `$${formatCompact(v, 2)}`} className="block text-lg font-black text-[var(--text-primary)]" />
                {change30d !== null && (
                  <span className={`text-[10px] font-bold tabular-nums ${change30d >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                    {formatPercent(change30d, 2, { signed: true })} · 30D
                  </span>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <Sparkline values={sparkline} width={80} height={24} />
                <span
                  className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                    status.tone === 'up'
                      ? 'text-[var(--color-up)] border-[var(--color-up)]/30 bg-[var(--color-up)]/10'
                      : status.tone === 'down'
                        ? 'text-[var(--color-down)] border-[var(--color-down)]/30 bg-[var(--color-down)]/10'
                        : 'text-[var(--text-secondary)] border-[var(--border-subtle)]'
                  }`}
                >
                  {status.label}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-[var(--border-subtle)]">
          <div className="flex items-center justify-between">
            <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--text-muted)]">INSTITUTIONAL POSITIONING</span>
            {cot.data?.fetchedAt && (
              <DataQualityBadge
                compact
                meta={{
                  source: cot.data.source,
                  lastUpdated: cot.data.fetchedAt,
                  status: cot.data.stale ? 'STALE' : statusFromAge(cot.data.fetchedAt, 24 * 60 * 60_000, 10 * 24 * 60 * 60_000),
                }}
              />
            )}
          </div>

          {ranked.length === 0 ? (
            <div className="mt-2 flex items-center justify-center min-h-[64px]">
              <UnavailableState className="w-full" source={cot.data?.source ?? 'CFTC Socrata'} detail={cot.data?.error ?? 'No COT data available.'} />
            </div>
          ) : (
            <>
              <div className="mt-1.5 space-y-1">
                {visible.map((row) => {
                  const band = positioningBand(row.percentile);
                  return (
                    <div key={row.symbol} className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-[var(--text-primary)]">{row.symbol}</span>
                      <span className="flex items-center gap-1.5">
                        <span className="tabular-nums text-[var(--text-secondary)]">{row.percentile}</span>
                        <Badge tone={band.tone}>{band.label}</Badge>
                      </span>
                    </div>
                  );
                })}
              </div>
              {ranked.length > TOP_N && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                >
                  {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {expanded ? 'SHOW LESS' : `VIEW FULL COT (${ranked.length})`}
                </button>
              )}
              {thin > 0 && <p className="mt-1 text-[9px] text-[var(--text-muted)]">{thin} market(s) with a thin sample.</p>}
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onOpen?.('/macro/cot')}
        className="mt-2 pt-2 border-t border-[var(--border-subtle)] shrink-0 flex items-center gap-1.5 text-[9px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <Layers className="w-3 h-3" />
        FULL COT DASHBOARD
      </button>
    </Panel>
  );
};
