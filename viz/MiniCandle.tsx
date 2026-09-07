import React from 'react';
import type { Candle } from '../../lib/analytics';

/**
 * Miniature OHLC candlestick strip for an asset tile (spec §Z: "Mini chart must use real candle
 * data, not a decorative graphic"). Sibling to Sparkline.tsx (same size class, same "too few
 * points -> render nothing but an em dash" rule) but plots real open/high/low/close per bar
 * instead of a smoothed close-only line, since a line chart cannot show a bar's range or
 * direction the way a candle can.
 *
 * Source is always the same `/api/market/candles` 30-bar 5m engine store every other Analysis
 * card already reads (CorrelationView, VolatilityView, TechnicalOverviewView) - no new fetch, no
 * new provider.
 */
export const MiniCandle: React.FC<{
  candles: Candle[];
  width?: number;
  height?: number;
}> = ({ candles, width = 120, height = 40 }) => {
  if (candles.length < 2) {
    return <span className="text-[9px] text-[var(--text-muted)] font-mono">—</span>;
  }

  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const span = max - min || 1;
  const inset = height * 0.1;
  const plotH = height - inset * 2;
  const y = (price: number) => inset + plotH - ((price - min) / span) * plotH;

  const step = width / candles.length;
  const bodyWidth = Math.max(1.5, step * 0.6);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="overflow-visible">
      {candles.map((candle, i) => {
        const cx = i * step + step / 2;
        const up = candle.c >= candle.o;
        const color = up ? 'var(--color-up)' : 'var(--color-down)';
        const bodyTop = y(Math.max(candle.o, candle.c));
        const bodyBottom = y(Math.min(candle.o, candle.c));
        const bodyHeight = Math.max(1, bodyBottom - bodyTop);
        return (
          <g key={candle.t} className="hev-event-in">
            <line x1={cx} y1={y(candle.h)} x2={cx} y2={y(candle.l)} stroke={color} strokeWidth={1} opacity={0.85} />
            <rect
              x={cx - bodyWidth / 2}
              y={bodyTop}
              width={bodyWidth}
              height={bodyHeight}
              fill={color}
              opacity={0.9}
              rx={0.5}
            />
          </g>
        );
      })}
    </svg>
  );
};
