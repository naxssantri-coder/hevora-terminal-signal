import type { MarketStateBias } from './lib/confluence/types';

export type AssetCategory = 'commodities' | 'crypto' | 'forex';

export type PairId =
  | 'XAUUSD'
  | 'BTCUSDT'
  | 'ETHUSDT'
  | 'SOLUSDT'
  | 'EURUSD'
  | 'USDCHF'
  | 'USDCAD'
  | 'GBPUSD'
  // Tahap C (blueprint §2-5): asset universe expansion, verified via GitHub Actions before being
  // added here (scripts/verify-sources.ts, group 'Asset universe - Forex'/'Asset universe -
  // Crypto'). Data-only on arrival - see PairMetadata.signalEngineEnabled for why price/candle
  // coverage is not the same thing as being ready for the confluence engine to trade them.
  | 'USDJPY'
  | 'AUDUSD'
  | 'NZDUSD'
  | 'BNBUSDT'
  | 'XRPUSDT'
  | 'ADAUSDT'
  | 'DOGEUSDT';

export type SignalType = 'BUY' | 'SELL';

export type SignalStatus = 
  | 'Waiting Entry' 
  | 'Running' 
  | 'TP1 Hit' 
  | 'TP2 Hit' 
  | 'TP MAX Hit'
  | 'Stop Loss Hit'
  | 'Invalidated';

export interface Signal {
  id: string;
  pairId: PairId;
  pairName: string;
  category: AssetCategory;
  type: SignalType;
  timeframe: string;
  entryMin: number;
  entryMax: number;
  entryAvg: number;
  stopLoss: number;
  originalStopLoss?: number;
  takeProfit1: number;
  takeProfit2: number;
  /** Final XAU/USD structural target. TP1/TP2 are milestones; only this target closes XAU. */
  takeProfitMax?: number;
  /** XAU/USD-only tiering (see evaluateXauIctSetups/Task 4 in the XAUUSD audit) - undefined for every other pair. */
  signalTier?: 'MAIN' | 'SCALP';
  /** XAU/USD-only (Fase 3 adaptive pattern weighting, 2026-09-03) - undefined for every other pair. */
  xauPattern?: 'TREND_CONTINUATION' | 'LIQUIDITY_SWEEP_REVERSAL' | 'RANGE_SND_BOUNCE' | 'CHOCH_REVERSAL' | 'BREAKOUT_DISPLACEMENT_CONTINUATION';
  /** XAU/USD-only (Fase 3 adaptive pattern weighting, 2026-09-03) - undefined for every other pair. */
  xauHtfAlignment?: 'ALIGNED' | 'OPPOSED' | 'NEUTRAL';
  /**
   * XAU/USD-only (Fase I, contradiction/counter-evidence logging) - the best-scoring OPPOSITE-direction
   * candidate that evaluateXauIctSetups already computed and validated in the same pool this signal's
   * winning direction was picked from, but did not select. Purely informational context ("what was the
   * strongest case against this signal") - never used to alter the signal itself. null when no valid
   * opposite-direction candidate existed; undefined for every other pair.
   *
   * pattern/confluenceScore are null (2026-09-04 AI ensemble follow-up) when this entry's `note`
   * carries ONLY an AI second-opinion disagreement (see AIValidationResult.secondOpinionNote in
   * server.ts) and no real structural opposite-direction candidate existed that tick - never a
   * fabricated pattern/score standing in for a real one. When a real structural candidate DID
   * exist, pattern/confluenceScore describe it as before and an AI disagreement (if any) is simply
   * appended onto the same `note` string.
   */
  counterEvidence?: {
    pattern: 'TREND_CONTINUATION' | 'LIQUIDITY_SWEEP_REVERSAL' | 'RANGE_SND_BOUNCE' | 'CHOCH_REVERSAL' | 'BREAKOUT_DISPLACEMENT_CONTINUATION' | null;
    confluenceScore: number | null;
    note: string;
  } | null;
  /**
   * XAU/USD-only (Fase D, honest TP-before-SL metric) - real historical win-rate/MAE-MFE for this
   * exact signal's own (pattern, tier, regime.trend) combination, looked up from a real-backtest-
   * derived table (server.ts's XAU_HISTORICAL_BUCKET_STATS). 0-100. Undefined whenever no bucket
   * with sampleSize >= 20 real historical trades exists for this combination - never estimated
   * from a smaller sample or a nearby bucket. Always shown together with sampleSize - never on
   * its own, so a viewer can judge how much to trust it.
   */
  historicalTpBeforeSlRate?: number;
  /** Sample size (count of real historical trades) the fields above were computed from. Always >= 20 when present - see historicalTpBeforeSlRate's own comment. */
  sampleSize?: number;
  /**
   * Pre-trade expectation, not a post-resolve report: the historical MEDIAN Maximum Adverse/
   * Favorable Excursion (in R, i.e. multiples of this signal's own initial risk) for signals in
   * this same bucket, BEFORE this signal has resolved - "how far this kind of setup has typically
   * moved against/in favor of the position before it closed, historically". Same n>=20/undefined
   * rule as historicalTpBeforeSlRate.
   */
  historicalMedianMaeR?: number;
  historicalMedianMfeR?: number;
  /**
   * XAU/USD-only (Fase G, narasi/explainability) - a 1-2 sentence plain-language narrative from
   * validateSignalWithAI, turning already-computed fields (pattern, regime, key zone, invalidation
   * level, TP1->TP2->TP MAX path) into readable text. Never a new probability/prediction - the
   * prompt explicitly forbids that (see server.ts's xauNarrativeContext comment). Undefined when
   * the AI call failed/timed out/wasn't configured (NVIDIA_API_KEY unset) - same honest-omission
   * convention as every other AI-derived field, never a placeholder sentence.
   */
  aiNarrative?: string;
  /**
   * XAU/USD-only (Fase J, macro confluence connection) - a DIAGNOSTIC, informational read from the
   * same buildXauConfluence engine that already powers the Analysis tab's Market State panel.
   * NOT wired into confluenceScore or any gate yet - see server.ts's refreshXauMacroBiasSnapshot
   * comment for why (no historical macro time series exists yet to honestly backtest a score
   * adjustment against). undefined for every other pair.
   */
  xauMacroBias?: MarketStateBias;
  xauMacroConfidence?: number;
  /** How this signal's own direction relates to xauMacroBias above - purely descriptive. */
  xauMacroAlignment?: 'ALIGNED' | 'OPPOSED' | 'NEUTRAL';
  /**
   * XAU/USD-only (Fase L, drift check) - `${pattern}|${tier}|${regimeTrend}|${session}`, the exact
   * same key format as server.ts's XAU_HISTORICAL_BUCKET_STATS. Computed for every XAUUSD signal
   * regardless of whether it currently matches a published n>=20 baseline bucket, so a future
   * baseline update can still match this record retroactively. Used by computeXauDriftCheck to
   * compare rolling live win-rate against the backtest baseline for the same bucket.
   */
  xauBucketKey?: string;
  riskReward: string;
  status: SignalStatus;
  createdAt: string;
  updatedAt: string;
  lockedUntil?: string;
  readyForReplacementAt?: string;
  strategyMethod: string;
  analysisReasoning: string;
  userAdvice: string;
  aiConfidenceScore?: number;
  aiQualityGrade?: string;
  riskGuidance?: {
    lotSize: string;
    riskRupiah: string;
    note: string;
  };
  structureBreakdown?: {
    mss: boolean;
    bos: boolean;
    fvg: boolean;
    liquiditySweep: boolean;
    orderBlock: boolean;
    supplyDemand: boolean;
  };
  hitPrices?: {
    tp1Time?: string;
    tp2Time?: string;
    tpMaxTime?: string;
    slTime?: string;
  };
  history: Array<{
    status: SignalStatus;
    timestamp: string;
    price: number;
    note: string;
  }>;
}

export type OutcomeCategory = 
  | 'TP2 Hit'
  | 'TP1 Partial + Breakeven'
  | 'TP1 Partial + Stop Loss'
  | 'Stop Loss Hit'
  | 'Full TP' 
  | 'TP1 then SL' 
  | 'Direct SL' 
  | 'Invalidated' 
  | 'TP1 Partial Close' 
  | 'TP2 Final Close' 
  | 'Remaining Position Closed';

export interface SignalHistoryRecord {
  id: string;
  signalId: string;
  pairId: PairId;
  pairName: string;
  category: AssetCategory;
  type: SignalType;
  timeframe: string;
  entryMin: number;
  entryMax: number;
  entryAvg: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  /** Final XAU/USD structural target. TP1/TP2 are milestones; only this target closes XAU. */
  takeProfitMax?: number;
  /** XAU/USD-only tiering (see evaluateXauIctSetups/Task 4 in the XAUUSD audit) - undefined for every other pair. */
  signalTier?: 'MAIN' | 'SCALP';
  /** XAU/USD-only (Fase 3 adaptive pattern weighting, 2026-09-03) - undefined for every other pair, and for any record closed before this field existed (no retroactive backfill). */
  xauPattern?: 'TREND_CONTINUATION' | 'LIQUIDITY_SWEEP_REVERSAL' | 'RANGE_SND_BOUNCE' | 'CHOCH_REVERSAL' | 'BREAKOUT_DISPLACEMENT_CONTINUATION';
  /** XAU/USD-only (Fase 3 adaptive pattern weighting, 2026-09-03) - undefined for every other pair, and for any record closed before this field existed (no retroactive backfill). */
  xauHtfAlignment?: 'ALIGNED' | 'OPPOSED' | 'NEUTRAL';
  /** XAU/USD-only (Fase D) - carried forward from the live Signal at the moment it was created, see Signal.historicalTpBeforeSlRate's own comment. undefined for every other pair and for any record closed before this field existed. */
  historicalTpBeforeSlRate?: number;
  sampleSize?: number;
  historicalMedianMaeR?: number;
  historicalMedianMfeR?: number;
  /** XAU/USD-only (Fase G) - carried forward from the live Signal at the moment it was created, see Signal.aiNarrative's own comment. */
  aiNarrative?: string;
  /** XAU/USD-only (Fase J) - carried forward from the live Signal, see Signal.xauMacroBias's own comment. Diagnostic only. */
  xauMacroBias?: MarketStateBias;
  xauMacroConfidence?: number;
  xauMacroAlignment?: 'ALIGNED' | 'OPPOSED' | 'NEUTRAL';
  /** XAU/USD-only (Fase L) - carried forward from the live Signal, see Signal.xauBucketKey's own comment. */
  xauBucketKey?: string;
  riskReward: string;
  finalStatus: 'TP2 Hit' | 'Stop Loss Hit' | 'TP1 Hit' | 'Invalidated';
  outcomeCategory: OutcomeCategory;
  pnlRMultiple: number;
  pnlPips?: number;
  pnlUnit?: 'pips' | 'points' | 'usd';
  positionSizeFraction?: number;
  createdAt: string;
  closedAt: string;
  durationMinutes: number;
  strategyMethod: string;
  aiQualityGrade?: string;
  hitPrices?: {
    tp1Time?: string;
    tp2Time?: string;
    tpMaxTime?: string;
    slTime?: string;
  };
}

