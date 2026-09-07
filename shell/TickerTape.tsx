import React, { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { MarketPrice, PairId } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { formatJakartaTime, formatNumber } from '../../lib/format';

/**
 * Persistent ticker tape (§2: horizontal, pinned to the very top on both platforms).
 *
 * Lifted verbatim out of Navbar.tsx so the shell can pin it above the header on every route
 * instead of it living inside one component's markup. Same marquee, same protected click path,
 * same PairId-keyed lookup (a mismatch between this order list and the real PairId values
 * silently drops pairs from the tape - see the note below).
 */

interface TickerTapeProps {
  prices: Record<PairId, MarketPrice>;
  selectedPairId: PairId;
  onSelectPair: (pairId: PairId) => void;
}

// IDs must match real PairId values ('BTCUSDT', not 'BTCUSD').
const TICKER_ORDER: PairId[] = ['XAUUSD', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'EURUSD', 'USDCHF', 'USDCAD', 'GBPUSD'];

export const TickerTape: React.FC<TickerTapeProps> = ({ prices, selectedPairId, onSelectPair }) => {
  const { t } = useTranslation();
  const [wibTime, setWibTime] = useState<string>(() => formatJakartaTime());

  useEffect(() => {
    const interval = setInterval(() => setWibTime(formatJakartaTime()), 1000);
    return () => clearInterval(interval);
  }, []);

  const priceList = (Object.values(prices) as MarketPrice[]).filter(Boolean);
  const orderedList = TICKER_ORDER.map((id) => prices[id]).filter(Boolean);
  const displayPrices = orderedList.length > 0 ? orderedList : priceList;
  const marqueeList = [...displayPrices, ...displayPrices];

  return (
    <div className="bg-[var(--bg-base)] border-b border-[var(--border-subtle)] px-4 py-1 font-mono text-[11px] overflow-hidden relative z-10">
      <div className="flex items-center justify-between gap-4">
        <div
          className="flex items-center gap-2 text-[var(--text-secondary)] shrink-0 select-none bg-[var(--bg-base)] z-10 pr-3 cursor-help"
          // 2026-08-31 audit (price-source clarity): this ticker's prices come from HEVORA's own
          // internal feed (e.g. gold-api.com for XAU), a different provider from the TradingView
          // chart shown elsewhere on the page - a plain title tooltip makes that explicit on hover.
          title={t('market.tickerSourceTooltip')}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-up)] animate-pulse" />
          <span className="font-extrabold text-[var(--text-primary)] text-[10px] tracking-widest uppercase">
            {t('nav.liveFeed')}
          </span>
          <span className="text-[var(--text-muted)] hidden sm:inline">|</span>
        </div>

        <div className="overflow-hidden flex-1 relative flex items-center">
          {marqueeList.length === 0 ? (
            // No fabricated rows while the first /api/signals response is in flight - a shimmer
            // placeholder, then real quotes.
            <div className="flex items-center gap-6">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="hev-skeleton h-3 w-28 rounded" />
              ))}
            </div>
          ) : (
            <div className="animate-marquee flex items-center gap-6 py-0.5">
              {marqueeList.map((item, idx) => {
                const isPositive = item.change24h >= 0;
                const isSelected = item.symbol === selectedPairId;
                return (
                  <button
                    key={`${item.symbol}-${idx}`}
                    onClick={() => onSelectPair(item.symbol)}
                    className={`flex items-center gap-2 px-2.5 py-0.5 rounded transition-colors duration-150 shrink-0 cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-extrabold border border-[var(--border-strong)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span className="font-extrabold tracking-tight text-[var(--text-primary)]">
                      {item.name || item.symbol}
                    </span>
                    <span className="font-mono tabular-nums text-[var(--text-primary)]">
                      {formatNumber(item.price, item.digits)}
                    </span>
                    <span
                      className={`text-[10px] font-bold tabular-nums ${
                        isPositive ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'
                      }`}
                    >
                      {isPositive ? '+' : ''}
                      {item.change24h.toFixed(2)}%
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="hidden lg:flex items-center gap-3 text-[var(--text-muted)] shrink-0 font-mono text-[10px] select-none bg-[var(--bg-base)] z-10 pl-3">
          <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
            <Globe className="w-3 h-3 text-[var(--color-up)]" />
            <span className="tabular-nums font-bold">{wibTime}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
