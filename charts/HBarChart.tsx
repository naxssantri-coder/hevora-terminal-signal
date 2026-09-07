import React from 'react';
import { formatNumber } from '../../lib/format';

export interface HBarDatum {
  label: string;
  value: number;
  /** Optional override; by default positive is green and negative red. */
  tone?: 'up' | 'down' | 'neutral';
  sublabel?: string;
}

/**
 * Horizontal bar comparison, sorted strongest to weakest (§4). Bars grow once on first render via
 * the shared .hev-bar-grow class - never on every data refresh, which would turn a live panel into
 * a flickering animation.
 */
export const HBarChart: React.FC<{
  data: HBarDatum[];
  /** Renders bars either side of a zero line - correct for signed values like strength scores. */
  diverging?: boolean;
  unit?: string;
  digits?: number;
}> = ({ data, diverging = true, unit = '%', digits = 2 }) => {
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 0.0001);

  return (
    <div className="space-y-1.5 font-mono">
      {data.map((datum) => {
        const width = (Math.abs(datum.value) / max) * (diverging ? 50 : 100);
        const isUp = datum.tone ? datum.tone === 'up' : datum.value >= 0;
        const color = datum.tone === 'neutral' ? 'var(--text-muted)' : isUp ? 'var(--color-up)' : 'var(--color-down)';

        return (
          <div key={datum.label} className="flex items-center gap-2 text-[11px]">
            <span className="w-14 shrink-0 font-bold text-[var(--text-primary)] uppercase">{datum.label}</span>

            <div className="flex-1 relative h-4 bg-[var(--bg-surface)] rounded-sm overflow-hidden">
              {diverging && <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-strong)]" />}
              <span
                className="hev-bar-grow absolute inset-y-0.5 rounded-sm"
                style={{
                  width: `${width}%`,
                  background: `linear-gradient(${
                    diverging ? (datum.value >= 0 ? '90deg' : '270deg') : '90deg'
                  }, color-mix(in srgb, ${color} 55%, transparent), ${color})`,
                  left: diverging ? (datum.value >= 0 ? '50%' : `${50 - width}%`) : 0,
                  transition: 'width 400ms cubic-bezier(0.16, 1, 0.3, 1), left 400ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />
            </div>

            <span className="w-20 shrink-0 text-right tabular-nums font-bold" style={{ color }}>
              {formatNumber(datum.value, digits, { signed: diverging })}
              {unit}
            </span>
            {datum.sublabel && (
              <span className="w-16 shrink-0 text-right text-[9px] text-[var(--text-muted)] hidden sm:inline">
                {datum.sublabel}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
