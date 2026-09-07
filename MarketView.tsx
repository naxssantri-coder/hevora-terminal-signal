import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  ExternalLink,
  ShieldAlert,
  Target,
  Radar,
  Info,
  LineChart,
  ListOrdered,
  PenTool,
  Bell,
  X
} from 'lucide-react';
import { TradingViewChart } from './TradingViewChart';
import { XauLightweightChart } from './XauLightweightChart';
import { LightweightChart } from './LightweightChart';
import { BrokerModal } from './BrokerModal';
import { BlurredValue, SignalBlurBanner } from './BlurredValue';
import { PairIcon } from './PairIcon';
import { WatchlistSidebar } from './market/WatchlistSidebar';
import { MarketPrice, Signal, PairId, AssetCategory, ScanStatus, EconomicEvent } from '../types';
import { PAIRS_LIST } from '../data/pairs';
import { useRiskConsent } from '../lib/useRiskConsent';
import { SignalGate } from './signals/SignalGate';
import { ConfluencePanel } from './confluence/ConfluencePanel';
import { BtcConfluencePanel } from './confluence/BtcConfluencePanel';
import { ForexConfluencePanel } from './confluence/ForexConfluencePanel';
import { getForexSpec } from '../lib/confluence/forexSpecs';
import { useTranslation } from '../i18n/LanguageContext';
import { AnimatedNumber, LiveValue } from './viz';

interface MarketViewProps {
  prices: Record<PairId, MarketPrice>;
  signals: Record<PairId, Signal | null>;
  scanStatus?: Partial<Record<PairId, ScanStatus>>;
  selectedPairId: PairId;
  onSelectPair: (pairId: PairId) => void;
  signalsBlurred?: boolean;
  /** Pre-selects the asset-class filter so /market/forex etc. land already filtered. The user's
   *  own filter clicks still win until the route changes again. */
  initialCategory?: AssetCategory | 'all';
  /** Calendar events, used by the Confluence Engine to name the next catalyst. */
  calendarEvents?: EconomicEvent[];
  onNavigate?: (route: string) => void;
}

// Pairs routed onto the in-house LightweightChart instead of the TradingView widget - BTCUSDT/
// ETHUSDT/SOLUSDT (Bagian H/J), now joined by all 4 forex majors (Bagian J Tugas 3, 2026-09-01):
// EUR/USD, GBP/USD, USD/CHF, USD/CAD. Migrated on the user's own explicit go-ahead, accepting the
// known risk (Yahoo's forex feed occasionally fails a cycle, showing the ~3-4 bar synthetic
// fallback instead of the full ~30 real bars - see recordForexReliabilityOutcome's own comment in
// server.ts for the live-measured rate) rather than waiting out a longer observation window.
// ROLLBACK: to put a pair back on TradingView, just remove its id from this array - XAUUSD is
// excluded on purpose (it has its own dedicated XauLightweightChart, handled separately below).
const IN_HOUSE_CHART_PAIRS: readonly PairId[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'EURUSD', 'GBPUSD', 'USDCHF', 'USDCAD'];

/** Shared by the pair-list filter and the category-change effect below, so the two never drift
 *  out of sync with each other. */
const pairsInCategory = (category: AssetCategory | 'all') =>
  PAIRS_LIST.filter((pair) => {
    if (category === 'all') return true;
    if (category === 'commodities') return pair.id === 'XAUUSD';
    if (category === 'crypto') return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].includes(pair.id);
    if (category === 'forex') return ['EURUSD', 'GBPUSD', 'USDCHF', 'USDCAD'].includes(pair.id);
    return pair.category === category;
  });

