import React, { useEffect, useState } from 'react';
import { BarChart3, Globe2 } from 'lucide-react';
import { DxyResponse, EconomicEvent, GeopoliticalRiskResponse, MarketPrice, PairId, Signal, StablecoinResponse } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { statusFromAge, type DataStatus } from '../../lib/dataState';
import { formatJakartaTime } from '../../lib/format';
import { Panel, PanelHeader, TabBar, type TabItem } from '../ui';
import { LivePulseDot } from '../viz';
import { MarketRegimeView } from './MarketRegimeView';
import { GlobalHeatmapView } from './GlobalHeatmapView';
import { CurrencyStrengthView } from './CurrencyStrengthView';
import { CorrelationView } from './CorrelationView';
import { VolatilityView } from './VolatilityView';
import { MarketBreadthView } from './MarketBreadthView';
import { GeopoliticalRiskView } from './GeopoliticalRiskView';
import { FearGreedView } from './FearGreedView';
import { TechnicalOverviewView } from './TechnicalOverviewView';
import { SweepWatchView } from './SweepWatchView';
import { LiquidityFlowView } from './LiquidityFlowView';
import { WhatMattersNowView } from './WhatMattersNowView';
import { InsightSummaryView } from './InsightSummaryView';
import { TodayCalendarView } from './TodayCalendarView';
import { SessionIntelligenceView } from './SessionIntelligenceView';

/**
 * Analysis Hub - "Market Intelligence" total rework (spec bagian 0-AG of the reworked prompt).
 *
 * LAYOUT (spec §AA, reverting PR #57's single-column pass after explicit user confirmation): back
 * to a 3-column dense desktop grid, but NOT the plain `items-stretch` grid PR #46 shipped and PR
 * #47/#48 had to patch twice (row 1/2 cards stretching unbounded to match their tallest sibling,
 * then a subtitle paragraph re-breaking the same density).
 *
 * Round 2 fix (user screenshot review of the first grid pass): `items-start` alone let each cell
 * size to its own content, which solved the stretch bug but created the opposite problem - a
 * short-content cell (an UNAVAILABLE state, a handful of rows) sat far shorter than its row
 * siblings, leaving a visible hole under it. Every one of the 9 cells in the 3x3 grid below now
 * gets the SAME fixed `GRID_CELL_CLASS` (min-height = max-height, both static values, never
 * relative to a sibling's height - the exact opposite mechanism from items-stretch, which measured
 * the tallest sibling at render time). Overflow is handled two ways depending on content length:
 * short content (an UnavailableState/EmptyState placeholder) is centered inside the fixed box so
 * it reads as deliberate rather than an orphaned line with dead space below it; content that can
 * exceed the box (a driver list, a heatmap's asset rows, an opened full correlation matrix) sits
 * inside its own `flex-1 min-h-0 overflow-y-auto` region below whatever must always stay visible
 * (a gauge, a network graph) - same overflow-y-auto pattern already proven pre-rework in
 * Correlation's Heatmap and Volatility's table, just driven by the new shared fixed height instead
 * of each view's own separate magic-number cap.
 *
 * The 3x3's third column, row 2 (spec §AA's "FLOW" cell) used to stack two full Panels
 * (StablecoinLiquidityView + InstitutionalFlowView) in one grid cell via hardcoded row-start
 * placement - which was exactly wrong once every cell shares one fixed height budget: a cell
 * holding 2 cards needs roughly double the room of a cell holding 1, the same mismatch flagged
 * against Volatility (1 card) sitting beside it. Fixed by merging both into a single
 * LiquidityFlowView card with two compact internal sections - matching spec §C's own module 8
 * ("Liquidity & Flow", one module, not two) rather than working around the height mismatch with a
 * wrapper-level scroll hack.
 *
 * Explicit grid placement (col-start/row-start) matches spec §AA's own diagram exactly for the 3x3
 * (Regime/Heatmap/GeoRisk, FX Strength/Volatility/Flow, Breadth/Correlation Network/Catalyst).
 * Spec §AA's diagram then shows only "WHAT MATTERS NOW" and "HEVORA INTELLIGENCE" below the grid -
 * but spec §C's page order and the detailed per-section specs (§P/§Q/§R/§M) also require Technical
 * Setup Overview, Sweep Watch and Crypto Sentiment to exist and to carry real content that does
 * not fit inside a 1/3-width grid cell. Reconciled here by rendering those three as full-width rows
 * between the grid and the two closing summary sections, in spec §C's own module order - a
 * disclosed judgment call, not a silent departure from either part of the spec. The fixed-height
 * rule applies only to the 3x3 grid itself (spec's own scope: "grid 3-kolom di desktop") - these
 * full-width rows and the two closing sections size to their own content as before.
 *
 * Mobile order (spec §AB) uses `order-[N]` utility classes on every cell (reset via `lg:order-none`
 * once explicit desktop grid placement takes over) rather than a second render path, so there is
 * exactly one DOM per module: Regime, Heatmap, What Matters Now, Currency Strength, Volatility,
 * Breadth, Technical Setup Overview, Sweep Watch, Geo Risk, Crypto Sentiment, Liquidity & Flow,
 * Correlation, Catalyst, Intelligence - spec §AB's own 10 named anchors plus the 4 modules it does
 * not name individually (Currency Strength, standalone Breadth, Sweep Watch, Crypto Sentiment)
 * inserted next to their closest thematic neighbour.
 *
 * Every module below is reused data-wise exactly as before this rework - same hooks, same
 * endpoints, no new fetch logic anywhere except the three new small primitives this rework adds
 * (MiniCandle, CorrelationNetwork, and the header's own DATA FEED status reads below) - only
 * re-laid-out and re-skinned per the individual per-letter specs each component's own file
 * documents. "Session Intelligence" is a second, untouched tab.
 */
