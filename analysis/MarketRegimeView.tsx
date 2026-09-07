import React from 'react';
import { Gauge as GaugeIcon } from 'lucide-react';
import { MarketPrice, PairId } from '../../types';
import { regimeLabelKey } from '../../lib/analytics';
import { useMarketRegime } from '../../lib/useMarketRegime';
import { aggregateFeedMeta } from '../../lib/dataState';
import { useTranslation } from '../../i18n/LanguageContext';
import { Badge, DataQualityBadge, LoadingState, Panel, PanelHeader, UnavailableState } from '../ui';
import { GaugeRadial, InfoTooltip, RangePositionBar, type GaugeZone } from '../viz';

const REGIME_ZONES: GaugeZone[] = [
  { from: 0, to: 45, color: 'var(--color-down)', label: 'RISK-OFF' },
  { from: 45, to: 55, color: 'var(--color-warn)', label: 'NEUTRAL' },
  { from: 55, to: 100, color: 'var(--color-up)', label: 'RISK-ON' },
];

const DRIVER_SHORT_LABEL: Record<string, string> = {
  dxy: 'DXY',
  vix: 'VIX',
  real_yield: '10Y REAL',
  crypto: 'BTC',
  gold: 'XAU',
};

/**
 * Market Regime (spec §E) - the most important module on the page, so it anchors the grid's first
 * cell. Score/gauge/driver computation is untouched (useMarketRegime, Fase 11 §3 - shared with the
 * Dashboard card, never a second copy). Presentation: the existing GaugeRadial arc stays (reuse-
 * first per this rework's own ground rules - it is the app's one shared 0-100 score visual, used
 * identically for Geopolitical Risk and Fear & Greed), with an added RangePositionBar underneath
 * as the literal "RISK-OFF -----o----- RISK-ON" horizontal read spec §E calls for - same primitive
 * VolatilityView/asset tiles already use for a 24h price-range position, repurposed here with
 * low=0/high=100 so its existing down->warn->up gradient already means exactly the right thing.
 *
 * Spec §E also asks for "REGIME 24H -> NEUTRAL" / "REGIME 7D -> NEUTRAL" rows. Omitted: this build
 * stores no historical regime-score series (useMarketRegime computes the live composite only), so
 * a 24H/7D figure would have nothing real behind it - the same §AG rule this rework already
 * applies to the Correlation window toggle and the FX Strength timeframe.
 */
export const MarketRegimeView: React.FC<{
  prices: Record<PairId, MarketPrice>;
  onOpenDriver: (route: string) => void;
}> = ({ prices, onOpenDriver }) => {
  const { t } = useTranslation();
  const { regime, isLoading, dxy } = useMarketRegime(prices);

  if (isLoading) return <LoadingState variant="cards" />;

  const driverRoute: Record<string, string> = {
    dxy: '/macro/dxy',
    vix: '/analysis/volatility',
    real_yield: '/macro/yield-curve',
    crypto: '/market/crypto',
    gold: '/market/commodities',
  };

  return (
    <Panel className="flex flex-col h-full">
      <PanelHeader
        eyebrow="ANALYSIS"
        // Renamed from the hardcoded "MARKET REGIME" (naming-consistency audit, 2026-08-30) -
        // reuses the same overview.marketRegime key the Dashboard card already renders, so the
        // two stay identical instead of drifting. subtitle makes the distinction from Economic
        // History's "Macro Regime Score (Economic)" visible without a click (regimeSubtitle
        // above stays inside the InfoTooltip, unchanged).
        title={t('overview.marketRegime')}
        subtitle={t('analysis.regimeDistinctFromMacro')}
        icon={<GaugeIcon className="w-4 h-4" />}
        actions={
          <div className="flex items-center gap-2">
            <DataQualityBadge
              meta={aggregateFeedMeta(
                'HEVORA composite',
                [prices.BTCUSDT, prices.XAUUSD, dxy.data?.lastUpdated ? { lastUpdated: dxy.data.lastUpdated } : undefined],
                60_000,
                10 * 60_000
              )}
            />
            <InfoTooltip text={`${t('analysis.regimeSubtitle')} ${t('analysis.regimeMethod')}`} />
          </div>
        }
      />

      {regime.availableDrivers === 0 ? (
        <div className="mt-4 flex-1 min-h-0 flex items-center justify-center">
          <UnavailableState className="w-full" source="DXY / FRED / price feed" detail={t('analysis.regimeNoDrivers')} />
        </div>
      ) : (
        <div className="mt-3 flex-1 min-h-0 flex flex-col items-center gap-3">
          <div className="shrink-0 w-full flex flex-col items-center gap-3">
            <GaugeRadial
              value={regime.score}
              zones={REGIME_ZONES}
              captionOverride={t(regimeLabelKey(regime.score))}
              size={130}
            />

            {regime.score === null ? (
              <div className="w-full text-[10px] text-[var(--color-warn)] leading-relaxed text-center">
                {t('analysis.regimeInsufficient').replace('{n}', String(regime.requiredDrivers))}
              </div>
            ) : (
              <div className="w-full flex items-center gap-2">
                <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--color-down)] shrink-0">RISK-OFF</span>
                <RangePositionBar low={0} high={100} value={regime.score} width={200} height={10} />
                <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--color-up)] shrink-0">RISK-ON</span>
              </div>
            )}
          </div>

          <div className="w-full flex-1 min-h-0 overflow-y-auto pt-2 border-t border-[var(--border-subtle)] space-y-1">
            <div className="text-[8px] font-bold uppercase tracking-wider text-[var(--text-muted)]">DRIVERS</div>
            {regime.drivers.map((driver) => (
              <button
                key={driver.id}
                type="button"
                title={driver.label}
                onClick={() => onOpenDriver(driverRoute[driver.id])}
                className="w-full flex items-center justify-between gap-2 py-0.5 text-left hover:opacity-80 transition-opacity cursor-pointer"
              >
                <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  {DRIVER_SHORT_LABEL[driver.id] ?? driver.id}
                </span>
                {driver.score === null ? (
                  <Badge tone="neutral">NO FEED</Badge>
                ) : (
                  <span className={`text-[11px] font-bold tabular-nums ${driver.score > 0.15 ? 'text-[var(--color-up)]' : driver.score < -0.15 ? 'text-[var(--color-down)]' : 'text-[var(--color-warn)]'}`}>
                    {driver.rawLabel}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
};
