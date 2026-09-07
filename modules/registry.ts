import {
  Activity,
  Bell,
  BarChart3,
  Brain,
  Calendar,
  DollarSign,
  Flame,
  Gauge,
  Globe,
  Globe2,
  History,
  Info,
  Landmark,
  Layers,
  Newspaper,
  Radio,
  Sigma,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

/**
 * Module Registry (§7.5) - the single source of truth for what the terminal contains.
 *
 * The desktop sidebar, the mobile bottom nav, the "More" module navigator, every section's
 * sub-nav, and the global command palette are all rendered FROM this list. Adding a module in a
 * later phase means adding one entry here plus its component in moduleComponents.tsx - no
 * navigation code changes, which is the whole point of §7.5.
 *
 * `status` is honest about what actually exists:
 *   active  - backed by a real component reading real provider data
 *   planned - registered and discoverable, but renders an explicit "not available yet" state.
 *             It never renders placeholder numbers (§1: no fake data, in any condition).
 */

// Fase 10 §2: 'signals' retired as a nav category. Live Signals is a per-asset card under the
// chart on the Markets page (already was, partially); Scalping Radar is an in-page toggle inside
// Markets, not its own route - see MarketsPage.tsx. Neither needed a registry entry anymore, so
// the type union drops the category rather than keeping a value nothing is ever tagged with.
export type ModuleCategory =
  | 'dashboard'
  | 'market'
  | 'analysis'
  | 'macro'
  | 'intelligence'
  | 'calendar'
  | 'performance'
  // Roadmap §F: About/Team/Terms/Privacy/Regulatory Disclosure - a low-traffic utility section,
  // ordered last so it never competes with the trading-focused categories above it.
  | 'company';

export type ModuleStatus = 'active' | 'planned';

export interface ModuleDefinition {
  id: string;
  /** i18n key for the display name; resolve with t(). */
  nameKey: string;
  /** English fallback, also what the command palette matches against. */
  name: string;
  category: ModuleCategory;
  route: string;
  icon: LucideIcon;
  descriptionKey: string;
  status: ModuleStatus;
  mobileVisibility: boolean;
  desktopVisibility: boolean;
  /** Data series this module needs; drives the source-health checks in later phases. */
  requiredData: string[];
  featureFlag: string | null;
  /** 'public' renders for signed-out visitors; 'premium' opens the auth modal first. */
  permissions: 'public' | 'premium';
  lazyLoad: boolean;
  /** Roadmap phase (§9) - shown on planned modules so the state is informative, not a dead end. */
  phase: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /** Extra terms the command palette should match (e.g. 'gold' -> COT module). */
  keywords?: string[];
}

export interface ModuleCategoryDefinition {
  id: ModuleCategory;
  nameKey: string;
  name: string;
  icon: LucideIcon;
  /** Categories shown as top-level sections in the desktop sidebar, in this order. */
  order: number;
}

export const MODULE_CATEGORIES: ModuleCategoryDefinition[] = [
  { id: 'dashboard', nameKey: 'category.dashboard', name: 'Dashboard', icon: Activity, order: 1 },
  { id: 'market', nameKey: 'category.market', name: 'Markets', icon: TrendingUp, order: 2 },
  { id: 'analysis', nameKey: 'category.analysis', name: 'Analysis', icon: BarChart3, order: 3 },
  { id: 'macro', nameKey: 'category.macro', name: 'Macro', icon: Landmark, order: 4 },
  { id: 'intelligence', nameKey: 'category.intelligence', name: 'Intelligence', icon: Newspaper, order: 5 },
  { id: 'calendar', nameKey: 'category.calendar', name: 'Calendar', icon: Calendar, order: 6 },
  { id: 'performance', nameKey: 'category.performance', name: 'Performance', icon: History, order: 7 },
  { id: 'company', nameKey: 'category.company', name: 'Company', icon: Info, order: 8 },
];

const m = (def: ModuleDefinition): ModuleDefinition => def;

export const MODULES: ModuleDefinition[] = [
  // ===== DASHBOARD =====
  m({
    id: 'ringkasan',
    nameKey: 'module.ringkasan',
    name: 'Overview',
    category: 'dashboard',
    route: '/',
    icon: Activity,
    descriptionKey: 'moduleDesc.ringkasan',
    status: 'active',
    mobileVisibility: true,
    desktopVisibility: true,
    requiredData: ['prices', 'signals', 'scan_status'],
    featureFlag: null,
    permissions: 'public',
    lazyLoad: false,
    phase: 1,
    keywords: ['home', 'summary', 'ringkasan', 'dashboard'],
  }),

  // ===== MARKETS =====
  // Nav Consolidation Fase 4a: Forex, Commodities, Crypto and Indices merged into this one
  // module - the asset-class filter is now an in-page segmented control (?class= in the URL)
  // instead of four separate routes. MarketsPage.tsx carries the filter and folds Indices in as a
  // sibling view. The four retired routes redirect here.
  m({
    id: 'market-overview',
    nameKey: 'module.marketOverview',
    name: 'Markets',
    category: 'market',
    route: '/market/overview',
    icon: Globe,
    descriptionKey: 'moduleDesc.marketOverview',
    status: 'active',
    mobileVisibility: true,
    desktopVisibility: true,
    requiredData: ['prices', 'signals'],
    featureFlag: null,
    permissions: 'premium',
    lazyLoad: true,
    phase: 2,
    keywords: [
      'pasar', 'all assets', 'quotes',
      'eurusd', 'gbpusd', 'usdcad', 'usdchf', 'fx', 'currency',
      'gold', 'xauusd', 'emas', 'silver', 'oil',
      'btc', 'eth', 'sol', 'bitcoin', 'perpetual',
      'sp500', 'nasdaq', 'dax', 'nikkei', 'indeks',
    ],
  }),
  // Nav Consolidation Fase 4b: ETH-USDT Depth and Liquidity Map merged into this one module,
  // renamed Order Book & Liquidity - a symbol switcher (BTC-USDT/ETH-USDT) replaces two of the
  // three former routes, with the DOM and the liquidity map side by side (Image 1 reference). The
  // liquidity map itself stays BTC-USDT only (no ETH-USDT provider exists) - switching to
  // ETH-USDT says so honestly rather than faking a second map. See
  // docs/AUDIT-VOLUME-PROFILE-ORDERBOOK.md §C for why crypto-only and why BTC-USDT first.
  m({
    id: 'btc-usdt-depth',
    nameKey: 'orderBookHub.title',
    name: 'Order Book & Liquidity',
    category: 'market',
    route: '/market/order-book',
    icon: Layers,
    descriptionKey: 'moduleDesc.orderBookHub',
    status: 'active',
    mobileVisibility: true,
    desktopVisibility: true,
    requiredData: ['orderbook-btcusdt', 'orderbook-ethusdt', 'engine_candles'],
    featureFlag: null,
    permissions: 'premium',
    lazyLoad: true,
    phase: 8,
    keywords: [
      'order book', 'dom', 'depth', 'btc-usdt', 'eth-usdt', 'ethereum', 'bid', 'ask', 'spread',
      'liquidity map', 'liquidity pool', 'swing high', 'swing low', 'fvg', 'fair value gap',
    ],
  }),

  // ===== SIGNALS ===== retired as a nav category (Fase 10 §2). Live Signals is a per-asset card
  // on the Markets page (src/components/MarketView.tsx), Scalping Radar an in-page toggle inside
  // Markets (src/components/market/MarketsPage.tsx) - neither is a standalone route anymore, so
  // neither has a registry entry. LEGACY_ROUTE_REDIRECTS below sends old links to /market/overview.

  // ===== ANALYSIS =====
  // Nav Consolidation Fase 3: Market Regime, Currency Strength, Correlation, Volatility,
  // Geopolitical Risk, Liquidity & Flow and Technical Overview merged into a "Market Intelligence"
  // grid tab; Session Intelligence becomes the hub's second tab. AnalysisHub.tsx composes all
  // eight source components as-is - see its own header comment for what changed inside them (two
  // gauges upgraded to GaugeRadial, Correlation's footnote moved to InfoTooltip) versus what is
  // pure layout. The eight retired routes redirect here via LEGACY_ROUTE_REDIRECTS below.
  m({
    id: 'market-regime',
    nameKey: 'analysisHub.title',
    name: 'Analysis',
    category: 'analysis',
    route: '/analysis/overview',
    icon: Gauge,
    descriptionKey: 'moduleDesc.analysisHub',
    status: 'active',
    mobileVisibility: true,
    desktopVisibility: true,
    requiredData: ['dxy', 'vix', 'real_yield', 'prices', 'engine_candles', 'live_events', 'stablecoin_supply', 'fear_greed', 'signals', 'yahoo_indices'],
    featureFlag: null,
    permissions: 'premium',
    lazyLoad: true,
    phase: 3,
    keywords: [
      'risk on', 'risk off', 'rezim', 'usd', 'eur', 'jpy', 'kekuatan',
      'heatmap', 'korelasi', 'cross asset', 'atr', 'vix', 'volatilitas',
      'geopolitics', 'war', 'sanctions', 'risk score', 'geopolitik', 'perang',
      'etf flow', 'likuiditas', 'aliran dana', 'fear', 'greed', 'sentimen',
      'breadth', 'advance decline', 'rsi', 'roc', 'momentum', 'bos', 'mss', 'fvg', 'order block',
      'struktur', 'anomali', 'outlier', 'spike',
      'session', 'sydney', 'tokyo', 'london', 'new york', 'overlap', 'kill zone',
    ],
  }),

  // ===== MACRO =====
  // Nav Consolidation Fase 1 (Hub 4a): Central Banks, Interest Rates, Yield Curve and Treasury
  // merged into this one module - all four rendered facets of the same FRED-driven policy/rates
  // picture across five separate pages. PolicyRatesHub.tsx carries every data point all five used
  // to show; the four retired routes redirect here via LEGACY_ROUTE_REDIRECTS below.
  m({
    id: 'macro-overview',
    nameKey: 'module.policyRatesHub',
    name: 'Policy & Rates',
    category: 'macro',
    route: '/macro/overview',
    icon: Landmark,
    descriptionKey: 'moduleDesc.policyRatesHub',
    status: 'active',
    mobileVisibility: true,
    desktopVisibility: true,
    requiredData: ['fred', 'dxy'],
    featureFlag: null,
    permissions: 'premium',
    lazyLoad: true,
    phase: 4,
    keywords: [
      'makro', 'macro', 'fed', 'ecb', 'boj', 'boe', 'fomc', 'bank sentral',
      'suku bunga', 'rates', 'fedwatch', 'kurva imbal hasil', 'inversion', '2s10s',
      'auction', 'obligasi', 'bond', 'treasury', 'yield curve', 'central banks', 'interest rates',
    ],
  }),
  // Nav Consolidation Fase 2 (Hub 4b): Gold Seasonality, XAU Futures Curve and Central Bank Gold
  // Buying merged into this DXY module, renamed Gold Intelligence - GoldIntelligenceHub.tsx
  // carries all four as in-page tabs (Overview/Futures Curve/Central Bank Buying/Seasonality).
  // The three retired routes redirect here via LEGACY_ROUTE_REDIRECTS below.
  m({
    id: 'dxy',
    nameKey: 'goldHub.title',
    name: 'Gold Intelligence',
    category: 'macro',
    route: '/macro/dxy',
    icon: DollarSign,
    descriptionKey: 'moduleDesc.goldIntelligence',
    status: 'active',
    mobileVisibility: true,
    desktopVisibility: true,
    requiredData: ['dxy', 'gold-seasonality', 'xau-futures-curve', 'central-bank-gold'],
    featureFlag: null,
    permissions: 'premium',
    lazyLoad: true,
    phase: 4,
    keywords: [
      'dollar index', 'usd', 'seasonality', 'musiman', 'xau', 'gold', 'emas', 'monthly',
      'futures curve', 'term structure', 'contango', 'backwardation', 'comex', 'gold futures',
      'central bank', 'gold reserves', 'imf ifs', 'bank sentral', 'cadangan emas',
    ],
  }),
  // Mobile pill-row cleanup, item 3: Oil Intelligence, the futures board and the Market State
  // confluence read moved here from Markets > Commodities - same reasoning as dxy above (Gold's
  // confluence read lives in its own Macro hub, not on the Markets page), and the same
  // buildCommodityConfluence/ConfluenceView engine XAU and BTC already use elsewhere.
  // CommoditiesIntelligenceHub.tsx wraps CommodityBoard.tsx unchanged; MarketsPage no longer
  // renders it, and /market/commodities keeps pointing at the plain pair view via the existing
  // Fase 4a redirect.
  m({
    id: 'commodities-intelligence',
    nameKey: 'commoditiesHub.title',
    name: 'Commodities Intelligence',
    category: 'macro',
    route: '/macro/commodities',
    icon: Flame,
    descriptionKey: 'moduleDesc.commoditiesHub',
    status: 'active',
    mobileVisibility: true,
    desktopVisibility: true,
    requiredData: ['commodities', 'crude-stocks', 'dxy', 'cot', 'vix', 'real_yield'],
    featureFlag: null,
    permissions: 'premium',
    lazyLoad: true,
    phase: 4,
    keywords: [
      'commodities', 'komoditas', 'oil', 'minyak', 'wti', 'brent', 'crude', 'crude stocks', 'eia',
      'futures board', 'energy', 'metals', 'agriculture', 'natural gas', 'silver', 'copper',
      'confluence', 'market state',
    ],
  }),
  m({
    id: 'cot',
    nameKey: 'module.cot',
    name: 'COT Positioning',
    category: 'macro',
    route: '/macro/cot',
    icon: Sigma,
    descriptionKey: 'moduleDesc.cot',
    status: 'active',
    mobileVisibility: true,
    desktopVisibility: true,
    requiredData: ['cot'],
    featureFlag: null,
    permissions: 'premium',
    lazyLoad: true,
    phase: 4,
    // Carries the keywords of the retired /analysis/positioning entry too: the reader who
    // thinks "positioning" and the reader who thinks "COT" must land on the same one page.
    keywords: ['commitment of traders', 'cftc', 'gold cot', 'positioning', 'institusi', 'retail'],
  }),
  // Nav Consolidation Fase 2 (Hub 4d): Inflation & Growth, Economic History and On-Chain Macro
  // merged into this Global Macro module, renamed Economy & Global Liquidity -
  // EconomyLiquidityHub.tsx carries fiscal/liquidity/activity/inflation/on-chain as one Overview
  // screen plus a Historical Archive tab (EconomicHistoryView, kept as its own component - see
  // that hub's own header comment for why). The three retired routes redirect here.
  m({
    id: 'global-macro',
    nameKey: 'econHub.title',
    name: 'Economy & Global Liquidity',
    category: 'macro',
    route: '/macro/global',
    icon: Globe2,
    descriptionKey: 'moduleDesc.econHub',
    status: 'active',
    mobileVisibility: true,
    desktopVisibility: true,
    requiredData: ['fred', 'economic_history', 'defillama_tvl', 'stablecoin_supply'],
    featureFlag: null,
    permissions: 'premium',
    lazyLoad: true,
    phase: 8,
    keywords: [
      'fiskal', 'fiscal', 'likuiditas', 'liquidity', 'sofr', 'rbi', 'utang', 'debt', 'housing', 'trade balance',
      'cpi', 'ppi', 'gdp', 'nfp', 'inflasi', 'inflation', 'growth',
      'arsip', 'historis', 'indicator history', 'economic history',
      'tvl', 'onchain', 'on-chain', 'stablecoin', 'whale',
    ],
  }),

  // ===== INTELLIGENCE =====
  // Nav Consolidation Fase 5: Breaking News merged into News Feed, renamed "News", as an in-page
  // filter chip (Semua/Breaking) instead of a second route - see NewsHub.tsx.
  m({
    id: 'news-feed',
    nameKey: 'newsHub.title',
    name: 'News',
    category: 'intelligence',
    route: '/intelligence/news',
    icon: Newspaper,
    descriptionKey: 'moduleDesc.newsHub',
    status: 'active',
    mobileVisibility: true,
    desktopVisibility: true,
    requiredData: ['live_events', 'research'],
    featureFlag: null,
    permissions: 'premium',
    lazyLoad: true,
    phase: 1,
    keywords: ['berita', 'news', 'intel', 'live intelligence', 'breaking', 'urgent'],
  }),
  // Research merged into AI Market Brief, renamed "AI Studio" - two in-page tabs instead of two
  // routes. See AiStudioHub.tsx.
  m({
    id: 'ai-market-brief',
    nameKey: 'aiStudioHub.title',
    name: 'AI Studio',
    category: 'intelligence',
    route: '/intelligence/ai-brief',
    icon: Brain,
    descriptionKey: 'moduleDesc.aiStudioHub',
    status: 'active',
    mobileVisibility: true,
    desktopVisibility: true,
    requiredData: ['macro_narrative', 'signals', 'live_events', 'research'],
    featureFlag: null,
    permissions: 'premium',
    lazyLoad: true,
    phase: 5,
    keywords: ['ai', 'brief', 'summary', 'riset', 'analisa', 'report', 'research'],
  }),

  // Live Desk (HEVORA "Live Desk" brief) - 3rd Intelligence choice alongside News/AI Studio. A
  // dense dashboard surfacing the existing Live Intelligence pipeline (live broadcast + AI
  // transcript analysis), Smart Alerts, Impact Matrix and Narrative Intelligence - see
  // LiveDeskView.tsx and the /api/live-desk/* scope comment in server.ts for what's genuinely
  // new here vs reused from other tabs.
  m({
    id: 'live-desk',
    nameKey: 'liveDesk.title',
    name: 'Live Desk',
    category: 'intelligence',
    route: '/intelligence/live-desk',
    icon: Radio,
    descriptionKey: 'moduleDesc.liveDesk',
    status: 'active',
    mobileVisibility: true,
    desktopVisibility: true,
    requiredData: ['live_events', 'calendar', 'macro_narrative'],
    featureFlag: null,
    permissions: 'premium',
    lazyLoad: true,
    phase: 8,
    keywords: ['live desk', 'siaran langsung', 'transkrip', 'live intelligence', 'fomc', 'pidato', 'smart alert', 'impact matrix'],
  }),

  // ===== CALENDAR =====
  // Nav Consolidation Fase 5: Central Bank Events and AI Event Analysis merged into Economic
  // Calendar, renamed "Calendar" - a filter chip row (Semua/Bank Sentral/AI Event Analysis)
  // instead of three routes. See CalendarHub.tsx.
  m({
    id: 'economic-calendar',
    nameKey: 'calendarHub.title',
    name: 'Calendar',
    category: 'calendar',
    route: '/calendar/economic',
    icon: Calendar,
    descriptionKey: 'moduleDesc.calendarHub',
    status: 'active',
    mobileVisibility: true,
    desktopVisibility: true,
    requiredData: ['calendar', 'live_events'],
    featureFlag: null,
    permissions: 'premium',
    lazyLoad: true,
    phase: 1,
    keywords: ['kalender', 'events', 'nfp', 'fomc', 'ecb meeting', 'boj', 'pre event', 'post event', 'ai'],
  }),

  // ===== PERFORMANCE =====
  // Nav Consolidation Fase 5: Paper Trading and Trading Journal merged into Performance as two
  // more in-page tabs (see PerformanceHub.tsx) instead of one route with two hidden ones. Fase 10
  // §4 hid both from navigation pending exactly this kind of reachable-but-uncluttered home; this
  // hub is that home, so both are visible again - neither component, route-as-tab, nor stored data
  // changed.
  m({
    id: 'performance',
    nameKey: 'performanceHub.title',
    name: 'Performance',
    category: 'performance',
    route: '/performance/overview',
    icon: BarChart3,
    descriptionKey: 'moduleDesc.performanceHub',
    status: 'active',
    mobileVisibility: true,
    desktopVisibility: true,
    requiredData: ['signal_history', 'history_summary', 'prices'],
    featureFlag: null,
    permissions: 'premium',
    lazyLoad: true,
    phase: 1,
    // Same for the retired /signals/history entry - one page, both vocabularies.
    keywords: [
      'performa', 'equity curve', 'winrate', 'drawdown', 'riwayat sinyal', 'signal history', 'track record',
      'simulasi', 'demo', 'paper trading', 'jurnal', 'catatan', 'journal',
    ],
  }),

  // ===== WATCHLIST =====

  // ===== COMPANY (Roadmap §F) =====
  m({
    id: 'company-info',
    nameKey: 'company.title',
    name: 'Company',
    category: 'company',
    route: '/company/about',
    icon: Info,
    descriptionKey: 'moduleDesc.companyInfo',
    status: 'active',
    mobileVisibility: true,
    desktopVisibility: true,
    requiredData: [],
    featureFlag: null,
    permissions: 'public',
    lazyLoad: true,
    phase: 8,
    keywords: ['about', 'team', 'terms', 'privacy', 'disclosure', 'legal', 'company', 'tentang', 'kebijakan privasi', 'ketentuan layanan'],
  }),
];

/** Feature flags evaluated at module-resolution time; empty until a phase needs one. */
const ENABLED_FEATURE_FLAGS = new Set<string>();

export const isModuleEnabled = (mod: ModuleDefinition): boolean =>
  mod.featureFlag === null || ENABLED_FEATURE_FLAGS.has(mod.featureFlag);

export const listModules = (): ModuleDefinition[] => MODULES.filter(isModuleEnabled);

export const getModuleById = (id: string): ModuleDefinition | undefined =>
  listModules().find((mod) => mod.id === id);

/**
 * Routes that no longer have a module of their own. The Fase 8 pair merged two duplicates into
 * one page - both rendered the SAME component from the SAME endpoint. The Fase 10 pair is
 * different: /signals/live and /signals/scalping-radar were retired as standalone pages (§2),
 * their content redistributed onto the Markets page rather than deduplicated - so the redirect
 * lands on Markets generally rather than on one specific former sub-page. Either way, these are
 * old addresses for content that still exists, not dead links to delete - a reader arriving from
 * a bookmark or an older share link should land on the terminal, not on "not found".
 */
export const LEGACY_ROUTE_REDIRECTS: Readonly<Record<string, string>> = {
  '/analysis/positioning': '/macro/cot',
  '/signals/history': '/performance/overview',
  '/signals/live': '/market/overview',
  '/signals/scalping-radar': '/market/overview',
  // Konsolidasi-1: 4 separate tabs over the same 15-asset universe merged into one table.
  '/analysis/market-breadth': '/analysis/technical-overview',
  '/analysis/momentum': '/analysis/technical-overview',
  '/analysis/market-structure': '/analysis/technical-overview',
  '/analysis/anomaly-detection': '/analysis/technical-overview',
  // Konsolidasi-2: Sentiment dissolved into two destinations (Fear & Greed -> Liquidity & Flow,
  // Signal Book Direction -> Dashboard). Liquidity & Flow is the surviving Analysis-category page.
  '/analysis/sentiment': '/analysis/liquidity-flow',
  // Nav Consolidation Fase 1 (Hub 4a): Central Banks, Interest Rates, Yield Curve and Treasury
  // merged into the Policy & Rates hub at the surviving /macro/overview route - every data point
  // any of the four used to show is still there, just on one screen instead of four.
  '/macro/central-banks': '/macro/overview',
  '/macro/interest-rates': '/macro/overview',
  '/macro/yield-curve': '/macro/overview',
  '/macro/treasury': '/macro/overview',
  // Nav Consolidation Fase 2 (Hub 4b): Gold Seasonality, XAU Futures Curve and Central Bank Gold
  // Buying merged into the Gold Intelligence hub at the surviving /macro/dxy route.
  '/macro/gold-seasonality': '/macro/dxy',
  '/macro/xau-futures-curve': '/macro/dxy',
  '/macro/central-bank-gold': '/macro/dxy',
  // Nav Consolidation Fase 2 (Hub 4d): Inflation & Growth, Economic History and On-Chain Macro
  // merged into the Economy & Global Liquidity hub at the surviving /macro/global route.
  '/macro/inflation': '/macro/global',
  '/macro/economic-history': '/macro/global',
  '/macro/on-chain': '/macro/global',
  // Nav Consolidation Fase 3: Market Regime, Currency Strength, Correlation, Volatility,
  // Geopolitical Risk, Liquidity & Flow, Technical Overview and Session Intelligence merged into
  // the Analysis hub at the surviving /analysis/overview route.
  '/analysis/market-regime': '/analysis/overview',
  '/analysis/currency-strength': '/analysis/overview',
  '/analysis/correlation': '/analysis/overview',
  '/analysis/volatility': '/analysis/overview',
  '/analysis/geopolitical-risk': '/analysis/overview',
  '/analysis/liquidity-flow': '/analysis/overview',
  '/analysis/technical-overview': '/analysis/overview',
  '/analysis/session-intelligence': '/analysis/overview',
  // Nav Consolidation Fase 4a: Forex, Commodities, Crypto and Indices merged into the Markets hub
  // at the surviving /market/overview route (asset class now lives in ?class=). The redirect
  // target here is deliberately a bare path, not "?class=forex" appended - resolveLegacyRoute's
  // one caller (ShellContext) appends the ORIGINAL request's own query string onto whatever this
  // map returns, so a value that already carries "?class=..." would double up into a malformed
  // "?class=forex?foo=bar" for any old link that also carried a query string of its own.
  '/market/forex': '/market/overview',
  '/market/commodities': '/market/overview',
  '/market/crypto': '/market/overview',
  '/market/indices': '/market/overview',
  // Nav Consolidation Fase 4b: ETH-USDT Depth and Liquidity Map merged into the Order Book &
  // Liquidity hub at the surviving /market/order-book route (BTC-USDT default, both reachable via
  // the in-page symbol switcher).
  '/market/eth-usdt-depth': '/market/order-book',
  '/market/liquidity-map': '/market/order-book',
  // Nav Consolidation Fase 5: Breaking News -> News (filter chip), Research -> AI Studio (tab),
  // Central Bank Events + AI Event Analysis -> Calendar (filter chip), Paper Trading + Trading
  // Journal -> Performance (tab).
  '/intelligence/breaking': '/intelligence/news',
  '/intelligence/research': '/intelligence/ai-brief',
  '/calendar/central-banks': '/calendar/economic',
  '/calendar/ai-event-analysis': '/calendar/economic',
  '/performance/paper-trading': '/performance/overview',
  '/performance/journal': '/performance/overview',
};

/** Resolves a legacy address to its surviving route, or null when the path is not a legacy one. */
export const resolveLegacyRoute = (route: string): string | null => {
  const pathOnly = route.split('#')[0].split('?')[0];
  const normalized = pathOnly === '/' || pathOnly === '' ? '/' : pathOnly.replace(/\/+$/, '');
  return LEGACY_ROUTE_REDIRECTS[normalized.toLowerCase()] ?? null;
};

export const getModuleByRoute = (route: string): ModuleDefinition | undefined => {
  // Query/hash are stripped first: module routes carry parameters (e.g.
  // /market/overview?symbol=XAUUSD), and a lookup that missed because of one would silently skip
  // the permission check that navigation relies on.
  const pathOnly = route.split('#')[0].split('?')[0];
  const normalized = pathOnly === '/' || pathOnly === '' ? '/' : pathOnly.replace(/\/+$/, '');
  return listModules().find((mod) => mod.route.toLowerCase() === normalized.toLowerCase());
};

export const listModulesByCategory = (category: ModuleCategory): ModuleDefinition[] =>
  listModules().filter((mod) => mod.category === category);

/**
 * Where a top-level section should land when the user taps it: its first ACTIVE module, so a
 * primary nav tap never dead-ends on a "not available yet" screen while the section still has
 * something real to show. Falls back to the first module when nothing in it is built yet.
 */
export const getCategoryLandingRoute = (category: ModuleCategory): string => {
  const modules = listModulesByCategory(category);
  const active = modules.find((mod) => mod.status === 'active');
  return (active ?? modules[0])?.route ?? '/';
};

export const getCategoryDefinition = (category: ModuleCategory): ModuleCategoryDefinition =>
  MODULE_CATEGORIES.find((c) => c.id === category) ?? MODULE_CATEGORIES[0];

/** Categories exposed as their own bottom-nav slot on mobile (§2: max 5, the 5th is "More"). */
// Slot 3 was Watchlist until Fase 8 removed it as a page (the asset list on the Dashboard is the
// watchlist now, and the star still writes to the same store); Analysis took it then, being the
// largest category. Slot 4 was Signals until Fase 10 retired it as a nav category (§2) - Live
// Signals is now a per-asset card on the Markets page and Scalping Radar an in-page toggle there,
// neither needs its own slot. Macro takes it: the other fully-built category of comparable size,
// and the one Market State (Confluence) on the asset page now leans on most for context.
export const MOBILE_PRIMARY_CATEGORIES: ModuleCategory[] = ['dashboard', 'market', 'analysis', 'macro'];

/** Everything else lives behind "More", grouped - never a flat list (§2). */
export const MOBILE_MORE_CATEGORIES: ModuleCategory[] = MODULE_CATEGORIES.filter(
  (c) => !MOBILE_PRIMARY_CATEGORIES.includes(c.id)
).map((c) => c.id);

export const searchModules = (query: string): ModuleDefinition[] => {
  const q = query.trim().toLowerCase();
  if (!q) return listModules();
  return listModules().filter(
    (mod) =>
      mod.name.toLowerCase().includes(q) ||
      mod.id.toLowerCase().includes(q) ||
      mod.category.toLowerCase().includes(q) ||
      (mod.keywords ?? []).some((k) => k.toLowerCase().includes(q))
  );
};
