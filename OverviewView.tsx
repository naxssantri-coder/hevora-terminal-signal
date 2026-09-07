import React, { useMemo, useRef } from 'react';
import {
  TrendingUp,
  Radio,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  ShieldCheck,
  Users,
  Activity,
  Flame,
  Star,
  Target,
  Gauge as GaugeIcon
} from 'lucide-react';
import { useUser } from '@clerk/clerk-react';
import { MarketPrice, Signal, PairId, ScanStatus, FearGreedResponse, GeopoliticalRiskResponse } from '../types';
import { PAIRS_LIST } from '../data/pairs';
import { BlurredValue, SignalBlurBanner } from './BlurredValue';
import { PairIcon } from './PairIcon';
import { useTranslation } from '../i18n/LanguageContext';
import { isActiveSignal, pickTopSignals } from '../lib/signals';
import { useWatchlist } from '../lib/watchlist';
import { useMarketRegime } from '../lib/useMarketRegime';
import { regimeLabelKey, type CandlesResponse } from '../lib/analytics';
import { latestValue, useFredSeries } from '../lib/useFredSeries';
import { useEndpoint } from '../lib/useEndpoint';
import { Badge } from './ui';
import { AlertBell } from './alerts/AlertBell';
import {
  AnimatedNumber,
  GaugeRadial,
  LiveValue,
  ProgressRing,
  RangePositionBar,
  SparklineCell,
  glowClass,
  glowForRegimeScore,
  type GaugeZone,
} from './viz';

/** Same green/red/neutral palette Card 3 (Active Signals) and the rest of this page already use. */
const regimeColor = (score: number | null): string => {
  if (score === null) return 'var(--text-muted)';
  if (score >= 55) return '#2ECC71';
  if (score <= 45) return '#FF4D4F';
  return 'var(--text-primary)';
};

const regimeBadgeTone = (score: number | null): 'up' | 'down' | 'neutral' => {
  if (score === null) return 'neutral';
  if (score >= 55) return 'up';
  if (score <= 45) return 'down';
  return 'neutral';
};

const REGIME_ZONES: GaugeZone[] = [
  { from: 0, to: 45, color: '#FF4D4F', label: 'RISK-OFF' },
  { from: 45, to: 55, color: 'var(--text-primary)', label: 'NEUTRAL' },
  { from: 55, to: 100, color: '#2ECC71', label: 'RISK-ON' },
];

// Same fear=red/greed=green read as the full Fear & Greed panel (Analysis > Liquidity & Flow),
// just collapsed to a badge tone - 0-25 extreme fear through 75-100 extreme greed.
const fearGreedBadgeTone = (value: number | null): 'up' | 'down' | 'warning' | 'neutral' => {
  if (value === null) return 'neutral';
  if (value <= 25) return 'down';
  if (value <= 45) return 'warning';
  if (value >= 55) return 'up';
  return 'neutral';
};

// Same 66/33 thresholds GeopoliticalRiskView's own scoreColor/scoreBandKey use - high score is
// bad here (elevated risk), the opposite sense from the regime/fear-greed reads above it.
const geoRiskBadgeTone = (score: number | null): 'up' | 'down' | 'warning' | 'neutral' => {
  if (score === null) return 'neutral';
  if (score >= 66) return 'down';
  if (score >= 33) return 'warning';
  return 'up';
};