export interface HistorySummary {
  totalSignals: number;
  winRate: number;
  nonLossRate: number;
  fullTpCount: number;
  tp1SlCount: number;
  directSlCount: number;
  invalidatedCount: number;
  avgRiskReward: number;
  totalRMultiple: number;
  totalPipsByUnit?: {
    pips: number;
    points: number;
    usd: number;
  };
  categoryBreakdown: {
    commodities: { count: number; winRate: number; nonLossRate?: number; rMultiple: number; pnlPips?: number };
    crypto: { count: number; winRate: number; nonLossRate?: number; rMultiple: number; pnlPips?: number };
    forex: { count: number; winRate: number; nonLossRate?: number; rMultiple: number; pnlPips?: number };
  };
  pairBreakdown: Record<PairId, { count: number; winRate: number; nonLossRate?: number; totalRMultiple: number; avgRMultiple: number; totalPnlPips?: number; pnlUnit?: 'pips' | 'points' | 'usd' }>;
}

export interface HistoryResponse {
  success: boolean;
  history: SignalHistoryRecord[];
  summary: HistorySummary;
}

export interface MarketPrice {
  symbol: PairId;
  name: string;
  category: AssetCategory;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume: string;
  digits: number;
  tradingViewSymbol: string;
  lastUpdated: string;
  isStale?: boolean;
  /** True only for the hardcoded placeholder currentPrices starts every pair on at boot, before
   * its first real fetch has ever succeeded (audit 2026-08-30) - distinct from isStale, which can
   * read false for a seed value too: the seed's own `lastUpdated` is set at module-load time, so
   * it looks "fresh" for the first ~15s after a restart even though it was never actually fetched.
   * Flips to false the moment a real price tick lands and never flips back, even if that pair's
   * feed later goes stale/fails - it only ever distinguishes "never fetched" from "fetched at
   * least once", not general freshness (isStale still owns that). Absent/undefined has the same
   * meaning as false for any consumer that predates this field. */
  isSeeded?: boolean;
}

/**
 * Structured macro narrative written by Gemini over the real FRED prints the server gathered
 * (see gatherMacroNarrativeInputs / getMacroNarrative in server.ts). The AI only interprets those
 * inputs - it is never a source of numbers, and a response failing the server's schema check is
 * discarded rather than rendered half-broken.
 */
export interface MacroNarrativeStructured {
  whatHappened: string;
  whyItMatters: string;
  marketImpactTable: { asset: string; bias: string; reason: string }[];
  whatToWatch: string;
}

export interface MacroNarrativeResponse {
  success: boolean;
  narrative: MacroNarrativeStructured | null;
  generatedAt: string | null;
}

/** Roadmap Batch D: POST /api/ai/ask - a free-text question answered only from real data this
 *  server already has (same honesty rule as MacroNarrativeResponse above), never a forecast. */
/** One Google Search grounding citation - title + URL only, no publish date (the grounding API
 *  itself does not return one per source; recency comes from the search being live at request
 *  time, not from a displayed timestamp). Shown separately from the answer text so a reader can
 *  tell HEVORA's own internal data apart from what an external search turned up. */
export interface AskAiSource {
  title: string;
  url: string;
}

export interface AskAiResponse {
  success: boolean;
  answer: string | null;
  error: string | null;
  generatedAt?: string | null;
  /** Present only when the answer actually used Google Search grounding - absent (not an empty
   *  array) when the model answered from HEVORA's internal data bundle alone. */
  sources?: AskAiSource[];
  /** True only when the model refused the question as out of HEVORA's trading/market scope
   *  (server's OFF_TOPIC guardrail). `answer` still carries the refusal text in that case - this
   *  flag just lets the UI render it as a distinct "out of scope" card instead of a normal
   *  answer bubble. Absent (not false) on every normal answer. */
  offTopic?: boolean;
  /** True only when the model stated a genuinely directional bias (bullish/bearish/range lean with
   *  a ranked dominant factor and a specific invalidation) rather than a purely informational
   *  answer (server's BIAS_DIRECTIONAL marker, PR 7). `answer` still carries the full reasoning -
   *  this flag just lets the UI render a separate DYOR disclaimer card, same pattern as `offTopic`.
   *  Absent (not false) on every non-directional answer. */
  hasDirectionalBias?: boolean;
  /** 2-3 short bullet-style summary points for the answer, parsed from the model's own leading
   *  POIN_UTAMA marker (HEVAI answer redesign) - same single-call, no-second-Gemini-call pattern as
   *  the other markers above. Absent (not an empty array) when the model omitted the marker. */
  keyPoints?: string[];
  /** 2-3 natural follow-up questions relevant to the answer just given, parsed from the model's own
   *  trailing SARAN_LANJUTAN marker - same pattern as `keyPoints`. Meant to be submitted verbatim
   *  (same submit(chipText) mechanism the welcome-screen quick-question chips already use), not
   *  edited by the user first. Absent when the model omitted the marker. */
  followUpQuestions?: string[];
  /** One actionable-but-non-executable closing observation, parsed from the model's own optional
   *  trailing TINDAKAN paragraph (HEVAI answer redesign, Priority 2 pass) - only present for
   *  comparison/condition-analysis questions the model judged worth ending on, never a literal
   *  buy/sell instruction (same guardrail as `hasDirectionalBias`). Absent (not empty string) on
   *  every other answer. */
  actionConclusion?: string;
}

/** Tahap F (blueprint §49): GET /api/intelligence/geopolitical-risk. Aggregated from real,
 * already-published market_news LiveEvents - never a black box, so every contributor is listed. */
export interface GeopoliticalRiskContributor {
  id: string;
  title: string;
  score: number;
  createdAt: string;
  sourceUrl: string | null;
  /** This item's weight in the aggregate (0-1, recency-decayed) - shown so the arithmetic is
   * checkable, not just the final number. */
  weight: number;
}

export interface GeopoliticalRiskResponse {
  /** 0-100, null when there is nothing to compute from (see `error`). */
  score: number | null;
  /** How many geopolitically-relevant items fed the score. */
  sampleSize: number;
  windowDays: number;
  topContributors: GeopoliticalRiskContributor[];
  methodology: string;
  source: string;
  generatedAt: string;
  unavailable: boolean;
  error?: string;
}

/** Tahap D3 Tier 3 (RUMORED/UNCONFIRMED, blueprint §14) - GET /api/macro/central-bank-gold-rumors.
 * A LIST, deliberately not aggregated into one score like GeopoliticalRiskResponse - each rumor
 * is its own unverified claim, averaging them into a single number would misrepresent them as one
 * coherent read the way the geopolitical-risk score legitimately is. */
export interface GoldPurchaseRumorItem {
  id: string;
  title: string;
  country: string;
  tonnesEstimate: number | null;
  reason: string;
  createdAt: string;
  sourceUrl: string | null;
}

export interface GoldPurchaseRumorResponse {
  rumors: GoldPurchaseRumorItem[];
  windowDays: number;
  source: string;
  generatedAt: string;
}

export interface XauDailyResponse {
  points: DailyPricePoint[];
  count: number;
  firstDate: string | null;
  lastDate: string | null;
  source: string;
}

// ===== Analysis module feeds (Fase 3) =====

/** /api/macro/dxy - the dollar-index tracker the signal engine already polls for XAU confluence. */
export interface DxyResponse {
  price: number | null;
  trend15m: number | null;
  /** Roadmap §D audit: % change from the session's first available 1m close to the latest one
   * (Yahoo's own `range=1d` window), NOT a 24h change - FX/DXY has no fixed daily reset like a
   * stock market, so this is "how far has today's session actually moved" rather than a strict
   * midnight-to-midnight figure. Added because trend15m alone is too short/noisy a window for
   * Market Regime's composite (see useMarketRegime.ts / computeRegime's dxy driver) - a real
   * intraday move that has already happened can sit outside the trailing 15 minutes and read as
   * "neutral" even while the session is clearly trending. trend15m itself is kept unchanged for
   * every existing fast-momentum consumer (signal generation, XAU confluence's DXY factor). */
  changeSessionPct: number | null;
  lastUpdated: string | null;
  ageMs: number | null;
  source: string;
  unavailable: boolean;
}

export interface GoldSeasonalityMonth {
  month: number; // 1-12
  avgReturnPercent: number | null;
  positiveYears: number;
  negativeYears: number;
  totalYears: number;
}

export interface GoldSeasonalityResponse {
  months: GoldSeasonalityMonth[];
  yearsCovered: number;
  firstDate: string | null;
  lastDate: string | null;
  symbol: string;
  source: string;
  fetchedAt: string | null;
  stale: boolean;
  unavailable: boolean;
  error?: string;
}

/** Tahap D §13-15: individual COMEX gold futures contract, GET /api/market/xau-futures-curve. */
export interface GoldFuturesContractQuote {
  symbol: string;
  label: string;
  month: number;
  year: number;
  price: number | null;
  error?: string;
}

export interface XauFuturesCurveResponse {
  curve: GoldFuturesContractQuote[];
  source: string;
  fetchedAt: string | null;
  stale: boolean;
  unavailable: boolean;
  error?: string;
}

/**
 * Tahap D3 Tier 1 (blueprint §14): central bank gold buying/selling by country, GET
 * /api/macro/central-bank-gold. Scraped from World Gold Council's free "Gold Focus" monthly blog
 * post (NOT the Changes_latest...xlsx file, which is confirmed HTTP 403 even with a Referer
 * header - see docs/TAHAP-D3-CENTRAL-BANK-GOLD.md). The post is prose, not a table or JSON, so
 * this is genuinely fragile - a copy change on WGC's side can break extraction, which is exactly
 * why `unavailable` exists and is checked before trusting `rows`.
 */
export interface CentralBankGoldRow {
  country: string;
  /** Signed tonnes: positive = net buyer, negative = net seller, for the reported month. */
  changeTonnes: number;
}

export interface CentralBankGoldResponse {
  rows: CentralBankGoldRow[];
  /** The calendar month the DATA ITSELF covers (e.g. "June 2026"), extracted from the post's own
   * headline - NOT when HEV fetched it. WGC's own reporting lag is ~2 months, so these two dates
   * are routinely different; conflating them was explicitly flagged as a mistake to avoid. */
  lastReportedMonth: string | null;
  postUrl: string | null;
  source: string;
  fetchedAt: string | null;
  stale: boolean;
  unavailable: boolean;
  error?: string;
}

/**
 * Liquidity Map (blueprint §50), BTC-USDT only - GET /api/market/liquidity-map/btcusdt.
 * Composes ONLY already-wired data (no new provider): the live order book relay for real resting
 * depth, and swing-high/low + Fair Value Gap structure derived fresh from candleStore['BTCUSDT']
 * using the same 3-candle fractal/gap logic the signal engine itself uses (see server.ts's
 * scanLiquidityStructure - a standalone re-scan over the whole available candle window, not just
 * the latest 3 candles the engine checks per tick).
 *
 * `kind: 'structural-*'` zones (swing highs/lows, FVGs) are an INFERENCE about where resting
 * orders/stops are LIKELY to cluster (standard SMC/ICT framing) - not a measurement of real
 * orders, since no free source for actual resting-order data exists. `kind: 'orderbook'` zones
 * ARE a direct measurement (today's visible bid/ask depth). The UI keeps these visually distinct
 * so a reader never mistakes an inference for a fact.
 */
export interface LiquidityZone {
  price: number;
  /** For a Fair Value Gap zone, the OTHER edge of the gap - absent for point levels (swing highs/
   * lows, order book levels). */
  priceTo?: number;
  kind: 'structural-swing' | 'structural-fvg' | 'orderbook';
  /** How many candles/levels support this exact price band - a rough "more inputs agree here"
   * signal, not a real volume/size measurement for structural zones. */
  weight: number;
}

