import React from 'react';

interface ExchangeIconProps {
  exchange: string;
  size?: number;
  className?: string;
}

interface ExchangeStyle {
  bg: string;
  fg: string;
  label: string;
}

/**
 * Per-exchange badge colors - hand-picked to be roughly in each exchange's own brand hue for quick
 * visual scanning, not sourced from any logo/CDN asset (this project deliberately has no icon-CDN
 * dependency, see PairIcon.tsx's own comment). Covers every `ExchangeRankingRow['exchange']`
 * value plus Binance (excluded from live rows today - see ExchangeRankingTable's comment - but
 * kept here so the icon exists if that ever changes).
 */
const EXCHANGE_STYLES: Record<string, ExchangeStyle> = {
  Binance: { bg: '#F0B90B', fg: '#1A1500', label: 'B' },
  OKX: { bg: '#000000', fg: '#FFFFFF', label: 'OKX' },
  Bybit: { bg: '#F7A600', fg: '#1A1200', label: 'B' },
  KuCoin: { bg: '#24AE8F', fg: '#FFFFFF', label: 'K' },
  'Gate.io': { bg: '#1E90FF', fg: '#FFFFFF', label: 'G' },
  Bitget: { bg: '#00F0B5', fg: '#04231C', label: 'BG' },
  Kraken: { bg: '#5741D9', fg: '#FFFFFF', label: 'K' },
  Coinbase: { bg: '#0052FF', fg: '#FFFFFF', label: 'C' },
  MEXC: { bg: '#262B33', fg: '#FFFFFF', label: 'MX' },
  Bitstamp: { bg: '#262B33', fg: '#FFFFFF', label: 'BS' },
  Gemini: { bg: '#262B33', fg: '#FFFFFF', label: 'GI' },
  'Crypto.com': { bg: '#262B33', fg: '#FFFFFF', label: 'CDC' },
  Deribit: { bg: '#0B1739', fg: '#FFFFFF', label: 'D' },
  BitMEX: { bg: '#E4002B', fg: '#FFFFFF', label: 'BM' },
  dYdX: { bg: '#6966FF', fg: '#FFFFFF', label: 'DY' },
  Hyperliquid: { bg: '#0DDB8C', fg: '#04231C', label: 'HL' },
  Upbit: { bg: '#093687', fg: '#FFFFFF', label: 'UP' },
  WhiteBIT: { bg: '#1F3AB3', fg: '#FFFFFF', label: 'WB' },
  CoinEx: { bg: '#1BC47D', fg: '#04231C', label: 'CE' },
  LBank: { bg: '#F2A900', fg: '#241A00', label: 'LB' },
  BingX: { bg: '#2762F2', fg: '#FFFFFF', label: 'BX' },
  HTX: { bg: '#1652F0', fg: '#FFFFFF', label: 'HTX' },
};

// Fixed viewBox coordinate-space font sizes (not real pixels - `size` only scales the whole glyph
// via the svg's width/height, same technique PairIcon.tsx uses), keyed by label length so "OKX"/
// "HTX" (3 chars) shrink enough to stay inside the badge while "B"/"K" (1 char) stay legible.
const FONT_SIZE_BY_LEN: Record<number, number> = { 1: 12, 2: 9.5 };

/**
 * Small rounded-square exchange badge (Institutional Watchlist detail page, visual redesign §3.2)
 * - used in ExchangeRankingTable's Exchange column and inside large-enough ExchangeVolumeHeatmap
 * blocks, matching the CoinGlass reference's "logo before exchange name" convention. Never returns
 * null for an unrecognized exchange (a future addition to ExchangeRankingRow's exchange union) -
 * falls back to a neutral badge with that exchange's own first 1-2 letters, so a table row never
 * loses its icon column and shifts layout.
 */
export const ExchangeIcon: React.FC<ExchangeIconProps> = ({ exchange, size = 18, className = '' }) => {
  const style = EXCHANGE_STYLES[exchange];
  const bg = style?.bg ?? 'var(--bg-surface)';
  const fg = style?.fg ?? 'var(--text-muted)';
  const label = style?.label ?? (exchange.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?');
  const fontSize = FONT_SIZE_BY_LEN[label.length] ?? 7.5;

  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={`shrink-0 ${className}`} aria-hidden="true">
      <rect
        x="1"
        y="1"
        width="22"
        height="22"
        rx="7"
        fill={bg}
        stroke={style ? 'rgba(255,255,255,0.14)' : 'var(--border-subtle)'}
        strokeWidth="1"
      />
      <text x="12" y="12.5" dominantBaseline="middle" textAnchor="middle" fontSize={fontSize} fontWeight="900" fill={fg} fontFamily="monospace">
        {label}
      </text>
    </svg>
  );
};