type TabId = 'intelligence' | 'session';

/** Shared by all 9 cells of the 3x3 grid only (see header comment) - a fixed box every cell must
 *  fit inside or scroll within, never grow past.
 *
 * `height`, not `min-height`+`max-height` separately (even though they'd be numerically
 * identical): a CSS gotcha caught via screenshot on the first attempt at this fix - each Panel
 * inside a cell uses `h-full` to stretch to its wrapper, but a percentage height only resolves
 * against a parent whose own `height` is a definite value. A wrapper with only min/max-height set
 * still has `height: auto` for that specific calculation, so the Panel never actually stretched -
 * it sized to its own content and sat at the top of a much taller invisible box, which looked like
 * a giant gap under every short card. An explicit fixed `height` is both min and max simultaneously
 * AND resolves child percentage heights correctly.
 *
 * `overflow-y-auto`, not `overflow-hidden`: every view inside a cell already keeps whatever can
 * exceed 460px in its own internal `flex-1 min-h-0 overflow-y-auto` region (see each view's own
 * file), so this outer scroll is a safety net, not the primary mechanism - it should not normally
 * engage. But `overflow-hidden` here would silently clip anything that DID slip past that internal
 * handling with no scrollbar and no indication anything was cut, which is a data-loss risk, not
 * just a cosmetic one (e.g. FX Relative Strength gaining an 8th currency, or Correlation Network's
 * pair list growing). `overflow-y-auto` degrades to a visible scrollbar instead - the data stays
 * reachable even if a future change outgrows the fixed box.
 *
 * `overflow-x-hidden` alongside it - required, not optional: setting only `overflow-y` leaves
 * `overflow-x` at its default `visible`, and per the CSS overflow spec a UA then computes that
 * `visible` axis as `auto` too (both axes become scrollable together). A user-caught regression:
 * with only overflow-y-auto set, StateBlock.tsx's shared UnavailableState/EmptyState row (icon +
 * single-line text, several `shrink-0` children, used by 6 of these 9 cells for their empty/
 * unavailable state) is wider than a 1/3-column cell, and the implicit horizontal scroll container
 * did not sit at scrollLeft 0 by default - "LIVE DATA TEMPORARILY UNAVAILABLE" rendered cut from
 * the FRONT ("LY UNAVAILABLE...") in Geopolitical Risk and Liquidity & Flow's Institutional
 * Positioning section. These cells only ever need to scroll vertically, so overflow-x is pinned to
 * hidden explicitly rather than left to default into a second, unwanted scroll axis. */