export interface LiquidityMapResponse {
  symbol: string;
  currentPrice: number | null;
  /** Zones below currentPrice - swing lows + bullish FVGs (buy-side/long-stop liquidity, in SMC
   * framing) plus the order book's own largest bid clusters. */
  buyLiquidity: LiquidityZone[];
  /** Zones above currentPrice - swing highs + bearish FVGs (sell-side/short-stop liquidity) plus
   * the order book's own largest ask clusters. */
  sellLiquidity: LiquidityZone[];
  /** Audited and confirmed NOT wired (no liquidation feed exists anywhere in this codebase) -
   * always false, always present so the UI can show this honestly instead of silently omitting
   * an entire planned input. */
  liquidationsIncluded: false;
  liquidationsNote: string;
  candleWindowSize: number;
  source: string;
  fetchedAt: string | null;
  unavailable: boolean;
  error?: string;
}

/** Tahap G §62 tambahan-2: GET /api/admin/data-health. Categorical, never a numeric score. */
export type ProviderHealthStatus = 'LIVE' | 'DELAYED' | 'STALE' | 'UNAVAILABLE';

export interface ProviderHealthRow {
  provider: string;
  category: string;
  status: ProviderHealthStatus;
  lastSuccessfulFetch: string | null;
  detail: string;
}

