import React, { useState } from 'react';
import { Globe2, History, Network, Target } from 'lucide-react';
import { ChainTvlResponse, EconIndicatorId, StablecoinResponse } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { latestChange, latestPoint, latestValue, useFredSeries } from '../../lib/useFredSeries';
import { statusFromAge } from '../../lib/dataState';
import { formatCompact, formatNumber, formatPercent } from '../../lib/format';
import { HBarChart, LineChart, Sparkline } from '../charts';
import { Badge, DataQualityBadge, LoadingState, Panel, PanelHeader, TabBar, UnavailableState, type TabItem } from '../ui';
import { InfoTooltip, LivePulseDot } from '../viz';
import { FredSetupNotice } from './FredSetupNotice';
import { EconomicHistoryView } from '../EconomicHistoryView';

/**
 * Macro Hub 4d - "Ekonomi & Likuiditas Global" (Nav Consolidation Fase 2).
 *
 * Merges Global Macro (fiscal/USD liquidity/activity, Image 10 reference), Inflation & Growth and
 * On-Chain Macro into one Overview screen - the "Belum Terpasang" (not-wired) pattern for Baltic
 * Dry / Energy Disruption is kept exactly as it was (§ non-negotiable rule 2). Economic History is
 * its own tab rather than folded into the Overview grid: it is a 1000+ line archive/search UI in
 * its own right (chips, per-indicator charts, market-context panel), not a card that fits a grid -
 * so it stays a separate, self-contained component, just reached by a tab instead of a route.
 */
type TabId = 'overview' | 'history';

type FormatFn = (value: number | null) => string;
interface MetricSpec {
  id: EconIndicatorId;
  labelKey: string;
  freqKey: string;
  format: FormatFn;
}

const dollarsFromMillions: FormatFn = (v) => (v === null ? '—' : `$${formatCompact(v * 1_000_000, 2)}`);
const dollarsFromBillions: FormatFn = (v) => (v === null ? '—' : `$${formatCompact(v * 1_000_000_000, 2)}`);
const percentFmt: FormatFn = (v) => (v === null ? '—' : formatPercent(v, 2));
const thousandsUnits: FormatFn = (v) => (v === null ? '—' : `${formatNumber(v, 0)}K`);
const indexFmt: FormatFn = (v) => (v === null ? '—' : formatNumber(v, 1));

