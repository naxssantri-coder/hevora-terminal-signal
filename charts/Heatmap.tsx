import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CorrelationCell } from '../../lib/analytics';

/**
 * A cell renders '—' when pearson() returned null (see src/lib/analytics.ts) - too few overlapping
 * bars, or a flat/zero-variance price series. That is a legitimate, deterministic outcome, not a
 * data-pairing bug, but a matrix mixing solid colour and blank dashes reads as broken unless the
 * blank cells look deliberately "no data" rather than accidentally empty - hence the hatch instead
 * of a flat fill.
 */
const NULL_CELL_BG =
  'repeating-linear-gradient(135deg, var(--bg-surface), var(--bg-surface) 3px, var(--border-subtle) 3px, var(--border-subtle) 4px)';

export const Heatmap: React.FC<{
  symbols: string[];
  cells: CorrelationCell[];
  labelFor?: (symbol: string) => string;
  legend?: string;
  scrollHint?: string;
}> = ({ symbols, cells, labelFor, legend, scrollHint }) => {
  const lookup = new Map(cells.map((cell) => [`${cell.a}|${cell.b}`, cell]));
  const cellColor = (value: number | null): string | undefined => {
    if (value === null) return undefined;
    const intensity = Math.min(1, Math.abs(value));
    const base = value >= 0 ? 'var(--color-up)' : 'var(--color-down)';
    return `color-mix(in srgb, ${base} ${Math.round(intensity * 70)}%, transparent)`;
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateFades = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    updateFades();
    window.addEventListener('resize', updateFades);
    return () => window.removeEventListener('resize', updateFades);
  }, [updateFades, symbols.length]);

  return (
    <div>
      <div className="relative">
        <div ref={scrollRef} onScroll={updateFades} className="overflow-auto max-h-[320px]">
          <table className="border-separate border-spacing-0.5 font-mono text-[10px]">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 bg-[var(--bg-panel)] p-1" />
                {symbols.map((symbol) => {
                  const label = labelFor ? labelFor(symbol) : symbol;
                  return (
                    <th
                      key={symbol}
                      title={label}
                      className="sticky top-0 z-10 bg-[var(--bg-panel)] p-1 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap"
                    >
                      {label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {symbols.map((rowSymbol) => {
                const rowLabel = labelFor ? labelFor(rowSymbol) : rowSymbol;
                return (
                  <tr key={rowSymbol}>
                    <th
                      title={rowLabel}
                      className="sticky left-0 z-10 bg-[var(--bg-panel)] p-1 pr-2 text-right text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap"
                    >
                      {rowLabel}
                    </th>
                    {symbols.map((colSymbol) => {
                      const cell = lookup.get(`${rowSymbol}|${colSymbol}`);
                      const value = cell?.value ?? null;
                      return (
                        <td
                          key={colSymbol}
                          className="hev-heatmap-cell w-12 h-9 text-center tabular-nums font-bold rounded-sm border border-[var(--border-subtle)]"
                          style={{ background: value === null ? NULL_CELL_BG : cellColor(value) }}
                          title={
                            value === null
                              ? `${rowSymbol} / ${colSymbol}: not enough overlapping observations`
                              : `${rowSymbol} / ${colSymbol}: ${value.toFixed(2)} over ${cell?.observations ?? 0} bars`
                          }
                        >
                          <span className="text-[var(--text-primary)]">{value === null ? '—' : value.toFixed(2)}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canScrollLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[var(--bg-panel)] to-transparent" />
        )}
        {canScrollRight && (
          <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[var(--bg-panel)] to-transparent" />
        )}
      </div>
      {(legend || (canScrollRight && scrollHint)) && (
        <div className="mt-1.5 space-y-0.5 text-[9px] text-[var(--text-muted)]">
          {legend && <p className="leading-relaxed">{legend}</p>}
          {canScrollRight && scrollHint && <p>{scrollHint}</p>}
        </div>
      )}
    </div>
  );
};