export const MarketView: React.FC<MarketViewProps> = ({
  prices,
  signals,
  scanStatus = {},
  selectedPairId,
  onSelectPair,
  signalsBlurred = false,
  initialCategory = 'all',
  calendarEvents = [],
  onNavigate,
}) => {
  const [isBrokerModalOpen, setIsBrokerModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<AssetCategory | 'all'>(initialCategory);
  const [chartDisplayMode, setChartDisplayMode] = useState<'chart' | 'levels'>('chart');
  // Mobile pill-row cleanup: the full Pair Switcher Strip stays exactly as-is on lg:+ (desktop
  // unchanged), but below that it collapses into one compact "active pair" chip that opens this
  // full-screen picker instead of its own always-visible scroll row - one fewer stacked pill row
  // on a 390px viewport. Same MoreSheet.tsx dialog pattern (fixed inset-0, body-scroll-lock,
  // Escape-to-close) reused rather than a new sheet primitive.
  const [pickerOpen, setPickerOpen] = useState(false);
  // Task 5 (2026-08-29 XAUUSD audit follow-up): the signal card below never rendered
  // analysisReasoning at all - the new ICT/SMC confluence notes (premium/discount, OTE, killzone,
  // HTF gate, etc.) were computed and returned by the API but invisible to users viewing this
  // page. Collapsed by default (it's a multi-line technical readout, not glance-friendly like the
  // rest of the card) - toggled per pair switch below since a stale open state from a previous
  // pair/signal would be confusing.
  const [showReasoning, setShowReasoning] = useState(false);

  // Route-driven category changes (MarketsPage's own class tabs - the only filter control now
  // that the duplicate one inside this component is gone, see the Pair Switcher Strip comment
  // below) reach an already-mounted MarketView as a prop change, not a remount. Also jumps the
  // selected pair to the first one in the new category when the current pick doesn't belong to
  // it, same as the old in-component filter used to on click - otherwise switching category would
  // filter the strip out from under whatever pair happened to be selected.
  useEffect(() => {
    setSelectedCategory(initialCategory);
    const catPairs = pairsInCategory(initialCategory);
    if (catPairs.length > 0 && !catPairs.some((p) => p.id === selectedPairId)) {
      onSelectPair(catPairs[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCategory]);

  useEffect(() => {
    if (!pickerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  const { t } = useTranslation();

  // Recorded risk consent, gating this tab's signals. The fail-closed logic itself lives in
  // lib/useRiskConsent.ts so Market, Live Signals and Scalping Radar all enforce it from one
  // place rather than each keeping its own copy of the rule.
  const { state: consentState, markGranted } = useRiskConsent();

  const filteredPairs = pairsInCategory(selectedCategory);

  const activePair = PAIRS_LIST.find((p) => p.id === selectedPairId) || PAIRS_LIST[0];
  const activePrice = prices[selectedPairId];
  const activeSignal = signals[selectedPairId];
  const activeScanStatus = scanStatus[selectedPairId];
  // Whether this pair has a real in-house HEVORA chart to show on the second tab (2026-09-01: the
  // second tab used to always be the price-ladder "Level Harga" view - now it's the HEVORA chart
  // for every pair that's actually migrated, and stays the price ladder for the rest, since there's
  // no candle feed wired for a LightweightChart on those yet).
  const hasInHouseChart = activePair.id === 'XAUUSD' || IN_HOUSE_CHART_PAIRS.includes(activePair.id);

  // Collapse the reasoning disclosure whenever the underlying signal changes (new pair picked, or
  // this one replaced by a fresh signal) - a stale open state would show the previous signal's
  // analysis under the current one's numbers.
  useEffect(() => {
    setShowReasoning(false);
  }, [activeSignal?.id]);

  // Present only for the four majors the Forex engine covers; every other pair renders nothing.
  const forexSpec = getForexSpec(activePair.id);

  const digits = activePrice?.digits || 2;
  const isBuy = activeSignal?.type === 'BUY';

  const getStatusBadge = (status: string) => {
    // switch condition compares against the literal status strings from the Signal data model
    // (signal logic, untouched) - only the rendered label text below is translated.
    switch (status) {
      case 'Running':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-success/10 text-success border border-success/20 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span>{t('market.status.running')}</span>
          </span>
        );
      case 'TP1 Hit':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-success/15 text-success border border-success/30">
            <span>{t('market.status.tp1Hit')}</span>
          </span>
        );
      case 'TP2 Hit':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-success/20 text-success border border-success/40">
            <span>{t('market.status.tp2Hit')}</span>
          </span>
        );
      case 'TP MAX Hit':
        // TP structure simplification (2026-08-31 audit): XAUUSD no longer produces this status
        // going forward (takeProfit2 IS the final/far target now - see server.ts's XAU block in
        // createInstitutionalScalpingSignal), so this only exists to render a still-lingering
        // legacy signal correctly for the few seconds before it gets auto-replaced. Same badge as
        // 'TP2 Hit' rather than a distinct third-level label, to stay consistent with the 2-level
        // structure everywhere else.
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-success/20 text-success border border-success/40">
            <span>{t('market.status.tp2Hit')}</span>
          </span>
        );
      case 'Stop Loss Hit':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#FF4D4F]/10 text-[#FF4D4F] border border-[#FF4D4F]/30">
            <span>{t('market.status.slHit')}</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-accent/10 text-accent border border-accent/25">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            <span>{t('market.status.waitingEntry')}</span>
          </span>
        );
    }
  };

  // Calculate live progress percentage
  let progressPercent = 50;
  if (activeSignal && activePrice) {
    const sl = activeSignal.stopLoss;
    const tp2 = activeSignal.takeProfitMax ?? activeSignal.takeProfit2;
    const current = activePrice.price;
    const totalRange = Math.abs(tp2 - sl);
    if (totalRange > 0) {
      if (isBuy) {
        progressPercent = Math.min(Math.max(((current - sl) / totalRange) * 100, 5), 95);
      } else {
        progressPercent = Math.min(Math.max(((sl - current) / totalRange) * 100, 5), 95);
      }
    }
  }

  type PriceLevel = {
    key: string;
    label: string;
    price: number;
    color: string;
    isZone?: boolean;
    zoneMin?: number;
    zoneMax?: number;
  };

  let priceLevels: PriceLevel[] = [];
  let ladderMin = 0;
  let ladderMax = 100;

  if (activeSignal) {
    priceLevels = [
      // TP structure simplification (2026-08-31 audit): was 3 rows (TP1/TP2/TP MAX) - TP2 is now
      // the genuine far target itself (previously labeled TP MAX; see server.ts), so there is no
      // separate TP MAX row to render any more.
      { key: 'tp2', label: 'TP2', price: activeSignal.takeProfit2, color: '#3B82F6' },
      { key: 'tp1', label: 'TP1', price: activeSignal.takeProfit1, color: '#3B82F6' },
      {
        key: 'entry',
        label: 'ENTRY',
        price: activeSignal.entryAvg,
        color: 'var(--color-brand)',
        isZone: true,
        zoneMin: activeSignal.entryMin,
        zoneMax: activeSignal.entryMax,
      },
      { key: 'sl', label: 'SL', price: activeSignal.stopLoss, color: '#FF4D4F' },
    ];

    priceLevels.sort((a, b) => b.price - a.price);

    const allPrices = priceLevels.map((l) => l.price);
    if (activePrice) {
      allPrices.push(activePrice.price);
    }

    const rawMin = Math.min(...allPrices);
    const rawMax = Math.max(...allPrices);
    const rangeDiff = rawMax - rawMin;
    const padding = rangeDiff > 0 ? rangeDiff * 0.15 : 1;

    ladderMin = rawMin - padding;
    ladderMax = rawMax + padding;
  }

  const priceToLadderPercent = (price: number) => {
    if (ladderMax === ladderMin) return 50;
    return ((ladderMax - price) / (ladderMax - ladderMin)) * 100;
  };

  const currentLivePrice = activePrice ? activePrice.price : (activeSignal ? activeSignal.entryAvg : 0);
  const clampedCurrentPrice = Math.min(Math.max(currentLivePrice, ladderMin), ladderMax);
  const currentMarkerPercent = priceToLadderPercent(clampedCurrentPrice);

  // SignalGate returns its own markup INSTEAD of the children while consent is unconfirmed, never
  // layered over them: rendering signals underneath a blocking overlay would still ship the
  // numbers to the DOM, which defeats the point of the gate.
  return (
    <SignalGate state={consentState} onAcknowledged={markGranted}>
    <div className="space-y-5 animate-in fade-in duration-200 text-xs font-mono">
      {/* Category & Pair Toolbar - 2026-09-02 (Pasar page visual polish, round 2): this used to be
          its own bordered hev-card-v2 box sitting right above the chart's own bordered frame, one
          more separately-outlined rectangle in a page the user wants reading as one flowing module
          rather than a stack of boxes. Unwrapped down to a plain flex/space-y container (the pills
          inside keep their own border/background, which is the pair-selection affordance that
          actually matters) so it sits as part of the page background and the chart card right
          below it reads as the one framed element here, not a second competing frame. */}
      <div className="space-y-3 font-mono">
        {/* Desktop pair-switcher pill row REMOVED (2026-09-02, Pasar visual-polish round 4): it
            used to be the lg:+ way to switch pairs (`hidden lg:flex`, one pill per pair with
            icon/price/change%), but WatchlistSidebar now renders at that exact same `lg:`
            breakpoint showing the identical pair/price/change data in a vertical list one column
            over - the two were duplicating each other on every desktop/laptop view. Desktop pair
            switching still works two ways without this: WatchlistSidebar itself (primary), and
            the always-on TickerTape strip at the very top of the page (AppShell.tsx, no lg:hidden
            of its own - already wired to the same onSelectPair). Mobile is untouched below: the
            active-pair chip + full-screen picker sheet right after this comment were always a
            separate lg:hidden mechanism (WatchlistSidebar hides itself below lg:, so this chip is
            still the only way to switch pairs on a phone) - nothing about their markup changed. */}

        {/* Mobile-only active-pair chip (below lg:) - opens the picker sheet instead of showing
            a full scroll row, so this toolbar contributes exactly one pill row on a 390px
            viewport. Same pair/price/change data WatchlistSidebar shows on desktop. */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="lg:hidden w-full flex items-center gap-2 px-4 py-2.5 rounded-[12px] bg-[var(--bg-surface)] text-[var(--text-primary)] font-black border border-[var(--border-strong)] shadow-sm text-xs font-mono tabular-nums cursor-pointer"
        >
          <PairIcon pairId={activePair.id} size={16} className="shrink-0" />
          <span className="truncate">{activePair.name}</span>
          {activePrice && (
            <span className="text-[12px] text-[var(--text-primary)] font-black tabular-nums ml-1">
              <BlurredValue blurred={signalsBlurred}>{activePrice.price.toFixed(activePrice.digits)}</BlurredValue>
            </span>
          )}
          {activePrice && (
            <span className={`text-[10px] font-bold ${activePrice.change24h >= 0 ? 'text-[#2ECC71]' : 'text-[#FF4D4F]'}`}>
              {activePrice.change24h >= 0 ? '+' : ''}
              {activePrice.change24h.toFixed(2)}%
            </span>
          )}
          <ChevronDown className="w-3.5 h-3.5 shrink-0 ml-auto text-[var(--text-muted)]" />
        </button>
      </div>

      {/* Pair picker sheet (mobile only - the button that opens it is lg:hidden) - same
          MoreSheet.tsx dialog pattern: fixed inset-0, body-scroll-lock + Escape via the effect
          above. Lists the exact same `filteredPairs`/`onSelectPair` the desktop strip uses, just
          as a full-height vertical list instead of a horizontal scroll row. */}
      {pickerOpen && (
        <div className="lg:hidden fixed inset-0 z-[60] flex flex-col bg-[var(--bg-base)]" role="dialog" aria-modal="true">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-header)]">
            <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-[var(--text-primary)]">
              {t('market.selectPair')}
            </span>
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              aria-label={t('shell.close')}
              className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 font-mono">
            {filteredPairs.map((pair) => {
              const p = prices[pair.id];
              const isSelected = pair.id === selectedPairId;
              const isPositive = p ? p.change24h >= 0 : true;

              return (
                <button
                  key={pair.id}
                  type="button"
                  onClick={() => {
                    onSelectPair(pair.id);
                    setPickerOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-4 py-3 rounded-[12px] text-xs font-mono tabular-nums cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-black border border-[var(--border-strong)] shadow-sm'
                      : 'text-[var(--text-secondary)] bg-[var(--bg-panel)] active:bg-[var(--card-hover-bg)] border border-[var(--border-subtle)]'
                  }`}
                >
                  <PairIcon pairId={pair.id} size={16} className="shrink-0" />
                  <span className="truncate">{pair.name}</span>
                  {p && (
                    <span className="text-[12px] text-[var(--text-primary)] font-black tabular-nums ml-auto">
                      <BlurredValue blurred={signalsBlurred}>{p.price.toFixed(p.digits)}</BlurredValue>
                    </span>
                  )}
                  {p && (
                    <span className={`text-[10px] font-bold w-14 text-right ${isPositive ? 'text-[#2ECC71]' : 'text-[#FF4D4F]'}`}>
                      {isPositive ? '+' : ''}
                      {p.change24h.toFixed(2)}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Stale Price Feed Warning Banner */}
      {activePrice?.isStale && (
        <div className="bg-[#FF4D4F]/10 border border-[#FF4D4F]/30 rounded-[14px] p-3.5 text-[#FF4D4F] text-xs font-mono font-bold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-sm animate-pulse">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#FF4D4F]" />
            <span className="font-extrabold uppercase tracking-wider">{t('market.priceFeedDelayed')}</span>
          </div>
          <span className="text-[11px] text-[var(--text-secondary)] font-medium">
            {t('market.priceFeedDelayedDetail')}
          </span>
        </div>
      )}

      {/* Blur Signal Publik Notice (admin maintenance mode) */}
      {signalsBlurred && <SignalBlurBanner />}

      {/* Chart Display Mode Toggle Row */}
      <div className="flex items-center justify-between gap-2 font-mono">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-muted)] font-black uppercase tracking-wider">
            {t('market.viewMode')}
          </span>
        </div>
        <div className="flex items-center gap-1 p-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-full shadow-sm">
          <button
            onClick={() => setChartDisplayMode('chart')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-mono font-bold transition-all duration-200 cursor-pointer ${
              chartDisplayMode === 'chart'
                ? 'bg-[var(--text-primary)] text-[var(--bg-base)] font-black shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] font-bold'
            }`}
          >
            <LineChart className="w-3.5 h-3.5" />
            <span>{t('market.tradingViewTab')}</span>
          </button>
          <button
            onClick={() => setChartDisplayMode('levels')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-mono font-bold transition-all duration-200 cursor-pointer ${
              chartDisplayMode === 'levels'
                ? 'bg-[var(--text-primary)] text-[var(--bg-base)] font-black shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] font-bold'
            }`}
          >
            {hasInHouseChart ? <PenTool className="w-3.5 h-3.5" /> : <ListOrdered className="w-3.5 h-3.5" />}
            <span>{hasInHouseChart ? t('market.hevoraChartTab') : t('market.levelView')}</span>
          </button>
        </div>
      </div>

      {/* Main Chart / Level View Area - two-column on desktop (2026-09-02, Pasar visual-polish
          round 3): WatchlistSidebar as the left rail, matching the reference layout's "DAFTAR
          WATCHLIST" column. It hides itself below lg: (mobile already has its own pair-picker
          sheet just above), collapsing this grid to a single column there automatically. */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4 items-start">
      <WatchlistSidebar
        pairs={filteredPairs}
        prices={prices}
        selectedPairId={selectedPairId}
        onSelectPair={onSelectPair}
        signalsBlurred={signalsBlurred}
      />
      <div className="w-full min-w-0">
        {/* Tab 1 ("TradingView") - CSS hidden when inactive so the widget instance is preserved.
            2026-09-01: this tab is now unconditionally the real TradingView embed widget for every
            pair, including XAU/BTC/ETH/SOL/forex - it's the tab a reader lands on first for any
            pair (chartDisplayMode defaults to 'chart'), so the very first chart anyone sees is a
            familiar one with TradingView's own full toolbar (cursor, trendline, measure, etc. all
            built into the widget itself) rather than the in-house chart. The in-house HEVORA chart
            moved to the second tab below - see hasInHouseChart above. */}
        <div className={chartDisplayMode === 'chart' ? 'block' : 'hidden'}>
          <TradingViewChart symbol={activePair.tradingViewSymbol} pairName={activePair.name} />
        </div>

        {/* Tab 2a ("HEVORA Chart") - only for pairs with a real in-house candle feed wired (XAUUSD
            via XauLightweightChart, or IN_HOUSE_CHART_PAIRS via the generic LightweightChart) -
            drawingToolsEnabled=true unconditionally, same as before. CSS-hidden like tab 1 (not
            unmounted) so drawings/zoom/indicator state survives switching tabs back and forth. */}
        {hasInHouseChart && (
          <div className={chartDisplayMode === 'levels' ? 'block' : 'hidden'}>
            {activePair.id === 'XAUUSD' ? (
              <XauLightweightChart pairName={activePair.name} signal={activeSignal} drawingToolsEnabled />
            ) : (
              <LightweightChart
                pairId={activePair.id}
                pairName={activePair.name}
                digits={activePair.digits}
                signal={activeSignal}
                drawingToolsEnabled
              />
            )}
          </div>
        )}

        {/* Tab 2b ("Level Harga") - unchanged price-ladder view, still shown on the second tab for
            every pair that doesn't have an in-house chart yet (no candle feed wired for it). */}
        {!hasInHouseChart && chartDisplayMode === 'levels' && (
          <div className="w-full hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] overflow-hidden transition-all duration-300 font-mono">
            {/* Title Bar imitating TradingViewChart */}
            <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] text-xs font-mono">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-[#2ECC71] animate-pulse" />
                <PairIcon pairId={activePair.id} size={16} />
                <span className="font-black text-sm text-[var(--text-primary)] tracking-wide">{activePair.name}</span>
                <span className="text-[var(--text-muted)]">|</span>
                <span className="text-[var(--text-secondary)] text-xs font-bold">{activePair.tradingViewSymbol}</span>
              </div>
              <div className="flex items-center gap-2.5 text-[var(--text-muted)] text-[11px]">
                <span className="px-2.5 py-0.5 rounded bg-[var(--color-brand)]/10 border border-[var(--color-brand)]/30 text-[var(--color-brand)] font-extrabold tracking-wider">
                  {t('market.levelViewBadge')}
                </span>
              </div>
            </div>

            {/* Canvas Container with identical responsive height rules */}
            <div className="h-[340px] sm:h-[360px] md:h-[420px] lg:h-[54vh] xl:h-[60vh] w-full relative bg-[var(--bg-base)] p-5 sm:p-6 flex flex-col justify-between overflow-hidden">
              {/* Level Ladder Area */}
              <div className="relative flex-1 w-full my-2">
                {/* Spine Line */}
                <div className="absolute left-3 sm:left-5 top-0 bottom-0 w-[1px] bg-[var(--border-strong)] z-0" />

                {/* Price Levels */}
                {priceLevels.map((lvl) => {
                  const targetPrice = lvl.isZone && lvl.zoneMin !== undefined && lvl.zoneMax !== undefined
                    ? (lvl.zoneMin + lvl.zoneMax) / 2
                    : lvl.price;
                  const topPct = priceToLadderPercent(targetPrice);

                  return (
                    <div
                      key={lvl.key}
                      className="absolute left-0 right-0 -translate-y-1/2 flex items-center justify-between gap-2 transition-all duration-300 z-10"
                      style={{ top: `${topPct}%` }}
                    >
                      {/* Left dot + dashed line */}
                      <div className="flex items-center flex-1 gap-2">
                        <div
                          className="w-3 h-3 rounded-full shrink-0 z-10 ml-1.5 sm:ml-3.5"
                          style={{
                            backgroundColor: lvl.color,
                            boxShadow: `0 0 8px ${lvl.color}`,
                          }}
                        />
                        <div
                          className="flex-1 border-b border-dashed opacity-50"
                          style={{ borderColor: lvl.color }}
                        />
                      </div>

                      {/* Badge Label */}
                      <span
                        className="px-2.5 py-0.5 rounded text-[11px] font-black shrink-0 tracking-wider"
                        style={{
                          backgroundColor: `${lvl.color}18`,
                          color: lvl.color,
                          border: `1px solid ${lvl.color}40`,
                        }}
                      >
                        {lvl.label}
                      </span>

                      {/* Price Text */}
                      <span
                        className="text-xs sm:text-sm font-bold tabular-nums shrink-0 text-right min-w-[80px]"
                        style={{ color: lvl.color }}
                      >
                        <BlurredValue blurred={signalsBlurred}>
                          {lvl.isZone && lvl.zoneMin !== undefined && lvl.zoneMax !== undefined
                            ? `${lvl.zoneMin.toFixed(digits)} – ${lvl.zoneMax.toFixed(digits)}`
                            : lvl.price.toFixed(digits)}
                        </BlurredValue>
                      </span>
                    </div>
                  );
                })}

                {/* Live Price Marker */}
                {activePrice && (
                  <div
                    className="absolute left-0 right-0 -translate-y-1/2 flex items-center justify-between gap-2 transition-all duration-300 z-20"
                    style={{ top: `${currentMarkerPercent}%` }}
                  >
                    <div className="flex items-center flex-1 gap-2">
                      <div className="w-3.5 h-3.5 rounded-full bg-[var(--text-primary)] border-2 border-[var(--bg-base)] shrink-0 z-10 animate-pulse shadow-md ml-1 sm:ml-3" />
                      <div className="flex-1 border-b border-[var(--text-primary)] opacity-80" />
                    </div>

                    <span className="px-2.5 py-0.5 rounded text-[11px] font-black shrink-0 tracking-wider bg-[var(--text-primary)] text-[var(--bg-base)] shadow-sm">
                      {t('market.now')}
                    </span>

                    <LiveValue
                      value={activePrice.price}
                      as="span"
                      className="text-xs sm:text-sm font-black tabular-nums shrink-0 text-right min-w-[80px] text-[var(--text-primary)]"
                      render={() => (
                        <BlurredValue blurred={signalsBlurred}>
                          <AnimatedNumber value={activePrice.price} digits={digits} />
                        </BlurredValue>
                      )}
                    />
                  </div>
                )}
              </div>

              {/* Level View Footer Bar - was a bare percentage with no visual bar at all, added
                  during the Bagian B self-audit (a number with no shape to it is exactly the kind
                  of "still looks like default HTML" gap the audit is meant to catch). Gradient
                  fill in the signal's own direction colour, width tweens on price movement via
                  the existing .hev-bar-grow draw-in plus a CSS transition for subsequent updates. */}
              <div className="pt-2.5 border-t border-[var(--border-subtle)] shrink-0 space-y-1.5">
                <div className="h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                  <div
                    className="hev-bar-grow h-full rounded-full"
                    style={{
                      width: `${progressPercent}%`,
                      transition: 'width 500ms cubic-bezier(0.16, 1, 0.3, 1)',
                      background: isBuy
                        ? 'linear-gradient(90deg, color-mix(in srgb, var(--color-up) 40%, transparent), var(--color-up))'
                        : 'linear-gradient(90deg, color-mix(in srgb, var(--color-down) 40%, transparent), var(--color-down))',
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)] font-mono font-bold">
                  <span>{t('market.progressToTp2')} <strong className="text-[var(--text-primary)]">{progressPercent.toFixed(1)}%</strong></span>
                  <span className={isBuy ? 'text-[#2ECC71] font-black' : 'text-[#FF4D4F] font-black'}>
                    {t('market.direction')} {isBuy ? 'BUY ↑' : 'SELL ↓'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2026-08-31: the XAUUSD-only "chart vs header, different provider" note that used to sit
            here has been removed - it's no longer relevant now that the XAUUSD chart
            (XauLightweightChart) reads candleStore.XAUUSD, the exact same gold-api.com/Yahoo feed
            already backing the header/ticker/signal card, instead of a separate TradingView/OANDA
            widget. See the commit that replaced the XAUUSD chart for the full change. */}

        {/* Disclaimer Strip */}
        <div className="flex items-start gap-2 text-[11px] text-[var(--text-muted)] bg-[var(--bg-panel)] p-3 rounded-lg border border-[var(--border-subtle)] mt-3 font-mono">
          <Info className="w-4 h-4 shrink-0 text-[var(--text-secondary)] mt-0.5" />
          <span>
            {t('market.disclaimer')}
          </span>
        </div>
      </div>
      </div>

      {/* Market State (Confluence Engine, Fase 8 §4) - context first, and only for the flagship
          asset so far. Fase 10 §3 moves this ABOVE the Signal Terminal panel on purpose: a reader
          landing on an asset page wants "why is price moving like this" (Market State, the
          explanation) before "what can I do about it" (the Signal card, the decision) - not the
          other way round. This block still must not be read as a competing recommendation; entry,
          stop and target remain the signal engine's alone. */}
      {activePair.id === 'XAUUSD' && (
        <ConfluencePanel gold={activePrice} events={calendarEvents} onOpen={(route) => onNavigate?.(route)} />
      )}

      {/* Same placement rule for crypto: context above the signal card, never a competing call.
          BTC only for now - ETH and SOL have no positioning data of their own wired, and a read
          assembled from bitcoin's inputs under another coin's name would be a fabrication. */}
      {activePair.id === 'BTCUSDT' && (
        <BtcConfluencePanel btc={activePrice} events={calendarEvents} onOpen={(route) => onNavigate?.(route)} />
      )}

      {forexSpec && (
        <ForexConfluencePanel
          spec={forexSpec}
          quote={activePrice}
          events={calendarEvents}
          onOpen={(route) => onNavigate?.(route)}
        />
      )}

      {/* Redesigned Institutional Signal Terminal Panel */}
      {activeSignal ? (
        <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] p-6 space-y-5 transition-all duration-300 relative overflow-hidden group">
          {/* Signal Panel Watermark */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[clamp(80px,12vw,150px)] font-black tracking-[0.12em] text-[var(--text-primary)] opacity-[0.012] dark:opacity-[0.018] group-hover:opacity-[0.03] transition-opacity duration-250 select-none blur-[0.8px] leading-none whitespace-nowrap z-0">
            HEVORA
          </div>
          {/* Header Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-4 relative z-10">
            <div className="flex items-center gap-3">
              {/* The purely-decorative lightning/Zap icon box that used to sit here has been
                  removed - PairIcon (just below) already gives this header a meaningful icon
                  next to the pair name, so the Zap mark was redundant decoration. */}
              <div>
                <div className="flex items-center gap-2">
                  <PairIcon pairId={activePair.id} size={18} />
                  <span className="font-black text-lg text-[var(--text-primary)] tracking-tight">{activePair.name}</span>
                  <span className="text-[10px] text-[var(--text-muted)] uppercase font-extrabold px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                    {activePair.brokerProvider}
                  </span>
                  <span
                    className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded border ${
                      isBuy
                        ? 'bg-[#2ECC71]/10 text-[#2ECC71] border-[#2ECC71]/30'
                        : 'bg-[#FF4D4F]/10 text-[#FF4D4F] border-[#FF4D4F]/30'
                    }`}
                  >
                    {activeSignal.type}
                  </span>
                  {/* XAU/USD-only tiering (Task 4) - undefined for every other pair, so this
                      simply never renders for them, same as before this badge existed. */}
                  {activeSignal.signalTier && (
                    <span
                      className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded border ${
                        activeSignal.signalTier === 'SCALP'
                          ? 'bg-[#F5A623]/10 text-[#F5A623] border-[#F5A623]/30'
                          : 'bg-[var(--color-brand)]/10 text-[var(--color-brand)] border-[var(--color-brand)]/30'
                      }`}
                      title={
                        activeSignal.signalTier === 'SCALP'
                          ? 'Tier SCALP: target liquidity terdekat, RR minimal 1:1 - lolos syarat struktural genuine yang sama seperti MAIN.'
                          : 'Tier MAIN: threshold RR & struktural penuh (target liquidity terjauh yang genuine).'
                      }
                    >
                      {activeSignal.signalTier}
                    </span>
                  )}
                  {getStatusBadge(activeSignal.status)}
                </div>
                {/* Current price dropped from this line (premium redesign): the Hero Price block
                    above already shows it at 4x this size, repeating it here was exactly the
                    "same number twice on one screen" clutter the redesign is meant to remove. */}
                <div className="text-[11px] text-[var(--text-secondary)] flex items-center gap-2 mt-1 font-medium">
                  <span className="text-[var(--text-primary)] font-extrabold">
                    {t('market.aiScore')} {activeSignal.aiConfidenceScore || 95}%
                  </span>
                </div>
              </div>
            </div>

            {/* Open Trade Button opens Broker Router */}
            <button
              onClick={() => setIsBrokerModalOpen(true)}
              className="px-6 py-2.5 rounded bg-[#2ECC71] hover:bg-[#2ECC71]/90 text-black font-black text-xs tracking-wider transition-all duration-200 flex items-center justify-center gap-2 shadow-md active:scale-[0.98] cursor-pointer shrink-0 uppercase"
            >
              <span>{t('market.openTrade')}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Institutional Metric Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 font-mono relative z-10">
            {/* Entry Range */}
            <div className="col-span-2 sm:col-span-1 hev-card-v2 !p-3.5 rounded-[14px] border border-[var(--border-subtle)]">
              <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider block mb-0.5">
                {t('market.entryRange')}
              </span>
              <div className="text-base font-black text-[var(--text-primary)] tabular-nums tracking-tight">
                <BlurredValue blurred={signalsBlurred}>
                  {activeSignal.entryMin.toFixed(digits)} &ndash; {activeSignal.entryMax.toFixed(digits)}
                </BlurredValue>
              </div>
            </div>

            {/* Stop Loss */}
            <div className="hev-card-v2 !p-3.5 rounded-[14px] border border-[var(--border-subtle)]">
              <div className="flex items-center gap-1 text-[10px] text-[#FF4D4F] font-bold uppercase tracking-wider mb-0.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>{t('market.stopLoss')}</span>
              </div>
              <div className="text-base font-black text-[#FF4D4F] tabular-nums">
                <BlurredValue blurred={signalsBlurred}>{activeSignal.stopLoss.toFixed(digits)}</BlurredValue>
              </div>
            </div>

            {/* TP1 */}
            <div className="hev-card-v2 !p-3.5 rounded-[14px] border border-[var(--border-subtle)]">
              <div className="flex items-center gap-1 text-[10px] text-[#2ECC71] font-bold uppercase tracking-wider mb-0.5">
                <Target className="w-3.5 h-3.5" />
                <span>{t('market.tp1Target')}</span>
              </div>
              <div className="text-base font-black text-[#2ECC71] tabular-nums">
                <BlurredValue blurred={signalsBlurred}>{activeSignal.takeProfit1.toFixed(digits)}</BlurredValue>
              </div>
            </div>

            {/* TP2 */}
            <div className="hev-card-v2 !p-3.5 rounded-[14px] border border-[var(--border-subtle)]">
              <div className="flex items-center gap-1 text-[10px] text-[#2ECC71] font-bold uppercase tracking-wider mb-0.5">
                <Target className="w-3.5 h-3.5" />
                <span>{t('market.tp2Target')}</span>
              </div>
              <div className="text-base font-black text-[#2ECC71] tabular-nums">
                <BlurredValue blurred={signalsBlurred}>{activeSignal.takeProfit2.toFixed(digits)}</BlurredValue>
              </div>
            </div>

            {/* TP structure simplification (2026-08-31 audit): the third "TP MAX" tile was removed -
                TP2 above is now the genuine far target itself (previously labeled TP MAX). */}
            <div className="col-span-2 text-xs font-bold text-[var(--text-secondary)]">{activeSignal.status === 'TP1 Hit' ? 'TP1 ✅' : (activeSignal.status === 'TP2 Hit' || activeSignal.status === 'TP MAX Hit') ? 'TP1 ✅ · TP2 ✅ — SIGNAL CLOSED' : activeSignal.status === 'Stop Loss Hit' ? 'STOP LOSS HIT — SIGNAL CLOSED' : ''}</div>

            {/* Risk / Reward */}
            <div className="col-span-2 sm:col-span-1 hev-card-v2 !p-3.5 rounded-[14px] border border-[var(--border-subtle)]">
              <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider block mb-0.5">{t('market.riskReward')}</span>
              <div className="text-base font-black text-[var(--text-primary)] tabular-nums">
                {activeSignal.riskReward}
              </div>
            </div>
          </div>



          {/* TP1 Hit Move-to-Break-Even Alert Badge - redesigned away from a solid yellow block:
              calm dark surface, blue left-border accent + icon, no pulse/bounce animation. Still
              draws the eye via the bold header and accent bar, without feeling like a warning. */}
          {activeSignal.status === 'TP1 Hit' && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] border-l-4 border-l-[var(--color-brand)] rounded-[14px] p-4 text-xs font-mono flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm relative z-10">
              <div className="flex items-start sm:items-center gap-3">
                <div className="p-2 rounded-full bg-[var(--color-brand)]/10 border border-[var(--color-brand)]/30 shrink-0">
                  <Bell className="w-4.5 h-4.5 text-[var(--color-brand)]" />
                </div>
                <div className="space-y-1">
                  <div className="font-black text-sm text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
                    <span>{t('market.tp1AlertTitle')}</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] font-medium leading-relaxed">
                    {t('market.tp1AlertBody')}
                  </p>
                </div>
              </div>
              <div className="hev-card-v2 !px-3.5 !py-2 text-right shrink-0 w-full sm:w-auto">
                <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase block tracking-wider">{t('market.breakEvenLevel')}</span>
                <span className="text-sm font-black text-[var(--color-brand)] tabular-nums">
                  <BlurredValue blurred={signalsBlurred}>{activeSignal.entryAvg.toFixed(digits)}</BlurredValue>
                </span>
              </div>
            </div>
          )}

          {/* AI User Advice Quote */}
          {activeSignal.userAdvice && (
            <div className="text-[11px] text-[var(--text-secondary)] font-medium leading-relaxed italic bg-[var(--bg-surface)] p-3 rounded-[12px] border border-[var(--border-subtle)] relative z-10 font-mono">
              &ldquo;{activeSignal.userAdvice}&rdquo;
            </div>
          )}

          {/* Analysis Reasoning disclosure - was computed by the engine (OB/FVG/CHOCH, and for
              XAU the newer premium/discount, OTE, killzone, HTF-bias confluence notes) but never
              actually rendered anywhere on this page before this fix. Collapsed by default since
              it's a dense multi-line technical readout, not a glanceable metric. */}
          {activeSignal.analysisReasoning && (
            <div className="relative z-10">
              <button
                type="button"
                onClick={() => setShowReasoning((prev) => !prev)}
                className="w-full flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer py-1"
              >
                <span>{t('market.analysisReasoning')}</span>
                <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${showReasoning ? 'rotate-180' : ''}`} />
              </button>
              {showReasoning && (
                <div className="mt-2 bg-[var(--bg-surface)] p-3 rounded-[12px] border border-[var(--border-subtle)] font-mono">
                  {activeSignal.analysisReasoning.split('\n').map((line, idx) => (
                    <p key={idx} className="text-[11px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                      {line}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] p-8 sm:p-12 text-center relative overflow-hidden group font-mono transition-colors duration-200">
          {/* 2026-09-02 (Pasar page visual polish): this used to be a bare icon+heading+body with
              no background treatment at all - flat and static next to the rest of the page's
              cards. Same axis-grid + soft glow dressing TradingViewChart's own unavailable state
              uses (see that component's comment), tuned to a brand/neutral tone instead of the
              error-red one there - this is a normal "waiting" state, not a failure. */}
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                'linear-gradient(var(--text-muted) 1px, transparent 1px), linear-gradient(90deg, var(--text-muted) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 50% 38%, color-mix(in srgb, #2ECC71 8%, transparent), transparent 60%)',
            }}
          />
          <div className="flex flex-col items-center justify-center max-w-lg mx-auto space-y-4 relative z-10">
            <div className="relative flex items-center justify-center w-14 h-14 rounded-full bg-[#2ECC71]/10 border border-[#2ECC71]/25 shrink-0">
              <span className="absolute inset-0 rounded-full bg-[#2ECC71]/20 animate-ping opacity-75" />
              <Radar className="w-6 h-6 text-[#2ECC71] animate-spin" style={{ animationDuration: '6s' }} />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-tight">
                {t('market.watchingMarket')}
              </h3>
              <p className="text-[11px] text-[var(--text-secondary)] font-medium leading-relaxed">
                {t('market.watchingMarketBody')}
              </p>
              {activeScanStatus?.lastScanReason && (
                <p className="text-[10px] text-[var(--text-muted)] font-medium leading-relaxed pt-2 mt-2 border-t border-[var(--border-subtle)]">
                  {activeScanStatus.lastScanReason}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Broker Router Modal */}
      <BrokerModal
        isOpen={isBrokerModalOpen}
        onClose={() => setIsBrokerModalOpen(false)}
        pairName={activePair.name}
      />
    </div>
    </SignalGate>
  );
};