const FISCAL: MetricSpec[] = [
  { id: 'FISCAL_DEBT', labelKey: 'macro.fiscalDebt', freqKey: 'macro.freqQuarterly', format: dollarsFromMillions },
  { id: 'FISCAL_DEFICIT', labelKey: 'macro.fiscalDeficit', freqKey: 'macro.freqMonthly', format: dollarsFromMillions },
  { id: 'FISCAL_RECEIPTS', labelKey: 'macro.fiscalReceipts', freqKey: 'macro.freqQuarterly', format: dollarsFromBillions },
  { id: 'FISCAL_EXPENDITURES', labelKey: 'macro.fiscalExpenditures', freqKey: 'macro.freqQuarterly', format: dollarsFromBillions },
];
const LIQUIDITY: MetricSpec[] = [
  { id: 'SOFR', labelKey: 'macro.sofr', freqKey: 'macro.freqDaily', format: percentFmt },
  { id: 'RRPONTSYD', labelKey: 'macro.rrp', freqKey: 'macro.freqDaily', format: dollarsFromBillions },
  { id: 'WRESBAL', labelKey: 'macro.wresbal', freqKey: 'macro.freqWeekly', format: dollarsFromMillions },
  { id: 'WTREGEN', labelKey: 'macro.wtregen', freqKey: 'macro.freqWeekly', format: dollarsFromMillions },
];
const ACTIVITY: MetricSpec[] = [
  { id: 'HOUSING_STARTS', labelKey: 'macro.housingStarts', freqKey: 'macro.freqMonthly', format: thousandsUnits },
  { id: 'CONSUMER_SENTIMENT', labelKey: 'macro.consumerSentiment', freqKey: 'macro.freqMonthly', format: indexFmt },
  { id: 'TRADE_BALANCE', labelKey: 'macro.tradeBalance', freqKey: 'macro.freqMonthly', format: dollarsFromMillions },
  { id: 'MANUFACTURING_OUTPUT', labelKey: 'macro.manufacturingOutput', freqKey: 'macro.freqMonthly', format: percentFmt },
];
const INFLATION: Array<{ id: EconIndicatorId; labelKey: string; suffix: string }> = [
  { id: 'CPI', labelKey: 'macro.cpi', suffix: '%' },
  { id: 'PPI', labelKey: 'macro.ppi', suffix: '%' },
  { id: 'PCEPI', labelKey: 'macro.pcepi', suffix: '%' },
  // The Fed's own most-cited inflation gauge (explicitly named in FOMC statements/SEP) - added
  // right beside headline PCEPI above, same FRED pipeline/YoY convention, neither replaces the
  // other since both are real, distinct, commonly-quoted series.
  { id: 'PCEPILFE', labelKey: 'macro.pcepilfe', suffix: '%' },
  { id: 'GDP', labelKey: 'macro.gdp', suffix: '%' },
  { id: 'NFP', labelKey: 'macro.nfp', suffix: 'K' },
  { id: 'UNRATE', labelKey: 'macro.unrate', suffix: '%' },
  { id: 'T10YIE', labelKey: 'macro.t10yie', suffix: '%' },
  { id: 'T5YIE', labelKey: 'macro.t5yie', suffix: '%' },
  // Roadmap Batch C: multi-country inflation, same table (this table already mixes CPI/PPI/GDP/
  // NFP/UNRATE at different frequencies, so a few more rows with self-explanatory per-country
  // labels needs no new sub-section). Series ids are pattern-matched against the OECD MEI family,
  // not live-verified - see the EconIndicatorId comment in src/types.ts.
  { id: 'CPI_DE', labelKey: 'macro.cpiDe', suffix: '%' },
  { id: 'CPI_GB', labelKey: 'macro.cpiGb', suffix: '%' },
  { id: 'CPI_JP', labelKey: 'macro.cpiJp', suffix: '%' },
  { id: 'CPI_CA', labelKey: 'macro.cpiCa', suffix: '%' },
];
const NOT_WIRED = ['macro.balticDry', 'macro.energyDisruption'];
const ALL_FRED_IDS: EconIndicatorId[] = [...FISCAL, ...LIQUIDITY, ...ACTIVITY, ...INFLATION].map((m) => m.id);

export const EconomyLiquidityHub: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>('overview');

  const tabs: TabItem[] = [
    { id: 'overview', label: t('goldHub.tabOverview'), icon: <Globe2 className="w-3 h-3" /> },
    { id: 'history', label: t('module.economicHistory'), icon: <History className="w-3 h-3" /> },
  ];

  return (
    <div className="space-y-4 font-mono">
      <Panel flush className="p-4 sm:p-5">
        <PanelHeader
          eyebrow={t('category.macro')}
          title={t('econHub.title')}
          subtitle={t('econHub.subtitle')}
          icon={<Globe2 className="w-4 h-4" />}
          actions={<LivePulseDot />}
        />
        <div className="mt-4">
          <TabBar tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} />
        </div>
      </Panel>

      {tab === 'overview' && <EconomyOverviewTab t={t} />}
      {tab === 'history' && <EconomicHistoryView />}
    </div>
  );
};

