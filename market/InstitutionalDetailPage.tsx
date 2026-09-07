import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Activity,
  Clock,
  Database,
  FileText,
  Gauge,
  Grid3x3,
  Hash,
  Info as InfoIcon,
  Layers,
  LineChart as LineChartIcon,
  Tag,
} from 'lucide-react';
import type { CandlesResponse } from '../../lib/analytics';
import { correlationMatrix, toReturns, volatilityRow } from '../../lib/analytics';
import type {
  CotPosition,
  CotResponse,
  CryptoDerivativesResponse,
  CryptoDerivativesSymbol,
  CryptoMarketHeatmapResponse,
  DxyResponse,
  ExchangeRankingResponse,
  MarketCapHistoryResponse,
  MarketPrice,
  PairId,
} from '../../types';
import { PAIRS_LIST, PAIRS_MAP } from '../../data/pairs';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { useStableCandles } from '../../lib/useStableCandles';
import { statusFromAge } from '../../lib/dataState';
import { formatCompact, formatNumber, shortSymbol } from '../../lib/format';
import { getAllSessionStatuses, getOpenOverlaps, type SessionStatus } from '../../lib/market/sessions';
import { PairIcon } from '../PairIcon';
import { BlurredValue } from '../BlurredValue';
import { TradingViewChart } from '../TradingViewChart';
import { Badge, type BadgeTone, EmptyState, LoadingState, Panel, PanelHeader, StatTile, TabBar, UnavailableState } from '../ui';
import { LiveValue } from '../viz';
import { CryptoDerivativesView, type DerivativesSymbol } from './CryptoDerivativesView';
import { ExchangeRankingTable } from './ExchangeRankingTable';
import { ExchangeVolumeHeatmap } from './ExchangeVolumeHeatmap';
import { CryptoMarketHeatmap } from './CryptoMarketHeatmap';
import { CryptoEtfOverview } from './CryptoEtfOverview';
import { MarketCapChart } from './MarketCapChart';
import { OverviewPriceChart } from './OverviewPriceChart';
import { FuturesDataAnalysis } from './FuturesDataAnalysis';
import { SimilarPairsRow } from './SimilarPairsRow';
import { FuturesOverviewSummary } from './FuturesOverviewSummary';

/** Institutional Watchlist full-page detail (Part A conversion, was InstitutionalDetailPanel.tsx's
 *  760px right-hand drawer) - reached at /market/institutional/:pairId. Every data-fetching hook
 *  and piece of derived logic below is carried over verbatim from that drawer; only the shell
 *  (full page + tabs instead of a fixed-width sheet) and the crypto section's content (now real
 *  multi-exchange ranking/heatmap/futures-analysis, Part B-G) changed.
 *
 * Content is deliberately NOT identical for every asset class - crypto has real funding/open-
 * interest/multi-exchange data; XAU/USD and the forex majors do not have a free equivalent to
 * futures Open Interest/Funding/Liquidation, so their Overview shows what this terminal DOES have
 * for real (CFTC positioning, realised volatility/ATR, session timing, correlation) instead of
 * blank or invented numbers. A still-missing Coinglass-style fully-aggregated (every derivatives
 * venue, incl. CME/Deribit institutional flow) read is a one-line honest note, never a fabricated
 * number.
 */
const CRYPTO_DERIVATIVES_SYMBOL: Partial<Record<PairId, CryptoDerivativesSymbol>> = {
  BTCUSDT: 'BTCUSDT',
  ETHUSDT: 'ETHUSDT',
  SOLUSDT: 'SOLUSDT',
  BNBUSDT: 'BNBUSDT',
  XRPUSDT: 'XRPUSDT',
  ADAUSDT: 'ADAUSDT',
  DOGEUSDT: 'DOGEUSDT',
};

const DERIVATIVES_INSTRUMENT: Record<CryptoDerivativesSymbol, DerivativesSymbol> = {
  BTCUSDT: 'BTC-USDT',
  ETHUSDT: 'ETH-USDT',
  SOLUSDT: 'SOL-USDT',
  BNBUSDT: 'BNB-USDT',
  XRPUSDT: 'XRP-USDT',
  ADAUSDT: 'ADA-USDT',
  DOGEUSDT: 'DOGE-USDT',
};

/** CoinGlass parity ROUND 3 (header): the asset's plain English name ("Bitcoin"), for the header's
 *  primary title - CoinGlass's own header shows this, not the pair string ("BTC/USDT Perpetual").
 *  `spotCoin.name` (CoinGecko, already fetched for the Spot tab) is the real, live-sourced version
 *  of this and is preferred whenever available; this is only the fallback for the rare cycle where
 *  a pair isn't in CoinGecko's top-~30-by-volume window. Static English names for a fixed set of
 *  well-known assets, not trading data - same category of "hardcoded" as `pair.name` itself. */