export interface DataHealthResponse {
  rows: ProviderHealthRow[];
  generatedAt: string;
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

/** blueprint §7. One relay instance per pair (BTC-USDT pilot, ETH-USDT pair #2 - see server.ts's
 * createOrderBookRelay factory), each producing this same shape. `connection` is the SERVER's
 * link to the exchange (OKX WebSocket relay); it is not the same thing as whether the browser's
 * own SSE stream is open - see useOrderBookStream's separate `streamConnected` for that. */
export interface OrderBookSnapshot {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  source: 'OKX' | 'Bybit' | null;
  updatedAt: string | null;
  ageMs: number | null;
  connection: 'connecting' | 'connected' | 'disconnected';
  fallbackActive: boolean;
  unavailable: boolean;
}

export interface FearGreedPoint {
  value: number;
  classification: string | null;
  timestamp: string | null;
}

export interface FearGreedResponse {
  points: FearGreedPoint[];
  source: string;
  /** 'crypto' - this index is a crypto measure and must not be labelled as market-wide. */
  scope: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** COT Heat Scan asset-class filter (2026-09-02 redesign) - groups every tracked market into the
 *  six buckets the page filters by. Also decides which CFTC report a market's `breakdown` came
 *  from server-side: FX/INDEX/CRYPTO use TFF, METALS/ENERGY/AGRI use Disaggregated - see
 *  CotBreakdown's own comment. */
export type CotClass = 'METALS' | 'FX' | 'ENERGY' | 'AGRI' | 'INDEX' | 'CRYPTO';

export interface CotCategoryRow {
  key: string;
  label: string;
  long: number;
  short: number;
  net: number;
}

/** Real CFTC trader-category breakdown for one market. `system` names which report the
 *  categories came from: 'tff' (Traders in Financial Futures - Dealer/Asset Manager/Leveraged
 *  Funds/Other Reportables) for FX/INDEX/CRYPTO, or 'disaggregated' (Producer-Merchant/Swap
 *  Dealers/Managed Money/Other Reportables) for physical commodities (METALS/ENERGY/AGRI) - the
 *  two report types use different category systems, never merged into one fake universal label
 *  set. Absent from CotPosition (not this type itself) when the breakdown fetch failed. */
export interface CotBreakdown {
  system: 'tff' | 'disaggregated';
  categories: CotCategoryRow[];
}

export interface CotPosition {
  symbol: string;
  market: string;
  cotClass: CotClass;
  longContracts: number;
  shortContracts: number;
  netContracts: number;
  /** Commercial long/short from the same Legacy dataset the Non-Commercial numbers above come
   *  from - null only if that dataset's own columns were ever missing, never fabricated as 0. */
  commercialLong: number | null;
  commercialShort: number | null;
  openInterest: number | null;
  reportDate: string | null;
  /** Where the latest net sits within its own recent history, 0-100. Null below 8 observations. */
  percentile: number | null;
  observations: number;
  history: Array<{ date: string | null; net: number }>;
  /** Net-position change vs the immediately preceding weekly report. Null with fewer than 2
   *  observations. */
  weeklyChange: number | null;
  /** Null when the TFF/Disaggregated fetch failed for this market - render "unavailable", never a
   *  fabricated breakdown. */
  breakdown: CotBreakdown | null;
}

export interface CotResponse {
  positions: Record<string, CotPosition>;
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** /api/analysis/cross-asset-correlation (Analysis tab upgrade, 2026-08-26) - daily-frequency
 *  correlation across Gold/DXY/10Y yield change/equity indices/BTC, distinct from the engine's
 *  own 5m candle-store matrix CorrelationView already computes (see that endpoint's server.ts
 *  comment for why these can't share one matrix). `cells` is the same shape src/lib/analytics.ts's
 *  CorrelationCell already uses (inlined rather than imported - analytics.ts itself imports from
 *  this file, so importing back would be circular). */
export interface CrossAssetCorrelationResponse {
  symbols: string[];
  labels: Record<string, string>;
  cells: Array<{ a: string; b: string; value: number | null; observations: number }>;
  observations: number;
  firstDate: string | null;
  lastDate: string | null;
  unavailableSeries: string[];
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

export interface ChainTvl {
  name: string;
  tvlUsd: number;
  tokenSymbol: string | null;
}

export interface ChainTvlResponse {
  chains: ChainTvl[];
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

export interface StablecoinPoint {
  date: string;
  totalUsd: number;
}

export interface StablecoinResponse {
  points: StablecoinPoint[];
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** /api/macro/gld-holdings (PRIORITY 3B, data-freshness audit 2026-08-26). SPDR's real daily
 *  archive, GLD only - IAU has no equivalent confirmed source, stays honest-unavailable. */
export interface GldHoldingsPoint {
  date: string;
  tonnes: number | null;
  closingPriceUsd: number | null;
  totalNetAssetValueUsd: number | null;
}

export interface GldHoldingsResponse {
  points: GldHoldingsPoint[];
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** /api/macro/treasury-auctions (PRIORITY 3A, data-freshness audit 2026-08-26). Bills clear at a
 *  discount rate, Notes/Bonds/TIPS at a yield - auctionRate keeps which one explicit rather than
 *  merging both into one ambiguous "rate" number. */
export interface TreasuryAuctionRow {
  cusip: string | null;
  securityType: string | null;
  securityTerm: string | null;
  announcementDate: string | null;
  auctionDate: string | null;
  issueDate: string | null;
  maturityDate: string | null;
  reopening: boolean;
  offeringAmount: number | null;
  bidToCoverRatio: number | null;
  totalAccepted: number | null;
  auctionRate: { kind: 'high_yield' | 'high_discnt_rate'; percent: number } | null;
  resultsPending: boolean;
}

export interface TreasuryAuctionsResponse {
  auctions: TreasuryAuctionRow[];
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** One Fed-funds-rate threshold market for the next FOMC meeting, from Kalshi
 *  (api.elections.kalshi.com) - a CFTC-regulated prediction-market exchange, replacing the
 *  CME FedWatch slot that was never wired (CME market data requires a paid license this app
 *  doesn't have). `probabilityPct` is the market's own read (mid of yes bid/ask, falling back to
 *  last trade price) that the Fed funds rate upper bound ends up ABOVE `floorStrike` after the
 *  meeting - a genuinely different methodology from a futures-implied probability, never
 *  presented as CME data. */
export interface KalshiFedThreshold {
  ticker: string;
  floorStrike: number;
  probabilityPct: number;
  volume24h: number | null;
  openInterest: number | null;
  closeTime: string | null;
}

export interface KalshiFedProbabilitiesData {
  /** Kalshi's own event ticker for the next meeting, e.g. "KXFED-26SEP" - picked dynamically each
   *  fetch (earliest strike_date among open KXFED events), never hardcoded. */
  eventTicker: string;
  /** ISO date of the FOMC decision this event resolves on. */
  meetingDate: string | null;
  thresholds: KalshiFedThreshold[];
}

export interface KalshiFedProbabilitiesResponse {
  probabilities: KalshiFedProbabilitiesData | null;
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** One global index quote from /api/indices (Yahoo Finance). A failed symbol carries
 *  `value: null` plus `error` - never a substituted or carried-over number. */
export interface IndexQuote {
  symbol: string;
  name: string;
  region: string;
  value: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  currency: string | null;
  marketState: string | null;
  error?: string;
}

export interface IndicesResponse {
  indices: IndexQuote[];
  source: string;
  fetchedAt: string | null;
  /** True when served from the last good snapshot because every live fetch failed. */
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** /api/market/fx-history - real Yahoo daily closes for one FX major. */
export interface FxHistoryResponse {
  pair: string;
  symbol?: string;
  points: Array<{ date: string; close: number }>;
  count: number;
  source: string;
  fetchedAt?: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** /api/crypto/derivatives - OKX funding, open interest and long/short ratio (primary path;
 *  Bybit is 403-blocked, Binance is 451-blocked from Render). */
export interface CryptoDerivativesResponse {
  instrument: string;
  fundingRate: number | null;
  nextFundingTime: string | null;
  fundingTime: string | null;
  openInterestContracts: number | null;
  openInterestCcy: number | null;
  openInterestTime: string | null;
  openInterestChange24h: number | null;
  openInterestObservations: number;
  /** Trailing hourly OI readings, oldest first. */
  openInterestHistory: Array<{ time: string; oi: number }>;
  /** Trailing funding settlements, oldest first. Each `rate` is the raw per-8h fraction. */
  fundingHistory: Array<{ time: string; rate: number }>;
  longShortRatio: number | null;
  longShortRatioTime: string | null;
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** Every crypto pair the Institutional Watchlist full-page detail can show a real multi-exchange
 *  ranking/liquidation table for (BTC/ETH/SOL plus BNB/XRP/ADA/DOGE - Part B bug fix). */
export type CryptoDerivativesSymbol = 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT' | 'BNBUSDT' | 'XRPUSDT' | 'ADAUSDT' | 'DOGEUSDT';

/** /api/crypto/exchange-ranking - per-exchange row (OKX + Bybit + KuCoin + Gate.io + Bitget +
 *  Kraken + Coinbase + MEXC + Bitstamp + Gemini + Crypto.com, all
 *  public REST, no API key). A row is simply ABSENT from `rows` when that exchange's fetch failed
 *  this cycle - never zero-filled or stale-filled to fake a complete table. */
export interface ExchangeRankingRow {
  exchange:
    | 'OKX'
    | 'Bybit'
    | 'KuCoin'
    | 'Gate.io'
    | 'Bitget'
    | 'Kraken'
    | 'Coinbase'
    | 'MEXC'
    | 'Bitstamp'
    | 'Gemini'
    | 'Crypto.com'
    | 'Deribit'
    | 'BitMEX'
    | 'dYdX'
    | 'Hyperliquid'
    | 'Upbit'
    | 'WhiteBIT'
    | 'CoinEx'
    | 'LBank'
    | 'BingX'
    | 'HTX';
  price: number | null;
  volume24hUsd: number | null;
  openInterestUsd: number | null;
  /** Percent per the exchange's own funding settlement interval (not necessarily 8h for every
   *  exchange/symbol) - never presented as a normalized-to-8h number across exchanges. */
  fundingRatePercent: number | null;
  /** 24h price change (%) for this pair ON THIS EXCHANGE - from that exchange's own ticker payload
   *  (an already-fetched field/derivation, e.g. OKX's `open24h`, Bybit's `price24hPcnt`), never a
   *  second endpoint call purely to compute this. Drives ExchangeVolumeHeatmap's block color (Fix
   *  Warna Heatmap: color = price change, not funding rate) - null when the exchange's payload
   *  doesn't carry a usable 24h-open/change field, rendered as a neutral (non-colored) block rather
   *  than guessed. */
  priceChangePercent24h: number | null;
  /** Long/short ACCOUNT ratio (buy accounts / sell accounts). Null when the exchange has no public
   *  equivalent (KuCoin/Gate.io/Bitget Futures have none) - shown as "—" for that cell, row is
   *  still kept. */
  longShortRatio: number | null;
}

export interface ExchangeRankingResponse {
  symbol: CryptoDerivativesSymbol;
  rows: ExchangeRankingRow[];
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** /api/crypto/market-cap-history - CoinGecko daily market cap + price, up to 1 year. */
export interface MarketCapHistoryPoint {
  time: string;
  price: number;
  marketCapUsd: number;
}

export interface MarketCapHistoryResponse {
  symbol: CryptoDerivativesSymbol;
  points: MarketCapHistoryPoint[];
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** /api/crypto/futures-history - OI-weighted funding rate + aggregate OI/volume, derived from the
 *  same per-exchange rows /api/crypto/exchange-ranking already fetches (never a second round of
 *  exchange calls). Persisted to Redis at a low frequency (~20min) and restored on server boot -
 *  see server.ts's loadFuturesHistoryStore/persistFuturesHistoryIfDue - so this now genuinely
 *  accumulates across restarts when Redis is configured, not just within one process's uptime. */
export interface FuturesHistoryPoint {
  time: string;
  weightedFundingRatePercent: number | null;
  totalOpenInterestUsd: number | null;
  totalVolume24hUsd: number | null;
  exchangeCount: number;
  /** This pair's own price at snapshot time (the highest-24h-volume exchange row's price, the
   *  same "most liquid/representative" pick ExchangeRankingTable's own sort already uses) - lets
   *  the chart plot price alongside the metric on an independent axis, CoinGlass-reference style,
   *  without a second fetch. Null only when every row's price was unavailable that cycle. */
  price: number | null;
}

export interface FuturesHistoryResponse {
  symbol: CryptoDerivativesSymbol;
  points: FuturesHistoryPoint[];
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** /api/crypto/market-heatmap - CoinGecko top ~30 coins by 24h volume, for the Institutional
 *  Watchlist detail panel's treemap (shared across every crypto pair's panel - general market
 *  context, not per-pair). */
export interface CryptoHeatmapCoin {
  id: string;
  symbol: string;
  name: string;
  price: number;
  volume24hUsd: number;
  change24hPercent: number | null;
  marketCapUsd: number | null;
  /** CoinGlass parity (Bagian A header tiles) - CoinGecko's /coins/markets already returns these
   *  per coin, just never mapped before. null when CoinGecko itself doesn't report a figure (e.g.
   *  `max_supply` for a coin with no hard cap) - never a guessed number. */
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
}

export interface CryptoMarketHeatmapResponse {
  coins: CryptoHeatmapCoin[];
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** /api/crypto/liquidations - Bybit allLiquidation WS, aggregated into rolling windows. Single
 *  exchange (Bybit), not a multi-exchange Coinglass-style aggregate - the UI must label this. */
export interface LiquidationWindowStats {
  longUsd: number;
  shortUsd: number;
  count: number;
}

export interface LiquidationsResponse {
  symbol: CryptoDerivativesSymbol;
  windows: {
    '1h': LiquidationWindowStats;
    '4h': LiquidationWindowStats;
    '12h': LiquidationWindowStats;
    '24h': LiquidationWindowStats;
  };
  connection: 'connecting' | 'connected' | 'disconnected';
  lastEventAt: string | null;
  /** When the in-memory aggregator started tracking (server boot / last restart) - a window whose
   *  span exceeds this is genuinely partial, not a full trailing period, and the UI must say so
   *  rather than imply a complete 24h read right after a restart. */
  trackingSince: string | null;
  source: string;
  unavailable: boolean;
}

/** /api/crypto/dominance - CoinGecko global market shares. */
export interface CryptoDominanceResponse {
  btcDominance: number | null;
  ethDominance: number | null;
  marketCapChange24h: number | null;
  updatedAt: string | null;
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** /api/flow/stablecoins - DefiLlama total circulating supply, oldest first. */
export interface StablecoinSupplyResponse {
  points: Array<{ date: string; totalUsd: number }>;
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** /api/market/commodities - Yahoo futures board (Fase 8 §4, commodities). */
export interface CommodityQuote {
  symbol: string;
  name: string;
  group: 'energy' | 'metals' | 'agriculture';
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string | null;
  marketState: string | null;
  quoteTime: string | null;
  error?: string;
}

export interface CommoditiesResponse {
  commodities: CommodityQuote[];
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** /api/market/commodity-history - real daily closes from the provider, never an archive of ours. */
export interface CommodityHistoryResponse {
  symbol: string;
  points: Array<{ date: string; close: number }>;
  count: number;
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** /api/crypto/etf-overview - Part H (Institutional Watchlist, BTCUSDT only). Price/volume per
 *  Bitcoin spot ETF ticker come from Yahoo Finance's chart endpoint (same provider/pattern as
 *  CommodityQuote above). `aumUsd` and `expenseRatioPercent` are always null - confirmed via a
 *  live audit (scripts/audit-etf-sources.ts) that Yahoo's chart endpoint carries neither field for
 *  any of these tickers, and no other free/keyless source for them was found. The UI must render
 *  them as an honest "—", never a fabricated or estimated figure. */
export interface CryptoEtfHolding {
  ticker: string;
  name: string | null;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  currency: string | null;
  marketState: string | null;
  quoteTime: string | null;
  /** Always null - see interface comment. Kept as a field (not omitted) so the UI has one place
   *  to render "—" and so a real source can be wired in later without a shape change. */
  aumUsd: number | null;
  expenseRatioPercent: number | null;
  error?: string;
}

export interface CryptoEtfOverviewResponse {
  etfs: CryptoEtfHolding[];
  /** Sum of price*volume across every ETF that answered with both fields this cycle - an honest
   *  same-cycle aggregate, not a cross-provider mix. Null when no ETF answered. */
  totalVolumeUsd: number | null;
  /** Daily net creation/redemption flow (Farside Investors) is NOT included here - confirmed via
   *  a live audit that farside.co.uk returns HTTP 403 to this deployment (likely anti-bot, not
   *  IP-specific.) Surfaced as a fixed honest string so the UI can show it verbatim instead of
   *  silently omitting the fact that flow data was looked for and not found. */
  flowNote: string;
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}

/** /api/energy/crude-stocks - EIA weekly stocks. Empty with `unavailable` when the key is absent. */
export interface CrudeStocksResponse {
  points: Array<{ period: string; value: number }>;
  count?: number;
  unit?: string;
  series?: string;
  source: string;
  fetchedAt?: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
  signupUrl?: string;
}

export interface ResearchItem {
  id: string;
  title: string;
  summary: string;
  content: string;
  imageUrl?: string;
  author?: string;
  category: 'Forex' | 'Crypto' | 'Commodities' | 'Macro';
  tags?: string[];
  createdAt: string;
}

export interface PlatformUpdate {
  id: string;
  title: string;
  description: string;
  type: 'feature' | 'fix' | 'improvement' | 'announcement';
  createdAt: string;
}

export interface EngineSettings {
  autoBreakevenEnabled: boolean;
}

/**
 * Version of the risk-disclaimer text the user signs in RiskConsentGate.
 *
 * SINGLE SOURCE OF TRUTH - imported by server.ts (to decide whether a stored acknowledgment is
 * still current) and by the gate component itself. Bump this whenever the disclaimer wording or
 * the checkbox list changes in any material way: every user whose stored acknowledgment carries an
 * older version is then asked to read and sign again on their next visit to the Market tab. That
 * re-consent is the entire point of versioning it - an old signature is not evidence of consent to
 * new text.
 *
 * Keep it a plain string (not a number) so a scheme like '2026-08-1' stays possible later.
 */
export const DISCLAIMER_VERSION = '1';

/** One recorded, provable risk acknowledgment. Written only by POST /api/user/risk-acknowledgment,
 * one per Clerk user, stored at Redis key `hevora:risk_ack:<clerkUserId>`.
 *
 * This is deliberately more than a boolean: `checkedItems` records WHICH statements were ticked,
 * `signatureName` what the user typed as their signature, and `acknowledgedAt` when - so the record
 * can answer "what exactly did this person agree to, and when", not merely "did they click ok". */
export interface RiskAcknowledgment {
  /** Clerk user id, taken from the verified session token server-side - never from the request
   * body, so a client cannot record consent on someone else's behalf. */
  userId: string;
  /** The DISCLAIMER_VERSION in force at the moment of signing. */
  disclaimerVersion: string;
  /** Ids of the checkboxes the user ticked (see RISK_CONSENT_ITEM_IDS). Stored verbatim so a later
   * audit can tell which specific statements were presented and accepted. */
  checkedItems: string[];
  /** What the user typed into the digital-signature field. */
  signatureName: string;
  acknowledgedAt: string;
}

/** The four statements a user must tick individually - no "agree to all" shortcut. Server-side
 * validation requires every one of these ids to be present in checkedItems, so adding an item here
 * automatically makes it mandatory (and should come with a DISCLAIMER_VERSION bump). */
export const RISK_CONSENT_ITEM_IDS = ['capitalLoss', 'notAdvice', 'ownResponsibility', 'noLiability'] as const;

export type RiskConsentItemId = (typeof RISK_CONSENT_ITEM_IDS)[number];

/** Response of GET /api/user/risk-acknowledgment. `needsAcknowledgment` is computed SERVER-side by
 * comparing the stored version against the current DISCLAIMER_VERSION, so the client never has to
 * reimplement that comparison and the two can't drift apart. */
export interface RiskAcknowledgmentStatus {
  success: boolean;
  needsAcknowledgment: boolean;
  currentVersion: string;
  /** The version the user previously signed, or null if they never have. */
  acknowledgedVersion: string | null;
  acknowledgedAt: string | null;
}

export interface SiteSettings {
  siteLogoUrl?: string;
  siteTagline?: string;
  engineSettings?: EngineSettings;
  /** When true, public-facing views blur entry/SL/TP/price numbers (admin dashboard is exempt). */
  signalsBlurred?: boolean;
}

export interface AIInsightLog {
  id: string;
  pairId: PairId;
  timestamp: string;
  closedSignalCount: number;
  winRate: number;
  avgR: number;
  outcomeBreakdown: string;
  aiAnalysis: string;
}

// ==========================================
// AUTO TRADING (MT5 Bridge) - admin-only, opt-in per pair, dry-run by default.
// See /mt5-ea/README.md for how the native MQL5 Expert Advisor consumes these.
// ==========================================

export type AutotradeMode = 'dry_run' | 'live';
export type AutotradeLotMode = 'fixed' | 'risk_percent';

export interface AutotradePairSettings {
  enabled: boolean;
  brokerSymbol: string;
  lotMode: AutotradeLotMode;
  lotValue: number;
  maxLot: number;
}

export interface AutotradeSettings {
  enabled: boolean;
  mode: AutotradeMode;
  /** Close the position in full the moment TP1 is hit. Default true. */
  tp1CloseEnabled: boolean;
  /** Close the position in full the moment TP2 is hit. Default true. If both flags are true, TP1
   *  wins the race (price always reaches TP1 before TP2 on the same position), so the TP2 event
   *  finds nothing left to close and is logged as a no-op. */
  tp2CloseEnabled: boolean;
  pairs: Partial<Record<PairId, AutotradePairSettings>>;
  maxConcurrentTrades: number;
  /**
   * Fase H (roadmap Bagian 1, kill-switch): a SEPARATE, narrower emergency stop from `enabled`
   * above. `enabled=false` blocks every event (new opens AND management of already-open positions
   * - TP1 partial-close, invalidation early-exit). This flag blocks ONLY new 'OPEN' events - an
   * already-open position keeps getting its TP1_HIT/CLOSE_TP2/CLOSE_SL/CLOSE_INVALIDATED events
   * normally, so it's still managed correctly (not just left to whatever broker-side SL/TP the EA
   * set at entry - see HandleOpen in mt5-ea/HevoraAutoTrade.mq5). Use this for "stop taking new
   * risk right now" without abandoning positions already open. Can ONLY be changed via
   * POST /api/admin/autotrade/kill-switch (never via the generic PUT settings endpoint, same
   * protected-field pattern as bridgeKeyHash below) so every change is guaranteed to append to the
   * persisted audit log (see AutotradeKillSwitchLogEntry).
   */
  killSwitchEnabled: boolean;
  killSwitchLastChangedAt: string | null;
  /** Never sent to the browser - only `bridgeKeyConfigured` (boolean) is exposed via the API. */
  bridgeKeyHash: string;
  bridgeKeyLastRotated: string | null;
}

/** Settings shape as returned to the admin browser - bridgeKeyHash replaced by a boolean flag. */
export interface AutotradeSettingsPublic extends Omit<AutotradeSettings, 'bridgeKeyHash'> {
  bridgeKeyConfigured: boolean;
}

export type AutotradeEventType = 'OPEN' | 'TP1_HIT' | 'CLOSE_TP2' | 'CLOSE_SL' | 'CLOSE_INVALIDATED';

export interface AutotradeEvent {
  eventId: string;
  eventType: AutotradeEventType;
  signalId: string;
  pairId: PairId;
  type: 'BUY' | 'SELL';
  entryAvg: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  brokerSymbol: string;
  lotMode: AutotradeLotMode;
  lotValue: number;
  maxLot: number;
  /** Snapshot of settings.tp1CloseEnabled at event time - only present on TP1_HIT events, so a
   *  setting change after the event is queued never changes it retroactively. */
  tp1CloseEnabled?: boolean;
  /** Snapshot of settings.tp2CloseEnabled at event time - only present on CLOSE_TP2 events. */
  tp2CloseEnabled?: boolean;
  createdAt: string;
  consumed: boolean;
  consumedAt?: string;
}

export interface AutotradeLogEntry {
  id: string;
  eventId: string;
  eventType: AutotradeEventType;
  pairId: PairId;
  signalId: string;
  status: 'success' | 'failed';
  ticket?: number;
  message?: string;
  accountBalance?: number;
  accountEquity?: number;
  reportedAt: string;
}

export interface AutotradeBridgeStatus {
  lastReportAt: string | null;
}

/** Fase H (roadmap Bagian 1, kill-switch) - one entry per status change, append-only, never
 *  overwritten. `trigger` is always 'manual' for now - an automatic trigger condition was
 *  explicitly left "to be discussed" by the roadmap rather than defined, so this field exists to
 *  stay extensible without a schema change if/when one is added later, not because auto-triggering
 *  exists yet. */
export interface AutotradeKillSwitchLogEntry {
  id: string;
  enabled: boolean;
  previousState: boolean;
  trigger: 'manual';
  changedAt: string;
}

/**
 * Fase K (roadmap Bagian 1, audit trail keputusan) - formalizes lastNoSignalReason (previously
 * in-memory only, overwritten every tick) into a persisted, append-only row per decision.
 * XAUUSD-only (per this project's XAUUSD-only-scope convention) - the fields this asks for
 * (pattern, counterEvidence) only exist for XAUUSD's ICT engine anyway.
 */
export interface XauDecisionAuditEntry {
  id: string;
  timestamp: string;
  decision: 'NO_SIGNAL' | 'SIGNAL_FIRED';
  reason: string;
  /** Null whenever the decision was made before market structure was even evaluated (e.g. stale
   *  price feed, circuit breaker, stale candle gate) - honestly absent, never fabricated. */
  regimeTrend: string | null;
  regimeVolatility: string | null;
  /** The best-scoring candidate's own pattern/score at decision time, even when it didn't clear
   *  the bar to fire - same honest-absence rule as regimeTrend above. */
  bestCandidatePattern: 'TREND_CONTINUATION' | 'LIQUIDITY_SWEEP_REVERSAL' | 'RANGE_SND_BOUNCE' | 'CHOCH_REVERSAL' | 'BREAKOUT_DISPLACEMENT_CONTINUATION' | null;
  bestCandidateScore: number | null;
  /** Fase I's own counter-evidence for the same tick, carried into this audit row. pattern/
   *  confluenceScore null when this entry is an AI second-opinion disagreement only - see
   *  Signal.counterEvidence's own comment for the full rationale (2026-09-04 AI ensemble follow-up). */
  counterEvidence: {
    pattern: 'TREND_CONTINUATION' | 'LIQUIDITY_SWEEP_REVERSAL' | 'RANGE_SND_BOUNCE' | 'CHOCH_REVERSAL' | 'BREAKOUT_DISPLACEMENT_CONTINUATION' | null;
    confluenceScore: number | null;
    note: string;
  } | null;
  /** Only present when decision === 'SIGNAL_FIRED'. */
  signalId?: string;
}

/**
 * Fase L (roadmap Bagian 1, drift check) - one entry per NEW flag transition (a bucket becoming
 * flagged, not re-logged on every periodic check while it stays flagged). Flag/notification only -
 * never a record of a parameter being changed, because none is.
 */
export interface XauDriftFlagLogEntry {
  id: string;
  timestamp: string;
  bucketKey: string;
  baselineTpBeforeSlRate: number;
  liveTpBeforeSlRate: number;
  liveSampleSize: number;
  deltaPercentagePoints: number;
}

export interface EconomicEvent {
  id: string;
  time: string;
  dateISO: string;
  currency: string;
  event: string;
  impact: 'High' | 'Medium' | 'Low';
  actual: string;
  forecast: string;
  previous: string;
  /** PRIORITY 2 (2026-08-26 data-freshness audit) + coverage expansion: set only when `actual`
   *  was filled in by a dedicated fallback (server.ts's applyOfficialStatsFallback) rather than
   *  coming straight from ForexFactory - never silently blended, so the UI can disclose
   *  provenance instead of implying every Actual came from the same source. 'bls' = US CPI/NFP,
   *  'eurostat' = euro area HICP (CPI), 'statcan' = Canada CPI/Unemployment Rate, 'ons' = UK CPI/
   *  Unemployment Rate/GDP. 'fred' is set CLIENT-SIDE, not by applyOfficialStatsFallback above -
   *  EconomicCalendarView.tsx overlays it onto a past-due USD event that genuinely has no free
   *  Actual source (every other value here) once it finds a real observation in the same FRED
   *  history already loaded for the Economic History tab, for the tracked indicators that have no
   *  dedicated fallback of their own (PPI/UNRATE/FOMC/GDP - CPI/NFP already have 'bls' above).
   *  Absent (undefined) means ForexFactory, same as before this field existed - existing callers
   *  reading `actual` alone are unaffected. */
  actualSource?: 'bls' | 'eurostat' | 'statcan' | 'ons' | 'fred';
  /** Production bug fix (2026-08-26): true when this specific indicator has a dedicated fallback
   *  source wired up (currently BLS for USD CPI m/m, CPI y/y and NFP; BEA for GDP/PCE once that
   *  key is registered) - set on EVERY matching event, not just ones a fallback actually managed
   *  to fill this pass, so the UI can tell "still genuinely awaiting a fresh number, will fill in"
   *  apart from "ForexFactory's free mirror never carries Actual for this indicator and nothing
   *  else covers it either" (verified live: ForexFactory's ff_calendar_thisweek.json returned 0/36
   *  past-event Actuals across all 8 tracked currencies on a direct probe). Absent/false means no
   *  dedicated fallback exists for this indicator today. */
  actualFallbackAvailable?: boolean;
  /** Live Desk audit (2026-09-06): true when this event's own `event` title reads as a US
   *  Congressional testimony/hearing (currency USD, impact High, title matches /testimony|hearing/i
   *  - see isCongressTestimonyEvent in server.ts) - e.g. the Fed Chair's semiannual Humphrey-Hawkins
   *  testimony, or a Senate Banking/House Financial Services Committee hearing. This is the ONLY
   *  signal server.ts's C-SPAN eligibility gate (GET /api/live-desk/cspan-eligibility) uses to
   *  decide whether C-SPAN's YouTube channel becomes live-intel/audio-eligible at all - ForexFactory
   *  itself has no dedicated "is this a Congress session" field, so this is computed/derived, not
   *  read from the upstream feed. Absent/false means no such match (the overwhelming majority of
   *  events - routine data releases, rate decisions, non-testimony speeches). */
  congressLinked?: boolean;
}

/**
 * Economic History - 12-month historical view for macro indicators (CPI, PPI, NFP, Fed Funds
 * Rate, GDP, Unemployment Rate via FRED; ADP and ISM PMI via forward-archiving, since those are
 * private-vendor data with no free historical API - see server.ts for the full explanation).
 */
// 'DGS10' (US 10-Year Treasury Yield) is fetched through this exact same FRED
// fetch/cache/transform pipeline, but is deliberately NOT surfaced as a selectable chip on the
// Economic History page (that page stays scoped to scheduled macro releases; DGS10 is a
// continuous daily yield). It feeds the page's Market Summary / AI macro narrative instead.
export type EconIndicatorId = 'CPI' | 'PPI' | 'UNRATE' | 'NFP' | 'FOMC' | 'GDP' | 'ADP' | 'PMI_MFG' | 'PMI_SVC' | 'DGS10' | 'DFII10' | 'M2SL' | 'VIXCLS'
  // Fase 4 (Macro) additions - all plain FRED series read through the existing pipeline,
  // reported in the unit FRED already publishes them in (no transform).
  | 'DGS3MO' | 'DGS2' | 'DGS5' | 'DGS30' | 'EFFR' | 'WALCL'
  // Fase 8: counterpart central-bank policy rates, which the Interest Rates module previously
  // named as a documented gap. All three were probed live before being wired.
  | 'ECBDFR' | 'BOEBR' | 'BOJPR'
  // Fase 8 §2.5 (Global Macro & Non-Market Data): two more central-bank rate proxies, plus USD
  // funding/liquidity conditions and fiscal/activity series the audit's C6 section listed as
  // buildable-but-not-yet-wired. Every one was title-verified against FRED before being added
  // here, the same discipline the commodity COT codes needed.
  | 'RBACR' | 'BOCCR'
  | 'SOFR' | 'RRPONTSYD' | 'WRESBAL' | 'WTREGEN'
  // PCEPILFE = "PCE Price Index Excluding Food and Energy" (Core PCE) - the Fed's own most-cited
  // inflation gauge (mandated explicitly in FOMC statements/SEP dot-plot commentary), distinct
  // from headline PCEPI above the same way CPI ex-food-energy differs from headline CPI. Same
  // FRED series/pipeline/YoY transform as PCEPI (see the fetchFredSeriesPoints branch in
  // server.ts) - added alongside it rather than replacing it, since both are real, distinct,
  // commonly-quoted series.
  | 'PCEPI' | 'PCEPILFE' | 'T10YIE' | 'T5YIE'
  | 'FISCAL_DEBT' | 'FISCAL_DEFICIT' | 'FISCAL_RECEIPTS' | 'FISCAL_EXPENDITURES'
  | 'HOUSING_STARTS' | 'CONSUMER_SENTIMENT' | 'TRADE_BALANCE' | 'MANUFACTURING_OUTPUT'
  // Roadmap §A3: the rest of the daily TIPS real-yield curve DFII10 already reads from - same
  // Treasury release, same FRED ingestion, so these carry the same live-proven confidence DFII10
  // already has. There is no 1Y entry: Treasury has never issued a 1-year TIPS (5Y is the
  // shortest original maturity), so no official 1Y real-yield series exists to wire - stated as
  // such rather than approximated from the nominal curve.
  | 'DFII5' | 'DFII30'
  // Roadmap §B4: foreign 10Y government bond yields, OECD "Main Economic Indicators" long-term
  // rate series (IRLTLT01{country}M156N) - the exact same OECD MEI family FRED already serves
  // BOEBR/BOJPR/RBACR/BOCCR from (IRSTCI01{country}M156N, the short-term sibling series), so this
  // extends an already-proven, live-verified naming convention rather than guessing a new one.
  | 'DE10Y' | 'GB10Y' | 'JP10Y' | 'AU10Y' | 'CA10Y'
  // Roadmap Batch C: multi-country inflation (CPI, YoY). CPALTT01{country}M659N is the OECD MEI
  // "Consumer Prices: All Items, Growth rate same period previous year, Monthly" series - the
  // same publisher and FRED-ingestion family the DE10Y/GB10Y/JP10Y/CA10Y bond yields above
  // already extend from (IRLTLT01/IRSTCI01), so this is a pattern-match against an already-proven
  // family, NOT a live-verified series id (this sandbox has no network access to probe it). If a
  // country's series does not actually exist under this exact mnemonic, the existing FRED
  // pipeline already degrades to an honest empty/unavailable read rather than fabricating a
  // number - same fail-safe every other `fred`-sourced indicator here already has. Australia is
  // deliberately NOT included: its OECD CPI release is quarterly, not monthly, so the M659N
  // (monthly) suffix would not apply and guessing the quarterly mnemonic too was one guess too
  // many for one commit.
  | 'CPI_DE' | 'CPI_GB' | 'CPI_JP' | 'CPI_CA';

export type EconIndicatorSource = 'fred' | 'archived';

export interface EconIndicatorMeta {
  id: EconIndicatorId;
  label: string;
  unit: 'percent' | 'thousands' | 'rate' | 'index';
  source: EconIndicatorSource;
  /** Only present for source==='fred' - the FRED series ID this indicator is derived from. */
  fredSeriesId?: string;
  /**
   * The economy the indicator describes. Stays a closed union so a new indicator cannot be filed
   * under an economy the UI has no label for.
   */
  currency: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD' | 'CAD';
}

/**
 * One historical release for an indicator. `forecast`/`previous`/`surprise` are null when not
 * available - FRED does not publish consensus forecasts, so FRED-sourced points only ever have
 * `actual` + `previous` (previous = the prior data point in the same series, real, not guessed).
 * Archived (ADP/PMI) points DO have forecast/previous because those are captured verbatim from
 * the economic calendar feed at archive time.
 */
export interface EconHistoryPoint {
  date: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  surprise: number | null;
}

export interface EconHistoryResponse {
  success: boolean;
  indicator: EconIndicatorMeta;
  points: EconHistoryPoint[];
  lastUpdated: string | null;
  /** True when source==='fred' and FRED_API_KEY is not configured - the frontend shows a clear
   * "needs setup" message instead of an empty chart that looks like a data outage. */
  needsSetup: boolean;
  /** For source==='archived' only - ISO date of the first archived point, so the UI can show
   * "collecting data since [date]" instead of a bare empty chart when there are few points. */
  collectingSince: string | null;
}

/** One archived release, forward-collected the moment a tracked ADP/PMI calendar event's Actual
 * value first becomes available. Superset of EconHistoryPoint's fields (keeps the raw display
 * strings too, since the calendar feed's actual/forecast/previous are pre-formatted text like
 * "48.5" or "210K" that we also need to parse into numbers for charting). */
export interface ArchivedEconRelease {
  date: string;
  actualRaw: string;
  forecastRaw: string;
  previousRaw: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
}

/** Read-only re-display of the existing dxyState the signal engine already maintains for its own
 * XAUUSD correlation scoring - not a new calculation. Serves the "Market Summary &
 * Interpretation" panel (USD Strength score + the Economic Transmission diagram's DXY label) on
 * the Economic History page, via GET /api/economic-history/market-context. */
export interface DxyPanelSnapshot {
  price: number | null;
  trend15mPercent: number | null;
  lastUpdated: string | null;
}

/** One daily closing-price snapshot for XAUUSD, forward-collected once per day (see server.ts).
 * Starts empty on a fresh deploy - backs the XAU Bias row's 7d/30d average comparison in the
 * Economic History page's Market Summary panel. */
export interface DailyPricePoint {
  date: string;
  close: number;
}

export interface PriceAverageComparison {
  currentPrice: number;
  avg7d: number | null;
  avg30d: number | null;
  pctVs7d: number | null;
  pctVs30d: number | null;
  /** How many daily points are actually available - so the UI never claims "30 hari" when only
   * a handful of days have been collected since this feature was deployed. */
  daysAvailable: number;
}

export interface PairMetadata {
  id: PairId;
  name: string;
  category: AssetCategory;
  tradingViewSymbol: string;
  digits: number;
  description: string;
  brokerProvider: string;
  /**
   * "Tradable with data" (price/candles flow, shows up in search/watchlist/chart) is NOT the
   * same as "tradable with a signal" (the confluence engine's BUY/SELL card). The engine's SL/TP
   * sizing (server.ts's createInstitutionalScalpingSignal) is hand-tuned per specific symbol -
   * XAUUSD/BTCUSDT/ETHUSDT/SOLUSDT/EURUSD-GBPUSD-USDCHF-USDCAD each have their own researched
   * min/max SL bands. A pair with no branch of its own falls through to a generic default sized
   * for forex pip scale, which is meaningless for a symbol on a different price scale (a new JPY
   * pair or any new crypto pair) - false, not just "not yet configured".
   *
   * false = data-only: price, candles, search, watchlist all work; runEngineScan() skips signal
   * generation for this pair entirely (see the signalEngineEnabled check there) until someone
   * has actually researched and added its own SL/TP band.
   */
  signalEngineEnabled: boolean;
}

/**
 * Present for a pair only while signals[pairId] is null - explains why (still evaluating, no
 * valid setup found yet), so the UI can render an informative "searching" state instead of a
 * blank card or a stale finished signal frozen on screen.
 */
export interface ScanStatus {
  lastScanAt: string;
  lastScanReason?: string;
  /** Live XAU transparency metadata, present even while no setup is published. */
  marketCondition?: { regime: 'trending' | 'ranging' | 'choppy'; breakout: 'breakout' | 'fake breakout' | 'none'; momentum: 'strengthening' | 'weakening' | 'neutral'; news: string };
  /**
   * Fase L / Fase N (roadmap Bagian 1, "forming setup") - the best-scoring RAW structural candidate
   * this tick, even though it hasn't cleared the filters to become a real signal, with a specific
   * reason why. HARD BOUNDARY: purely informational - never sent to auto-trading, never a
   * justification to loosen an RR floor or zone-width cap. null when no structural candidate was
   * detected at all this tick (not even a failing one). XAUUSD only.
   */
  formingSetup?: { pattern: string; type: 'BUY' | 'SELL'; confluenceScore: number; reason: string } | null;
}

export interface SignalStateResponse {
  signals: Record<PairId, Signal | null>;
  prices: Record<PairId, MarketPrice>;
  scanStatus?: Partial<Record<PairId, ScanStatus>>;
  lastSyncTime: string;
}

// ===== HEV Live Market Intelligence =====

/** 'market_news' is the automated market-news pipeline (scripts/live-intel-watcher.ts RSS sources
 * with category 'market-news'): headline-only ingestion, AI-rewritten summary, per-asset-class
 * impact read. Every other value is the original live/speech intelligence pipeline. */
export type LiveEventType = 'speech' | 'press_conference' | 'testimony' | 'interview' | 'press_release' | 'other' | 'market_news';

/** The three asset classes HEV Terminal covers. Used by the automated market-news cards, which
 * report impact per class rather than per individual pair (a general news headline rarely says
 * anything pair-specific enough to justify the 8-pair forced read `pairImpacts` does). */
export type LiveEventAssetClass = 'commodities' | 'crypto' | 'forex';

/** One asset-class read for an automated market-news item - written by Gemini from the headline
 * alone (see buildMarketNewsAutofillPrompt in server.ts), never copied from the source article. */
export interface LiveEventAssetClassImpact {
  assetClass: LiveEventAssetClass;
  direction: LiveEventDirection;
  /** Short rationale in the site's language - the AI's own words, never the outlet's text. */
  reason: string;
}

/** Tahap F (blueprint §49) - per-headline geopolitical risk read from the same AI call that
 * already classifies every market_news item (no new provider, no extra API cost). */
export interface LiveEventGeopoliticalRisk {
  /** True only for headlines about actual geopolitical tension (war, sanctions, diplomatic
   * crisis, conflict escalation, terrorism, coup, politically-driven trade conflict) - NOT
   * ordinary economic/market news, even market-moving news (rate decisions, earnings, data
   * releases are never geopolitical regardless of impact). */
  relevant: boolean;
  /** 0-100, meaningful only when relevant is true (always 0 when relevant is false). Rough bands:
   * 0-20 routine/recurring tension, 40-60 real escalation, 80-100 major crisis (open conflict,
   * direct attack, explicit nuclear threat). */
  score: number;
  reason: string;
}

/** Tahap D3 Tier 3 (RUMORED/UNCONFIRMED, blueprint §14) - same pattern as
 * LiveEventGeopoliticalRisk: one more field on the same AI call that already classifies every
 * market_news item, no new provider. Working definition: a headline reporting a specific central
 * bank/government's gold buy/sell activity that has NOT yet shown up in Tier 1 (WGC Gold Focus)
 * for that month - i.e. media-reported, not yet officially confirmed. */
export interface LiveEventGoldPurchaseRumor {
  /** True only when the headline names a specific country/central bank reportedly buying or
   * selling gold, AND this is media reporting/speculation - NOT an official WGC/central
   * bank/IMF announcement (those belong to Tier 1, not this tag). */
  relevant: boolean;
  /** Empty string when relevant is false. Never guessed when the headline doesn't name one. */
  country: string;
  /** Tonnes, only when stated explicitly in the headline - null otherwise (never estimated). */
  tonnesEstimate: number | null;
  reason: string;
}
export type LiveEventImpact = 'High' | 'Medium' | 'Low';
export type LiveEventTone = 'Hawkish' | 'Dovish' | 'Neutral';
export type LiveEventDirection = 'Bullish' | 'Bearish' | 'Neutral';

/** One asset's read on a live event - grounded strictly in the rawTranscript passed to the AI
 * autofill endpoint, never a fabricated/generic claim (see buildLiveEventAutofillPrompt in
 * server.ts for the exact grounding rules). Legacy field - only covers assets the transcript
 * actually discusses. `pairImpacts` below is the newer, forced-8-pair replacement; this stays
 * around so older events (and code that only knows this shape) keep working. */
export interface LiveEventMarketEffect {
  asset: string;
  direction: LiveEventDirection;
  reason: string;
}

export type LiveEventSegmentTopic =
  | 'Inflation'
  | 'Rate Policy'
  | 'Employment'
  | 'Growth'
  | 'Banking'
  | 'Liquidity'
  | 'Trade'
  | 'Currency'
  | 'Energy'
  | 'Geopolitics'
  | 'Other';

export type LiveEventSegmentImportance = 'Low' | 'Medium' | 'High' | 'Extreme';

/** One topic-segment the AI identified inside the raw transcript - a real statement is rarely
 * about just one thing, so instead of a single flat summary the AI breaks it into these labeled
 * chunks, each grounded in an actual (not paraphrased-into-fiction) quote from the transcript.
 *
 * The fields below `stanceScore` are ALL optional: a segment produced by the original single-shot
 * full-transcript analysis (buildLiveEventAutofillPrompt, used for manual publishes, "Simulasi
 * Pipeline Otomatis", and the final holistic live-session re-analysis) never populates them - they
 * only exist for segments individually generated during an ACTIVE live session, one per polling
 * round (buildLiveEventIncrementalSegmentPrompt in server.ts / pollYoutubeLiveCaptions in
 * scripts/live-intel-watcher.ts), where each round genuinely is its own discrete "conversation". */
export interface LiveEventSegment {
  topic: LiveEventSegmentTopic;
  /** A representative statement lifted from rawTranscript - never invented; see the grounding
   * rules in buildLiveEventAutofillPrompt (server.ts). */
  statement: string;
  /** This segment's own tone - can differ from the event's overall `tone` above (e.g. an
   * otherwise-hawkish speech can still have a dovish aside on employment). */
  tone: LiveEventTone;
  /** 0 = most Dovish, 100 = most Hawkish, 50 = Neutral midpoint - a numeric read of this
   * segment's stance, meant for plotting (see the stance chart in the live-event detail page). */
  stanceScore: number;
  /** 1-indexed order this segment was appended within its event's live session ("Conversation
   * #001", "#002", ...) - only set for live-session segments (see above), assigned server-side
   * (never trusted from the AI's own output) so numbering is always exactly sequential. */
  sequence?: number;
  /** How much UI weight this segment deserves - Low renders lightly in the timeline, Extreme gets
   * a prominent callout. Every segment still gets stored/shown regardless of this value; it only
   * controls visual prominence, never whether something is recorded. */
  importance?: LiveEventSegmentImportance;
  /** 0-100 - the AI's own confidence in this specific segment's read (separate from pairImpacts'
   * per-pair confidence below). */
  confidence?: number;
  /** true = this segment says something not already covered by an earlier segment in the same
   * event; false = it's substantially repeating a point already made. Both kinds are still stored
   * (nothing is dropped), this only distinguishes them for importance/UI purposes. */
  isNewInformation?: boolean;
  /** The single most important quote from this segment, if the AI judged one sentence within
   * `statement` to matter more than the rest - same grounding rule as `statement` (a real quote,
   * never invented). Falls back to `statement` itself in the UI when absent. */
  keyStatement?: string;
  /** Lightweight, only-if-relevant market read for THIS segment specifically - unlike the event's
   * `pairImpacts` (forced coverage of all 8 tracked pairs every time), this only lists pairs the
   * AI judged this segment actually touches on, and can be empty. */
  segmentMarketImpact?: { pairId: PairId; direction: LiveEventDirection }[];
  /** Seconds into the source video/stream this segment's content occurred, if derivable from the
   * caption track's own cue timestamps (real ones from the .vtt file - never estimated/invented).
   * Absent when the source has no timestamped captions to derive this from. */
  videoTimestampSec?: number;
  /** ISO timestamp of when this segment was actually appended to the event (distinct from the
   * event's own top-level createdAt, which is when the EVENT started). */
  createdAt?: string;
}

/** Forced-coverage per-pair read - unlike LiveEventMarketEffect (only assets actually discussed),
 * every LiveEvent with this field populated has exactly one entry per pair in
 * LIVE_EVENT_TRACKED_PAIRS (server.ts) - a pair the transcript never touches on still gets an
 * entry, just Neutral + low confidence, instead of being silently omitted. */
export interface LiveEventPairImpact {
  pairId: PairId;
  direction: LiveEventDirection;
  /** 0-100 - how confident the AI is this pair actually reacts to this specific event. */
  confidence: number;
}

/** Read-only re-display of currentPrices/dxyState at one point in time - same pattern as
 * MarketReactionSnapshotSet (Economic History), reused for live events. */
export interface LiveEventReactionSnapshotSet {
  xauPrice: number | null;
  dxyPrice: number | null;
  btcPrice: number | null;
  capturedAt: string;
}

export interface LiveEvent {
  id: string;
  createdAt: string;
  type: LiveEventType;
  speaker: string | null;
  rawTranscript: string;
  title: string;
  summary: string;
  tone: LiveEventTone;
  marketEffects: LiveEventMarketEffect[];
  verdict: LiveEventDirection;
  impact: LiveEventImpact;
  /** Where the raw transcript came from (e.g. "YouTube Live - Federal Reserve", "ECB Press
   * Release RSS") - null when published manually via the admin panel without a source label. */
  source: string | null;
  sourceUrl: string | null;
  /** Forward-collected market snapshots at publish/+15m/+1h - starts with only atPublish filled,
   * after15m/after1h fill in as real time passes (see captureLiveEventReactionSnapshots in
   * server.ts). Never backfilled/estimated. */
  reaction: {
    atPublish: LiveEventReactionSnapshotSet;
    after15m: LiveEventReactionSnapshotSet | null;
    after1h: LiveEventReactionSnapshotSet | null;
  };
  /** Topic-segmented transcript breakdown - undefined on events published before this field
   * existed ("legacy" events). The detail page falls back to the old flat single-summary display
   * whenever this is absent; it never fabricates segments for old data. */
  segments?: LiveEventSegment[];
  /** Short causal-chain steps, e.g. ["Hawkish", "Rate-cut expectation turun", "USD naik", "Gold
   * turun"] - undefined for legacy events, same fallback rule as `segments`. */
  causalChain?: string[];
  /** Forced 8-pair impact read - undefined for legacy events (which only have the narrower
   * `marketEffects` above, covering only assets actually discussed). */
  pairImpacts?: LiveEventPairImpact[];
  /** Per-asset-class impact read - only ever present on `type: 'market_news'` events from the
   * automated news pipeline. Absent for every speech/press-conference event, same
   * "absent = doesn't apply" convention as the fields above. */
  assetClassImpacts?: LiveEventAssetClassImpact[];
  /** Tahap F (blueprint §49) - geopolitical risk read on this item, only ever present on
   * `type: 'market_news'` events (same "absent = doesn't apply" convention as assetClassImpacts).
   * `relevant: false` is itself meaningful (the AI checked and found no geopolitical content) -
   * distinct from the field being absent entirely (a legacy event published before this existed,
   * never checked at all). See GET /api/intelligence/geopolitical-risk for the aggregate score
   * this feeds. */
  geopoliticalRisk?: LiveEventGeopoliticalRisk;
  /** Tahap D3 Tier 3 (blueprint §14) - central bank gold buy/sell rumor read on this item, same
   * "absent = doesn't apply" / "relevant: false is itself meaningful" conventions as
   * geopoliticalRisk above. Only ever present on `type: 'market_news'` events. See
   * GET /api/macro/central-bank-gold-rumors for the aggregate list this feeds. */
  goldPurchaseRumor?: LiveEventGoldPurchaseRumor;
  /** Present only for events that started life as an actively-streaming YouTube Live source
   * tracked by the watcher's semi-real-time polling loop (scripts/live-intel-watcher.ts's
   * pollYoutubeLiveCaptions) - absent for every other event (RSS, admin manual, one-shot
   * already-finished YouTube fetch), same "absent = doesn't apply" convention as segments/
   * causalChain/pairImpacts above. */
  liveSession?: LiveEventLiveSession;
  /** Deterministic-stats-plus-AI-synthesis summary, computed once a full segment breakdown is
   * already known to be complete: either the moment liveSession.status reaches 'finalized', or -
   * since the 2026-08-30 audit fix - immediately at publish time for any one-shot publish (RSS,
   * manual, "Simulasi Pipeline Otomatis") that already carries segments, since there is no future
   * liveSession to wait on for those. Absent for a still-streaming liveSession event (not final
   * yet) and for any event with no segments to compute it from (e.g. market_news, a plain manual
   * publish without AI-autofilled segments). See computeFinalEventIntelligence in server.ts. */
  finalIntelligence?: LiveEventFinalIntelligence;
}

/** Live-session tracking - see the `liveSession` field comment on LiveEvent above. Three-state,
 * matching how a real live session actually progresses:
 *   live -> ended -> finalized
 * 'ended' is a real (if often brief) state: the watcher just confirmed the stream stopped, but
 * the (Gemini) final holistic re-analysis hasn't completed yet - written to the store immediately
 * so the badge never falsely says "LIVE" a moment after the stream actually ends, and so a failed
 * final-analysis attempt leaves visible, retryable state instead of forcing a fabricated "final"
 * result or silently reverting to 'live'. */
export interface LiveEventLiveSession {
  status: 'live' | 'ended' | 'finalized';
  /** The actual YouTube video id this session tracks - lets the watcher tell "still the same
   * ongoing stream, keep appending to this event" apart from "a brand new stream just started,
   * publish a new event instead" across separate scheduled runs. */
  videoId: string;
  /** ISO timestamp of the most recently appended segment (or of publish time, before any segment
   * has been appended yet). The detail page uses this to show "last updated Xs ago" and to decide
   * when to bother re-polling for new segments while status is 'live'. */
  lastSegmentAt: string;
}

/** One meaningfully-sized stance jump between two consecutive live-session segments - the "what
 * changed?" callout. Only ever built from real, already-stored segment data - never estimated. */
export interface LiveEventStanceShift {
  fromSequence: number;
  toSequence: number;
  fromScore: number;
  toScore: number;
  delta: number;
  /** Short, grounded explanation of why the shift happened, from the AI - see
   * buildFinalEventIntelligencePrompt (server.ts). Empty string if the AI couldn't produce one. */
  reason: string;
}

/** Built once a live session reaches 'finalized' (see LiveEvent.finalIntelligence above).
 * Counts/shifts are computed DETERMINISTICALLY from the event's own stored segments (never
 * AI-estimated, so they're exact) - only strongestDriver/majorRisks/the shift `reason` above come
 * from a small dedicated AI synthesis call over that already-computed structure. */
export interface LiveEventFinalIntelligence {
  conversationsAnalyzed: number;
  /** Segments with importance 'High' or 'Extreme'. */
  importantStatements: number;
  /** Segments carrying a non-empty segmentMarketImpact, or importance 'Extreme'. */
  marketMovingStatements: number;
  /** Count of consecutive-segment stance jumps at/above the significance threshold - see
   * LIVE_STANCE_SHIFT_THRESHOLD in server.ts. */
  stanceShifts: number;
  /** Segments flagged isNewInformation === true - genuinely new information that could shift
   * market expectations, as opposed to repeated points. */
  expectationChanges: number;
  /** The single highest-importance segment's statement (ties broken by confidence, then latest) -
   * null only when the event has no segments with importance set at all. */
  strongestStatement: string | null;
  strongestTopic: LiveEventSegmentTopic | null;
  /** Short AI-synthesized phrase naming the dominant driver across the whole session, e.g.
   * "Higher-for-longer rate expectations" - grounded in the actual segments, empty string if the
   * AI call failed (never fabricated). */
  strongestDriver: string;
  /** The single largest consecutive-segment stance jump, or null if there were fewer than 2
   * segments. */
  biggestStanceShift: LiveEventStanceShift | null;
  /** Short AI-synthesized risk callouts grounded in the transcript - empty array if the AI call
   * failed or found none. */
  majorRisks: string[];
  /** The last segment's stanceScore (or the event's own overall verdict-derived midpoint if there
   * were no segments) - the session's ending stance read. */
  finalStanceScore: number;
}

/** Honest, purely-computed aggregate over today's (WIB) published live events - never a
 * fabricated/estimated figure. */
export interface LiveEventStats {
  totalToday: number;
  byImpact: Record<LiveEventImpact, number>;
  byTone: Record<LiveEventTone, number>;
  lastEventAt: string | null;
}

// ===== Live Desk (Intelligence tab #3) =====
// These are pure aggregations over LiveEvent records the existing Live Intelligence pipeline
// (scripts/live-intel-watcher.ts) already captures - see the comment above the
// /api/live-desk/* routes in server.ts for why this tab does NOT add a new audio-capture/STT
// provider. No new data source is introduced by any type below.

/** One topic's appearance count within a time window, computed from LiveEventSegment.topic
 *  across recent events - never a fabricated trend, always backed by an example event. */
export interface LiveDeskNarrativeTopic {
  topic: LiveEventSegmentTopic;
  count: number;
  exampleTitle: string | null;
  exampleEventId: string | null;
}

export interface LiveDeskCausalChainEntry {
  chain: string[];
  eventId: string;
  eventTitle: string;
  createdAt: string;
}

export interface LiveDeskNarrativeResponse {
  generatedAt: string;
  windowNote: string;
  hottestToday: LiveDeskNarrativeTopic[];
  hottestWeek: LiveDeskNarrativeTopic[];
  rising: LiveDeskNarrativeTopic[];
  weakening: LiveDeskNarrativeTopic[];
  causalChains: LiveDeskCausalChainEntry[];
  sampleSize: number;
  methodology: string;
  source: string;
  error?: string;
}

export type LiveDeskAlertSeverity = 'HIGH' | 'MEDIUM' | 'INFO';

/** One computed Smart Alert - every field traces back to a real stored record (a calendar event,
 *  a published LiveEvent, or the geopolitical risk score); never a synthetic/demo alert. */
export interface LiveDeskAlert {
  id: string;
  severity: LiveDeskAlertSeverity;
  type: string;
  title: string;
  description: string;
  at: string;
  link?: string | null;
}

/** A Smart Alert trigger type from the brief that genuinely has no free/legal real-time data
 *  source (audited, not guessed) - surfaced honestly instead of silently omitted. */
export interface LiveDeskUnavailableTrigger {
  type: string;
  label: string;
  reason: string;
}

export interface LiveDeskAlertsResponse {
  generatedAt: string;
  alerts: LiveDeskAlert[];
  unavailableTriggers: LiveDeskUnavailableTrigger[];
  error?: string;
}

/** One of the 8 pairs HEV Terminal forces a per-pair AI read for (LIVE_EVENT_TRACKED_PAIRS,
 *  server.ts) - direction/confidence come straight from the most recent LiveEvent.pairImpacts,
 *  price/change24h from the live price feed already running for the signal engine. */
export interface LiveDeskPrimaryImpactRow {
  pairId: PairId;
  label: string;
  direction: LiveEventDirection;
  confidence: number;
  price: number | null;
  change24h: number | null;
}

/** Coarser, asset-CLASS-level read (commodities/crypto/forex only) - a majority vote over the
 *  last ~30 automated market-news items' assetClassImpacts. Deliberately not presented as a
 *  per-instrument score; see LiveDeskImpactMatrixResponse.disclaimer. */
export interface LiveDeskAssetClassImpactRow {
  assetClass: LiveEventAssetClass;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  majorityDirection: LiveEventDirection;
  sampleSize: number;
}

export interface LiveDeskImpactMatrixResponse {
  generatedAt: string;
  primary: {
    rows: LiveDeskPrimaryImpactRow[];
    sourceEventId: string | null;
    sourceEventTitle: string | null;
    sourceEventAt: string | null;
  } | null;
  assetClasses: LiveDeskAssetClassImpactRow[];
  disclaimer: string;
  error?: string;
}

// ===== Live Desk - real audio-to-text pipeline (Part 2) =====
//
// Everything below governs scripts/live-desk-audio-worker.ts, a standalone child process
// server.ts spawns/monitors (see the "Live Desk audio worker lifecycle" section in server.ts) -
// never anything that runs inline on the signal-engine's own event loop. Kept OFF by default
// (LIVE_DESK_AUDIO_ENABLED env var) precisely because this project's single 0.5 CPU/512MB Render
// instance must never let a side feature delay the XAUUSD signal engine - see that section's
// header comment for the full safety rationale and the load-test results that informed it.

/** Persisted settings - same shape/pattern as AutotradeSettings (killSwitchEnabled only ever
 *  changes via its own dedicated, logged endpoint, never the generic settings path). */
export interface LiveDeskAudioSettings {
  /** Operator's own on/off intent (mirrors LIVE_DESK_AUDIO_ENABLED's boot-time default, but
   *  changeable at runtime with no redeploy/restart needed - see the kill-switch endpoint). */
  enabled: boolean;
  /** Emergency stop - separate from `enabled` so the circuit breaker (automatic) and a human
   *  (manual) are both recorded distinctly in killSwitchLog, and so re-enabling after an
   *  automatic trip is a deliberate action, not something a stale `enabled: true` silently does
   *  on the next restart. */
  killSwitchEnabled: boolean;
  killSwitchLastChangedAt: string | null;
  /** Set by the circuit breaker when it trips (see LiveDeskAudioHealthResponse.circuitBreaker) -
   *  read-only from the API's perspective, informational only (killSwitchEnabled is what actually
   *  blocks the worker from running). */
  lastCircuitBreakerTripAt: string | null;
  lastCircuitBreakerTripReason: string | null;
}

export type LiveDeskAudioKillSwitchTrigger = 'manual' | 'auto_circuit_breaker';

export interface LiveDeskAudioKillSwitchLogEntry {
  id: string;
  enabled: boolean;
  previousState: boolean;
  trigger: LiveDeskAudioKillSwitchTrigger;
  /** Only set for trigger: 'auto_circuit_breaker' - which threshold tripped and the measured
   *  value, so the log is self-explanatory without cross-referencing server logs. */
  reason?: string;
  changedAt: string;
}

/** One real, measured chunk of OpenRouter usage - never an estimated/rounded total, always
 *  computed from the actual audio duration processed and the actual response. Persisted as an
 *  append-only log (capped) so cost is auditable per-event, not just a running counter. */
export interface LiveDeskAudioUsageLogEntry {
  id: string;
  at: string;
  /** Which broadcast this chunk belonged to, if it was tied to a published LiveEvent. */
  liveEventId: string | null;
  sourceId: string;
  audioSeconds: number;
  sttModel: string;
  translateModel: string | null;
  /** Estimated cost in USD - ALWAYS labeled as an estimate (see LiveDeskAudioHealthResponse's own
   *  disclaimer), computed from a configurable per-minute rate, never scraped/verified live
   *  against OpenRouter's own billing (no network access to do so from this codebase's CI). */
  estimatedCostUsd: number;
  sttSuccess: boolean;
  translateSuccess: boolean;
}

export interface LiveDeskAudioWorkerProcessState {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  /** Which audio-eligible source the worker is currently actively capturing, if any - null when
   *  idle (enabled but nothing audio-eligible is live right now). */
  activeSourceId: string | null;
  activeSourceLabel: string | null;
  restartCount: number;
  lastExitCode: number | null;
  lastExitAt: string | null;
}

export interface LiveDeskAudioHealthResponse {
  generatedAt: string;
  /** False when OPENROUTER_API_KEY is simply not set in this environment - the honest "needs
   *  setup" state, distinct from the feature being deliberately turned off. */
  openRouterConfigured: boolean;
  settings: LiveDeskAudioSettings;
  worker: LiveDeskAudioWorkerProcessState;
  /** The exact same signal the circuit breaker itself watches - see getEngineTickHealthSnapshot
   *  in server.ts. Surfaced here so a human can see precisely what the breaker is (or would be)
   *  reacting to, not just its outcome. */
  engineTickHealth: {
    sampleSize: number;
    p50Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
    eventLoopLagP95Ms: number | null;
    eventLoopLagMaxMs: number | null;
  };
  circuitBreaker: {
    /** The exact thresholds in force - documented here (not just in code) so "why did it trip?"
     *  is always answerable from the API alone. */
    tickP95ThresholdMs: number;
    eventLoopLagP95ThresholdMs: number;
    tripped: boolean;
    lastTripAt: string | null;
    lastTripReason: string | null;
    /** Cooldown before an auto-trip will let the worker be started again - null when not
     *  currently cooling down. */
    cooldownUntil: string | null;
  };
  /** Last 30 usage entries, newest first - full history lives in the append-only log file. */
  recentUsage: LiveDeskAudioUsageLogEntry[];
  /** Last ~50 raw stdout/stderr lines from the worker child process, oldest first, in-memory only
   *  (cleared on server restart, never persisted) - added after the 2026-09-06 real-production
   *  canary run crash-looped (exit code 1, restartCount climbing) with no way to see WHY from this
   *  endpoint alone. Empty if the worker has never been started this process lifetime. */
  recentLogLines: string[];
  /** Deterministic sums over recentUsage's own persisted log (not just the 30 shown), so the
   *  totals are real even once the log is longer than what's returned inline. */
  totals: {
    audioSecondsLast24h: number;
    estimatedCostUsdLast24h: number;
    audioSecondsLast30d: number;
    estimatedCostUsdLast30d: number;
  };
  costDisclaimer: string;
}

/** Live Desk fix round (UX audit): a lightweight, real (never fabricated) snapshot of what the
 *  Live Desk page is currently showing the user, pushed into ShellContext by LiveDeskView.tsx so
 *  the ONE global HEVAI chat widget (bottom-right, every page) can answer Live-Desk-scoped
 *  questions ("apa dampak berita ini ke BTC") WITHOUT a second, duplicate chat panel living inside
 *  the Live Desk grid itself. Every field here is a value already rendered on the page - this is
 *  a relay, not a new data source. Sent to POST /api/ai/ask as `liveDeskContext`; server.ts
 *  re-validates and bounds every field before it ever reaches a prompt (see
 *  sanitizeLiveDeskChatContext). */
export interface LiveDeskChatContext {
  focusEventTitle: string | null;
  focusEventSummary: string | null;
  focusEventTone: LiveEventTone | null;
  focusEventVerdict: LiveEventDirection | null;
  topics: string[];
  narrativeHotTopics: string[];
  impactRows: { label: string; direction: LiveEventDirection; confidence: number }[];
}
