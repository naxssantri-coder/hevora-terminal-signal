import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { OverviewView } from './components/OverviewView';
import { AuthModal } from './components/AuthModal';
import { IntroAnimation } from './components/IntroAnimation';
import { LoadingState, UnavailableState } from './components/ui';
import { AppShell } from './components/shell/AppShell';
import { AccessGate } from './components/shell/AccessGate';
import { ModulePlaceholder } from './components/shell/ModulePlaceholder';
import { NotFoundView } from './components/shell/NotFoundView';
import { ShellProvider, useShell } from './components/shell/ShellContext';
import { matchRoute, useRouter } from './lib/router';
import { isEnginePair } from './lib/assets/universe';
import { evaluateRules } from './lib/alerts/engine';
import type { AlertEvent } from './lib/alerts/types';
import { AlertToaster } from './components/alerts/AlertToaster';
import { readRules, useAlerts } from './lib/alerts/store';
import { PairId, Signal, MarketPrice, EconomicEvent, SignalStateResponse, SiteSettings, ScanStatus } from './types';
import { PAIRS_MAP } from './data/pairs';
import { useTranslation } from './i18n/LanguageContext';

/**
 * Modules are code-split (§7.10 lazyLoad) - only Overview, the landing module, is eager. The
 * heavy ones (History ~1.8k lines, Economic History ~1.4k, Admin ~900) no longer sit in the
 * first bundle a visitor downloads.
 */