const MetricGroup: React.FC<{
  titleKey: string;
  subtitleKey: string;
  metrics: MetricSpec[];
  series: ReturnType<typeof useFredSeries>['series'];
}> = ({ titleKey, subtitleKey, metrics, series }) => {
  const { t } = useTranslation();
  return (
    <Panel>
      <PanelHeader title={t(titleKey)} subtitle={t(subtitleKey)} />
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {metrics.map((metric) => {
          const value = latestValue(series[metric.id]);
          const point = latestPoint(series[metric.id]);
          // `series` carried the full history per indicator all along - only the latest reading
          // was ever read off it, so every card here was a bare number with no shape behind it
          // (root-cause fix, Poin 6). Same history-extraction pattern the Inflation & Growth
          // table below already uses.
          const history = (series[metric.id]?.points ?? []).filter((p) => p.actual !== null).map((p) => p.actual as number);
          return (
            <div key={metric.id} className="hev-card-v2 !p-3">
              <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t(metric.labelKey)}</span>
              <span className={`block text-lg font-black tabular-nums mt-1 ${value === null ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
                {metric.format(value)}
              </span>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[9px] text-[var(--text-muted)]">
                  {t(metric.freqKey)}
                  {point ? ` · ${point.date}` : ''}
                </span>
                <Sparkline values={history} width={64} height={20} />
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
};

const EconomyOverviewTab: React.FC<{ t: (key: string) => string }> = ({ t }) => {
  const { series, isLoading, needsSetup, lastUpdated } = useFredSeries(ALL_FRED_IDS, 36);
  const chains = useEndpoint<ChainTvlResponse>('/api/flow/chains', 30 * 60_000);
  const stables = useEndpoint<StablecoinResponse>('/api/flow/stablecoins', 30 * 60_000);

  const chainBars = (chains.data?.chains ?? []).slice(0, 10).map((chain) => ({
    label: chain.name.slice(0, 10),
    value: chain.tvlUsd,
    tone: 'up' as const,
    sublabel: `$${formatCompact(chain.tvlUsd, 1)}`,
  }));
  const totalTvl = (chains.data?.chains ?? []).reduce((sum, chain) => sum + chain.tvlUsd, 0);

  const stableSeries = (stables.data?.points ?? []).map((point) => ({
    label: new Date(point.date).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
    value: point.totalUsd,
  }));
  const latestStable = stables.data?.points?.[stables.data.points.length - 1] ?? null;
  const priorStable = stables.data?.points && stables.data.points.length > 30 ? stables.data.points[stables.data.points.length - 31] : stables.data?.points?.[0] ?? null;
  const stableChange = latestStable && priorStable && priorStable.totalUsd ? ((latestStable.totalUsd - priorStable.totalUsd) / priorStable.totalUsd) * 100 : null;

  if (isLoading) return <LoadingState variant="cards" />;
  if (needsSetup) return <FredSetupNotice />;

  const anyFredData = ALL_FRED_IDS.some((id) => latestPoint(series[id]));

  return (
    <>
      <div className="flex justify-end -mt-1">
        <DataQualityBadge meta={{ source: 'FRED + DefiLlama', lastUpdated, status: statusFromAge(lastUpdated, 24 * 60 * 60_000, 45 * 24 * 60 * 60_000) }} />
      </div>

      {!anyFredData ? (
        <UnavailableState source="FRED" />
      ) : (
        <>
          <MetricGroup titleKey="macro.fiscalTitle" subtitleKey="macro.fiscalSubtitle" metrics={FISCAL} series={series} />
          <MetricGroup titleKey="macro.liquidityTitle" subtitleKey="macro.liquiditySubtitle" metrics={LIQUIDITY} series={series} />
          <MetricGroup titleKey="macro.activityTitle" subtitleKey="macro.activitySubtitle" metrics={ACTIVITY} series={series} />
        </>
      )}

      {/* ===== Inflation & Growth ===== */}
      <Panel flush>
        <div className="p-4 sm:p-5">
          <PanelHeader
            title={t('module.inflation')}
            subtitle={t('macro.inflationSubtitle')}
            icon={<Target className="w-4 h-4" />}
            actions={<InfoTooltip text={t('macro.inflationMethod')} />}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-y border-[var(--border-subtle)]">
                <th className="text-left font-bold px-4 py-2">{t('macro.colIndicator')}</th>
                <th className="text-right font-bold px-3 py-2">{t('macro.colLatest')}</th>
                <th className="text-right font-bold px-3 py-2">{t('macro.colChange')}</th>
                <th className="text-right font-bold px-3 py-2">{t('macro.colAsOf')}</th>
                <th className="text-right font-bold px-4 py-2">{t('macro.colTrend')}</th>
              </tr>
            </thead>
            <tbody>
              {INFLATION.map((entry) => {
                const point = latestPoint(series[entry.id]);
                const change = latestChange(series[entry.id]);
                const history = (series[entry.id]?.points ?? []).filter((p) => p.actual !== null).map((p) => p.actual as number);
                return (
                  <tr key={entry.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
                    <td className="px-4 py-2.5 font-bold text-[var(--text-primary)]">{t(entry.labelKey)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-primary)]">
                      {point?.actual === null || point === null ? '—' : `${formatNumber(point.actual, 2)}${entry.suffix}`}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${change === null ? 'text-[var(--text-muted)]' : change >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                      {change === null ? '—' : formatNumber(change, 2, { signed: true })}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-muted)]">{point?.date ?? '—'}</td>
                    <td className="px-4 py-2 text-right">
                      <span className="inline-flex justify-end w-full">
                        <Sparkline values={history} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ===== On-Chain Macro ===== */}
      <Panel>
        <PanelHeader
          title={t('macro.chainTvlTitle')}
          subtitle={t('macro.chainTvlSubtitle')}
          icon={<Network className="w-4 h-4" />}
          actions={
            chains.data?.fetchedAt ? (
              <DataQualityBadge
                meta={{ source: chains.data.source, lastUpdated: chains.data.fetchedAt, status: chains.data.stale ? 'STALE' : statusFromAge(chains.data.fetchedAt, 2 * 60 * 60_000, 24 * 60 * 60_000) }}
              />
            ) : undefined
          }
        />
        {chains.data?.unavailable || chainBars.length === 0 ? (
          <div className="mt-4">
            <UnavailableState source={chains.data?.source ?? 'DefiLlama'} detail={chains.data?.error} />
          </div>
        ) : (
          <>
            <div className="mt-4">
              <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('macro.totalTvl')}</span>
              <span className="block text-2xl font-black tabular-nums text-[var(--text-primary)]">${formatCompact(totalTvl, 2)}</span>
            </div>
            <div className="mt-4">
              <HBarChart data={chainBars} diverging={false} unit="" digits={0} />
            </div>
          </>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title={t('analysis.stablecoinTitle')}
          subtitle={t('analysis.stablecoinSubtitle')}
          actions={
            stables.data?.fetchedAt ? (
              <DataQualityBadge
                meta={{ source: stables.data.source, lastUpdated: stables.data.fetchedAt, status: stables.data.stale ? 'STALE' : statusFromAge(stables.data.fetchedAt, 2 * 60 * 60_000, 24 * 60 * 60_000) }}
              />
            ) : undefined
          }
        />
        {stables.data?.unavailable || !latestStable ? (
          <div className="mt-4">
            <UnavailableState source={stables.data?.source ?? 'DefiLlama'} detail={stables.data?.error} />
          </div>
        ) : (
          <>
            <div className="mt-4 flex items-end gap-6 flex-wrap">
              <div>
                <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('analysis.totalSupply')}</span>
                <span className="block text-2xl font-black tabular-nums text-[var(--text-primary)]">${formatCompact(latestStable.totalUsd, 2)}</span>
              </div>
              {stableChange !== null && (
                <div>
                  <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('analysis.change30d')}</span>
                  <span className={`block text-lg font-bold tabular-nums ${stableChange >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                    {formatPercent(stableChange, 2, { signed: true })}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-4">
              <LineChart points={stableSeries} valueDigits={0} color="var(--color-up)" />
            </div>
          </>
        )}
      </Panel>

      <Panel>
        <PanelHeader title={t('macro.notWiredBanksTitle')} subtitle={t('macro.globalMacroNotWiredSubtitle')} />
        <div className="mt-3 flex flex-wrap gap-2">
          {NOT_WIRED.map((key) => (
            <Badge key={key} tone="warning">
              {t(key)} · {t('analysis.providerNotWired')}
            </Badge>
          ))}
        </div>
      </Panel>
    </>
  );
};
