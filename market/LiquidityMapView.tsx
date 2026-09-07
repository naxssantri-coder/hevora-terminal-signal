import React, { useEffect, useRef, useState } from 'react';
import { Waves } from 'lucide-react';
import { LiquidityMapResponse, LiquidityZone } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { formatNumber } from '../../lib/format';
import { Badge, DataQualityBadge, LoadingState, Panel, PanelHeader, UnavailableState } from '../ui';
import { statusFromAge } from '../../lib/dataState';
import { AnimatedNumber, InfoTooltip } from '../viz';

/**
 * Liquidity Map (blueprint §50), BTC-USDT only. Buildable now because its prerequisite (a live
 * order book) exists - see server.ts's own header comment on GET /api/market/liquidity-map/btcusdt
 * for the full audit of what is and isn't wired.
 *
 * Two DIFFERENT kinds of evidence are shown, and deliberately never blended into one number:
 * - `orderbook` zones are a MEASUREMENT (today's real resting bid/ask depth) - labelled "Order
 *   Block" in the UI.
 * - `structural-swing`/`structural-fvg` zones are an INFERENCE (standard SMC/ICT framing - where
 *   stop-loss/breakout orders are LIKELY to cluster, based on candle structure), not a real order
 *   count. Each zone's color/icon tags which kind it is so a reader never mistakes one for the
 *   other.
 *
 * Liquidations are NOT included (audited - no feed wired) - shown as its own honest line, not
 * silently omitted. This is a structural/order-book read only, distinct from a true multi-exchange
 * leverage-liquidation heatmap (assessed separately, not built here - no OI/funding archive or
 * liquidation-price model exists anywhere in this codebase yet).
 */

const ZONE_KIND_LABEL: Record<LiquidityZone['kind'], string> = {
  'orderbook': 'orderbook.kindOrderBlock',
  'structural-swing': 'orderbook.kindSwing',
  'structural-fvg': 'orderbook.kindFvg',
};

type ZoneEntry = { zone: LiquidityZone; side: 'buy' | 'sell' };

/** Two-stage colour ramp: background -> base hue for most of the range, base hue -> a SMALL
 *  amber ("hot") mix only at the very top of it - a terminal heatmap (Coinglass, Bloomberg) stays
 *  a saturated, legible colour at peak intensity. The hot target used to be var(--text-primary)
 *  (pure white in dark theme): mixing white into red desaturates straight into pink, a much bigger
 *  perceptual jump than the same mix into green - which is why only the sell side visibly bloomed.
 *  var(--color-warn) (amber) is hue-consistent with the classic green->yellow / red->orange thermal
 *  ramp instead, so both sides warm up toward the same accent rather than washing out toward white.
 *  A gamma curve (pow 1.6) compresses low/mid density toward the background too, so the ramp has
 *  real visual steps instead of reading as one smooth fade. */
const thermalFill = (strength: number, hueVar: string): string => {
  const eased = Math.pow(Math.max(0, Math.min(1, strength)), 1.6);
  if (eased <= 0.6) {
    const pct = Math.round((eased / 0.6) * 70);
    return `color-mix(in srgb, ${hueVar} ${pct}%, var(--bg-surface))`;
  }
  const hotPct = Math.round(((eased - 0.6) / 0.4) * 14);
  return `color-mix(in srgb, var(--color-warn) ${hotPct}%, ${hueVar})`;
};

/**
 * Vertical liquidity heatmap ("classic" restyle - replaces the card grid and, before that, the
 * treemap). The board only ever has ~10-15 real LiquidityZone entries (5 order-book levels/side +
 * however many swing/FVG zones the candle window turned up) - rendering one rect per zone left
 * bare black gaps between them, which read as a sparse chart rather than a dense terminal heatmap.
 * This bucketizes the price axis into BUCKET_COUNT fixed-height rows and gives each row a density
 * score via a Gaussian-kernel sum of every zone's real weight, weighted by how close that zone's
 * price sits to the row - a kernel density estimate, the same technique liquidation heatmaps use
 * to turn a handful of real inputs into a continuous field. No new data: every row's score is
 * still built entirely from the same buyLiquidity/sellLiquidity weights the table below renders
 * one-for-one; this only changes how those same numbers are painted.
 */
const BUCKET_COUNT = 96;