const CRYPTO_ASSET_NAME: Record<CryptoDerivativesSymbol, string> = {
  BTCUSDT: 'Bitcoin',
  ETHUSDT: 'Ethereum',
  SOLUSDT: 'Solana',
  BNBUSDT: 'BNB',
  XRPUSDT: 'XRP',
  ADAUSDT: 'Cardano',
  DOGEUSDT: 'Dogecoin',
};

const strengthTone = (value: number): { label: string; tone: BadgeTone } => {
  const abs = Math.abs(value);
  if (abs >= 0.8) return { label: 'EXTREME', tone: 'warning' };
  if (abs >= 0.5) return { label: 'HIGH', tone: 'info' };
  return { label: 'LOW', tone: 'neutral' };
};

const formatDuration = (ms: number | null): string => {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const TIMEFRAME_KEYS = ['4H', '24H', '7D', '30D', '90D', 'YTD', '1Y'] as const;

type PageTab = 'overview' | 'futures' | 'spot' | 'info';

interface InstitutionalDetailPageProps {
  pairId: PairId;
  onBack: () => void;
  onSelectPair: (id: PairId) => void;
  prices: Record<PairId, MarketPrice>;
  signalsBlurred?: boolean;
}

export const InstitutionalDetailPage: React.FC<InstitutionalDetailPageProps> = ({
  pairId,
  onBack,
  onSelectPair,
  prices,
  signalsBlurred = false,
}) => {
  const { t } = useTranslation();

  // Same candle feed the Dashboard watchlist sparklines and every other Overview read already use
  // - fetched here rather than passed down as a prop, since this is now its own routed page rather
  // than a child of OverviewView.
  const { data: candlesData } = useEndpoint<CandlesResponse>('/api/market/candles', 60_000);
  const candles = useStableCandles(candlesData);

  const pair = PAIRS_MAP[pairId];
  const market = prices[pairId];
  const derivSymbol = CRYPTO_DERIVATIVES_SYMBOL[pairId];
  const isCryptoDerivatives = Boolean(derivSymbol);

  const [tab, setTab] = useState<PageTab>('overview');
  // Switching pairs (via the pair-switcher row or a fresh route) never carries over a tab that
  // doesn't exist for the new pair's asset class (e.g. leaving "Futures" selected after jumping
  // from BTC to EUR/USD, which has no such tab).
  useEffect(() => {
    if (!isCryptoDerivatives && (tab === 'futures' || tab === 'spot')) setTab('overview');
  }, [isCryptoDerivatives, tab]);

  // CFTC Commitment of Traders - only fetched for non-crypto pairs (same lazy pattern the old
  // drawer used).
  const cot = useEndpoint<CotResponse>(!isCryptoDerivatives ? '/api/positioning/cot' : null, 60 * 60_000);
  const cotPosition: CotPosition | null = cot.data?.positions?.[pairId] ?? null;

  // CoinGlass parity ROUND 3 (header, XAU/FX branch): non-crypto pairs swap the header's
  // funding/OI tiles for DXY (real quote, already used elsewhere in the app for XAU/forex
  // confluence) + this pair's own ATR% (already computed below via volRow) - never blank crypto
  // columns for an asset class that has no funding/OI concept.
  const dxy = useEndpoint<DxyResponse>(!isCryptoDerivatives ? '/api/macro/dxy' : null, 5 * 60_000);

  // Header quick-stats (funding/OI) for crypto pairs - visible without switching to the Futures
  // tab, per the task's own header spec. CryptoDerivativesView fetches the exact same endpoint
  // again for its own detailed section; both share server.ts's 5-minute cachedExternalFeed cache,
  // so this never doubles the real OKX call.
  const derivInstId = derivSymbol ? `${DERIVATIVES_INSTRUMENT[derivSymbol]}-SWAP` : null;
  const headerDerivatives = useEndpoint<CryptoDerivativesResponse>(
    derivInstId ? `/api/crypto/derivatives?instId=${derivInstId}` : null,
    5 * 60_000
  );

  // Multi-exchange ranking - fetched ONCE here and passed down to ExchangeRankingTable AND
  // ExchangeVolumeHeatmap (Part D explicitly reuses Part C's data rather than fetching it twice).
  const ranking = useEndpoint<ExchangeRankingResponse>(
    isCryptoDerivatives ? `/api/crypto/exchange-ranking?symbol=${derivSymbol}` : null,
    2 * 60_000
  );

  // Market cap + daily price history (CoinGecko, up to 1 year) - fetched ONCE here and passed down
  // to BOTH MarketCapChart and the Overview tab's own OverviewPriceChart (week/month/year/all
  // ranges), same "lift the fetch, pass data down" pattern `ranking` above already uses. Never a
  // second round-trip for the same response.
  const marketCapHistory = useEndpoint<MarketCapHistoryResponse>(
    derivSymbol ? `/api/crypto/market-cap-history?symbol=${derivSymbol}` : null,
    60 * 60_000
  );

  // Spot tab: this pair's own row from the general top ~30 coin-by-volume feed (CoinGecko), not a
  // new fetch - CryptoMarketHeatmap already renders the same response for general context.
  const heatmap = useEndpoint<CryptoMarketHeatmapResponse>(isCryptoDerivatives ? '/api/crypto/market-heatmap' : null, 10 * 60_000);
  const spotCoin = useMemo(() => {
    if (!isCryptoDerivatives) return null;
    const coinSymbol = pairId.replace(/USDT$/, '');
    return heatmap.data?.coins.find((c) => c.symbol === coinSymbol) ?? null;
  }, [heatmap.data?.coins, isCryptoDerivatives, pairId]);

  const volRow = useMemo(() => volatilityRow(pairId, candles[pairId] ?? [], market), [candles, pairId, market]);

  const correlationRows = useMemo(() => {
    const symbols = Object.keys(candles).filter((s) => (candles[s] ?? []).length >= 4);
    if (!symbols.includes(pairId)) return [];
    const returnsBySymbol: Record<string, number[]> = {};
    for (const s of symbols) returnsBySymbol[s] = toReturns(candles[s]);
    const cells = correlationMatrix(returnsBySymbol, symbols);
    return cells
      .filter((c) => c.value !== null && (c.a === pairId) !== (c.b === pairId))
      .map((c) => ({ other: (c.a === pairId ? c.b : c.a) as PairId, value: c.value as number }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 4);
  }, [candles, pairId]);

  // Session Intelligence clock - ticks once a minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const sessionStatuses: SessionStatus[] = useMemo(() => getAllSessionStatuses(now), [now]);
  const openOverlapCount = useMemo(() => getOpenOverlaps(now).length, [now]);

  if (!pair) {
    return (
      <div className="space-y-4 font-mono">
        <BackButton onClick={onBack} label={t('instPanel.backToDashboard')} />
        <EmptyState title={t('instPanel.pairNotFound')} />
      </div>
    );
  }

  // CoinGlass parity (Bagian A) - Market Cap: last point of the SAME market-cap-history fetch
  // MarketCapChart/OverviewPriceChart already use, never a new endpoint. null when unavailable.
  const headerMarketCapUsd =
    marketCapHistory.data?.points && marketCapHistory.data.points.length > 0
      ? marketCapHistory.data.points[marketCapHistory.data.points.length - 1].marketCapUsd
      : null;

  // Futures Vol (24h): sum of this pair's already-fetched per-exchange rows (`ranking`, same data
  // ExchangeRankingTable/ExchangeVolumeHeatmap use) - real aggregate futures volume, not a second
  // fetch.
  const headerFuturesVolumeUsd = isCryptoDerivatives
    ? (ranking.data?.rows ?? []).reduce((sum, r) => (r.volume24hUsd !== null ? sum + r.volume24hUsd : sum), 0) || null
    : null;

  // CoinGlass parity ROUND 3 (header): Open Interest in USD, aggregated across the same
  // multi-exchange `ranking` rows Futures Vol above already sums - replaces the old single-OKX,
  // coin-denominated figure (headerDerivatives.openInterestCcy is OKX's own contract count in the
  // BASE coin, not USD - showing that as "Open Interest" without a $ conversion was the round 3
  // complaint "OI dalam BTC, dinihin USD").
  const headerOpenInterestUsd = isCryptoDerivatives
    ? (ranking.data?.rows ?? []).reduce((sum, r) => (r.openInterestUsd !== null ? sum + r.openInterestUsd : sum), 0) || null
    : null;

  // Spot Vol (24h): deliberately left unshown (tile renders "—") - this codebase has no clean
  // spot-only volume source (CoinGecko's `total_volume` mixes spot and derivatives across venues
  // for many coins), and labelling that number "Spot Vol" the way CoinGlass does would be a
  // dishonest label per this page's own no-fabricated-data discipline. The column stays in the
  // header's 7-metric layout (round 3's exact spec) so the row shape matches the reference, just
  // never with an invented value in it.

  // Circulating/Total/Max Supply: this pair's own row in the already-fetched top-~30-by-volume
  // CoinGecko feed (`heatmap`/`spotCoin`, same data the Spot tab already renders) - "—" when this
  // pair isn't in that top-30 window.

  // CoinGlass parity ROUND 3 (header identity cluster): plain-English asset name + a short ticker
  // badge + an instrument-class badge, replacing the old "BTC/USDT Perpetual" string as the
  // primary title. spotCoin.name (CoinGecko, real data) is preferred; CRYPTO_ASSET_NAME is only a
  // fallback for the rare cycle a pair isn't in CoinGecko's top-30-by-volume window.
  const assetTitle = isCryptoDerivatives
    ? spotCoin?.name || (derivSymbol ? CRYPTO_ASSET_NAME[derivSymbol] : null) || pair.name
    : pair.name;
  const tickerBadgeText = isCryptoDerivatives ? pairId.replace(/USDT$/, '') : pairId;
  const categoryBadge = isCryptoDerivatives
    ? t('instPanel.badgePerpetual')
    : pair.category === 'forex'
      ? t('instPanel.badgeForex')
      : t('instPanel.badgeCommodities');

  const tabs: Array<{ id: PageTab; label: string }> = isCryptoDerivatives
    ? [
        { id: 'overview', label: t('instPanel.tabOverview') },
        { id: 'futures', label: t('instPanel.tabFutures') },
        { id: 'spot', label: t('instPanel.tabSpot') },
        { id: 'info', label: t('instPanel.tabInfo') },
      ]
    : [
        { id: 'overview', label: t('instPanel.tabOverview') },
        { id: 'info', label: t('instPanel.tabInfo') },
      ];

  return (
    <div className="space-y-3 font-mono animate-in fade-in duration-200 pb-12">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <BackButton onClick={onBack} label={t('instPanel.backToDashboard')} />

        {/* Pair switcher - moves between watchlist pairs without leaving this page. */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full">
          {PAIRS_LIST.filter((p) => prices[p.id]).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectPair(p.id)}
              aria-current={p.id === pairId ? 'page' : undefined}
              className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-bold transition-colors duration-150 cursor-pointer ${
                p.id === pairId
                  ? 'bg-[var(--text-primary)] text-[var(--bg-base)]'
                  : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <PairIcon pairId={p.id} size={12} />
              {shortSymbol(p.name)}
            </button>
          ))}
        </div>
      </div>

      {/* Sticky header ROUND 3 rewrite: CoinGlass's own exact pattern - identity+price cluster on
          the left (asset name, ticker+class badges, price+delta all one visual group), a single
          row of 7 metrics on the right (crypto) or DXY/ATR/session (XAU/FX). Flat instead of the
          hev-card-v2 gradient card - a solid bg (needed since this is `sticky`) + a thin bottom
          border is the "hero info, not a card" treatment the dense-data reference uses. Labels
          here are deliberately NOT `uppercase` (unlike every other label on this page) - round 3's
          own spec calls for Title Case header labels ("Futures Vol (24h)", not "FUTURES VOL
          (24H)"), matching the CoinGlass reference photographed in the brief. */}
      <Panel variant="flat" className="lg:sticky lg:top-2 z-20 bg-[var(--bg-panel)] border-b border-[var(--border-subtle)] py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <PairIcon pairId={pairId} size={30} className="shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[15px] font-bold text-[var(--text-primary)] tracking-tight truncate">{assetTitle}</span>
                <span className="text-[9px] font-bold text-[var(--text-muted)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 shrink-0">
                  {tickerBadgeText}
                </span>
                <span className="text-[9px] text-[var(--text-muted)] shrink-0">{categoryBadge}</span>
              </div>
              {market && (
                <div className="flex items-baseline gap-2 mt-0.5">
                  <LiveValue
                    value={market.price}
                    as="span"
                    className="text-xl font-bold text-[var(--text-primary)] tabular-nums"
                    render={() => <BlurredValue blurred={signalsBlurred}>{market.price.toFixed(market.digits)}</BlurredValue>}
                  />
                  <span className={`text-xs font-bold tabular-nums ${market.change24h >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                    {market.change24h >= 0 ? '+' : ''}
                    {(market.price - market.price / (1 + market.change24h / 100)).toFixed(market.digits)} {market.change24h >= 0 ? '+' : ''}
                    {market.change24h.toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
          </div>

          {isCryptoDerivatives ? (
            <div className="flex items-start gap-x-5 gap-y-2 flex-wrap">
              <HeaderMetric label={t('instPanel.futuresVolume24h')} value={headerFuturesVolumeUsd === null ? '—' : `$${formatCompact(headerFuturesVolumeUsd, 2)}`} />
              <HeaderMetric label={t('instPanel.spotVolume24h')} value="—" title={t('instPanel.spotVolumeUnavailableNote')} />
              <HeaderMetric label={t('instPanel.marketCap')} value={headerMarketCapUsd === null ? '—' : `$${formatCompact(headerMarketCapUsd, 2)}`} />
              <HeaderMetric label={t('derivatives.openInterest')} value={headerOpenInterestUsd === null ? '—' : `$${formatCompact(headerOpenInterestUsd, 2)}`} />
              <HeaderMetric label={t('instPanel.circulatingShort')} value={spotCoin?.circulatingSupply != null ? formatCompact(spotCoin.circulatingSupply, 2) : '—'} />
              <HeaderMetric label={t('instPanel.totalShort')} value={spotCoin?.totalSupply != null ? formatCompact(spotCoin.totalSupply, 2) : '—'} />
              <HeaderMetric label={t('instPanel.maxShort')} value={spotCoin?.maxSupply != null ? formatCompact(spotCoin.maxSupply, 2) : '—'} />
            </div>
          ) : (
            <div className="flex items-start gap-x-5 gap-y-2 flex-wrap">
              <HeaderMetric
                label={t('instPanel.dxy')}
                value={dxy.data?.price == null ? '—' : formatNumber(dxy.data.price, 2)}
                tone={dxy.data?.changeSessionPct == null ? undefined : dxy.data.changeSessionPct >= 0 ? 'up' : 'down'}
              />
              <HeaderMetric label={t('instPanel.atrPercent')} value={volRow?.atrPercent == null ? '—' : `${formatNumber(volRow.atrPercent, 2)}%`} />
              <HeaderMetric
                label={t('instPanel.sessionTitle')}
                value={
                  sessionStatuses.filter((s) => s.isOpen).length > 0
                    ? sessionStatuses
                        .filter((s) => s.isOpen)
                        .map((s) => t(s.labelKey))
                        .join(' + ')
                    : '—'
                }
              />
            </div>
          )}
        </div>
      </Panel>

      <TabBar tabs={tabs} active={tab} onChange={(id) => setTab(id as PageTab)} />

      {tab === 'overview' && (
        <div className="space-y-3">
          {/* CoinGlass parity ROUND 3 layout: chart LEFT (~65%) + a stacked right rail (~35%) in
              ONE row, not stacked sections - "chart kiri + panel kanan dalam SATU viewport" per
              the brief. `xl:` (1280px), not `lg:` (1024px) - see this file's own breakpoint note
              near ExchangeRankingTable/ExchangeVolumeHeatmap for why 1024px is too narrow for a
              65/35 split to not look jammed (verified against real MacBook logical-px widths:
              1280/1440/1512/1728, plus the ~900-1200px "browser not maximized" case which is
              common on Mac and needs the single-column fallback to still look intentional). Below
              `xl:`, both sides stack full-width in document order (chart, then the right-rail
              content) exactly as they did before this round. */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 items-start">
            <div className="xl:col-span-2 min-w-0">
              {/* Visual fix ("Fix Chart Overview"): crypto pairs get the CoinGlass-reference simple
                  line/area chart (Price/Market Cap toggle, 1D/1W/1M/1Y/All ranges) by default, with
                  the full TradingView candlestick widget demoted to an opt-in "Advanced Chart"
                  inside it. XAU/forex majors have no market-cap-history equivalent to power that
                  toggle - kept on the exact TradingView widget they've always had, unchanged. */}
              <Panel flush className="p-3 sm:p-4">
                {isCryptoDerivatives && derivSymbol ? (
                  <OverviewPriceChart
                    pairName={pair.name}
                    tradingViewSymbol={pair.tradingViewSymbol}
                    candles={candles[pairId] ?? []}
                    marketCapHistory={marketCapHistory.data}
                    marketCapHistoryLoading={marketCapHistory.isLoading}
                  />
                ) : (
                  <TradingViewChart symbol={pair.tradingViewSymbol} pairName={pair.name} />
                )}
              </Panel>
            </div>

            <div className="xl:col-span-1 min-w-0 space-y-3">
              {market && (
                // Visual fix (Bug #2 turunan, item 4): flat surface + the multi-timeframe cells
                // rendered as small cells sharing thin dividers (divide-x) instead of a card with
                // wide, evenly-spaced gaps - matches the dense-data reference's tight timeframe
                // strip. ROUND 3: 3x3-ish wrap (grid-cols-3 here vs the old 4/7-col strip, since
                // this now sits in a ~35%-width column, not the full page) and cells with no real
                // history (everything but 24H right now) are skipped entirely rather than
                // rendering a row of "—" that eats space without saying anything.
                <Panel variant="flat" className="border-t border-[var(--border-subtle)]">
                  <PanelHeader eyebrow={t('category.market')} title={t('instPanel.performanceTitle')} />
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2.5">
                    {TIMEFRAME_KEYS.filter((tf) => tf === '24H').map((tf) => (
                      <div key={tf}>
                        <span className="text-[8px] uppercase tracking-wider text-[var(--text-muted)] block">{tf}</span>
                        <span className={`block text-[11px] font-bold tabular-nums ${market.change24h >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                          {market.change24h >= 0 ? '+' : ''}
                          {market.change24h.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[9px] text-[var(--text-muted)] leading-relaxed">{t('instPanel.performanceNote')}</p>
                </Panel>
              )}

              {isCryptoDerivatives && derivSymbol && (
                <FuturesOverviewSummary
                  symbol={derivSymbol}
                  pairId={pairId}
                  derivatives={headerDerivatives.data}
                  isLoading={headerDerivatives.isLoading}
                />
              )}

              {/* XAU + FOREX (round 3, "Ganti panel kanan: session ADR, DXY, yield 2Y, COT
                  ringkas"): DXY/ATR already moved into the header row above (this pair's own
                  right-rail here is session status + a compact COT read). No real 2Y-yield-spread
                  source exists in this codebase yet - honestly skipped rather than estimated, same
                  discipline as every other "don't have it" case on this page. */}
              {!isCryptoDerivatives && (
                <>
                  <Panel>
                    <PanelHeader
                      eyebrow={t('category.market')}
                      title={t('instPanel.sessionTitle')}
                      icon={<Clock className="w-4 h-4" />}
                      subtitle={openOverlapCount > 1 ? t('session.overlapActive') : undefined}
                    />
                    <div className="mt-3 grid grid-cols-2 gap-2.5">
                      {sessionStatuses.map((s) => (
                        <div key={s.id} className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[10px] p-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.isOpen ? 'bg-[var(--color-up)] animate-pulse' : 'bg-[var(--text-muted)]'}`} />
                            <span className="text-[10px] font-bold text-[var(--text-primary)] uppercase">{t(s.labelKey)}</span>
                          </div>
                          <span className="block text-[9px] text-[var(--text-muted)] mt-1">
                            {s.isOpen ? `${t('session.closesIn')} ${formatDuration(s.remainingMs)}` : `${t('session.opensIn')} ${formatDuration(s.remainingMs)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Panel>

                  <Panel>
                    <PanelHeader eyebrow={t('category.macro')} title={t('instPanel.cotTitle')} icon={<Gauge className="w-4 h-4" />} />
                    {cot.isLoading && !cot.data ? (
                      <div className="mt-3">
                        <LoadingState variant="cards" />
                      </div>
                    ) : !cotPosition ? (
                      <div className="mt-3">
                        <UnavailableState source={cot.data?.source ?? 'CFTC Socrata'} detail={cot.data?.error ?? t('instPanel.cotUnavailable')} />
                      </div>
                    ) : (
                      <div className="mt-3 grid grid-cols-2 gap-2.5">
                        <StatTile
                          label={t('analysis.cotColNet')}
                          value={formatNumber(cotPosition.netContracts, 0, { signed: true })}
                          tone={cotPosition.netContracts >= 0 ? 'up' : 'down'}
                        />
                        <StatTile
                          label={t('analysis.percentile')}
                          value={cotPosition.percentile === null ? '—' : `${Math.round(cotPosition.percentile)}`}
                        />
                      </div>
                    )}
                  </Panel>
                </>
              )}
            </div>
          </div>

          {/* CoinGlass parity ROUND 3 (Bagian "BAWAH OVERVIEW, baru boleh scroll"): Markets ranking
              table + Volume Heatmap live here now, matching the CoinGlass reference page directly
              - moved off the Futures tab (which per spec is just the Funding/OI/Volume/Liquidation
              chart section) rather than shown on both. Same ranking.data.rows fetch this page
              already made for the header/right-rail tiles, never a second round-trip. */}
          {isCryptoDerivatives && derivSymbol && (
            <>
              <div className="flex flex-col">
                <div>
                  <ExchangeRankingTable bare symbol={derivSymbol} data={ranking.data} isLoading={ranking.isLoading} />
                </div>
                <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
                  <ExchangeVolumeHeatmap bare rows={ranking.data?.rows ?? []} isLoading={ranking.isLoading} source={ranking.data?.source} />
                </div>
              </div>
              <p className="mt-3 text-[9px] text-[var(--text-muted)] leading-relaxed">{t('instPanel.aggregationNoteMarkets')}</p>
            </>
          )}

          {isCryptoDerivatives && derivSymbol && (
            <MarketCapChart symbol={derivSymbol} data={marketCapHistory.data} isLoading={marketCapHistory.isLoading} />
          )}

          {isCryptoDerivatives && (
            <SimilarPairsRow currentPairId={pairId} prices={prices} candles={candles} onSelectPair={onSelectPair} />
          )}

          {!isCryptoDerivatives && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Volatility / ATR - full detail (ATR% + day range%); the header/right-rail above
                  already surface a quick ATR% read, this is the fuller below-the-fold version. */}
              <Panel>
                <PanelHeader eyebrow={t('category.market')} title={t('instPanel.volatilityTitle')} icon={<Activity className="w-4 h-4" />} />
                {!volRow || volRow.atrPercent === null ? (
                  <div className="mt-3">
                    <EmptyState title={t('instPanel.volatilityUnavailable')} detail={t('instPanel.volatilityUnavailableDetail')} />
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-2.5">
                    <StatTile label={t('instPanel.atrPercent')} value={`${formatNumber(volRow.atrPercent, 2)}%`} />
                    <StatTile
                      label={t('instPanel.dayRangePercent')}
                      value={volRow.dayRangePercent === null ? '—' : `${formatNumber(volRow.dayRangePercent, 2)}%`}
                    />
                  </div>
                )}
              </Panel>

              {/* Correlation */}
              <Panel>
                <PanelHeader eyebrow={t('category.market')} title={t('instPanel.correlationTitle')} icon={<Grid3x3 className="w-4 h-4" />} />
                {correlationRows.length === 0 ? (
                  <div className="mt-3">
                    <EmptyState title={t('instPanel.correlationUnavailable')} detail={t('instPanel.correlationUnavailableDetail')} />
                  </div>
                ) : (
                  <div className="mt-3 space-y-1.5">
                    {correlationRows.map((row) => {
                      const strength = strengthTone(row.value);
                      return (
                        <div key={row.other} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="flex items-center gap-1.5 text-[var(--text-secondary)] truncate">
                            <PairIcon pairId={row.other} size={14} />
                            {PAIRS_MAP[row.other]?.name ?? row.other}
                          </span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            <span className={`font-bold tabular-nums ${row.value >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                              {row.value.toFixed(2)}
                            </span>
                            <Badge tone={strength.tone}>{strength.label}</Badge>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>
            </div>
          )}
        </div>
      )}

      {tab === 'futures' && isCryptoDerivatives && derivSymbol && (
        <div>
          {/* CoinGlass parity ROUND 2 (Bagian A): chartless - this tab's own FuturesDataAnalysis
              below already covers Funding Rate/Open Interest with aggregated ~14-exchange data,
              a price overlay and crosshair, so this panel's OKX-only history charts would be pure
              duplication. Keeps only the 3 stat tiles as a quick OKX-sourced snapshot. */}
          <CryptoDerivativesView symbol={DERIVATIVES_INSTRUMENT[derivSymbol]} dense chartless />

          {/* CoinGlass parity ROUND 3 (Bagian FUTURES): this tab's own chart list per spec is just
              Weighted Funding | Open Interest | Volume | Liquidation - the ranking table and volume
              heatmap moved to the bottom of the Overview tab (Bagian "BAWAH OVERVIEW"), matching
              the CoinGlass reference page directly instead of splitting that content across two
              tabs. */}
          <div className="mt-3">
            <FuturesDataAnalysis symbol={derivSymbol} rows={ranking.data?.rows ?? []} />
          </div>

          <p className="mt-3 text-[9px] text-[var(--text-muted)] leading-relaxed">{t('instPanel.aggregationNoteFutures')}</p>
        </div>
      )}

      {tab === 'spot' && isCryptoDerivatives && (
        <div className="space-y-3">
          <Panel>
            <PanelHeader eyebrow={t('category.market')} title={t('instPanel.spotTitle')} />
            {heatmap.isLoading && !heatmap.data ? (
              <div className="mt-3">
                <LoadingState variant="cards" />
              </div>
            ) : !spotCoin ? (
              <div className="mt-3">
                <UnavailableState source="CoinGecko" title={t('instPanel.spotUnavailable')} />
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <StatTile label={t('instPanel.price')} value={formatNumber(spotCoin.price, spotCoin.price < 10 ? 4 : 2)} />
                <StatTile label={t('instPanel.volume')} value={`$${formatCompact(spotCoin.volume24hUsd, 2)}`} />
                <StatTile label={t('instPanel.marketCap')} value={spotCoin.marketCapUsd === null ? '—' : `$${formatCompact(spotCoin.marketCapUsd, 2)}`} />
                <StatTile
                  label={t('instPanel.24h')}
                  value={spotCoin.change24hPercent === null ? '—' : `${spotCoin.change24hPercent >= 0 ? '+' : ''}${spotCoin.change24hPercent.toFixed(2)}%`}
                  tone={spotCoin.change24hPercent === null ? undefined : spotCoin.change24hPercent >= 0 ? 'up' : 'down'}
                />
              </div>
            )}
          </Panel>
          {/* Part H - Crypto ETF Overview: only relevant for BTCUSDT, since every ticker it covers
              is a spot Bitcoin ETF - no equivalent free data exists for any other pair here. */}
          {pairId === 'BTCUSDT' && <CryptoEtfOverview />}
          <CryptoMarketHeatmap />
        </div>
      )}

      {tab === 'info' && (
        <Panel>
          <PanelHeader eyebrow={t('category.market')} title={t('instPanel.infoTitle')} icon={<InfoIcon className="w-4 h-4" />} />
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 text-[11px]">
            <InfoRow icon={<Tag className="w-3.5 h-3.5" />} label={t('instPanel.infoName')} value={pair.name} />
            <InfoRow icon={<Layers className="w-3.5 h-3.5" />} label={t('instPanel.infoCategory')} value={pair.category} />
            <InfoRow
              icon={<FileText className="w-3.5 h-3.5" />}
              label={t('instPanel.infoDescription')}
              value={pair.description}
              fullWidth
            />
            <InfoRow icon={<Database className="w-3.5 h-3.5" />} label={t('instPanel.infoProvider')} value={pair.brokerProvider} />
            <InfoRow icon={<Hash className="w-3.5 h-3.5" />} label={t('instPanel.infoDigits')} value={String(pair.digits)} />
            <InfoRow icon={<LineChartIcon className="w-3.5 h-3.5" />} label={t('instPanel.infoChartSymbol')} value={pair.tradingViewSymbol} />
          </div>
        </Panel>
      )}
    </div>
  );
};

/** CoinGlass parity ROUND 3 (header): one of the 7 (crypto) or 3 (XAU/FX) metric cells on the
 *  right side of the sticky header - Title Case label (never `uppercase` - round 3's own spec
 *  distinguishes this row from every other UPPERCASE label on this page), bold tabular value.
 *  `title` is an optional native tooltip for a metric that's honestly unavailable rather than
 *  hidden (e.g. Spot Vol - see its own call site comment). */
const HeaderMetric: React.FC<{ label: string; value: string; tone?: 'up' | 'down'; title?: string }> = ({ label, value, tone, title }) => (
  <div title={title}>
    <span className="text-[10px] text-[var(--text-muted)] block mb-0.5">{label}</span>
    <span
      className={`text-[13px] font-bold tabular-nums block ${
        tone === 'up' ? 'text-[var(--color-up)]' : tone === 'down' ? 'text-[var(--color-down)]' : 'text-[var(--text-primary)]'
      }`}
    >
      {value}
    </span>
  </div>
);

const BackButton: React.FC<{ onClick: () => void; label: string }> = ({ onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-[11px] font-bold transition-colors cursor-pointer"
  >
    <ArrowLeft className="w-3.5 h-3.5" />
    <span>{label}</span>
  </button>
);

const InfoRow: React.FC<{ label: string; value: string; icon: React.ReactNode; fullWidth?: boolean }> = ({
  label,
  value,
  icon,
  fullWidth = false,
}) => (
  <div className={`flex items-start gap-2.5 py-2.5 border-b border-[var(--border-subtle)] sm:border-0 ${fullWidth ? 'sm:col-span-2' : ''}`}>
    <span className="text-[var(--text-muted)] shrink-0 mt-0.5">{icon}</span>
    <div className="min-w-0">
      <span className="block text-[var(--text-muted)] uppercase tracking-wider text-[9px]">{label}</span>
      <span className="block text-[var(--text-primary)] font-semibold break-words">{value}</span>
    </div>
  </div>
);
