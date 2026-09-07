import React, { useMemo, useState } from 'react';
import { CalendarDays, Coins, DollarSign, Gauge as GaugeIcon, Landmark, LineChart as LineChartIcon, Percent, Vault } from 'lucide-react';
import {
  CentralBankGoldResponse,
  CommodityHistoryResponse,
  DxyResponse,
  GeopoliticalRiskResponse,
  GldHoldingsResponse,
  GoldPurchaseRumorResponse,
  GoldSeasonalityResponse,
  XauFuturesCurveResponse,
} from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { statusFromAge } from '../../lib/dataState';
import { formatNumber, formatPercent } from '../../lib/format';
import { latestChange, latestValue, useFredSeries } from '../../lib/useFredSeries';
import { DualAxisAreaChart, HBarChart, LineChart as CurveChart, Sparkline, type HBarDatum, type LinePoint } from '../charts';
import { Badge, DataQualityBadge, LoadingState, Panel, PanelHeader, TabBar, UnavailableState, type TabItem } from '../ui';
import { InfoTooltip, LivePulseDot, LiveValue } from '../viz';
import { FredSetupNotice } from './FredSetupNotice';

/**
 * Macro Hub 4b - "Gold Intelligence" (Nav Consolidation Fase 2).
 *
 * Merges DXY, Gold Seasonality, XAU Futures Curve and Central Bank Gold Buying into one module
 * with in-page tabs (Image 6 reference: "Overview / COMEX Futures Curve / ... / Central Bank
 * Buying / ... / Seasonality"). Only tabs backed by a real wired provider exist here - there is
 * no Delivery & Inventory, Physical Market or ETF Flow tab, because this build has no data for
 * those; adding an empty tab would imply a capability that does not exist (§1). Every figure the
 * four source pages showed is still here, one tab away instead of one route away. The three
 * retired routes redirect to the surviving /macro/dxy (see registry.ts LEGACY_ROUTE_REDIRECTS).
 */
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

type TabId = 'overview' | 'futures' | 'cbgold' | 'seasonality';