const LiquidityHeatmapColumn: React.FC<{
  zones: ZoneEntry[];
  currentPrice: number;
  digits: number;
  height?: number;
}> = ({ zones, currentPrice, digits, height = 200 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Geometry is measured, not viewBox-scaled (same fix FlowParticles.tsx documents/uses): a fixed
  // viewBox width rendered at width="100%" without preserveAspectRatio="none" letterboxes to a
  // centred strip the size of the shorter side - which read as "a narrow bar with empty margins"
  // (found via inspecting the rendered SVG's own getBoundingClientRect). preserveAspectRatio="none"
  // alone would stretch it back out, but non-uniformly (X and Y scaled by different factors),
  // which distorts every <text> label. Measuring the real pixel width and using THAT as the
  // viewBox width instead keeps 1 unit = 1px on both axes, so it fills the panel with no
  // distortion either way.
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

  const padding = { top: 8, right: 58, bottom: 8, left: 0 };
  const barX = padding.left;
  const barWidth = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const pricePoints = [
    currentPrice,
    ...zones.map((z) => z.zone.price),
    ...zones.filter((z) => z.zone.priceTo !== undefined).map((z) => z.zone.priceTo as number),
  ];
  const rawMin = Math.min(...pricePoints);
  const rawMax = Math.max(...pricePoints);
  const pad = (rawMax - rawMin || Math.abs(rawMax) * 0.01 || 1) * 0.1;
  const domainMin = rawMin - pad;
  const domainMax = rawMax + pad;
  const domainSpan = domainMax - domainMin || 1;
  const yFor = (price: number) => padding.top + (1 - (price - domainMin) / domainSpan) * plotH;

  // Kernel bandwidth in price units - just wide enough that a zone's influence covers its own
  // immediate neighbouring buckets (no black gap either side of it), tight enough that the falloff
  // still reads as a band with an edge rather than a smooth blur bleeding across the whole board.
  const bandwidth = domainSpan * 0.012;
  const gaussian = (distance: number) => Math.exp(-0.5 * (distance / bandwidth) ** 2);

  // Every zone's own "reach" into a bucket: a point zone (order book / swing) contributes by
  // distance-to-price; an FVG's whole [price, priceTo] range counts as distance 0 for any bucket
  // that falls inside it (a gap is flat-strength across its width, not peaked at one edge).
  const zoneDistance = (zone: LiquidityZone, price: number): number => {
    if (zone.priceTo === undefined) return Math.abs(price - zone.price);
    const lo = Math.min(zone.price, zone.priceTo);
    const hi = Math.max(zone.price, zone.priceTo);
    if (price >= lo && price <= hi) return 0;
    return price < lo ? lo - price : price - hi;
  };

  const buckets = Array.from({ length: BUCKET_COUNT }, (_, i) => {
    const bucketTop = padding.top + (i / BUCKET_COUNT) * plotH;
    const bucketPrice = domainMax - ((i + 0.5) / BUCKET_COUNT) * domainSpan;
    const side: 'buy' | 'sell' = bucketPrice <= currentPrice ? 'buy' : 'sell';
    let density = 0;
    for (const entry of zones) {
      if (entry.side !== side) continue;
      density += entry.zone.weight * gaussian(zoneDistance(entry.zone, bucketPrice));
    }
    return { bucketTop, side, density };
  });
  const maxDensity = Math.max(...buckets.map((b) => b.density), 0.00001);
  const bucketH = plotH / BUCKET_COUNT;

  const ticks = Array.from({ length: 5 }, (_, i) => domainMax - (i / 4) * domainSpan);

  return (
    <div ref={containerRef} className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Liquidity heatmap by price">
        <rect x={barX} y={padding.top} width={barWidth} height={plotH} fill="var(--bg-surface)" />

        {buckets.map((b, i) => {
          const strength = b.density / maxDensity;
          const hueVar = b.side === 'buy' ? 'var(--color-up)' : 'var(--color-down)';
          return (
            <rect
              key={i}
              x={barX}
              y={b.bucketTop}
              width={barWidth}
              // Slight vertical overlap (+0.5px) closes any hairline seam between adjacent bucket
              // rects that antialiasing would otherwise render as a thin grid line.
              height={bucketH + 0.5}
              fill={thermalFill(strength, hueVar)}
            />
          );
        })}

        {ticks.map((price, i) => {
          // A tick landing within a few px of the current-price line collides with that line's own
          // (bolder) label - drop the tick's label rather than let two overlapping price readings
          // sit on top of each other. The grid line itself still draws, so the axis stays complete.
          const tooCloseToCurrentPrice = Math.abs(yFor(price) - yFor(currentPrice)) < 10;
          return (
            <g key={i}>
              <line x1={barX} y1={yFor(price)} x2={barX + barWidth} y2={yFor(price)} stroke="var(--border-subtle)" strokeWidth={1} opacity={0.4} />
              {!tooCloseToCurrentPrice && (
                <text x={barX + barWidth + 6} y={yFor(price) + 3} fontSize={8} fill="var(--text-muted)" fontFamily="var(--font-mono, monospace)">
                  {formatNumber(price, digits)}
                </text>
              )}
            </g>
          );
        })}

        <line x1={barX} y1={yFor(currentPrice)} x2={barX + barWidth} y2={yFor(currentPrice)} stroke="var(--text-primary)" strokeWidth={1.5} strokeDasharray="3 2" />
        <text
          x={barX + barWidth + 6}
          y={yFor(currentPrice) + 3}
          fontSize={8.5}
          fontWeight={700}
          fill="var(--text-primary)"
          fontFamily="var(--font-mono, monospace)"
        >
          {formatNumber(currentPrice, digits)}
        </text>
      </svg>
    </div>
  );
};

const LevelRow: React.FC<{ zone: LiquidityZone; side: 'buy' | 'sell'; digits: number; strengthPct: number }> = ({
  zone,
  side,
  digits,
  strengthPct,
}) => {
  const { t } = useTranslation();
  const color = side === 'buy' ? 'var(--color-up)' : 'var(--color-down)';
  const isOrderBook = zone.kind === 'orderbook';

  return (
    <tr className="border-b border-[var(--border-subtle)] last:border-b-0">
      <td className="py-1.5 pr-2">
        <Badge tone={isOrderBook ? (side === 'buy' ? 'up' : 'down') : 'neutral'} className="text-[8px]">
          {t(ZONE_KIND_LABEL[zone.kind])}
        </Badge>
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums font-bold" style={{ color }}>
        {formatNumber(zone.price, digits)}
        {zone.priceTo !== undefined ? `–${formatNumber(zone.priceTo, digits)}` : ''}
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums text-[var(--text-secondary)]">
        {isOrderBook ? formatNumber(zone.weight, 5) : `×${zone.weight}`}
      </td>
      <td className="py-1.5 text-right tabular-nums text-[var(--text-muted)]">{strengthPct.toFixed(0)}%</td>
    </tr>
  );
};

type FilterSide = 'all' | 'buy' | 'sell';
const FILTER_LABEL_KEY: Record<FilterSide, string> = {
  all: 'liquidityMap.filterAll',
  buy: 'liquidityMap.filterBuy',
  sell: 'liquidityMap.filterSell',
};

export const LiquidityMapView: React.FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useEndpoint<LiquidityMapResponse>('/api/market/liquidity-map/btcusdt', 15_000);
  const [filter, setFilter] = useState<FilterSide>('all');

  if (isLoading && !data) return <LoadingState variant="cards" />;

  const hasData = data && !data.unavailable && data.currentPrice !== null;
  const status = data?.fetchedAt ? statusFromAge(data.fetchedAt, 30_000, 5 * 60_000) : 'UNAVAILABLE';
  const digits = 1;

  // One combined, price-sorted list feeds both the heatmap and the table below it - same
  // buyLiquidity/sellLiquidity arrays the endpoint already returns, just paired with which side
  // each zone came from so the heatmap can colour it and the table can filter by it.
  const allZones: ZoneEntry[] = hasData
    ? [
        ...data!.sellLiquidity.map((zone) => ({ zone, side: 'sell' as const })),
        ...data!.buyLiquidity.map((zone) => ({ zone, side: 'buy' as const })),
      ].sort((a, b) => b.zone.price - a.zone.price)
    : [];
  const maxWeight = allZones.length > 0 ? Math.max(...allZones.map((z) => z.zone.weight), 0.00001) : 1;
  const filteredZones = filter === 'all' ? allZones : allZones.filter((z) => z.side === filter);

  return (
    <Panel live={Boolean(hasData) && status === 'LIVE'}>
      <PanelHeader
        eyebrow={t('category.market')}
        title={t('module.liquidityMap')}
        subtitle={t('liquidityMap.subtitle')}
        icon={<Waves className="w-4 h-4" />}
        actions={
          data && !data.unavailable ? (
            <div className="flex items-center gap-2">
              <DataQualityBadge meta={{ source: data.source, lastUpdated: data.fetchedAt, status }} />
              {/* FASE C quick fix: the "swing/FVG zones are inference, not real orders" explanation
                  folded into a tooltip instead of a permanent paragraph - same grid-density-fix
                  pattern used elsewhere (see MarketRegimeView), the explanation is one click away
                  rather than always taking up panel height. */}
              <InfoTooltip text={t('liquidityMap.methodNote')} />
            </div>
          ) : undefined
        }
      />

      {!hasData ? (
        <div className="mt-4">
          <UnavailableState source={data?.source ?? 'HEVORA'} detail={data?.error ?? t('liquidityMap.unavailableDetail')} />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div>
            <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mb-1 block">
              {t('liquidityMap.zoneMapTitle')}
            </span>
            {allZones.length === 0 ? (
              <p className="text-[10px] text-[var(--text-muted)] px-1.5">{t('liquidityMap.noZones')}</p>
            ) : (
              <LiquidityHeatmapColumn zones={allZones} currentPrice={data!.currentPrice!} digits={digits} />
            )}
            <div className="mt-1.5">
              <span className="text-[8px] text-[var(--text-muted)] uppercase tracking-wider block mb-1">{t('liquidityMap.strengthLabel')}</span>
              <div className="flex items-center gap-3">
                {/* Two scales, not one - the heatmap's own colour already carries side (green
                    below price / red above), so the legend explains what the thermal ramp means
                    for EACH colour rather than introducing a third, unrelated colour scale. Same
                    background -> hue -> hot-highlight stops as thermalFill() above, so the legend
                    is an honest preview of what the heatmap itself actually renders. */}
                <div className="flex items-center gap-1.5 flex-1">
                  <span className="text-[8px] text-[var(--text-muted)] tabular-nums">0%</span>
                  <div
                    className="flex-1 h-1.5"
                    style={{
                      background:
                        'linear-gradient(90deg, var(--bg-surface) 0%, color-mix(in srgb, var(--color-up) 65%, var(--bg-surface)) 50%, color-mix(in srgb, var(--color-warn) 14%, var(--color-up)) 100%)',
                    }}
                  />
                  <span className="text-[8px] text-[var(--text-muted)] tabular-nums">100%</span>
                </div>
                <div className="flex items-center gap-1.5 flex-1">
                  <span className="text-[8px] text-[var(--text-muted)] tabular-nums">0%</span>
                  <div
                    className="flex-1 h-1.5"
                    style={{
                      background:
                        'linear-gradient(90deg, var(--bg-surface) 0%, color-mix(in srgb, var(--color-down) 65%, var(--bg-surface)) 50%, color-mix(in srgb, var(--color-warn) 14%, var(--color-down)) 100%)',
                    }}
                  />
                  <span className="text-[8px] text-[var(--text-muted)] tabular-nums">100%</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between px-1.5 py-1.5 border-y border-[var(--border-subtle)] font-mono text-[11px]">
            <span className="text-[var(--text-muted)]">{t('liquidityMap.currentPrice')}</span>
            <AnimatedNumber value={data!.currentPrice!} digits={digits} className="font-bold text-[var(--text-primary)]" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('liquidityMap.levelsTitle')}</span>
              <div className="flex items-center gap-0.5 p-0.5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-full">
                {(['all', 'buy', 'sell'] as FilterSide[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    aria-current={filter === f ? 'page' : undefined}
                    className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold transition-colors duration-150 cursor-pointer ${
                      filter === f
                        ? 'bg-[var(--text-primary)] text-[var(--bg-base)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    {t(FILTER_LABEL_KEY[f])}
                  </button>
                ))}
              </div>
            </div>

            {filteredZones.length === 0 ? (
              <p className="text-[10px] text-[var(--text-muted)] px-1.5">{t('liquidityMap.noZones')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                      <th className="text-left font-normal py-1 pr-2">{t('liquidityMap.colType')}</th>
                      <th className="text-right font-normal py-1 pr-2">{t('liquidityMap.colPriceLevel')}</th>
                      <th className="text-right font-normal py-1 pr-2">{t('liquidityMap.colSize')}</th>
                      <th className="text-right font-normal py-1">{t('liquidityMap.colStrength')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredZones.map(({ zone, side }, i) => (
                      <LevelRow
                        key={`${side}-${zone.kind}-${zone.price}-${i}`}
                        zone={zone}
                        side={side}
                        digits={digits}
                        strengthPct={(zone.weight / maxWeight) * 100}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-[10px] text-[var(--color-warn)] leading-relaxed border-t border-[var(--border-subtle)] pt-3">
            {data!.liquidationsNote}
          </p>
        </div>
      )}
    </Panel>
  );
};
