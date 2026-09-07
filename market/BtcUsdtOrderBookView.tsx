import React, { useEffect, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import { OrderBookSnapshot } from '../../types';
import { DataStatus } from '../../lib/dataState';
import { useTranslation } from '../../i18n/LanguageContext';
import { useOrderBookStream } from '../../lib/useOrderBookStream';
import { DataQualityBadge, LoadingState, Panel, PanelHeader, UnavailableState } from '../ui';
import { AnimatedNumber } from '../viz';

/**
 * Order book depth panel (blueprint §7). BTC-USDT was the pilot - see
 * docs/AUDIT-VOLUME-PROFILE-ORDERBOOK.md for why it was scoped to one pair, one exchange as
 * primary: order book data changes too fast for this app's usual 1s REST-poll pattern, so this
 * was the first panel in the project driven by a real push stream (server.ts's OKX WebSocket
 * relay -> SSE to the browser) instead of useEndpoint. ETH-USDT (below) reuses this exact
 * component with the pilot proven stable, per the project's one-pair-at-a-time extension pattern
 * (server.ts's createOrderBookRelay factory is the matching backend generalization). Deliberately
 * NOT a liquidity heatmap, imbalance meter, or large-order detector on its own - those sit on top
 * of this foundation (see the Liquidity Map module, which composes this same book data).
 */

const SOURCE_LABEL: Record<'OKX' | 'Bybit', string> = {
  OKX: 'OKX (WebSocket relay)',
  Bybit: 'Bybit (REST fallback)',
};

function deriveStatus(
  streamConnected: boolean,
  data: OrderBookSnapshot | null
): { status: DataStatus; message?: string } {
  if (!streamConnected) {
    return { status: 'ERROR', message: 'Disconnected from HEVORA stream - browser is retrying automatically' };
  }
  if (!data) {
    return { status: 'LOADING' };
  }
  if (data.unavailable) {
    if (data.connection === 'connecting') {
      return { status: 'UNAVAILABLE', message: 'Connecting to OKX...' };
    }
    if (data.fallbackActive) {
      return { status: 'UNAVAILABLE', message: 'OKX disconnected - Bybit fallback has not returned data yet' };
    }
    return { status: 'UNAVAILABLE', message: 'OKX disconnected and no fallback data available yet' };
  }
  if (data.source === 'Bybit') {
    return { status: 'DELAYED', message: 'OKX unavailable - showing Bybit fallback (polled every 3s)' };
  }
  if (data.connection !== 'connected') {
    const ageSec = data.ageMs !== null ? Math.round(data.ageMs / 1000) : null;
    return {
      status: 'STALE',
      message: `Lost connection to OKX - showing last known book${ageSec !== null ? ` (${ageSec}s old)` : ''}`,
    };
  }
  if (data.ageMs !== null && data.ageMs > 5_000) {
    return { status: 'DELAYED', message: 'No fresh push from OKX in over 5s' };
  }
  return { status: 'LIVE' };
}

// Tahap-Polish: presentation only, on top of the already-verified-live OKX book (no data/WS
// logic touched). Two things were flat before: the depth bar was 10% opacity (barely a tint on
// the dark panel background - reads as "just a list of numbers", which is exactly what the user
// reported from production) and there was no running total, so "how much size stands between the
// spread and this level" required mental math. Both fixed here, same up/down palette the rest of
// the app already uses (index.css --color-up/--color-down) - no new colors introduced.
const DepthRow: React.FC<{
  level: { price: number; size: number };
  cumSize: number;
  maxSize: number;
  maxCumSize: number;
  side: 'ask' | 'bid';
}> = ({ level, cumSize, maxSize, maxCumSize, side }) => {
  const widthPct = maxSize > 0 ? Math.max(4, (level.size / maxSize) * 100) : 0;
  const cumWidthPct = maxCumSize > 0 ? Math.max(4, (cumSize / maxCumSize) * 100) : 0;
  const color = side === 'ask' ? 'var(--color-down)' : 'var(--color-up)';
  return (
    <div className="relative flex items-center justify-between text-[11px] font-mono py-0.5 px-1.5">
      {/* Faint full-row cumulative bar first (how much size stands between the spread and here),
          then the brighter per-level bar on top of it - the level that actually moved gets the
          strong tint, the accumulated context stays in the background. */}
      <span
        className="absolute inset-y-0 right-0"
        style={{
          width: `${cumWidthPct}%`,
          background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${color} 16%, transparent))`,
          transition: 'width 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      />
      <span
        className="absolute inset-y-0 right-0"
        style={{
          width: `${widthPct}%`,
          background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${color} 45%, transparent))`,
          transition: 'width 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      />
      <span className="relative tabular-nums font-bold" style={{ color }}>
        {level.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </span>
      <span className="relative flex items-baseline gap-2 tabular-nums">
        <span className="text-[var(--text-secondary)]">
          {level.size.toLocaleString(undefined, { maximumFractionDigits: 5 })}
        </span>
        <span className="w-16 text-right text-[9px] text-[var(--text-muted)]">
          {cumSize.toLocaleString(undefined, { maximumFractionDigits: 5 })}
        </span>
      </span>
    </div>
  );
};

/** Running total from the best price outward - level[0] in each array is always the best price
 * (best bid / best ask, nearest the spread), matching OKX's own book snapshot ordering. */
function withCumulative<T extends { size: number }>(levels: T[]): (T & { cum: number })[] {
  let running = 0;
  return levels.map((l) => {
    running += l.size;
    return { ...l, cum: running };
  });
}

const fmtPrice = (price: number) => price.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Cumulative depth "smile" chart (classic depth restyle - replaces the Institutional Order Flow
 * arc this panel used to render here). Same bid/ask cumulative arrays the ladder above already
 * built with withCumulative() - no new data, just plotted against PRICE on the X axis instead of
 * shown as running totals in a column. Cumulative is lowest right at the spread (only the nearest
 * level counted so far) and grows outward toward the edges as more levels are summed in, which is
 * exactly the valley/"smile" shape real depth charts have - not a decorative curve shape.
 *
 * One continuous chart, not two side-by-side panels: both areas share one SVG/coordinate space
 * and a shared backdrop rect spans the full plot width (including the spread gap between them) so
 * that gap reads as "this is the spread, on purpose" rather than empty leftover space. A dashed
 * spread-midpoint line ties the two halves together visually the same way the current-price line
 * does on the Liquidity Map heatmap beside it.
 */
const DepthSmileChart: React.FC<{
  bids: Array<{ price: number; cum: number }>;
  asks: Array<{ price: number; cum: number }>;
  maxCumSize: number;
  height?: number;
}> = ({ bids, asks, maxCumSize, height = 100 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Measured width, not viewBox-scaled (same fix as LiquidityHeatmapColumn / FlowParticles.tsx) -
  // 1 unit = 1 real pixel on both axes, so the chart fills the panel with no letterboxing and no
  // text distortion.
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (bids.length === 0 || asks.length === 0) return null;

  const padding = { top: 6, right: 4, bottom: 14, left: 4 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const bottom = padding.top + plotH;

  // Ascending price order on both sides (bids come in best-first / nearest-spread-first, so they
  // need reversing; asks are already nearest-spread-first, which is already ascending price).
  const bidsAsc = [...bids].reverse();
  const asksAsc = asks;

  const minPrice = bidsAsc[0].price;
  const maxPrice = asksAsc[asksAsc.length - 1].price;
  const priceSpan = maxPrice - minPrice || 1;
  const xFor = (price: number) => padding.left + ((price - minPrice) / priceSpan) * plotW;
  const yFor = (cum: number) => bottom - (maxCumSize > 0 ? (cum / maxCumSize) * plotH : 0);

  const toArea = (points: Array<{ price: number; cum: number }>) =>
    `M ${xFor(points[0].price).toFixed(1)} ${bottom.toFixed(1)} ` +
    points.map((p) => `L ${xFor(p.price).toFixed(1)} ${yFor(p.cum).toFixed(1)}`).join(' ') +
    ` L ${xFor(points[points.length - 1].price).toFixed(1)} ${bottom.toFixed(1)} Z`;
  const toLine = (points: Array<{ price: number; cum: number }>) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.price).toFixed(1)} ${yFor(p.cum).toFixed(1)}`).join(' ');

  const bestBidPrice = bidsAsc[bidsAsc.length - 1].price;
  const bestAskPrice = asksAsc[0].price;
  const spreadMidX = xFor((bestBidPrice + bestAskPrice) / 2);

  return (
    <div ref={containerRef} className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Cumulative depth chart">
        <rect x={padding.left} y={padding.top} width={plotW} height={plotH} fill="var(--bg-surface)" />
        <path d={toArea(bidsAsc)} fill="color-mix(in srgb, var(--color-up) 24%, transparent)" />
        <path d={toArea(asksAsc)} fill="color-mix(in srgb, var(--color-down) 24%, transparent)" />
        <path d={toLine(bidsAsc)} fill="none" stroke="var(--color-up)" strokeWidth={1.5} strokeLinejoin="round" />
        <path d={toLine(asksAsc)} fill="none" stroke="var(--color-down)" strokeWidth={1.5} strokeLinejoin="round" />
        <line x1={spreadMidX} y1={padding.top} x2={spreadMidX} y2={bottom} stroke="var(--text-primary)" strokeWidth={1} strokeDasharray="2 2" opacity={0.6} />
        <text x={padding.left} y={height - 2} fontSize={8} fill="var(--text-muted)" fontFamily="var(--font-mono, monospace)">
          {fmtPrice(minPrice)}
        </text>
        <text x={width - padding.right} y={height - 2} textAnchor="end" fontSize={8} fill="var(--text-muted)" fontFamily="var(--font-mono, monospace)">
          {fmtPrice(maxPrice)}
        </text>
      </svg>
    </div>
  );
};

interface OrderBookDepthViewProps {
  /** e.g. '/api/market/orderbook/btcusdt/stream' */
  streamUrl: string;
  titleKey: string;
  /** Shown only before the first frame ever arrives (no source known yet). */
  fallbackSourceLabel: string;
}

const OrderBookDepthView: React.FC<OrderBookDepthViewProps> = ({ streamUrl, titleKey, fallbackSourceLabel }) => {
  const { t } = useTranslation();
  const { data, streamConnected, error } = useOrderBookStream(streamUrl);
  const { status, message } = deriveStatus(streamConnected, data);

  const hasBook = data && !data.unavailable && data.bids.length > 0 && data.asks.length > 0;

  if (status === 'LOADING') return <LoadingState variant="table" />;

  const source = data?.source ? SOURCE_LABEL[data.source] : fallbackSourceLabel;

  const bestBid = hasBook ? data!.bids[0] : null;
  const bestAsk = hasBook ? data!.asks[0] : null;
  const spread = bestBid && bestAsk ? bestAsk.price - bestBid.price : null;
  const spreadPct = spread !== null && bestBid ? (spread / bestBid.price) * 100 : null;

  const maxSize = hasBook
    ? Math.max(...data!.bids.map((l) => l.size), ...data!.asks.map((l) => l.size), 0.00001)
    : 0;
  // Cumulative is computed per side (bids and asks build their own running total outward from
  // the spread) but shares one max across both sides, same as maxSize above - keeps the two
  // ladders visually comparable instead of each side re-scaling to its own total depth.
  const bidsWithCum = hasBook ? withCumulative(data!.bids) : [];
  const asksWithCum = hasBook ? withCumulative(data!.asks) : [];
  const maxCumSize = hasBook
    ? Math.max(bidsWithCum[bidsWithCum.length - 1]?.cum ?? 0, asksWithCum[asksWithCum.length - 1]?.cum ?? 0, 0.00001)
    : 0;
  const asksTopDown = hasBook ? [...asksWithCum].reverse() : [];

  return (
    <Panel live={status === 'LIVE'}>
      <PanelHeader
        eyebrow={t('category.market')}
        title={t(titleKey)}
        subtitle={t('orderbook.subtitle')}
        icon={<Layers className="w-4 h-4" />}
        actions={
          <DataQualityBadge
            meta={{
              source,
              lastUpdated: data?.updatedAt ?? null,
              status,
              message,
            }}
          />
        }
      />

      {!hasBook ? (
        <div className="mt-4">
          <UnavailableState source={source} detail={message ?? t('orderbook.unavailableDetail')} />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {data?.fallbackActive && data.source === 'Bybit' && (
            <p className="text-[10px] text-[var(--color-warn)] font-mono uppercase tracking-wider">
              {t('orderbook.fallbackNotice')}
            </p>
          )}

          <div className="grid grid-cols-2 text-[9px] font-mono uppercase tracking-wider text-[var(--text-muted)] px-1.5">
            <span>{t('orderbook.price')}</span>
            <span className="text-right pr-[68px]">
              {t('orderbook.size')} · {t('orderbook.cumulative')}
            </span>
          </div>

          <div>
            {asksTopDown.map((level, i) => (
              <DepthRow key={`ask-${i}`} level={level} cumSize={level.cum} maxSize={maxSize} maxCumSize={maxCumSize} side="ask" />
            ))}
          </div>

          <div className="flex items-center justify-between px-1.5 py-1.5 border-y border-[var(--border-subtle)] font-mono text-[11px]">
            <span className="text-[var(--text-muted)]">{t('orderbook.spread')}</span>
            <span className="font-bold text-[var(--text-primary)] tabular-nums">
              {spread !== null ? <AnimatedNumber value={spread} digits={2} /> : '—'}
              {spreadPct !== null && (
                <>
                  {' ('}
                  <AnimatedNumber value={spreadPct} digits={3} format={(v) => `${v.toFixed(3)}%`} />
                  {')'}
                </>
              )}
            </span>
          </div>

          <div>
            {bidsWithCum.map((level, i) => (
              <DepthRow key={`bid-${i}`} level={level} cumSize={level.cum} maxSize={maxSize} maxCumSize={maxCumSize} side="bid" />
            ))}
          </div>

          <div className="pt-2">
            <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mb-1 block">
              {t('orderbook.depthChartTitle')}
            </span>
            <DepthSmileChart bids={bidsWithCum} asks={asksWithCum} maxCumSize={maxCumSize} />
          </div>
        </div>
      )}

      {error && streamConnected === false && (
        <p className="mt-3 text-[9px] text-[var(--text-muted)] font-mono">{error}</p>
      )}
    </Panel>
  );
};

export const BtcUsdtOrderBookView: React.FC = () => (
  <OrderBookDepthView
    streamUrl="/api/market/orderbook/btcusdt/stream"
    titleKey="module.btcUsdtDepth"
    fallbackSourceLabel="HEVORA order book relay (BTC-USDT)"
  />
);

// Pair #2 (blueprint §7 extension) - same component, same relay pattern, own stream endpoint.
export const EthUsdtOrderBookView: React.FC = () => (
  <OrderBookDepthView
    streamUrl="/api/market/orderbook/ethusdt/stream"
    titleKey="module.ethUsdtDepth"
    fallbackSourceLabel="HEVORA order book relay (ETH-USDT)"
  />
);

/** Depth config per symbol, keyed for the Order Book & Liquidity hub's symbol switcher
 *  (Nav Consolidation Fase 4b) - same two relay endpoints, addressed by symbol instead of by two
 *  separate exported components. */
export const ORDER_BOOK_SYMBOLS = {
  'BTC-USDT': {
    streamUrl: '/api/market/orderbook/btcusdt/stream',
    titleKey: 'module.btcUsdtDepth',
    fallbackSourceLabel: 'HEVORA order book relay (BTC-USDT)',
  },
  'ETH-USDT': {
    streamUrl: '/api/market/orderbook/ethusdt/stream',
    titleKey: 'module.ethUsdtDepth',
    fallbackSourceLabel: 'HEVORA order book relay (ETH-USDT)',
  },
} as const;
export type OrderBookSymbol = keyof typeof ORDER_BOOK_SYMBOLS;

export const OrderBookDepthPanel: React.FC<{ symbol: OrderBookSymbol }> = ({ symbol }) => {
  const cfg = ORDER_BOOK_SYMBOLS[symbol];
  return <OrderBookDepthView streamUrl={cfg.streamUrl} titleKey={cfg.titleKey} fallbackSourceLabel={cfg.fallbackSourceLabel} />;
};
