import React from 'react';
import { PairId } from '../types';

interface PairIconProps {
  pairId: PairId;
  size?: number;
  className?: string;
}

// Currency flag emoji, reusing the exact same mapping EconomicCalendarView already uses for the
// same purpose - one flag lookup, not two competing ones.
const CURRENCY_FLAG: Record<string, string> = {
  USD: '🇺🇸',
  EUR: '🇪🇺',
  GBP: '🇬🇧',
  CHF: '🇨🇭',
  CAD: '🇨🇦',
};

/**
 * Small representative mark shown next to a pair's name - crypto get a brand-colored SVG glyph,
 * gold gets a coin glyph, forex pairs get their two currencies' flag emoji. Built as self-
 * contained inline SVG/emoji rather than pulling from a crypto-icon CDN: no icon library is
 * installed in this project (checked package.json) and a hard runtime dependency on a third-
 * party icon host isn't a great fit for a terminal meant to be dependable - these render
 * instantly, offline, and never 404.
 */
export const PairIcon: React.FC<PairIconProps> = ({ pairId, size = 20, className = '' }) => {
  const style = { width: size, height: size };

  switch (pairId) {
    case 'XAUUSD':
      return (
        <svg viewBox="0 0 24 24" style={style} className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#F5B942" stroke="#B8842F" strokeWidth="1" />
          <circle cx="12" cy="12" r="6.5" fill="none" stroke="#B8842F" strokeWidth="1" />
          <text x="12" y="15.5" textAnchor="middle" fontSize="8" fontWeight="900" fill="#7A5A1E" fontFamily="monospace">
            Au
          </text>
        </svg>
      );

    case 'BTCUSDT':
      return (
        <svg viewBox="0 0 24 24" style={style} className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#F7931A" />
          <text x="12" y="16.5" textAnchor="middle" fontSize="13" fontWeight="900" fill="#FFFFFF" fontFamily="sans-serif">
            ₿
          </text>
        </svg>
      );

    case 'ETHUSDT':
      return (
        <svg viewBox="0 0 24 24" style={style} className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#627EEA" />
          <path d="M12 4.5 L12 10.8 L17 13 Z" fill="#FFFFFF" fillOpacity="0.85" />
          <path d="M12 4.5 L7 13 L12 10.8 Z" fill="#FFFFFF" />
          <path d="M12 14.4 L12 19.5 L17 14.1 Z" fill="#FFFFFF" fillOpacity="0.85" />
          <path d="M12 19.5 L12 14.4 L7 14.1 Z" fill="#FFFFFF" />
        </svg>
      );

    case 'SOLUSDT':
      return (
        <svg viewBox="0 0 24 24" style={style} className={className} aria-hidden="true">
          <defs>
            <linearGradient id="solGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#9945FF" />
              <stop offset="100%" stopColor="#14F195" />
            </linearGradient>
          </defs>
          <circle cx="12" cy="12" r="10" fill="url(#solGrad)" />
          <rect x="6.5" y="8" width="11" height="1.8" rx="0.9" fill="#FFFFFF" />
          <rect x="6.5" y="11.1" width="11" height="1.8" rx="0.9" fill="#FFFFFF" />
          <rect x="6.5" y="14.2" width="11" height="1.8" rx="0.9" fill="#FFFFFF" />
        </svg>
      );

    case 'EURUSD':
    case 'USDCHF':
    case 'USDCAD':
    case 'GBPUSD': {
      const base = pairId.slice(0, 3);
      const quote = pairId.slice(3, 6);
      const baseFlag = CURRENCY_FLAG[base] || '🌐';
      const quoteFlag = CURRENCY_FLAG[quote] || '🌐';
      return (
        <span
          className={`inline-flex items-center ${className}`}
          style={{ fontSize: size * 0.62, lineHeight: 1 }}
          aria-hidden="true"
        >
          <span>{baseFlag}</span>
          <span className="-ml-1">{quoteFlag}</span>
        </span>
      );
    }

    default:
      return null;
  }
};
