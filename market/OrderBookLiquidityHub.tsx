import React, { useState } from 'react';
import { Layers } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext';
import { Panel, PanelHeader, UnavailableState } from '../ui';
import { OrderBookDepthPanel, type OrderBookSymbol } from './BtcUsdtOrderBookView';
import { LiquidityMapView } from './LiquidityMapView';
import { CryptoDerivativesView } from './CryptoDerivativesView';

/**
 * Markets Hub 2b - "Order Book & Liquidity" (Nav Consolidation Fase 4b).
 *
 * Merges BTC-USDT Depth, ETH-USDT Depth and Liquidity Map into one screen with a symbol switcher,
 * DOM on the left and the liquidity map beside it (Image 1 reference: "ORDER BOOK (DOM)" next to
 * "LIQUIDATION MAP" in one viewport). The order book itself works for both symbols - it is the
 * same relay pattern extended pair by pair. The liquidity map does NOT: only
 * GET /api/market/liquidity-map/btcusdt exists server-side (its own header comment audits exactly
 * why - BTC-USDT's order book was the only one proven live long enough to build structural
 * swing/FVG detection on top of). Switching to ETH-USDT says so honestly instead of showing a
 * blank panel or borrowing BTC's zones.
 */
export const OrderBookLiquidityHub: React.FC = () => {
  const { t } = useTranslation();
  const [symbol, setSymbol] = useState<OrderBookSymbol>('BTC-USDT');

  return (
    <div className="space-y-4 font-mono">
      <Panel flush className="p-4 sm:p-5">
        <PanelHeader
          eyebrow={t('category.market')}
          title={t('orderBookHub.title')}
          subtitle={t('orderBookHub.subtitle')}
          icon={<Layers className="w-4 h-4" />}
        />
        <div className="mt-4 flex items-center gap-1 p-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-full shadow-sm w-fit">
          {(Object.keys({ 'BTC-USDT': 0, 'ETH-USDT': 0 }) as OrderBookSymbol[]).map((sym) => (
            <button
              key={sym}
              type="button"
              onClick={() => setSymbol(sym)}
              aria-current={symbol === sym ? 'page' : undefined}
              className={`px-3.5 py-1.5 rounded-full text-xs font-mono font-bold transition-colors duration-150 cursor-pointer ${
                symbol === sym
                  ? 'bg-[var(--text-primary)] text-[var(--bg-base)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {sym}
            </button>
          ))}
        </div>
      </Panel>

      {symbol === 'BTC-USDT' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <OrderBookDepthPanel symbol={symbol} />
          <LiquidityMapView />
        </div>
      ) : (
        // ETH-USDT has no liquidity map (only BTC-USDT's structural zones are wired) - the
        // equal-width grid column above used to give that "not available" note the exact same
        // column width as the fully-populated Order Book Depth panel beside it, which read as
        // lopsided (layout audit). Stacking instead lets Order Book Depth take the full width it
        // actually has data for, with the compact unavailable note below it rather than a
        // half-empty second column.
        <div className="space-y-4">
          <OrderBookDepthPanel symbol={symbol} />
          <Panel>
            <PanelHeader title={t('module.liquidityMap')} subtitle={t('liquidityMap.subtitle')} />
            <div className="mt-4">
              <UnavailableState source="HEVORA" detail={t('orderBookHub.liquidityMapBtcOnly')} />
            </div>
          </Panel>
        </div>
      )}

      {/* Funding / Open Interest / Long-Short Ratio (Roadmap §A1) - same "order flow" family as
          the depth book above, same symbol switcher, so it lives here rather than a new tab. */}
      <CryptoDerivativesView symbol={symbol} />
    </div>
  );
};
