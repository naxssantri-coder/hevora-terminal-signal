import React from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { LineChart, type LinePoint } from '../charts/LineChart';

export interface HevaiAssetCardData {
  key: string;
  title: string;
  price: string;
  changeLabel?: string;
  changeUp?: boolean;
  chartPoints?: LinePoint[];
  /** 'step' for policy-rate-shaped series (Fed Funds) - same LineChart prop every other step-chart
   *  caller in this app already uses for the same reason (a held-then-jumps series). */
  chartInterpolation?: 'linear' | 'step';
  chartCaption?: string;
  stats?: Array<{ label: string; value: string }>;
}

/**
 * Unified asset/data card for HEVAI answers (chart-redesign pass) - replaces the plain-text mini
 * price chip from the earlier UI-polish pass with a real price chart + relevant stats, reusing
 * LineChart (src/components/charts/LineChart.tsx) exactly as every other module already does - no
 * new charting library. Renders for both tracked pairs (XAU/BTC/forex/commodities, fed by
 * currentPrices + /api/market/candles) and macro indicators (VIX/real yield/10Y yield/Fed funds,
 * fed by /api/economic-history) - the two data sources are assembled into this same shape by
 * hevaiAssetCards.ts, so this component itself doesn't know or care which one it's showing.
 *
 * Visual consolidation pass (Aug 2026): this is now the ONLY card type left in a HEVAI answer -
 * every other section (key points, Consider/Tindakan, sources, DYOR) was converted to plain
 * typography per the Binance AI/ChatGPT reference, which uses a box only for an actual price/chart
 * lookup. The caller (HevaiPanel.tsx) also caps this to a single instance per answer even when
 * multiple pairs are mentioned. `cardClassName` carries the brief's literal card colour/shadow
 * spec (HEVAI_PRICE_CARD_CLASS), not this app's shared design-system tokens.
 */
export const HevaiAssetCard: React.FC<{ data: HevaiAssetCardData; cardClassName: string }> = ({ data, cardClassName }) => {
  const changeColor = data.changeUp === undefined ? 'var(--text-secondary)' : data.changeUp ? 'var(--color-up)' : 'var(--color-down)';
  const ChangeIcon = data.changeUp === false ? ArrowDownRight : ArrowUpRight;
  const hasChart = (data.chartPoints?.length ?? 0) >= 2;

  return (
    <div className={cardClassName}>
      <div className="flex items-baseline justify-between gap-2 px-4 pt-4">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{data.title}</span>
        {data.changeLabel && (
          <span className="flex items-center gap-0.5 text-xs font-semibold tabular-nums shrink-0" style={{ color: changeColor }}>
            {data.changeUp !== undefined && <ChangeIcon className="w-3 h-3" />}
            {data.changeLabel}
          </span>
        )}
      </div>
      <div className="px-4 pt-1 text-lg font-bold text-[var(--text-primary)] tabular-nums">{data.price}</div>

      {hasChart ? (
        // 20px clearance above/below the chart plus a background a shade apart from the card body
        // so the chart reads as its own region, not text bleeding into it. --hevai-chart-bg
        // (theme-aware pass, index.css) keeps the same literal translucent-black look in dark
        // theme and swaps to an existing light surface token in light theme.
        <div className="mt-5 mx-3 mb-1 rounded-xl bg-[var(--hevai-chart-bg)] pt-2 px-1 pb-1">
          <LineChart
            points={data.chartPoints as LinePoint[]}
            height={100}
            color={data.changeUp === false ? 'var(--color-down)' : 'var(--color-brand)'}
            interpolation={data.chartInterpolation}
          />
          {data.chartCaption && (
            <div className="px-2 pb-1.5 pt-1 text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{data.chartCaption}</div>
          )}
        </div>
      ) : (
        <div className="h-3" />
      )}

      {data.stats && data.stats.length > 0 && (
        // border-white/5 (theme-aware pass): was chosen over --border-subtle only because that
        // token was too close to the old hardcoded #1E1E21 card background to read in dark theme -
        // --hevai-divider (index.css) keeps that same faint dark-theme value while using the
        // app's normal --border-subtle token in light theme, where it's already how every other
        // bordered surface separates itself.
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 pb-4 pt-3 border-t border-[var(--hevai-divider)] mt-2">
          {data.stats.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{s.label}</span>
              <span className="text-xs text-[var(--text-secondary)] tabular-nums">{s.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
