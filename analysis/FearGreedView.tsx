import React, { useMemo } from 'react';
import { Flame, TrendingDown, TrendingUp } from 'lucide-react';
import { FearGreedResponse } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { statusFromAge } from '../../lib/dataState';
import { DataQualityBadge, LoadingState, Panel, PanelHeader, UnavailableState } from '../ui';
import { GaugeRadial, InfoTooltip, RangePositionBar, type GaugeZone } from '../viz';

const FEAR_GREED_ZONES: GaugeZone[] = [
  { from: 0, to: 25, color: 'var(--color-down)', label: 'EXTREME FEAR' },
  { from: 25, to: 45, color: 'var(--color-warn)', label: 'FEAR' },
  { from: 45, to: 55, color: 'var(--text-secondary)', label: 'NEUTRAL' },
  { from: 55, to: 75, color: 'var(--color-up)', label: 'GREED' },
  { from: 75, to: 100, color: 'var(--color-up)', label: 'EXTREME GREED' },
];

const bandKey = (value: number): string =>
  value <= 25 ? 'analysis.fgBandExtremeFear' : value <= 45 ? 'analysis.fgBandFear' : value <= 55 ? 'analysis.fgBandNeutral' : value <= 75 ? 'analysis.fgBandGreed' : 'analysis.fgBandExtremeGreed';

/**
 * Crypto Sentiment / Fear & Greed (spec §M). Same endpoint/zones as before; presentation adds the
 * RangePositionBar FEAR->GREED bar (same pattern as Market Regime/Geopolitical Risk) and a trend
 * arrow. Trend compares the latest reading against the mean of the OLDER half of the same already-
 * fetched window (no new fetch, no invented baseline) - "improving" means sentiment has moved up
 * versus where this window started, "declining" the opposite; flat within 2 points reads as STABLE
 * rather than forcing a direction out of noise.
 */
export const FearGreedView: React.FC = () => {
  const { t } = useTranslation();
  const fearGreed = useEndpoint<FearGreedResponse>('/api/sentiment/fear-greed', 15 * 60_000);

  const fgLatest = fearGreed.data?.points?.[0] ?? null;
  const fgHistory = useMemo(
    () =>
      (fearGreed.data?.points ?? [])
        .slice()
        .reverse()
        .filter((point) => point.timestamp)
        .map((point) => point.value),
    [fearGreed.data]
  );

  const windowStats = useMemo(() => {
    if (fgHistory.length === 0) return null;
    const avg = fgHistory.reduce((sum, v) => sum + v, 0) / fgHistory.length;
    const olderHalf = fgHistory.slice(0, Math.max(1, Math.floor(fgHistory.length / 2)));
    const olderAvg = olderHalf.reduce((sum, v) => sum + v, 0) / olderHalf.length;
    return {
      avg,
      low: Math.min(...fgHistory),
      high: Math.max(...fgHistory),
      days: fgHistory.length,
      trendDelta: fgHistory[fgHistory.length - 1] - olderAvg,
    };
  }, [fgHistory]);

  if (fearGreed.isLoading && !fearGreed.data) return <LoadingState variant="cards" />;

  return (
    <Panel className="flex flex-col h-full">
      <PanelHeader
        eyebrow="ANALYSIS"
        title="CRYPTO SENTIMENT"
        icon={<Flame className="w-4 h-4" />}
        actions={
          <div className="flex items-center gap-2">
            {fearGreed.data?.fetchedAt && (
              <DataQualityBadge
                meta={{
                  source: fearGreed.data.source,
                  lastUpdated: fearGreed.data.fetchedAt,
                  status: fearGreed.data.stale ? 'STALE' : statusFromAge(fearGreed.data.fetchedAt, 60 * 60_000, 6 * 60 * 60_000),
                }}
              />
            )}
            <InfoTooltip text={t('analysis.fearGreedSubtitle')} />
          </div>
        }
      />

      {fearGreed.data?.unavailable || !fgLatest ? (
        <div className="mt-4">
          <UnavailableState source={fearGreed.data?.source ?? 'alternative.me'} detail={fearGreed.data?.error} />
        </div>
      ) : (
        <div className="mt-3 flex-1 flex flex-col items-center gap-3">
          <GaugeRadial value={fgLatest.value} zones={FEAR_GREED_ZONES} captionOverride={fgLatest.classification ?? undefined} size={130} />

          <div className="w-full flex items-center gap-2">
            <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--color-down)] shrink-0">FEAR</span>
            <RangePositionBar low={0} high={100} value={fgLatest.value} width={200} height={10} />
            <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--color-up)] shrink-0">GREED</span>
          </div>

          {windowStats && (
            <div className="w-full pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[var(--text-muted)] uppercase tracking-wider">{windowStats.days}D AVG</span>
                <span className="font-bold tabular-nums text-[var(--text-primary)]">{windowStats.avg.toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[var(--text-muted)] uppercase tracking-wider">{windowStats.days}D RANGE</span>
                <span className="font-bold tabular-nums text-[var(--text-primary)]">
                  {Math.round(windowStats.low)} &ndash; {Math.round(windowStats.high)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[var(--text-muted)] uppercase tracking-wider">TREND</span>
                <span
                  className={`flex items-center gap-1 font-bold tabular-nums ${
                    Math.abs(windowStats.trendDelta) < 2 ? 'text-[var(--text-secondary)]' : windowStats.trendDelta > 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'
                  }`}
                >
                  {Math.abs(windowStats.trendDelta) < 2 ? (
                    'STABLE'
                  ) : windowStats.trendDelta > 0 ? (
                    <>
                      <TrendingUp className="w-3 h-3" /> IMPROVING
                    </>
                  ) : (
                    <>
                      <TrendingDown className="w-3 h-3" /> DECLINING
                    </>
                  )}
                </span>
              </div>
              <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed pt-1">{t(bandKey(fgLatest.value))}</p>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
};