const GRID_CELL_CLASS = 'lg:h-[460px] lg:overflow-y-auto lg:overflow-x-hidden';

const FEED_STATUS_DOT: Record<DataStatus, string> = {
  LIVE: 'bg-[var(--color-up)]',
  DELAYED: 'bg-[var(--color-warn)]',
  STALE: 'bg-[var(--color-warn)]',
  UNAVAILABLE: 'bg-[var(--text-muted)]',
  ERROR: 'bg-[var(--color-down)]',
  LOADING: 'bg-[var(--text-muted)]',
};

/** Spec §W's DATA STATUS row, folded into the header per spec §D's "DATA FEED" line - one status
 *  dot per upstream category, derived from feeds this hub (or a sibling card) already polls, never
 *  a fabricated "always LIVE" indicator. */
const DataFeedStatus: React.FC<{ prices: Record<PairId, MarketPrice> }> = ({ prices }) => {
  const dxy = useEndpoint<DxyResponse>('/api/macro/dxy', 30_000);
  const geoRisk = useEndpoint<GeopoliticalRiskResponse>('/api/intelligence/geopolitical-risk', 15 * 60_000);
  const stablecoins = useEndpoint<StablecoinResponse>('/api/flow/stablecoins', 30 * 60_000);

  const priceAges = [prices.BTCUSDT?.lastUpdated, prices.XAUUSD?.lastUpdated, prices.EURUSD?.lastUpdated].filter(Boolean) as string[];
  const priceStatus: DataStatus = priceAges.length === 0 ? 'UNAVAILABLE' : statusFromAge(priceAges.sort().pop(), 15_000, 120_000);
  const macroStatus: DataStatus = dxy.data?.unavailable ? 'UNAVAILABLE' : statusFromAge(dxy.data?.lastUpdated, 60_000, 10 * 60_000);
  const newsStatus: DataStatus = geoRisk.data?.unavailable ? 'UNAVAILABLE' : statusFromAge(geoRisk.data?.generatedAt, 20 * 60_000, 60 * 60_000);
  const flowStatus: DataStatus = stablecoins.data?.unavailable ? 'UNAVAILABLE' : statusFromAge(stablecoins.data?.fetchedAt, 2 * 60 * 60_000, 24 * 60 * 60_000);

  const feeds: Array<{ label: string; status: DataStatus }> = [
    { label: 'PRICE', status: priceStatus },
    { label: 'MACRO', status: macroStatus },
    { label: 'NEWS', status: newsStatus },
    { label: 'FLOW', status: flowStatus },
  ];

  return (
    <div className="flex items-center gap-3">
      <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--text-muted)]">DATA FEED</span>
      {feeds.map((feed) => (
        <span key={feed.label} className="flex items-center gap-1" title={`${feed.label}: ${feed.status}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${FEED_STATUS_DOT[feed.status]} ${feed.status === 'LIVE' ? 'animate-subtle-pulse' : ''}`} />
          <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{feed.label}</span>
        </span>
      ))}
    </div>
  );
};