// MarketsPage owns MarketView, ScalpingRadarView and CommodityBoard internally now (Fase 10 §2) -
// they are not imported here directly, App.tsx only needs the page that composes them.
const MarketsPage = lazy(() => import('./components/market/MarketsPage').then((m) => ({ default: m.MarketsPage })));
const AdminDashboard = lazy(() => import('./components/AdminDashboard').then((m) => ({ default: m.AdminDashboard })));
const LiveEventDetailPage = lazy(() =>
  import('./components/LiveEventDetailPage').then((m) => ({ default: m.LiveEventDetailPage }))
);
// Institutional Watchlist full-page detail (full-page conversion, was a 760px drawer inside
// OverviewView) - own route, same lazy-loaded full-page pattern as LiveEventDetailPage above.
const InstitutionalDetailPage = lazy(() =>
  import('./components/market/InstitutionalDetailPage').then((m) => ({ default: m.InstitutionalDetailPage }))
);
// Nav Consolidation Fase 4b: ETH-USDT Depth and Liquidity Map merged into this one hub - see
// registry.ts's btc-usdt-depth entry and OrderBookLiquidityHub.tsx.
const OrderBookLiquidityHub = lazy(() =>
  import('./components/market/OrderBookLiquidityHub').then((m) => ({ default: m.OrderBookLiquidityHub }))
);
// Nav Consolidation Fase 3: Market Regime, Currency Strength, Correlation, Volatility,
// Geopolitical Risk, Liquidity & Flow, Technical Overview and Session Intelligence merged into
// this one hub - see registry.ts's market-regime entry and AnalysisHub.tsx.
const AnalysisHub = lazy(() => import('./components/analysis/AnalysisHub').then((m) => ({ default: m.AnalysisHub })));
const PositioningView = lazy(() =>
  import('./components/analysis/PositioningView').then((m) => ({ default: m.PositioningView }))
);
// Nav Consolidation Fase 1 (Hub 4a): Macro Snapshot, Central Banks, Interest Rates, Yield Curve
// and Treasury merged into this one hub component - see registry.ts's macro-overview entry and
// PolicyRatesHub.tsx's own header comment.
const PolicyRatesHub = lazy(() =>
  import('./components/macro/PolicyRatesHub').then((m) => ({ default: m.PolicyRatesHub }))
);
// Nav Consolidation Fase 2 (Hub 4b): DXY, Gold Seasonality, XAU Futures Curve and Central Bank
// Gold Buying merged into this one hub - see registry.ts's dxy entry and GoldIntelligenceHub.tsx.
const GoldIntelligenceHub = lazy(() =>
  import('./components/macro/GoldIntelligenceHub').then((m) => ({ default: m.GoldIntelligenceHub }))
);
// Mobile pill-row cleanup, item 3: Oil Intelligence, the futures board and the Market State
// confluence read moved out of Markets > Commodities into this sibling hub - see registry.ts's
// commodities-intelligence entry and CommoditiesIntelligenceHub.tsx.
const CommoditiesIntelligenceHub = lazy(() =>
  import('./components/macro/CommoditiesIntelligenceHub').then((m) => ({ default: m.CommoditiesIntelligenceHub }))
);
// Nav Consolidation Fase 2 (Hub 4d): Global Macro, Inflation & Growth, Economic History and
// On-Chain Macro merged into this one hub - see registry.ts's global-macro entry and
// EconomyLiquidityHub.tsx (which imports EconomicHistoryView directly for its own Historical
// Archive tab, so that component no longer needs its own top-level lazy entry here).
const EconomyLiquidityHub = lazy(() =>
  import('./components/macro/EconomyLiquidityHub').then((m) => ({ default: m.EconomyLiquidityHub }))
);
// Nav Consolidation Fase 5: Breaking News merged into News Feed (renamed "News") as an in-page
// filter chip - see registry.ts's news-feed entry and NewsHub.tsx.
const NewsHub = lazy(() => import('./components/intelligence/NewsHub').then((m) => ({ default: m.NewsHub })));
// Research merged into AI Market Brief, renamed "AI Studio" - see registry.ts's ai-market-brief
// entry and AiStudioHub.tsx.
const AiStudioHub = lazy(() => import('./components/intelligence/AiStudioHub').then((m) => ({ default: m.AiStudioHub })));
// Live Desk - 3rd Intelligence choice alongside News/AI Studio - see registry.ts's live-desk
// entry and LiveDeskView.tsx.
const LiveDeskView = lazy(() => import('./components/intelligence/LiveDeskView').then((m) => ({ default: m.LiveDeskView })));
// Central Bank Events and AI Event Analysis merged into Economic Calendar, renamed "Calendar" -
// see registry.ts's economic-calendar entry and CalendarHub.tsx.
const CalendarHub = lazy(() => import('./components/calendar/CalendarHub').then((m) => ({ default: m.CalendarHub })));
// Paper Trading and Trading Journal merged into Performance as two more in-page tabs - see
// registry.ts's performance entry and PerformanceHub.tsx.
const PerformanceHub = lazy(() => import('./components/performance/PerformanceHub').then((m) => ({ default: m.PerformanceHub })));
// Roadmap §F: About/Team/Terms/Privacy/Regulatory Disclosure - see registry.ts's company-info
// entry and LegalHub.tsx.
const LegalHub = lazy(() => import('./components/company/LegalHub').then((m) => ({ default: m.LegalHub })));
const INTRO_SESSION_KEY = 'hev_intro_shown';

export default function App() {
  const { isSignedIn } = useUser();

  // Splash/intro plays once per browser session (sessionStorage, not localStorage) - same rule
  // for signed-in and signed-out visitors alike. A fresh tab / new session sees it again; a
  // reload or tab switch within the same session does not.
  const [showIntro, setShowIntro] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return sessionStorage.getItem(INTRO_SESSION_KEY) !== '1';
    } catch {
      return true;
    }
  });

  // Premium redesign: a professional multi-asset terminal (Bloomberg/Bookmap/TradingView Pro
  // territory) defaults to a dark instrumentation surface, not a bright marketing-site page - so
  // a first-time visitor with no saved preference lands on 'dark'. Anyone who already chose light
  // (saved in localStorage, or the html tag already carries the attribute from a prior session)
  // keeps that choice untouched.
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('hev_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      const attr = document.documentElement.getAttribute('data-theme');
      if (attr === 'dark' || attr === 'light') return attr;
    }
    return 'dark';
  });

  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  // Remembers the route a signed-out user was actually trying to reach when a protected
  // navigation forced the auth modal open. Without it the click's intent was silently dropped:
  // the modal opened, the user signed in, and they landed on the default view instead of what
  // they clicked.
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);

  // Apply theme to root html element and sync to localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('hev_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  return (
    <ShellProvider
      isSignedIn={Boolean(isSignedIn)}
      onRequireAuth={(route) => {
        setPendingRoute(route);
        setIsAuthModalOpen(true);
      }}
    >
      <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)] flex flex-col font-sans selection:bg-accent selection:text-black transition-colors duration-200 relative overflow-hidden">
        {showIntro && (
          <IntroAnimation
            onComplete={() => {
              try {
                sessionStorage.setItem(INTRO_SESSION_KEY, '1');
              } catch {
                // sessionStorage unavailable (private mode edge case) - not fatal, intro just
                // replays next load instead of being remembered for the session.
              }
              setShowIntro(false);
            }}
          />
        )}

        <div className="relative z-10 flex flex-col min-h-screen">
          <TerminalRoutes
            theme={theme}
            onToggleTheme={toggleTheme}
            isAuthModalOpen={isAuthModalOpen}
            onOpenAuthModal={(route) => {
              if (route) setPendingRoute(route);
              setIsAuthModalOpen(true);
            }}
            pendingRoute={pendingRoute}
            onAuthResolved={() => {
              setPendingRoute(null);
              setIsAuthModalOpen(false);
            }}
          />
        </div>

        {/* Clerk Auth Modal */}
        <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
      </div>
    </ShellProvider>
  );
}

