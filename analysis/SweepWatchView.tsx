import React, { useMemo } from 'react';
import { Waves } from 'lucide-react';
import { PairId, Signal } from '../../types';
import { isActiveSignal } from '../../lib/signals';
import { Panel, PanelHeader } from '../ui';
import { InfoTooltip } from '../viz';

const STRUCTURE_FLAGS: Array<{ key: keyof NonNullable<Signal['structureBreakdown']>; short: string }> = [
  { key: 'liquiditySweep', short: 'SWEEP' },
  { key: 'mss', short: 'MSS' },
  { key: 'bos', short: 'BOS' },
  { key: 'fvg', short: 'FVG' },
  { key: 'orderBlock', short: 'OB' },
  { key: 'supplyDemand', short: 'S/D' },
];

/**
 * Liquidity Sweep Watch (spec §R) - split into BUY/SELL groups with a compact dot-separated flag
 * string instead of a badge pill per flag, per spec's own mockup. Same underlying data as before
 * (Signal['structureBreakdown'], straight off the signal engine, never a fabricated tick feed).
 */
export const SweepWatchView: React.FC<{
  signals?: Record<PairId, Signal | null>;
  onOpenAsset?: (pairId: PairId) => void;
}> = ({ signals = {} as Record<PairId, Signal | null>, onOpenAsset }) => {
  const { buy, sell } = useMemo(() => {
    const active = (Object.values(signals) as (Signal | null)[]).filter(
      (s): s is Signal => Boolean(s) && isActiveSignal(s as Signal) && Boolean((s as Signal).structureBreakdown)
    );
    const rows = active
      .map((s) => ({ signal: s, flags: STRUCTURE_FLAGS.filter((f) => s.structureBreakdown?.[f.key]) }))
      .filter((row) => row.flags.length > 0)
      .sort((a, b) => b.flags.length - a.flags.length);
    return { buy: rows.filter((r) => r.signal.type === 'BUY'), sell: rows.filter((r) => r.signal.type === 'SELL') };
  }, [signals]);

  const groups: Array<{ label: string; tone: string; rows: typeof buy }> = [
    { label: 'BUY', tone: 'var(--color-up)', rows: buy },
    { label: 'SELL', tone: 'var(--color-down)', rows: sell },
  ];

  return (
    <Panel className="flex flex-col">
      <PanelHeader
        eyebrow="ANALYSIS"
        title="LIQUIDITY SWEEP WATCH"
        icon={<Waves className="w-4 h-4" />}
        actions={<InfoTooltip text="Structure flags straight off the signal engine's own output - never a fabricated tick feed. Click an asset for its full structure." />}
      />

      {buy.length === 0 && sell.length === 0 ? (
        <p className="mt-4 text-[11px] text-[var(--text-muted)]">No flagged structure right now.</p>
      ) : (
        <div className="mt-4 max-h-[280px] overflow-y-auto pr-1 space-y-3">
          {groups.map(
            (group) =>
              group.rows.length > 0 && (
                <div key={group.label}>
                  <div className="text-[9px] font-bold uppercase tracking-[0.18em] mb-1.5" style={{ color: group.tone }}>
                    {group.label}
                  </div>
                  <div className="space-y-1">
                    {group.rows.map(({ signal, flags }) => (
                      <button
                        key={signal.id}
                        type="button"
                        onClick={() => onOpenAsset?.(signal.pairId)}
                        className="hev-event-in w-full flex items-center justify-between gap-3 py-1 text-left hover:opacity-80 transition-opacity cursor-pointer"
                      >
                        <span className="text-[11px] font-bold text-[var(--text-primary)] truncate">{signal.pairName}</span>
                        <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider shrink-0">
                          {flags.map((f) => f.short).join(' · ')}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
          )}
        </div>
      )}
    </Panel>
  );
};