export const AnalysisHub: React.FC<{
  prices: Record<PairId, MarketPrice>;
  signals: Record<PairId, Signal | null>;
  onNavigate: (route: string) => void;
  onOpenAsset: (pairId: PairId) => void;
  calendarEvents?: EconomicEvent[];
  onOpenEvent?: (id: string) => void;
}> = ({ prices, signals, onNavigate, onOpenAsset, calendarEvents = [], onOpenEvent }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>('intelligence');
  const [clock, setClock] = useState(() => formatJakartaTime());

  useEffect(() => {
    const id = setInterval(() => setClock(formatJakartaTime()), 1000);
    return () => clearInterval(id);
  }, []);

  const tabs: TabItem[] = [
    { id: 'intelligence', label: t('analysisHub.tabIntelligence'), icon: <BarChart3 className="w-3 h-3" /> },
    { id: 'session', label: t('module.sessionIntelligence'), icon: <Globe2 className="w-3 h-3" /> },
  ];

  return (
    <div className="space-y-4 font-mono">
      <Panel flush className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div>
            <h1 className="text-base font-black uppercase tracking-wide text-[var(--text-primary)]">MARKET INTELLIGENCE</h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)] mt-0.5">GLOBAL CROSS-ASSET ANALYTICS</p>
            <div className="mt-1.5 flex items-center gap-2">
              <LivePulseDot />
              <span className="text-[9px] text-[var(--text-muted)] tabular-nums">LAST UPDATE {clock}</span>
            </div>
          </div>
          <DataFeedStatus prices={prices} />
        </div>

        <div className="mt-4">
          <TabBar tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} />
        </div>
      </Panel>

      {tab === 'intelligence' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 lg:items-start gap-4">
          <div className={`order-[10] lg:order-none lg:col-start-1 lg:row-start-1 ${GRID_CELL_CLASS}`}>
            <MarketRegimeView prices={prices} onOpenDriver={onNavigate} />
          </div>
          <div className={`order-[20] lg:order-none lg:col-start-2 lg:row-start-1 ${GRID_CELL_CLASS}`}>
            <GlobalHeatmapView prices={prices} onOpenAsset={onOpenAsset} />
          </div>
          <div className={`order-[90] lg:order-none lg:col-start-3 lg:row-start-1 ${GRID_CELL_CLASS}`}>
            <GeopoliticalRiskView />
          </div>

          <div className={`order-[40] lg:order-none lg:col-start-1 lg:row-start-2 ${GRID_CELL_CLASS}`}>
            <CurrencyStrengthView prices={prices} />
          </div>
          <div className={`order-[50] lg:order-none lg:col-start-2 lg:row-start-2 ${GRID_CELL_CLASS}`}>
            <VolatilityView prices={prices} />
          </div>
          <div className={`order-[110] lg:order-none lg:col-start-3 lg:row-start-2 ${GRID_CELL_CLASS}`}>
            <LiquidityFlowView onOpen={onNavigate} />
          </div>

          <div className={`order-[60] lg:order-none lg:col-start-1 lg:row-start-3 ${GRID_CELL_CLASS}`}>
            <MarketBreadthView prices={prices} />
          </div>
          <div className={`order-[120] lg:order-none lg:col-start-2 lg:row-start-3 ${GRID_CELL_CLASS}`}>
            <CorrelationView />
          </div>
          <div className={`order-[130] lg:order-none lg:col-start-3 lg:row-start-3 ${GRID_CELL_CLASS}`}>
            <TodayCalendarView events={calendarEvents} onOpenEvent={onOpenEvent} onOpenCalendar={() => onNavigate('/calendar/economic')} />
          </div>

          <div className="order-[70] lg:order-none lg:col-start-1 lg:col-span-3 lg:row-start-4">
            <TechnicalOverviewView prices={prices} signals={signals} onOpenAsset={onOpenAsset} />
          </div>
          <div className="order-[80] lg:order-none lg:col-start-1 lg:col-span-3 lg:row-start-5">
            <SweepWatchView signals={signals} onOpenAsset={onOpenAsset} />
          </div>
          <div className="order-[100] lg:order-none lg:col-start-1 lg:col-span-3 lg:row-start-6">
            <FearGreedView />
          </div>

          <div className="order-[30] lg:order-none lg:col-start-1 lg:col-span-3 lg:row-start-7">
            <WhatMattersNowView prices={prices} />
          </div>
          <div className="order-[140] lg:order-none lg:col-start-1 lg:col-span-3 lg:row-start-8">
            <InsightSummaryView prices={prices} onNavigate={onNavigate} calendarEvents={calendarEvents} />
          </div>
        </div>
      )}

      {tab === 'session' && <SessionIntelligenceView prices={prices} />}
    </div>
  );
};