export const GoldIntelligenceHub: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>('overview');

  const dxy = useEndpoint<DxyResponse>('/api/macro/dxy', 30_000);
  const seasonality = useEndpoint<GoldSeasonalityResponse>('/api/market/gold-seasonality', 60 * 60_000);
  const futures = useEndpoint<XauFuturesCurveResponse>('/api/market/xau-futures-curve', 5 * 60_000);
  const cbGold = useEndpoint<CentralBankGoldResponse>('/api/macro/central-bank-gold', 60 * 60_000);
  const rumors = useEndpoint<GoldPurchaseRumorResponse>('/api/macro/central-bank-gold-rumors', 15 * 60_000);
  // Roadmap §2/§5: real yield is XAU's single biggest macro driver (it sets the opportunity cost
  // of holding a non-yielding asset), but it only lived on the Policy & Rates hub - a reader on
  // the gold-specific hub had to already know to look elsewhere. Same FRED series, same
  // useFredSeries/DataQualityBadge pattern as Policy & Rates, surfaced here too instead of
  // duplicated as a second data pipeline.
  const realYield = useFredSeries(['DFII10'], 24);
  const realYieldValue = latestValue(realYield.series.DFII10);
  const realYieldChange = latestChange(realYield.series.DFII10);
  // Roadmap §5: "Gold Bias Today" card + a short Real Yield vs Gold chart - same four inputs the
  // roadmap names (DXY, real yield, geo risk, CB buying flow), all already fetched somewhere in
  // this app; geoRisk is the one genuinely new fetch here, same endpoint InsightSummaryView
  // already calls. Deliberately NOT gold's own price as a fifth input - that would be exactly the
  // circular read computeRegime's own gold driver was de-weighted for (analytics.ts), and none of
  // these four inputs need it to stand on their own.
  const geoRisk = useEndpoint<GeopoliticalRiskResponse>('/api/intelligence/geopolitical-risk', 15 * 60_000);
  // Gold futures (GC=F) daily closes - the same Yahoo history endpoint CommodityBoard already
  // calls for its own selected-contract chart, read here for the Real Yield vs Gold view instead
  // of archiving a second price series of our own.
  const goldHistory = useEndpoint<CommodityHistoryResponse>('/api/market/commodity-history?symbol=GC=F', 6 * 60 * 60_000);
  // PRIORITY 3B (2026-08-26 data-freshness audit): ETF Gold Flow, GLD only - this file's own head
  // comment used to say no ETF Flow card existed "because this build has no data for those"; SPDR's
  // real daily archive (server.ts's /api/macro/gld-holdings) closes that gap for GLD specifically.
  // IAU has no confirmed equivalent source (investigated, not found) and stays honest-unavailable.
  const gldHoldings = useEndpoint<GldHoldingsResponse>('/api/macro/gld-holdings', 6 * 60 * 60_000);

  const realYieldVsGold = useMemo(() => {
    const ryPoints = (realYield.series.DFII10?.points ?? []).filter((p) => p.actual !== null);
    const goldBySDate = new Map((goldHistory.data?.points ?? []).map((p) => [p.date, p.close]));
    const realYieldSeries: LinePoint[] = [];
    const goldSeries: LinePoint[] = [];
    for (const point of ryPoints) {
      const close = goldBySDate.get(point.date);
      if (close === undefined) continue;
      realYieldSeries.push({ label: point.date.slice(5), value: point.actual as number });
      goldSeries.push({ label: point.date.slice(5), value: close });
    }
    return { realYieldSeries, goldSeries };
  }, [realYield.series.DFII10, goldHistory.data]);

  const cbFlowTonnes = useMemo(() => {
    if (!cbGold.data || cbGold.data.unavailable) return null;
    return cbGold.data.rows.reduce((sum, row) => sum + row.changeTonnes, 0);
  }, [cbGold.data]);

  // Same 30D-change derivation LiquidityFlowView already uses for stablecoin supply - real daily
  // points in, a plain latest-vs-30-points-back delta out, nothing smoothed or estimated.
  const gldFlow = useMemo(() => {
    const rows = (gldHoldings.data?.points ?? []).filter((p) => p.tonnes !== null) as Array<{ date: string; tonnes: number }>;
    const sparkline = rows.map((p) => p.tonnes);
    const latest = rows[rows.length - 1] ?? null;
    const prior = rows.length > 30 ? rows[rows.length - 31] : (rows[0] ?? null);
    const changeTonnes = latest && prior ? latest.tonnes - prior.tonnes : null;
    const changePercent = latest && prior && prior.tonnes !== 0 ? (changeTonnes as number) / prior.tonnes * 100 : null;
    return { sparkline, latest, changeTonnes, changePercent };
  }, [gldHoldings.data]);

  const dxySessionChange = dxy.data?.unavailable ? null : (dxy.data?.changeSessionPct ?? null);
  const geoRiskScore = geoRisk.data && !geoRisk.data.unavailable ? geoRisk.data.score : null;

  // Tally, not a fabricated weighted index: each factor counts as +1 gold-supportive / -1
  // gold-negative / excluded when its own feed is down, same "excluded, not treated as neutral"
  // discipline computeRegime already uses for a missing driver.
  const biasFactors: Array<{ id: string; supportive: boolean | null; label: string; readout: string }> = [
    {
      id: 'dxy',
      supportive: dxySessionChange === null ? null : dxySessionChange < 0,
      label: t('module.dxy'),
      readout: dxySessionChange === null ? '—' : `${formatPercent(dxySessionChange, 2, { signed: true })} ${t('goldHub.today')}`,
    },
    {
      id: 'realYield',
      supportive: realYieldChange === null ? null : realYieldChange < 0,
      label: t('macro.realYield'),
      readout: realYieldChange === null ? '—' : `${formatNumber(realYieldChange, 2, { signed: true })}pp`,
    },
    {
      id: 'geoRisk',
      supportive: geoRiskScore === null ? null : geoRiskScore >= 50,
      label: t('module.geopoliticalRisk'),
      readout: geoRiskScore === null ? '—' : `${Math.round(geoRiskScore)}/100`,
    },
    {
      id: 'cbFlow',
      supportive: cbFlowTonnes === null ? null : cbFlowTonnes >= 0,
      label: t('goldHub.cbFlow'),
      readout: cbFlowTonnes === null ? '—' : `${formatNumber(cbFlowTonnes, 0, { signed: true })}t`,
    },
  ];
  const availableBiasFactors = biasFactors.filter((f) => f.supportive !== null);
  const supportiveCount = availableBiasFactors.filter((f) => f.supportive).length;

  const tabs: TabItem[] = [
    { id: 'overview', label: t('goldHub.tabOverview'), icon: <Coins className="w-3 h-3" /> },
    { id: 'futures', label: t('module.xauFuturesCurve'), icon: <LineChartIcon className="w-3 h-3" /> },
    { id: 'cbgold', label: t('module.centralBankGold'), icon: <Landmark className="w-3 h-3" /> },
    { id: 'seasonality', label: t('module.goldSeasonality'), icon: <CalendarDays className="w-3 h-3" /> },
  ];

  const hasFutures = futures.data && !futures.data.unavailable && futures.data.curve.some((c) => c.price !== null);
  const priced = hasFutures ? futures.data!.curve.filter((c) => c.price !== null) : [];
  const nearMonth = priced[0] ?? null;
  // A shape (contango/backwardation) needs two priced contracts to compare, but a single priced
  // contract is still real data - the tile falls back to showing just that one price instead of
  // going blank, the same way the Futures Curve tab's own table never hides a contract that DID
  // return a quote just because a sibling contract didn't.
  const farMonth = priced.length > 1 ? priced[priced.length - 1] : null;
  const isContango = nearMonth && farMonth ? farMonth.price! > nearMonth.price! : null;

  const hasCbGold = cbGold.data && !cbGold.data.unavailable && cbGold.data.rows.length > 0;
  const topMover = hasCbGold ? [...cbGold.data!.rows].sort((a, b) => Math.abs(b.changeTonnes) - Math.abs(a.changeTonnes))[0] : null;

  const currentMonthIndex = new Date().getUTCMonth();
  const currentMonthData = seasonality.data?.months.find((m) => m.month === currentMonthIndex + 1);
  const hasSeasonality = seasonality.data && !seasonality.data.unavailable && seasonality.data.months.some((m) => m.totalYears > 0);
  // Falls back to the month with the deepest sample when THIS calendar month happens to be thin
  // (a real gap, not an error) - the Seasonality tab itself still renders a full bar chart in that
  // case, so the tile should not be the one place that goes blank instead of showing something real.
  const seasonalityFallback = hasSeasonality
    ? [...(seasonality.data!.months)].filter((m) => m.totalYears > 0).sort((a, b) => b.totalYears - a.totalYears)[0]
    : null;
  const seasonalityTile = currentMonthData && currentMonthData.totalYears > 0 ? currentMonthData : seasonalityFallback;
  const seasonalityTileIsCurrentMonth = seasonalityTile === currentMonthData;

  return (
    <div className="space-y-4 font-mono">
      <Panel flush className="p-4 sm:p-5">
        <PanelHeader
          eyebrow={t('category.macro')}
          title={t('goldHub.title')}
          subtitle={t('goldHub.subtitle')}
          icon={<Coins className="w-4 h-4" />}
          actions={<LivePulseDot />}
        />
        <div className="mt-4">
          <TabBar tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} />
        </div>
      </Panel>

      {tab === 'overview' && (
        <Panel>
          <PanelHeader
            eyebrow={t('category.macro')}
            title={t('macro.realYield')}
            subtitle={t('goldHub.realYieldSubtitle')}
            titleVariant="chart"
            icon={<Percent className="w-4 h-4" />}
            actions={
              !realYield.needsSetup && (
                <DataQualityBadge
                  meta={{
                    source: 'FRED (DFII10)',
                    lastUpdated: realYield.lastUpdated,
                    status: statusFromAge(realYield.lastUpdated, 26 * 60 * 60_000, 72 * 60 * 60_000),
                  }}
                />
              )
            }
          />
          {realYield.needsSetup ? (
            <div className="mt-4">
              <FredSetupNotice />
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <LiveValue
                  value={realYieldValue}
                  className="text-3xl font-black tabular-nums text-[var(--text-primary)]"
                  render={(v) => (v === null ? '—' : `${formatNumber(v as number, 2)}%`)}
                />
                {realYieldChange !== null && (
                  <span
                    className={`text-sm font-bold tabular-nums ${realYieldChange >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}
                  >
                    {realYieldChange >= 0 ? '+' : ''}
                    {formatNumber(realYieldChange, 2)}pp
                  </span>
                )}
              </div>
              <p className="max-w-md text-[10px] text-[var(--text-muted)] leading-relaxed">
                {t('goldHub.realYieldNote')} <InfoTooltip text={t('macro.realYieldCurveNote')} />
              </p>
            </div>
          )}

          {!realYield.needsSetup && realYieldVsGold.realYieldSeries.length > 1 && (
            <div className="mt-5 pt-4 border-t border-[var(--border-subtle)]">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('goldHub.realYieldVsGoldTitle')}</span>
                <InfoTooltip text={t('goldHub.realYieldVsGoldNote')} />
              </div>
              <DualAxisAreaChart
                primary={{ points: realYieldVsGold.realYieldSeries, color: 'var(--color-warn)', label: t('macro.realYield'), valueDigits: 2, valueSuffix: '%' }}
                secondary={{ points: realYieldVsGold.goldSeries, color: 'var(--accent-gold)', label: 'XAU (GC=F)', valueDigits: 0, valuePrefix: '$' }}
                height={180}
              />
            </div>
          )}
        </Panel>
      )}

      {tab === 'overview' && (
        <Panel>
          <PanelHeader
            eyebrow={t('category.macro')}
            title={t('goldHub.biasTitle')}
            subtitle={t('goldHub.biasSubtitle')}
            icon={<GaugeIcon className="w-4 h-4" />}
            actions={<InfoTooltip text={t('goldHub.biasMethodology')} />}
          />
          {availableBiasFactors.length === 0 ? (
            <div className="mt-4">
              <UnavailableState source="DXY / FRED / GDELT / World Gold Council" detail={t('goldHub.biasNoFactors')} />
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <Badge tone={supportiveCount > availableBiasFactors.length / 2 ? 'up' : supportiveCount < availableBiasFactors.length / 2 ? 'down' : 'warning'}>
                {t('goldHub.biasReadout').replace('{n}', String(supportiveCount)).replace('{total}', String(availableBiasFactors.length))}
              </Badge>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {biasFactors.map((factor) => (
                  <div key={factor.id} className="hev-card-v2 !p-2.5 flex flex-col items-start gap-1">
                    <span className="text-[8px] uppercase tracking-wider text-[var(--text-muted)] truncate w-full">{factor.label}</span>
                    <span className="text-xs font-bold tabular-nums text-[var(--text-primary)]">{factor.readout}</span>
                    {factor.supportive === null ? (
                      <Badge tone="neutral">{t('analysis.noFeed')}</Badge>
                    ) : (
                      <Badge tone={factor.supportive ? 'up' : 'down'}>
                        {factor.supportive ? t('goldHub.biasSupportive') : t('goldHub.biasNegative')}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      )}

      {tab === 'overview' && (
        <Panel>
          <PanelHeader
            eyebrow={t('category.macro')}
            title={t('goldHub.etfFlowTitle')}
            subtitle={t('goldHub.etfFlowSubtitle')}
            icon={<Vault className="w-4 h-4" />}
            actions={
              gldHoldings.data?.fetchedAt && (
                <DataQualityBadge
                  compact
                  meta={{
                    source: gldHoldings.data.source,
                    lastUpdated: gldHoldings.data.fetchedAt,
                    status: gldHoldings.data.stale
                      ? 'STALE'
                      : statusFromAge(gldHoldings.data.fetchedAt, 24 * 60 * 60_000, 4 * 24 * 60 * 60_000),
                  }}
                />
              )
            }
          />
          {gldHoldings.data?.unavailable || !gldFlow.latest ? (
            <div className="mt-4">
              <UnavailableState source="SPDR Gold Shares" detail={gldHoldings.data?.error} />
            </div>
          ) : (
            <div className="mt-4 flex items-center justify-between gap-3">
              <div>
                <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('goldHub.etfFlowGld')}</span>
                <span className="text-2xl font-black tabular-nums text-[var(--text-primary)]">
                  {formatNumber(gldFlow.latest.tonnes, 1)}t
                </span>
                {gldFlow.changeTonnes !== null && (
                  <span
                    className={`block text-[10px] font-bold tabular-nums mt-0.5 ${gldFlow.changeTonnes >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}
                  >
                    {formatNumber(gldFlow.changeTonnes, 1, { signed: true })}t
                    {gldFlow.changePercent !== null && ` (${formatPercent(gldFlow.changePercent, 1, { signed: true })})`} · {t('goldHub.etfFlow30d')}
                  </span>
                )}
              </div>
              {gldFlow.sparkline.length > 1 && <Sparkline values={gldFlow.sparkline.slice(-90)} width={100} height={32} />}
            </div>
          )}
          <p className="mt-3 pt-2 border-t border-[var(--border-subtle)] text-[9px] text-[var(--text-muted)] leading-relaxed">
            {t('goldHub.etfFlowIauNote')}
          </p>
        </Panel>
      )}

      {tab === 'overview' && dxy.isLoading && futures.isLoading && cbGold.isLoading && seasonality.isLoading && (
        <LoadingState variant="cards" />
      )}

      {tab === 'overview' && !(dxy.isLoading && futures.isLoading && cbGold.isLoading && seasonality.isLoading) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => setTab('overview')}
            className="text-left hev-card-v2 !p-4"
          >
            <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
              <DollarSign className="w-3 h-3" /> {t('module.dxy')}
            </span>
            {!dxy.data || dxy.data.unavailable ? (
              <span className="block text-lg font-black text-[var(--text-muted)] mt-1">—</span>
            ) : (
              <>
                <LiveValue
                  value={dxy.data.price}
                  className="block text-2xl font-black tabular-nums text-[var(--text-primary)] mt-1"
                  render={(v) => (v === null ? '—' : formatNumber(v as number, 3))}
                />
                <span
                  className={`block text-[11px] font-bold tabular-nums mt-1 ${
                    dxy.data.trend15m === null ? 'text-[var(--text-muted)]' : dxy.data.trend15m >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'
                  }`}
                >
                  {dxy.data.trend15m === null ? '—' : formatPercent(dxy.data.trend15m, 2, { signed: true })} / 15m
                </span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setTab('futures')}
            className="text-left hev-card-v2 !p-4 hover:border-[var(--border-strong)] transition-colors"
          >
            <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
              <LineChartIcon className="w-3 h-3" /> {t('xauCurve.shape')}
            </span>
            {!hasFutures || !nearMonth ? (
              <span className="block text-lg font-black text-[var(--text-muted)] mt-1">—</span>
            ) : farMonth ? (
              <>
                <span className={`block text-lg font-black mt-1 ${isContango ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                  {isContango ? t('xauCurve.contango') : t('xauCurve.backwardation')}
                </span>
                <span className="block text-[10px] text-[var(--text-muted)] mt-1 tabular-nums">
                  {nearMonth.label} → {farMonth.label}: {farMonth.price! >= nearMonth.price! ? '+' : ''}
                  {formatNumber(farMonth.price! - nearMonth.price!, 2)}
                </span>
              </>
            ) : (
              <>
                <span className="block text-lg font-black text-[var(--text-primary)] mt-1 tabular-nums">
                  ${formatNumber(nearMonth.price!, 2)}
                </span>
                <span className="block text-[10px] text-[var(--text-muted)] mt-1">{nearMonth.label}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setTab('cbgold')}
            className="text-left hev-card-v2 !p-4 hover:border-[var(--border-strong)] transition-colors"
          >
            <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
              <Landmark className="w-3 h-3" /> {t('goldHub.topMover')}
            </span>
            {!topMover ? (
              <span className="block text-lg font-black text-[var(--text-muted)] mt-1">—</span>
            ) : (
              <>
                <span className="block text-lg font-black text-[var(--text-primary)] mt-1">{topMover.country}</span>
                <span className={`block text-[11px] font-bold tabular-nums mt-1 ${topMover.changeTonnes >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                  {formatNumber(topMover.changeTonnes, 0, { signed: true })}t · {cbGold.data?.lastReportedMonth}
                </span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setTab('seasonality')}
            className="text-left hev-card-v2 !p-4 hover:border-[var(--border-strong)] transition-colors"
          >
            <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
              <CalendarDays className="w-3 h-3" /> {seasonalityTileIsCurrentMonth ? t('seasonality.thisMonth') : t('goldHub.deepestMonth')}
            </span>
            {!seasonalityTile ? (
              <span className="block text-lg font-black text-[var(--text-muted)] mt-1">—</span>
            ) : (
              <>
                <span
                  className={`block text-lg font-black mt-1 ${
                    seasonalityTile.positiveYears >= seasonalityTile.negativeYears ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'
                  }`}
                >
                  {Math.round((seasonalityTile.positiveYears / seasonalityTile.totalYears) * 100)}% {t('seasonality.bullish')}
                </span>
                <span className="block text-[10px] text-[var(--text-muted)] mt-1">
                  {seasonalityTileIsCurrentMonth
                    ? `${seasonalityTile.positiveYears}/${seasonalityTile.totalYears} ${t('seasonality.observations')}`
                    : t(`seasonality.month.${MONTH_KEYS[seasonalityTile.month - 1]}`)}
                </span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Roadmap §4/§5: ETF Holdings GLD/IAU flow - investigated (see OtherFlowsView.tsx for the
          full audit), no free source returns it as parseable JSON. Surfaced here as an explicit
          gap in Gold's own home rather than left silently missing, reusing that same investigated
          conclusion instead of re-deriving it or, worse, faking a number. */}
      {tab === 'overview' && (
        <div className="hev-card-v2 !p-3">
          <Badge tone="warning">
            {t('goldHub.etfHoldingsLabel')} · {t('analysis.providerNotWired')}
          </Badge>
          <p className="mt-1.5 text-[9px] text-[var(--text-muted)] leading-relaxed">{t('goldHub.etfHoldingsDetail')}</p>
        </div>
      )}

      {tab === 'futures' && <FuturesCurveTab data={futures.data} isLoading={futures.isLoading} t={t} />}
      {tab === 'cbgold' && <CentralBankGoldTab data={cbGold.data} isLoading={cbGold.isLoading} rumorData={rumors.data} t={t} />}
      {tab === 'seasonality' && <SeasonalityTab data={seasonality.data} isLoading={seasonality.isLoading} t={t} />}
    </div>
  );
};

const FuturesCurveTab: React.FC<{
  data: XauFuturesCurveResponse | null;
  isLoading: boolean;
  t: (key: string) => string;
}> = ({ data, isLoading, t }) => {
  if (isLoading && !data) return <LoadingState variant="cards" />;
  const hasData = data && !data.unavailable && data.curve.some((c) => c.price !== null);
  const priced = hasData ? data!.curve.filter((c) => c.price !== null) : [];
  const nearMonth = priced[0] ?? null;
  const farMonth = priced.length > 1 ? priced[priced.length - 1] : null;
  const isContango = nearMonth && farMonth ? farMonth.price! > nearMonth.price! : null;
  const points: LinePoint[] = priced.map((c) => ({ label: c.label, value: c.price as number }));

  return (
    <Panel>
      <PanelHeader
        title={t('module.xauFuturesCurve')}
        subtitle={t('xauCurve.subtitle')}
        titleVariant="chart"
        actions={
          <div className="flex items-center gap-2">
            {data && !data.unavailable && (
              <DataQualityBadge meta={{ source: data.source, lastUpdated: data.fetchedAt, status: statusFromAge(data.fetchedAt, 15 * 60_000, 60 * 60_000) }} />
            )}
            <InfoTooltip text={t('xauCurve.methodNote')} />
          </div>
        }
      />

      {!hasData ? (
        <div className="mt-4">
          <UnavailableState source={data?.source ?? 'Yahoo Finance (COMEX gold futures)'} detail={data?.error ?? t('xauCurve.unavailableDetail')} />
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {nearMonth && farMonth && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              <span>
                {t('xauCurve.shape')}:{' '}
                <strong className={isContango ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}>
                  {isContango ? t('xauCurve.contango') : t('xauCurve.backwardation')}
                </strong>
              </span>
              <span>
                {nearMonth.label} → {farMonth.label}:{' '}
                <strong className="text-[var(--text-primary)] tabular-nums">
                  {farMonth.price! >= nearMonth.price! ? '+' : ''}
                  {formatNumber(farMonth.price! - nearMonth.price!, 2)}
                </strong>
              </span>
            </div>
          )}

          <CurveChart points={points} valueDigits={2} color="var(--color-up)" />

          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="text-left font-normal py-1">{t('xauCurve.contract')}</th>
                  <th className="text-right font-normal py-1">{t('xauCurve.price')}</th>
                  <th className="text-right font-normal py-1">{t('xauCurve.vsNear')}</th>
                </tr>
              </thead>
              <tbody>
                {data!.curve.map((c) => (
                  <tr key={c.symbol} className="border-t border-[var(--border-subtle)]">
                    <td className="py-1.5 text-[var(--text-primary)] font-bold">{c.label}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {c.price !== null ? `$${formatNumber(c.price, 2)}` : `— (${c.error ?? t('xauCurve.noQuote')})`}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--text-secondary)]">
                      {c.price !== null && nearMonth && c.symbol !== nearMonth.symbol
                        ? `${c.price - nearMonth.price! >= 0 ? '+' : ''}${formatNumber(c.price - nearMonth.price!, 2)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
};

const CentralBankGoldTab: React.FC<{
  data: CentralBankGoldResponse | null;
  isLoading: boolean;
  rumorData: GoldPurchaseRumorResponse | null;
  t: (key: string) => string;
}> = ({ data, isLoading, rumorData, t }) => {
  if (isLoading && !data) return <LoadingState variant="cards" />;
  const hasData = data && !data.unavailable && data.rows.length > 0;
  const chartData: HBarDatum[] = hasData
    ? [...data!.rows].sort((a, b) => b.changeTonnes - a.changeTonnes).map((r) => ({ label: r.country, value: r.changeTonnes }))
    : [];
  const rumors = rumorData?.rumors ?? [];

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title={t('module.centralBankGold')}
          subtitle={t('cbGold.subtitle')}
          actions={
            <div className="flex items-center gap-2">
              {data && !data.unavailable && (
                <DataQualityBadge
                  meta={{ source: data.source, lastUpdated: data.fetchedAt, status: data.stale ? 'STALE' : statusFromAge(data.fetchedAt, 26 * 60 * 60_000, 72 * 60 * 60_000) }}
                />
              )}
              <InfoTooltip text={`${t('cbGold.methodNote')} ${t('cbGold.tier2Closed')}`} />
            </div>
          }
        />

        {!hasData ? (
          <div className="mt-4">
            <UnavailableState source={data?.source ?? 'World Gold Council - Gold Focus'} detail={data?.error ?? t('cbGold.unavailableDetail')} />
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              <span>
                {t('cbGold.lastReported')}: <strong className="text-[var(--text-primary)]">{data!.lastReportedMonth}</strong>
              </span>
              {data!.postUrl && (
                <a href={data!.postUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-gold)] hover:underline normal-case tracking-normal">
                  {t('cbGold.readSource')} ↗
                </a>
              )}
            </div>
            <HBarChart data={chartData} diverging unit="t" digits={0} />
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title={t('cbGold.rumorsTitle')}
          subtitle={t('cbGold.rumorsSubtitle')}
          actions={<InfoTooltip text={t('cbGold.rumorsDisclaimer')} />}
        />
        <div className="mt-4 space-y-2">
          {rumors.length === 0 ? (
            <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">{t('cbGold.rumorsEmpty')}</p>
          ) : (
            rumors.map((r) => (
              <div key={r.id} className="border border-[var(--border-subtle)] rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="warning">{t('cbGold.unconfirmed')}</Badge>
                  {r.country && (
                    <span className="text-[10px] font-bold text-[var(--text-primary)] uppercase tracking-wider">
                      {r.country}
                      {r.tonnesEstimate !== null ? ` · ${r.tonnesEstimate}t` : ''}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{r.title}</p>
                {r.reason && <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">{r.reason}</p>}
                {r.sourceUrl && (
                  <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-[10px] text-[var(--accent-gold)] hover:underline">
                    {t('cbGold.readSource')} ↗
                  </a>
                )}
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
};

const SeasonalityTab: React.FC<{
  data: GoldSeasonalityResponse | null;
  isLoading: boolean;
  t: (key: string) => string;
}> = ({ data, isLoading, t }) => {
  if (isLoading && !data) return <LoadingState variant="cards" />;
  const hasData = data && !data.unavailable && data.months.some((m) => m.totalYears > 0);
  const currentMonthIndex = new Date().getUTCMonth();
  const currentMonthData = data?.months.find((m) => m.month === currentMonthIndex + 1);
  const chartData: HBarDatum[] = hasData
    ? data!.months
        .filter((m) => m.avgReturnPercent !== null)
        .map((m) => ({ label: t(`seasonality.month.${MONTH_KEYS[m.month - 1]}`), value: m.avgReturnPercent as number, sublabel: `${m.positiveYears}/${m.totalYears}` }))
    : [];

  return (
    <Panel>
      <PanelHeader
        title={t('module.goldSeasonality')}
        subtitle={t('seasonality.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            {data && !data.unavailable && (
              <DataQualityBadge meta={{ source: data.source, lastUpdated: data.fetchedAt, status: statusFromAge(data.fetchedAt, 24 * 60 * 60_000, 48 * 60 * 60_000) }} />
            )}
            <InfoTooltip text={t('seasonality.methodNote')} />
          </div>
        }
      />

      {!hasData ? (
        <div className="mt-4">
          <UnavailableState source={data?.source ?? 'Yahoo Finance (GC=F)'} detail={data?.error ?? t('seasonality.unavailableDetail')} />
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            <span>
              {t('seasonality.yearsCovered')}: <strong className="text-[var(--text-primary)]">{data!.yearsCovered}</strong> ({data!.firstDate?.slice(0, 4)}–{data!.lastDate?.slice(0, 4)})
            </span>
            {currentMonthData && currentMonthData.totalYears > 0 && (
              <span>
                {t('seasonality.thisMonth')}:{' '}
                <strong className={currentMonthData.positiveYears >= currentMonthData.negativeYears ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}>
                  {`${Math.round((currentMonthData.positiveYears / currentMonthData.totalYears) * 100)}% ${t('seasonality.bullish')}`}
                </strong>{' '}
                ({currentMonthData.positiveYears}/{currentMonthData.totalYears} {t('seasonality.observations')})
              </span>
            )}
          </div>
          <HBarChart data={chartData} diverging unit="%" digits={2} />
        </div>
      )}
    </Panel>
  );
};
