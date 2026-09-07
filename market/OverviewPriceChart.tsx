import React, { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { Candle } from '../../lib/analytics';
import type { MarketCapHistoryResponse } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { LineChart } from '../charts';
import { EmptyState, LoadingState } from '../ui';
import { TradingViewChart } from '../TradingViewChart';

type RangeKey = '1d' | '1w' | '1m' | '1y' | 'all';
type ModeKey = 'price' | 'marketCap';

const RANGE_KEYS: RangeKey[] = ['1d', '1w', '1m', '1y', 'all'];

/**
 * Overview tab's main chart (visual fix, "Fix Chart Overview" round 1) - a simple smooth line/area
 * chart with a "Price / Market Cap" toggle and "1 day / 1 week / 1 month / 1 Year / All" range
 * tabs, matching the CoinGlass reference, instead of the full TradingView candlestick widget
 * (toolbar, drawing tools, indicators, volume bars) that used to be this tab's default and only
 * view. That widget is real and stays available - see `advanced` below - just demoted to an
 * opt-in secondary view rather than the first thing a reader sees.
 *
 * Data sourcing reuses what this page already fetches, per the task's own explicit instruction -
 * no new pipeline:
 * - '1 day': this pair's own intraday candles (`/api/market/candles`, already fetched by
 *   InstitutionalDetailPage for the Overview volatility/correlation reads and the dashboard's own
 *   sparklines) - closing price per candle, plotted as a line/area rather than a candlestick.
 * - '1 week' / '1 month' / '1 Year' / 'All': the SAME `/api/crypto/market-cap-history` response
 *   MarketCapChart renders (365 days of daily price + market cap from CoinGecko), fetched ONCE by
 *   the page and passed down to both components - never a second fetch for the same data. 'All'
 *   is honestly the full window this endpoint has (CoinGecko's free-tier daily-history cap, see
 *   that endpoint's own comment) - not a claim of the coin's entire trading history.
 *
 * FIX WARNA DUA-NADA: color is now a real two-tone BASELINE chart (LineChart's `baseline` prop),
 * not one flat color for the whole line - the baseline is the first point's own value (this
 * range's open), matching the CoinGlass reference exactly ("garis acuan = harga pembukaan
 * periode itu, warna berganti hijau/merah setiap kali garis harga melintasi acuan itu dalam SATU
 * chart yang sama"). The old first-vs-last single-color read is gone: a day that opened, dipped
 * red, then closed back above open now shows that dip in red and the rest in green, instead of
 * lying with one green line for the whole session.
 *
 * Market Cap has no intraday feed, so the toggle is disabled (forced to Price) whenever '1 day' is
 * selected - never a fabricated intraday market-cap number.
 */
export const OverviewPriceChart: React.FC<{
  pairName: string;
  tradingViewSymbol: string;
  candles: Candle[];
  marketCapHistory: MarketCapHistoryResponse | null;
  marketCapHistoryLoading: boolean;
}> = ({ pairName, tradingViewSymbol, candles, marketCapHistory, marketCapHistoryLoading }) => {
  const { t } = useTranslation();
  const [range, setRange] = useState<RangeKey>('1d');
  const [mode, setMode] = useState<ModeKey>('price');
  const [advanced, setAdvanced] = useState(false);

  const effectiveMode: ModeKey = range === '1d' ? 'price' : mode;

  const points = useMemo(() => {
    if (range === '1d') {
      return candles.map((c) => ({
        label: new Date(c.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
        value: c.c,
      }));
    }
    const all = marketCapHistory?.points ?? [];
    const sliced = range === '1w' ? all.slice(-7) : range === '1m' ? all.slice(-30) : all; // '1y'/'all' both use the full fetched window - see header comment
    return sliced.map((p) => ({
      label: new Date(p.time).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
      value: effectiveMode === 'price' ? p.price : p.marketCapUsd / 1e9,
    }));
  }, [range, candles, marketCapHistory, effectiveMode]);

  // Baseline = this range's own open (first plotted point) - LineChart splits the line/fill at
  // every real crossing of this value, not just once for the whole series (see header comment).
  const baseline = points.length >= 2 ? points[0].value : undefined;

  const isLoading = range === '1d' ? candles.length === 0 : marketCapHistoryLoading && !marketCapHistory;
  const hasEnoughPoints = points.length >= 2;

  const valueDigits = effectiveMode === 'marketCap' ? 1 : points.some((p) => p.value < 10) ? 4 : 2;
  const valueSuffix = effectiveMode === 'marketCap' ? 'B' : '';

  if (advanced) {
    return (
      <div>
        <div className="flex justify-end mb-2">
          <ChartModeButton active={false} onClick={() => setAdvanced(false)}>
            {t('overviewChart.simpleToggle')}
          </ChartModeButton>
        </div>
        <TradingViewChart symbol={tradingViewSymbol} pairName={pairName} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-1">
          <ChartModeButton active={effectiveMode === 'price'} onClick={() => setMode('price')}>
            {t('overviewChart.modePrice')}
          </ChartModeButton>
          <ChartModeButton
            active={effectiveMode === 'marketCap'}
            disabled={range === '1d'}
            title={range === '1d' ? t('overviewChart.marketCapUnavailableIntraday') : undefined}
            onClick={() => setMode('marketCap')}
          >
            {t('overviewChart.modeMarketCap')}
          </ChartModeButton>
        </div>
        <div className="flex items-center gap-1">
          {RANGE_KEYS.map((r) => (
            <ChartModeButton key={r} active={range === r} onClick={() => setRange(r)}>
              {t(`overviewChart.range.${r}`)}
            </ChartModeButton>
          ))}
        </div>
      </div>

      {isLoading ? (
        <LoadingState variant="cards" />
      ) : !hasEnoughPoints ? (
        <EmptyState title={t('overviewChart.unavailable')} />
      ) : (
        <LineChart
          points={points}
          height={460}
          baseline={baseline}
          areaFill
          endLabel
          fitToContainer
          valueDigits={valueDigits}
          valuePrefix="$"
          valueSuffix={valueSuffix}
          xAxisTicks={range === '1d' ? 6 : 6}
        />
      )}

      <div className="flex items-center justify-between mt-2 gap-2">
        {range === 'all' && <p className="text-[9px] text-[var(--text-muted)] leading-relaxed">{t('overviewChart.allRangeNote')}</p>}
        <button
          type="button"
          onClick={() => setAdvanced(true)}
          className="ml-auto shrink-0 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
        >
          <SlidersHorizontal className="w-3 h-3" />
          {t('overviewChart.advancedToggle')}
        </button>
      </div>
    </div>
  );
};

const ChartModeButton: React.FC<{
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, disabled = false, title, onClick, children }) => (
  <button
    type="button"
    disabled={disabled}
    title={title}
    onClick={onClick}
    className={`shrink-0 px-2 py-1 rounded text-[10px] font-bold tracking-wide transition-colors duration-150 ${
      disabled
        ? 'text-[var(--text-muted)] opacity-40 cursor-not-allowed'
        : active
          ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] cursor-pointer'
          : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer'
    }`}
  >
    {children}
  </button>
);