interface OverviewViewProps {
  prices: Record<PairId, MarketPrice>;
  signals: Record<PairId, Signal | null>;
  scanStatus?: Partial<Record<PairId, ScanStatus>>;
  tradersCount?: number | null;
  onSelectPair: (pairId: PairId) => void;
  /** Route-based navigation (Fase 2) - replaces the old tab-name callback. */
  onNavigate: (route: string) => void;
  /** Opens the auth modal, carrying the route the click was actually trying to reach. */
  onOpenAuthModal?: (route?: string) => void;
  signalsBlurred?: boolean;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  prices,
  signals,
  scanStatus = {},
  tradersCount,
  onSelectPair,
  onNavigate,
  onOpenAuthModal,
  signalsBlurred = false,
}) => {
  const signalArray = (Object.values(signals) as Signal[]).filter(Boolean);
  const { isSignedIn } = useUser();
  const watchlistRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  const { has: isWatched, toggle: toggleWatch } = useWatchlist();

  // Card 5 (Market Regime) and the Macro Snapshot row (Fase 11 §3): same composite regime score
  // and the same DXY/VIX feeds behind it, computed once here and read again on the dedicated
  // Analysis > Market Regime page via the same useMarketRegime hook - never a second copy that
  // could drift. Fed rate is the one series that page doesn't already fetch, so it gets its own
  // small useFredSeries call here (a single series, a short window - this badge only needs the
  // latest print).
  const { regime, dxyPrice, vixValue } = useMarketRegime(prices);
  const { series: fedSeries } = useFredSeries(['FOMC'], 6);
  const fedRate = latestValue(fedSeries.FOMC);

  // Fear & Greed and Geopolitical Risk (layout audit): both used to be reachable only by
  // scrolling to the bottom of Analysis, or into Analysis at all - added here as two more Macro
  // Snapshot badges so a reader sees today's sentiment/risk backdrop without leaving the
  // dashboard. Same endpoints their full panels already read, own poll interval, no new provider
  // calls - only the DXY/VIX/Fed Target row gains two more entries.
  const { data: fearGreedData } = useEndpoint<FearGreedResponse>('/api/sentiment/fear-greed', 15 * 60_000);
  const fearGreedLatest = fearGreedData?.points?.[0] ?? null;
  const { data: geoRiskData } = useEndpoint<GeopoliticalRiskResponse>('/api/intelligence/geopolitical-risk', 15 * 60_000);

  // Watchlist sparklines (Fase 6 dashboard enrichment): the same engine candle store Volatility
  // and Correlation already read from, just close prices per pair rather than returns - a real
  // recent-shape read, not a decorative squiggle.
  const { data: candlesData } = useEndpoint<CandlesResponse>('/api/market/candles', 60_000);

  const protectedNavigateTo = (route: string) => {
    if (!isSignedIn) {
      if (onOpenAuthModal) onOpenAuthModal(route);
      return;
    }
    onNavigate(route);
  };

  const handleProtectedNavigate = (pairId?: PairId) => {
    // The Markets module carries the pair in its URL, so signing in resumes on the exact asset
    // that was clicked instead of dropping the intent and landing on the default one.
    const route = pairId ? `/market/overview?symbol=${encodeURIComponent(pairId)}` : '/market/overview';
    if (!isSignedIn) {
      if (onOpenAuthModal) onOpenAuthModal(route);
      return;
    }
    if (pairId) onSelectPair(pairId);
    onNavigate(route);
  };

  // Institutional Watchlist full-page detail (Institutional Watchlist full-page conversion):
  // clicking a watchlist row or "Buka Terminal" now navigates to its own routed page
  // (/market/institutional/:pairId - see InstitutionalDetailPage) instead of opening a 760px
  // right-hand drawer. Same auth gate as every other protected click on this page, since this
  // still surfaces per-asset positioning/derivatives data - carried over unchanged, just now
  // guarding a navigation instead of a local open() call.
  const openInstitutionalPanel = (pairId: PairId) => {
    if (!isSignedIn) {
      if (onOpenAuthModal) onOpenAuthModal(`/market/institutional/${encodeURIComponent(pairId)}`);
      return;
    }
    onNavigate(`/market/institutional/${encodeURIComponent(pairId)}`);
  };

  const scrollToWatchlist = () => {
    watchlistRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Top/Trending Signals: the 2-4 strongest active setups across categories. Ranking lives in
  // lib/signals.ts (pickTopSignals) so Overview, Live Signals and Scalping Radar all order the
  // same signals identically - it is a presentation layer over what the engine already publishes
  // (status, aiConfidenceScore), never new signal logic.
  const topSignals = useMemo(() => pickTopSignals(signalArray, 4), [signalArray]);

  // Signal Book Direction (Konsolidasi-2): moved here from the old standalone Sentiment tab - this
  // is the engine's own live signal book split (BUY vs SELL), not market sentiment, so it belongs
  // on the Dashboard next to the rest of this terminal's own state, not filed under "Sentiment"
  // alongside an external index like Fear & Greed (which moved to Analysis > Liquidity & Flow).
  const signalBook = useMemo(() => {
    const active = signalArray.filter(isActiveSignal);
    const buys = active.filter((signal) => signal.type === 'BUY').length;
    return { buys, sells: active.length - buys, total: active.length };
  }, [signalArray]);

  return (
    <div className="space-y-5 animate-in fade-in duration-200 text-xs font-mono relative">
      <div className="relative z-10 space-y-4">
        {/* Blur Signal Publik Notice (admin maintenance mode) */}
        {signalsBlurred && <SignalBlurBanner />}

        {/* Platform Tagline - orients first-time visitors in one line, with the registered-trader
            count as a small secondary stat beside it (moved out of the KPI grid below - see Card 2
            removal note). */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] sm:text-xs text-[var(--text-secondary)] font-medium tracking-wide">
            {t('overview.tagline')}
          </p>
          <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] font-medium">
            <Users className="w-3 h-3 text-[var(--text-primary)]" />
            <AnimatedNumber
              value={tradersCount ?? null}
              digits={0}
              format={(v) => Math.round(v).toLocaleString()}
              className="hev-count-transition font-bold text-[var(--text-primary)]"
            />
            <span className="uppercase tracking-wider">{t('overview.registeredTraders')}</span>
          </span>
        </div>

        {/* Level 1: Institutional Metric Cards - Registered Traders (formerly Card 2 here) moved
            up next to the tagline above: it is a passive stat, not a KPI on the same footing as
            these four, so this grid is 4-wide now instead of 5. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Card 1: Market Coverage - clickable, jumps to Markets tab. Routed through
              handleProtectedNavigate (not a direct onNavigate call) so signed-out users hit
              the same auth gate as every other route into Markets, instead of slipping past it. */}
          <button
            type="button"
            onClick={() => handleProtectedNavigate()}
            className="text-left hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] p-4 flex flex-col justify-between hover-lift relative overflow-hidden group transition-colors duration-200 cursor-pointer"
          >
            <div className="flex items-center justify-between text-[var(--text-muted)] relative z-10">
              <span className="text-[10px] font-bold tracking-widest uppercase">{t('overview.marketCoverage')}</span>
              <Activity className="w-4 h-4 text-[var(--text-primary)]" />
            </div>
            <div className="mt-3 relative z-10 flex items-end justify-between gap-2">
              <div>
                <div className="hev-hero-number text-[var(--text-primary)]">
                  {PAIRS_LIST.length} {t('overview.pairs')}
                </div>
                <span className="text-[10px] text-[var(--text-muted)] font-medium block mt-1">{t('overview.marketCoverageSub')}</span>
              </div>
              <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] group-hover:translate-x-0.5 transition-all shrink-0 mb-0.5" />
            </div>
          </button>

          {/* Card 2 (formerly Registered Traders here) moved next to the tagline above - see the
              secondary stat badge added there. This grid keeps Market Coverage, Active Signals,
              Terminal Health and Market Regime only. */}

          {/* Card: Active Signals - clickable, jumps down to the Institutional Watchlist below */}
          <button
            type="button"
            onClick={scrollToWatchlist}
            className="text-left hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] p-4 flex flex-col justify-between hover-lift relative overflow-hidden group transition-colors duration-200 cursor-pointer"
          >
            <div className="flex items-center justify-between text-[var(--text-muted)] relative z-10">
              <span className="text-[10px] font-bold tracking-widest uppercase">{t('overview.activeSignals')}</span>
              <Radio className="w-4 h-4 text-[#2ECC71]" />
            </div>
            <div className="mt-3 relative z-10 flex items-end justify-between gap-2">
              <div>
                <span className="flex items-baseline gap-1.5">
                  <AnimatedNumber
                    value={signalArray.length}
                    digits={0}
                    className="hev-hero-number hev-count-transition text-[#2ECC71]"
                  />
                  <span className="text-[11px] font-bold text-[#2ECC71]/70 uppercase">{t('overview.setups')}</span>
                </span>
                <span className="text-[10px] text-[var(--text-secondary)] font-medium block mt-1">{t('overview.realtimeSweeps')}</span>
                {/* Signal Book Direction (Konsolidasi-2): the engine's own BUY/SELL split, moved
                    here from the old standalone Sentiment tab - see the signalBook memo above. */}
                {signalBook.total > 0 && (
                  <span className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[10px] font-black text-[var(--color-up)] tabular-nums">{signalBook.buys} BUY</span>
                    <span className="text-[10px] text-[var(--text-muted)]">/</span>
                    <span className="text-[10px] font-black text-[var(--color-down)] tabular-nums">{signalBook.sells} SELL</span>
                  </span>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] group-hover:translate-x-0.5 transition-all shrink-0 mb-0.5" />
            </div>
          </button>

          {/* Card: Terminal Health - informational only, not clickable. */}
          <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] p-4 flex flex-col justify-between relative overflow-hidden group transition-colors duration-200">
            <div className="flex items-center justify-between text-[var(--text-muted)] relative z-10">
              <span className="text-[10px] font-bold tracking-widest uppercase">{t('overview.terminalHealth')}</span>
              <ShieldCheck className="w-4 h-4 text-[#2ECC71]" />
            </div>
            <div className="mt-3 relative z-10">
              <div className="hev-hero-number text-[var(--text-primary)] flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#2ECC71] animate-pulse" />
                <span>{t('overview.online')}</span>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] font-medium block mt-1">{t('overview.latency')}</span>
            </div>
          </div>

          {/* Card 5: Market Regime (Fase 11 §3) - clickable, drills into Analysis > Market Regime
              for the full five-driver breakdown. Same composite score computed once in
              useMarketRegime and read again down there - not a second opinion. */}
          <button
            type="button"
            onClick={() => protectedNavigateTo('/analysis/overview')}
            className={`text-left hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] p-4 flex flex-col justify-between hover-lift relative overflow-hidden group transition-colors duration-200 cursor-pointer ${glowClass(glowForRegimeScore(regime.score))}`}
          >
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[clamp(50px,7vw,90px)] font-black tracking-[0.12em] text-[var(--text-primary)] opacity-[0.012] dark:opacity-[0.018] group-hover:opacity-[0.03] transition-opacity duration-250 select-none blur-[0.8px] leading-none whitespace-nowrap z-0">
              HEVORA
            </div>
            <div className="flex items-center justify-between text-[var(--text-muted)] relative z-10">
              <span className="text-[10px] font-bold tracking-widest uppercase">{t('overview.marketRegime')}</span>
              <GaugeIcon className="w-4 h-4" style={{ color: regimeColor(regime.score) }} />
            </div>
            <div className="mt-1 relative z-10 flex items-end justify-between gap-2">
              <GaugeRadial
                value={regime.score}
                zones={REGIME_ZONES}
                captionOverride={t(regimeLabelKey(regime.score))}
                size={100}
              />
              <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] group-hover:translate-x-0.5 transition-all shrink-0 mb-0.5" />
            </div>
          </button>
        </div>

        {/* Macro Snapshot (Fase 11 §3, extended in the layout audit with Fear & Greed and
            Geopolitical Risk - both used to be reachable only by scrolling deep into Analysis): a
            small badge row, not a full panel, so a reader knows today's backdrop before scrolling
            into Top Signals. Each badge drills into the module that owns its number. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] mr-1">
            {t('overview.macroSnapshot')}
          </span>
          <button type="button" onClick={() => protectedNavigateTo('/macro/dxy')} className="cursor-pointer">
            <Badge tone="neutral">
              <LiveValue
                value={dxyPrice}
                as="span"
                render={(v) => (
                  <>
                    {t('module.dxy')} {v === null ? '—' : <AnimatedNumber value={v as number} digits={3} />}
                  </>
                )}
              />
            </Badge>
          </button>
          <button type="button" onClick={() => protectedNavigateTo('/analysis/overview')} className="cursor-pointer">
            <Badge tone="neutral">
              <LiveValue
                value={vixValue}
                as="span"
                render={(v) => (
                  <>
                    {t('macro.vix')} {v === null ? '—' : <AnimatedNumber value={v as number} digits={2} />}
                  </>
                )}
              />
            </Badge>
          </button>
          <button type="button" onClick={() => protectedNavigateTo('/macro/overview')} className="cursor-pointer">
            <Badge tone="neutral">
              <LiveValue
                value={fedRate}
                as="span"
                render={(v) => (
                  <>
                    {t('macro.fedTarget')} {v === null ? '—' : <AnimatedNumber value={v as number} digits={2} format={(n) => `${n.toFixed(2)}%`} />}
                  </>
                )}
              />
            </Badge>
          </button>
          <button type="button" onClick={() => protectedNavigateTo('/analysis/overview')} className="cursor-pointer">
            <Badge tone={regimeBadgeTone(regime.score)}>{t(regimeLabelKey(regime.score))}</Badge>
          </button>
          <button type="button" onClick={() => protectedNavigateTo('/analysis/overview')} className="cursor-pointer">
            <Badge tone={fearGreedBadgeTone(fearGreedLatest?.value ?? null)}>
              <LiveValue
                value={fearGreedLatest?.value ?? null}
                as="span"
                render={(v) => (
                  <>
                    {t('overview.fearGreedShort')} {v === null ? '—' : <AnimatedNumber value={v as number} digits={0} />}
                    {fearGreedLatest?.classification ? ` · ${fearGreedLatest.classification}` : ''}
                  </>
                )}
              />
            </Badge>
          </button>
          <button type="button" onClick={() => protectedNavigateTo('/analysis/overview')} className="cursor-pointer">
            <Badge tone={geoRiskBadgeTone(geoRiskData?.score ?? null)}>
              <LiveValue
                value={geoRiskData?.score ?? null}
                as="span"
                render={(v) => (
                  <>
                    {t('overview.geoRiskShort')} {v === null ? '—' : <AnimatedNumber value={v as number} digits={0} />}
                  </>
                )}
              />
            </Badge>
          </button>
        </div>

        {/* Top/Trending Signals: highlighted spotlight cards for the 2-4 strongest active
            setups right now (see topSignals / pickTopSignals above and scrollToWatchlist).
            Visually distinct from the plain Watchlist rows below - elevated card with a colored
            accent border - but built from the same design tokens/patterns as the rest of Bagian
            0-7's palette (green=buy/win, red=sell, blue=neutral highlight).
            Mobile: horizontal swipeable snap-scroll carousel (one card at a glance, swipe for
            more) instead of a tall vertical stack. Desktop/tablet (sm+): unchanged grid, all
            cards visible side by side. Same `renderSignalCard` markup powers both - only the
            outer container differs per breakpoint, not the card itself. */}
        {topSignals.length > 0 && (() => {
          const renderSignalCard = (signal: Signal, extraClassName: string) => {
            const market = prices[signal.pairId];
            const isWin = signal.status === 'TP1 Hit' || signal.status === 'TP2 Hit';
            const isBuy = signal.type === 'BUY';
            const accentColor = isWin ? '#2ECC71' : 'var(--color-brand)';

            return (
              <button
                key={signal.id}
                type="button"
                onClick={() => handleProtectedNavigate(signal.pairId)}
                className={`text-left hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] p-5 flex flex-col gap-3 hover-lift relative overflow-hidden group transition-colors duration-200 cursor-pointer ${extraClassName}`}
                style={{ borderLeftWidth: '4px', borderLeftColor: accentColor }}
              >
                <div className="flex items-center justify-between relative z-10">
                  <div className="flex items-center gap-2">
                    <PairIcon pairId={signal.pairId} size={18} />
                    <span className="font-black text-sm text-[var(--text-primary)] tracking-tight">{signal.pairName}</span>
                    <span
                      className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${
                        isBuy ? 'bg-[#2ECC71]/10 text-[#2ECC71]' : 'bg-[#FF4D4F]/10 text-[#FF4D4F]'
                      }`}
                    >
                      {signal.type}
                    </span>
                    {/* XAU/USD-only tiering (Task 4) - undefined for every other pair. */}
                    {signal.signalTier && (
                      <span
                        className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${
                          signal.signalTier === 'SCALP' ? 'bg-[#F5A623]/10 text-[#F5A623]' : 'bg-[var(--color-brand)]/10 text-[var(--color-brand)]'
                        }`}
                      >
                        {signal.signalTier}
                      </span>
                    )}
                  </div>
                  {isWin ? (
                    <span className="inline-flex items-center gap-1 text-[9px] font-black text-[#2ECC71] uppercase tracking-wide">
                      <Target className="w-3 h-3" />
                      {signal.status}
                    </span>
                  ) : (
                    <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wide">{signal.status}</span>
                  )}
                </div>

                <div className="flex items-end justify-between relative z-10">
                  <div className="flex items-center gap-2.5">
                    <ProgressRing value={signal.aiConfidenceScore ?? null} color={accentColor} size={40} strokeWidth={3.5} />
                    <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">{t('overview.aiScore')}</span>
                  </div>
                  {market && (
                    <div className="text-right">
                      <span className="text-[9px] text-[var(--text-muted)] block">{t('overview.marketPrice')}</span>
                      <LiveValue
                        value={market.price}
                        as="span"
                        className="text-xs font-bold text-[var(--text-primary)] tabular-nums"
                        render={() => <BlurredValue blurred={signalsBlurred}>{market.price.toFixed(market.digits)}</BlurredValue>}
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)] pt-2 border-t border-[var(--border-subtle)] relative z-10">
                  <span className="uppercase tracking-wider text-[var(--text-muted)]">{signal.category}</span>
                  <span className="font-bold text-[var(--text-primary)] group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1">
                    {t('overview.open')}
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </button>
            );
          };

          return (
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 px-1">
                <Flame className="w-4 h-4 text-[#FF4D4F]" />
                <h2 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-wider">
                  {t('overview.topSignals')}
                </h2>
                <span className="text-[10px] text-[var(--text-muted)] font-medium">{t('overview.topSignalsSub')}</span>
              </div>

              {/* Mobile: swipeable carousel with scroll-snap */}
              <div className="sm:hidden -mx-4 px-4">
                <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory no-scrollbar pb-1">
                  {topSignals.map((signal) => renderSignalCard(signal, 'shrink-0 w-[82%] snap-center'))}
                </div>
                {topSignals.length > 1 && (
                  <div className="flex items-center justify-center gap-1.5 mt-2.5">
                    {topSignals.map((signal) => (
                      <span key={signal.id} className="w-1.5 h-1.5 rounded-full bg-[var(--border-strong)]" />
                    ))}
                  </div>
                )}
              </div>

              {/* Desktop/tablet: unchanged grid, all cards visible at once */}
              <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {topSignals.map((signal) => renderSignalCard(signal, ''))}
              </div>
            </div>
          );
        })()}

        {/* Watchlist Section: Institutional List Row Format */}
        <div
          ref={watchlistRef}
          className="scroll-mt-24 hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] p-4 space-y-3 relative overflow-hidden group transition-colors duration-200"
        >
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[clamp(80px,12vw,150px)] font-black tracking-[0.12em] text-[var(--text-primary)] opacity-[0.012] dark:opacity-[0.018] group-hover:opacity-[0.03] transition-opacity duration-250 select-none blur-[0.8px] leading-none whitespace-nowrap z-0">
            HEVORA
          </div>
          <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)] relative z-10">
            <div className="flex items-center gap-2.5">
              <TrendingUp className="w-4 h-4 text-[var(--text-primary)]" />
              <h2 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-wider">{t('overview.watchlistTitle')}</h2>
            </div>
            <button
              onClick={() => openInstitutionalPanel('XAUUSD')}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
            >
              <span>{t('overview.openTerminal')}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* List Rows */}
          <div className="space-y-1">
            {PAIRS_LIST.map((pair) => {
              const market = prices[pair.id];
              const signal = signals[pair.id];
              if (!market) return null;

              const isPositive = market.change24h >= 0;

              const changeBadge = (
                <span
                  className={`inline-flex items-center gap-0.5 text-xs font-extrabold tabular-nums ${
                    isPositive ? 'text-[#2ECC71]' : 'text-[#FF4D4F]'
                  }`}
                >
                  {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {isPositive ? '+' : ''}
                  {market.change24h.toFixed(2)}%
                </span>
              );

              const signalTypeBadge = signal ? (
                <span
                  className={`text-[10px] font-black px-2.5 py-0.5 rounded border ${
                    signal.type === 'BUY'
                      ? 'bg-[#2ECC71]/10 text-[#2ECC71] border-[#2ECC71]/30'
                      : 'bg-[#FF4D4F]/10 text-[#FF4D4F] border-[#FF4D4F]/30'
                  }`}
                >
                  {signal.type}
                </span>
              ) : (
                <span className="text-[10px] text-[var(--text-muted)] border border-[var(--border-subtle)] px-2 py-0.5 rounded">
                  {t('overview.neutral')}
                </span>
              );

              const statusBadge = signal ? (
                <span className="text-[10px] text-[var(--text-secondary)] font-medium bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2.5 py-1 rounded">
                  {signal.status}
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1.5 text-[10px] text-[#2ECC71] font-bold bg-[#2ECC71]/10 border border-[#2ECC71]/25 px-2.5 py-1 rounded cursor-help"
                  title={scanStatus[pair.id]?.lastScanReason || t('overview.searchingSetupDefault')}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#2ECC71] animate-pulse" />
                  <span>{t('overview.searchingSetup')}</span>
                </span>
              );

              // Star toggle - the same personal watchlist the Watchlist module reads
              // (lib/watchlist.ts). stopPropagation keeps a star tap from also opening the asset.
              const watchButton = (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleWatch(pair.id);
                  }}
                  aria-pressed={isWatched(pair.id)}
                  aria-label={`${isWatched(pair.id) ? t('overview.removeFromWatchlist') : t('overview.addToWatchlist')} ${pair.name}`}
                  title={isWatched(pair.id) ? t('overview.removeFromWatchlist') : t('overview.addToWatchlist')}
                  className="shrink-0 p-1 rounded cursor-pointer transition-colors text-[var(--text-muted)] hover:text-[var(--accent-gold)]"
                >
                  <Star
                    className="w-3.5 h-3.5"
                    fill={isWatched(pair.id) ? 'var(--accent-gold)' : 'none'}
                    stroke={isWatched(pair.id) ? 'var(--accent-gold)' : 'currentColor'}
                  />
                </button>
              );

              // Alert bell sits beside the star: both are per-asset controls the trader reaches
              // for from the same row, and neither should trigger the row's own navigation.
              const alertButton = <AlertBell pairId={pair.id} market={market} />;

              const openAction = (
                <span className="text-xs text-[var(--text-primary)] group-hover:translate-x-1 font-bold inline-flex items-center gap-1 transition-all">
                  <span>{t('overview.open')}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              );

              return (
                <React.Fragment key={pair.id}>
                  {/* Mobile: 2-line layout (name+price / change+status+action) - the old single
                      row forced 4-5 fixed-width columns into one line, which clipped the %change
                      and Open action off the right edge on narrow screens instead of wrapping. */}
                  <div
                    onClick={() => openInstitutionalPanel(pair.id)}
                    className="sm:hidden py-2 px-3 rounded-xl border border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--card-hover-bg)] cursor-pointer transition-all duration-150 group space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <PairIcon pairId={pair.id} size={18} className="shrink-0" />
                        <div className="min-w-0">
                          <span className="font-extrabold text-sm text-[var(--text-primary)] tracking-tight block truncate">
                            {pair.name}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{pair.category}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="text-right">
                          <LiveValue
                            value={market.price}
                            as="span"
                            className="font-black text-sm text-[var(--text-primary)] tabular-nums block"
                            render={() => <BlurredValue blurred={signalsBlurred}>{market.price.toFixed(market.digits)}</BlurredValue>}
                          />
                          <span className="text-[10px] text-[var(--text-muted)]">{t('overview.marketPrice')}</span>
                        </div>
                        {watchButton}
                        {alertButton}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-[var(--border-subtle)]">
                      <div className="flex items-center gap-2 min-w-0 shrink-0">
                        {changeBadge}
                        {/* When there's no active signal, the type badge ("NEUTRAL") and the
                            status pill ("Searching Setup...") both just say "nothing yet" -
                            showing both was redundant AND the combined width overflowed this
                            line, visually overlapping the two badges on top of each other. Only
                            show the type badge on mobile when there's an actual signal to name. */}
                        {signal && signalTypeBadge}
                      </div>
                      <div className="flex items-center gap-2 min-w-0 justify-end">
                        {statusBadge}
                        {openAction}
                      </div>
                    </div>
                  </div>

                  {/* Desktop/tablet: unchanged single-line layout, all columns side by side */}
                  <div
                    onClick={() => openInstitutionalPanel(pair.id)}
                    className="hidden sm:flex py-2 px-3 rounded-xl border border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--card-hover-bg)] cursor-pointer transition-all duration-150 items-center justify-between gap-4 group"
                  >
                    {/* Asset Info */}
                    <div className="w-36 shrink-0 flex items-start gap-2">
                      <PairIcon pairId={pair.id} size={18} className="mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <span className="font-extrabold text-sm text-[var(--text-primary)] tracking-tight block">
                          {pair.name}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{pair.category}</span>
                      </div>
                    </div>

                    {/* Price - flashes green/red for a tick when it actually moves */}
                    <div className="text-right w-28 shrink-0">
                      <LiveValue
                        value={market.price}
                        as="span"
                        className="font-black text-sm text-[var(--text-primary)] tabular-nums block"
                        render={() => <BlurredValue blurred={signalsBlurred}>{market.price.toFixed(market.digits)}</BlurredValue>}
                      />
                      <span className="text-[10px] text-[var(--text-muted)]">{t('overview.marketPrice')}</span>
                    </div>

                    {/* Recent shape - the same engine candle store Volatility/Correlation read,
                        closes only. Hidden below lg: not enough row width to show it without
                        crowding the columns that carry the actual decision-relevant numbers. */}
                    <div className="hidden lg:block w-16 shrink-0">
                      <SparklineCell values={(candlesData?.candles[pair.id] ?? []).map((c) => c.c)} />
                    </div>

                    {/* 24h range position (§ Bagian A) - real high24h/low24h/price, never a
                        fabricated range. Only at xl+: the row is already tight below that. */}
                    <div className="hidden xl:block w-24 shrink-0">
                      <RangePositionBar low={market.low24h} high={market.high24h} value={market.price} />
                      <div className="flex items-center justify-between text-[8px] text-[var(--text-muted)] tabular-nums mt-0.5">
                        <span>{market.low24h.toFixed(market.digits)}</span>
                        <span>{market.high24h.toFixed(market.digits)}</span>
                      </div>
                    </div>

                    {/* 24h Change */}
                    <div className="text-right w-24 shrink-0">{changeBadge}</div>

                    {/* Signal Type */}
                    <div className="text-center w-24 shrink-0">{signalTypeBadge}</div>

                    {/* Status */}
                    <div className="text-center w-28 shrink-0 hidden md:block">{statusBadge}</div>

                    {/* Per-asset controls: watchlist star + alert bell */}
                    <div className="shrink-0 flex items-center gap-0.5">
                      {watchButton}
                      {alertButton}
                    </div>

                    {/* Action */}
                    <div className="text-right shrink-0">{openAction}</div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
