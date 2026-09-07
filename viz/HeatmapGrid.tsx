import React from 'react';
import { formatNumber } from '../../lib/format';

export interface HeatRow {
  id: string;
  label: string;
  /** Signed magnitude - drives bar length and which side (diverging) it grows from. */
  value: number;
  /** 0-1 colour intensity, independent of `value`'s own scale - e.g. a percentile-derived
   *  "how extreme" read rather than the raw contract count, so one outlier market doesn't wash
   *  out the colour of every other row. Defaults to |value| normalised against the row set's max. */
  heat?: number;
  sublabel?: string;
  rightText?: string;
  /** Overrides the default up/down (green/red) base colour - for magnitude-only data that has no
   *  bullish/bearish meaning (e.g. a volatility range), where green/red would misleadingly imply
   *  direction. Applies to both the bar fill and the value text. */
  color?: string;
  /** Extra content rendered at the end of the row (e.g. a SparklineCell) - kept optional so rows
   *  without a time-series behind them don't reserve dead space. */
  trailing?: React.ReactNode;
}

/**
 * Horizontal heat-bar list (§ Institutional Positioning, Image 8/9 reference): each row's bar
 * length is the real signed magnitude and its colour intensity is a real "how extreme" read -
 * replacing a flat text table with something scannable at a glance, without inventing a value
 * that was not in the underlying row.
 */
export const HeatmapGrid: React.FC<{
  rows: HeatRow[];
  diverging?: boolean;
  unit?: string;
  digits?: number;
  onSelectRow?: (id: string) => void;
}> = ({ rows, diverging = true, unit = '', digits = 0, onSelectRow }) => {
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)), 0.0001);

  return (
    <div className="space-y-1 font-mono">
      {rows.map((row) => {
        const width = (Math.abs(row.value) / maxAbs) * (diverging ? 50 : 100);
        const heat = row.heat ?? Math.abs(row.value) / maxAbs;
        const isUp = row.value >= 0;
        const base = row.color ?? (isUp ? 'var(--color-up)' : 'var(--color-down)');
        const fill = `color-mix(in srgb, ${base} ${Math.round(20 + heat * 60)}%, var(--bg-surface))`;
        const textColor = base;

        const Row = onSelectRow ? 'button' : 'div';

        return (
          <Row
            key={row.id}
            type={onSelectRow ? 'button' : undefined}
            onClick={onSelectRow ? () => onSelectRow(row.id) : undefined}
            className={`w-full flex items-center gap-2 text-[11px] ${onSelectRow ? 'cursor-pointer hover:opacity-90' : ''}`}
          >
            <span className="w-20 shrink-0 text-left font-bold text-[var(--text-primary)] uppercase truncate">
              {row.label}
            </span>

            <div className="flex-1 relative h-5 bg-[var(--bg-surface)] rounded-sm overflow-hidden hev-heatmap-cell">
              {diverging && <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-strong)]" />}
              <span
                className="hev-bar-grow hev-heatmap-cell absolute inset-y-0.5 rounded-sm"
                style={{
                  width: `${width}%`,
                  background: `linear-gradient(${row.value >= 0 ? '90deg' : '270deg'}, color-mix(in srgb, ${fill} 60%, transparent), ${fill})`,
                  left: diverging ? (row.value >= 0 ? '50%' : `${50 - width}%`) : 0,
                  border: `1px solid color-mix(in srgb, ${base} 55%, transparent)`,
                  transition: 'width 400ms cubic-bezier(0.16, 1, 0.3, 1), left 400ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />
            </div>

            <span className="w-20 shrink-0 text-right tabular-nums font-bold" style={{ color: textColor }}>
              {formatNumber(row.value, digits, { signed: diverging })}
              {unit}
            </span>
            {row.rightText && (
              <span className="w-16 shrink-0 text-right text-[9px] text-[var(--text-muted)] hidden sm:inline">
                {row.rightText}
              </span>
            )}
            {row.sublabel && (
              <span className="w-24 shrink-0 text-right text-[9px] text-[var(--text-muted)] hidden lg:inline truncate">
                {row.sublabel}
              </span>
            )}
            {row.trailing && <span className="shrink-0 hidden xl:inline-flex">{row.trailing}</span>}
          </Row>
        );
      })}
    </div>
  );
};