interface TerminalRoutesProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  isAuthModalOpen: boolean;
  onOpenAuthModal: (route?: string) => void;
  pendingRoute: string | null;
  onAuthResolved: () => void;
}

/**
 * Owns the live data polling and resolves the current URL to a module. Lives below ShellProvider
 * so it can use the shell's single navigation implementation (auth gate included) rather than
 * calling history.pushState itself.
 */
const TerminalRoutes: React.FC<TerminalRoutesProps> = ({
  theme,
  onToggleTheme,
  isAuthModalOpen,
  onOpenAuthModal,
  pendingRoute,
  onAuthResolved,
}) => {
  const { t } = useTranslation();
  const { path, query, navigate } = useRouter();
  const { activeModule, navigateToRoute, canAccess, isSignedIn } = useShell();

  const [selectedPairId, setSelectedPairId] = useState<PairId>('XAUUSD');
  const [prices, setPrices] = useState<Record<PairId, MarketPrice>>({} as Record<PairId, MarketPrice>);
  const [signals, setSignals] = useState<Record<PairId, Signal | null>>({} as Record<PairId, Signal | null>);
  const [scanStatus, setScanStatus] = useState<Partial<Record<PairId, ScanStatus>>>({});
  const [calendarEvents, setCalendarEvents] = useState<EconomicEvent[]>([]);
  const [calendarStale, setCalendarStale] = useState<boolean>(false);
  const [calendarLoaded, setCalendarLoaded] = useState<boolean>(false);
  // FASE C quick fix: last genuinely successful upstream fetch, straight from the server (which
  // tracks it regardless of whether this particular poll served fresh/stale/empty) - shown next to
  // the stale/unavailable banners so a reader always knows how old the data on screen actually is.
  const [calendarLastFetchedAt, setCalendarLastFetchedAt] = useState<string | null>(null);
  const [tradersCount, setTradersCount] = useState<number | null>(null);
  const [isLoadingInitial, setIsLoadingInitial] = useState<boolean>(true);
  // A module must never sit on a shimmer forever when the feed is down (§7.10). Consecutive
  // failures before the first successful payload flip the market modules to an explicit
  // UNAVAILABLE state naming the endpoint - the counter lives in a ref so failures do not
  // re-create the polling interval on every tick.
  const feedFailuresRef = useRef<number>(0);
  const [feedUnavailable, setFeedUnavailable] = useState<boolean>(false);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>({});

  // Once sign-in completes: replay the route that triggered the auth modal (if any), and close
  // the modal either way - AuthModal's embedded Clerk <SignIn>/<SignUp> forms don't close
  // themselves on success, so without this a user who signs in from the generic "Login" button
  // (no specific intent) would also be stuck looking at a completed form until they hit X.
  useEffect(() => {
    if (!isSignedIn || !isAuthModalOpen) return;
    if (pendingRoute) navigateToRoute(pendingRoute);
    onAuthResolved();
  }, [isSignedIn, isAuthModalOpen, pendingRoute, navigateToRoute, onAuthResolved]);

  // Poll server for live signals & prices state synchronization
  useEffect(() => {
    let isMounted = true;

    const FAILURES_BEFORE_UNAVAILABLE = 5;

    const registerFailure = () => {
      feedFailuresRef.current += 1;
      if (feedFailuresRef.current >= FAILURES_BEFORE_UNAVAILABLE && isMounted) {
        setFeedUnavailable(true);
      }
    };

    const fetchSignalState = async () => {
      try {
        const res = await fetch('/api/signals');
        if (!res.ok) {
          registerFailure();
          return;
        }
        const data: SignalStateResponse = await res.json().catch(() => null);
        if (data && data.prices && data.signals) {
          if (!isMounted) return;
          feedFailuresRef.current = 0;
          setFeedUnavailable(false);
          setPrices(data.prices);
          setSignals(data.signals);
          setScanStatus(data.scanStatus || {});
          if (isLoadingInitial) setIsLoadingInitial(false);
        } else {
          registerFailure();
        }
      } catch (err) {
        registerFailure();
      }
    };

    fetchSignalState();
    const interval = setInterval(fetchSignalState, 1000);

    // 2026-08-31 audit (point 4): this 1s interval itself is untouched (it is already the fastest
    // poll in the app) - but a backgrounded/minimized tab has its setInterval throttled by the
    // browser regardless of how short the interval is, so a reader returning to the tab can
    // momentarily see prices/signals older than 1s until the throttled timer next fires. Refetch
    // immediately when the tab becomes visible again to close that gap.
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchSignalState();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      isMounted = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isLoadingInitial]);

  // Fetch Economic Calendar & Traders Count
  //
  // PRIORITY 0/2 audit fix (2026-08-26): fetchCalendar used to run exactly once on mount, unlike
  // fetchSignalState just above (which polls every 1s) - the "N high-impact release still pending
  // today" reads (WhatMattersNowView/InsightSummaryView) filter this same array by
  // `dateISO > Date.now()`, so that part was never the bug (Date.now() is always current); what
  // was actually stale was calendarEvents itself, since nothing ever asked the server for a newer
  // snapshot after the first load. A reader who left the tab open across a release kept seeing the
  // Actual/forecast/previous values (and the calendar's own event list) from whenever the page was
  // first opened. Polled every 5 minutes now - matches the server's own CALENDAR_CACHE_DURATION_MS
  // (server.ts), so this never polls faster than the upstream cache can actually change.
  useEffect(() => {
    const fetchCalendar = async () => {
      try {
        const calRes = await fetch('/api/calendar');
        if (calRes.ok) {
          const calData = await calRes.json().catch(() => null);
          if (calData && Array.isArray(calData.events)) {
            setCalendarEvents(calData.events);
            setCalendarStale(Boolean(calData.stale));
            setCalendarLoaded(true);
            setCalendarLastFetchedAt(typeof calData.lastFetchedAt === 'string' ? calData.lastFetchedAt : null);
          }
        }
      } catch (e) {
        // Silent catch
      }
    };

    const fetchTradersCount = async () => {
      try {
        const res = await fetch('/api/traders-count');
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data && typeof data.totalTraders === 'number') {
            setTradersCount(data.totalTraders);
          }
        }
      } catch (e) {
        // Silent catch
      }
    };

    fetchCalendar();
    fetchTradersCount();
    const calendarInterval = setInterval(fetchCalendar, 5 * 60_000);
    const tradersInterval = setInterval(fetchTradersCount, 5 * 60_000);

    // 2026-08-31 audit (point 4): same background-tab throttling catch-up as the signal-state poll
    // above - refetch immediately on the tab becoming visible again instead of waiting for the
    // throttled 5-minute timer.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchCalendar();
        fetchTradersCount();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(calendarInterval);
      clearInterval(tradersInterval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Poll site settings (incl. admin "Blur Signal Publik" toggle) - rare admin action, so a
  // slower 10s poll is enough to pick up the change without adding load to the 1s signal loop.
  useEffect(() => {
    let isMounted = true;

    const fetchSettings = async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data && isMounted) setSiteSettings(data);
        }
      } catch (e) {
        // Silent catch
      }
    };

    fetchSettings();
    const interval = setInterval(fetchSettings, 10000);

    // 2026-08-31 audit (point 4): same background-tab throttling catch-up as the other polls above.
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchSettings();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      isMounted = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Alert rules are evaluated here, where the live prices and signals already are, rather than by
  // each module separately - one evaluation per feed update, against exactly the data the rest of
  // the terminal is showing. A rule whose input is missing simply does not evaluate.
  const { recordEvents } = useAlerts();
  const alertFiredAtRef = useRef<Record<string, string>>({});
  // With the Alerts page removed in Fase 8, a firing is only visible if it surfaces itself - so
  // fired events go straight into a global toast as well as the stored history.
  const [alertToasts, setAlertToasts] = useState<AlertEvent[]>([]);

  useEffect(() => {
    const rules = readRules();
    if (rules.length === 0) return;

    const fired = evaluateRules(rules, {
      prices,
      signals,
      lastFiredAt: alertFiredAtRef.current,
      cooldownMs: 10 * 60_000,
    });
    if (fired.length === 0) return;

    for (const event of fired) alertFiredAtRef.current[event.ruleId] = event.triggeredAt;
    recordEvents(fired);
    // Cap the stack: three simultaneous toasts is already the point at which they stop being
    // readable, and the full list is kept in the alert history either way.
    setAlertToasts((prev) => [...fired, ...prev].slice(0, 3));
  }, [prices, signals, recordEvents]);

  const dismissToast = useCallback((event: AlertEvent) => {
    setAlertToasts((prev) => prev.filter((item) => !(item.ruleId === event.ruleId && item.triggeredAt === event.triggeredAt)));
  }, []);

  const isAdminRoute = path === '/admin' || path.startsWith('/admin/');
  // Full-page Live Intelligence event detail route - a Live Intelligence card opens its own real
  // URL rather than a modal on top of the Intel module.
  const liveEventId = useMemo(() => matchRoute('/intel/live/:id', path)?.id ?? null, [path]);
  // Institutional Watchlist full-page detail route (same pattern as liveEventId above) - only a
  // recognized PAIRS_LIST id renders the page; anything else falls through to NotFoundView exactly
  // like every other unmatched route.
  const institutionalPairIdParam = useMemo(() => matchRoute('/market/institutional/:pairId', path)?.pairId ?? null, [path]);
  const institutionalPairId: PairId | null =
    institutionalPairIdParam && institutionalPairIdParam in PAIRS_MAP ? (institutionalPairIdParam as PairId) : null;
  // Institutional Watchlist detail still needs sign-in (same gate OverviewView's own click handler
  // already applies before navigating here) - a deep link/bookmark from a signed-out visitor is
  // the one path that bypasses that click-time check, so it's re-applied here.
  useEffect(() => {
    if (institutionalPairId && !isSignedIn) {
      onOpenAuthModal(path);
      navigateToRoute('/');
    }
  }, [institutionalPairId, isSignedIn, onOpenAuthModal, path, navigateToRoute]);

  const signalsBlurred = Boolean(siteSettings.signalsBlurred);

  // The selected asset lives in the URL (?symbol=), so a Markets link is shareable and the back
  // button steps through assets the same way it steps through modules.
  const symbolParam = query.get('symbol');
  useEffect(() => {
    if (symbolParam && isEnginePair(symbolParam)) setSelectedPairId(symbolParam);
  }, [symbolParam]);

  const openLiveEvent = (id: string) => navigateToRoute(`/intel/live/${encodeURIComponent(id)}`);

  const goToPair = (pairId: PairId) => {
    setSelectedPairId(pairId);
    navigateToRoute(`/market/overview?symbol=${encodeURIComponent(pairId)}`);
  };

  // Selecting an asset from inside the Markets module: same module, different parameter, so this
  // replaces the URL rather than pushing a history entry per click.
  const selectPairInPlace = (pairId: PairId) => {
    setSelectedPairId(pairId);
    if (activeModule?.category === 'market') {
      navigate(`${path}?symbol=${encodeURIComponent(pairId)}`, { replace: true });
    }
  };

  // Same in-place pattern for the Markets asset-class filter (Nav Consolidation Fase 4a): five
  // former routes collapsed into one, so the class that used to be encoded in the path now lives
  // in ?class= instead - still shareable, still survives a reload, never a full navigation.
  //
  // 'indices' removed (Markets > Analysis relocation, item 2 of the mobile pill-row cleanup):
  // Indices content now lives in Analysis > Global Market Heatmap instead. An old ?class=indices
  // deep link still resolves safely - it just falls through to the 'all' default below, the same
  // handling any other invalid class value already got.
  const VALID_MARKET_CLASSES = ['all', 'forex', 'commodities', 'crypto'] as const;
  type MarketClassParam = (typeof VALID_MARKET_CLASSES)[number];
  const classParam = query.get('class');
  const marketClass: MarketClassParam =
    classParam && (VALID_MARKET_CLASSES as readonly string[]).includes(classParam) ? (classParam as MarketClassParam) : 'all';
  const selectClassInPlace = (cls: MarketClassParam) => {
    navigate(`${path}?class=${encodeURIComponent(cls)}`, { replace: true });
  };

  const renderModule = (): React.ReactNode => {
    if (liveEventId) {
      return (
        <LiveEventDetailPage id={liveEventId} onBack={() => navigateToRoute('/intelligence/news')} />
      );
    }

    if (institutionalPairIdParam) {
      // Signed-out: the useEffect above already redirected home and opened the auth modal - render
      // nothing for this one tick rather than a flash of protected content.
      if (!isSignedIn) return null;
      if (!institutionalPairId) return <NotFoundView path={path} />;
      return (
        <InstitutionalDetailPage
          pairId={institutionalPairId}
          onBack={() => navigateToRoute('/')}
          onSelectPair={(id) => navigateToRoute(`/market/institutional/${encodeURIComponent(id)}`)}
          prices={prices}
          signalsBlurred={signalsBlurred}
        />
      );
    }

    if (isAdminRoute) return <AdminDashboard />;

    if (!activeModule) return <NotFoundView path={path} />;

    // Checked before the auth gate: a module that does not exist yet has no data to protect, so
    // asking an unregistered visitor to sign in first would be a pointless dead end.
    if (activeModule.status === 'planned') return <ModulePlaceholder module={activeModule} />;

    // Deep-linked premium module while signed out: gate before the module mounts or fetches.
    if (!canAccess(activeModule)) {
      return <AccessGate module={activeModule} onSignIn={() => onOpenAuthModal()} />;
    }

    const needsMarketData = activeModule.requiredData.includes('prices');

    // Feed never came up: say so, naming the endpoint and the last attempt. Never a fabricated
    // quote, and never an endless shimmer.
    if (needsMarketData && isLoadingInitial && feedUnavailable) {
      return (
        <UnavailableState
          source="/api/signals"
          detail="The live signal and price feed is not responding. Values will appear as soon as the feed recovers - nothing is estimated in the meantime."
        />
      );
    }

    // The first /api/signals response has not landed yet - show a skeleton shaped like the
    // module rather than a blank page or invented numbers.
    const marketDataPending = isLoadingInitial && needsMarketData;

    switch (activeModule.id) {
      case 'ringkasan':
        if (marketDataPending) return <InitialFeedSkeleton label={t('common.initializingFeed')} />;
        return (
          <OverviewView
            prices={prices}
            signals={signals}
            scanStatus={scanStatus}
            tradersCount={tradersCount}
            onSelectPair={setSelectedPairId}
            onNavigate={navigateToRoute}
            onOpenAuthModal={onOpenAuthModal}
            signalsBlurred={signalsBlurred}
          />
        );

      case 'market-overview':
        if (marketDataPending) return <LoadingState variant="cards" />;
        return (
          <MarketsPage
            prices={prices}
            signals={signals}
            scanStatus={scanStatus}
            selectedPairId={selectedPairId}
            onSelectPair={selectPairInPlace}
            signalsBlurred={signalsBlurred}
            initialCategory={marketClass}
            onClassChange={selectClassInPlace}
            calendarEvents={calendarEvents}
            onNavigate={navigateToRoute}
          />
        );

      case 'btc-usdt-depth':
        return <OrderBookLiquidityHub />;

      case 'market-regime':
        if (marketDataPending) return <LoadingState variant="cards" />;
        return (
          <AnalysisHub
            prices={prices}
            signals={signals}
            onNavigate={navigateToRoute}
            onOpenAsset={goToPair}
            calendarEvents={calendarEvents}
            onOpenEvent={openLiveEvent}
          />
        );

      case 'macro-overview':
        return <PolicyRatesHub onOpen={navigateToRoute} />;

      case 'dxy':
        return <GoldIntelligenceHub />;

      case 'commodities-intelligence':
        return <CommoditiesIntelligenceHub events={calendarEvents} onOpen={navigateToRoute} />;

      // COT and the retired /analysis/positioning were the same report from the same endpoint;
      // Fase 8 merged them into this one page, and the old address redirects here.
      case 'cot':
        return <PositioningView />;

      case 'ai-market-brief':
        return <AiStudioHub signals={signals} onOpenEvent={openLiveEvent} />;

      case 'live-desk':
        return <LiveDeskView prices={prices} calendarEvents={calendarEvents} onOpenEvent={openLiveEvent} onNavigate={navigateToRoute} />;

      case 'news-feed':
        return <NewsHub onOpenEvent={openLiveEvent} />;

      case 'economic-calendar':
        return (
          <CalendarHub
            events={calendarEvents}
            stale={calendarStale}
            unavailable={calendarLoaded && calendarEvents.length === 0}
            lastFetchedAt={calendarLastFetchedAt}
            onOpenEvent={openLiveEvent}
          />
        );

      case 'global-macro':
        return <EconomyLiquidityHub />;

      // Signal History and Performance were the same HistoryView; merged into Performance, with
      // /signals/history redirecting here.
      case 'performance':
        return (
          <PerformanceHub
            prices={prices}
            marketDataPending={marketDataPending}
            onSelectPair={goToPair}
            onNavigateToSignal={() => navigateToRoute('/market/overview')}
          />
        );

      case 'company-info':
        return <LegalHub />;

      default:
        // A module marked active in the registry with no component wired here is a registry bug,
        // not a data problem - surfacing it as "not available" is still better than a blank page.
        return <ModulePlaceholder module={activeModule} />;
    }
  };

  return (
    <AppShell
      prices={prices}
      selectedPairId={selectedPairId}
      onSelectPair={goToPair}
      theme={theme}
      onToggleTheme={onToggleTheme}
      onOpenAuthModal={onOpenAuthModal}
    >
      <Suspense fallback={<LoadingState variant="table" />}>{renderModule()}</Suspense>
      <AlertToaster events={alertToasts} onDismiss={dismissToast} onOpen={navigateToRoute} />
    </AppShell>
  );
};

/**
 * Skeleton shaped like the Overview module (the landing route) instead of a bare spinner, so the
 * very first paint already reads as "the app". Real content swaps in the instant the first
 * /api/signals response lands.
 */
const InitialFeedSkeleton: React.FC<{ label: string }> = ({ label }) => (
  <div className="space-y-6 font-mono">
    <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] tracking-widest uppercase">
      <span className="w-2 h-2 rounded-full bg-[var(--color-up)] animate-pulse" />
      {label}
    </div>

    <div className="h-3 w-48 rounded hev-skeleton" />

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] p-6 space-y-4">
          <div className="h-2.5 w-20 rounded hev-skeleton" />
          <div className="h-7 w-16 rounded hev-skeleton" />
        </div>
      ))}
    </div>

    <div className="h-4 w-40 rounded hev-skeleton" />
    <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-40 rounded-[14px] hev-skeleton" />
      ))}
    </div>
    <div className="flex sm:hidden gap-3 overflow-hidden">
      {[0, 1].map((i) => (
        <div key={i} className="shrink-0 w-[82%] h-40 rounded-[14px] hev-skeleton" />
      ))}
    </div>

    <div className="space-y-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-14 rounded-xl hev-skeleton" />
      ))}
    </div>
  </div>
);
