import React, { useEffect, useMemo, useState } from 'react';
import { Landmark } from 'lucide-react';
import { DxyResponse, EconHistoryResponse, EconIndicatorId, KalshiFedProbabilitiesResponse, LiveEvent, TreasuryAuctionsResponse } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { latestPoint, latestValue, useFredSeries } from '../../lib/useFredSeries';
import { formatAge, statusFromAge } from '../../lib/dataState';
import { formatCompact, formatNumber } from '../../lib/format';
import { DualAxisAreaChart, LineChart } from '../charts';
import { Badge, DataQualityBadge, LoadingState, Panel, PanelHeader, SectionLabel, UnavailableState } from '../ui';
import { glowClass, InfoTooltip, LiveValue, SparklineCell } from '../viz';
import { FredSetupNotice } from './FredSetupNotice';

/**
 * Macro Hub 4a - "Kebijakan & Suku Bunga" (Policy & Rates).
 *
 * Merges five former standalone pages (Macro Overview, Central Banks, Interest Rates, Yield
 * Curve, Treasury) into one dense screen, per the Image 7 reference: a Policy Regime gauge, the
 * Fed's own cards, a Policy Transmission Flow diagram, a Policy Factors table (other central
 * banks with trend), the yield curve, and Treasury/M2 - every data point that used to live on
 * those five pages is still here, just laid out as one screen instead of five clicks. The four
 * routes those pages owned now redirect to this one (see registry.ts LEGACY_ROUTE_REDIRECTS).
 */
const OTHER_BANKS: Array<{ code: string; id: EconIndicatorId }> = [
  { code: 'ECB', id: 'ECBDFR' },
  { code: 'BOE', id: 'BOEBR' },
  { code: 'BOJ', id: 'BOJPR' },
  { code: 'RBA', id: 'RBACR' },
  { code: 'BOC', id: 'BOCCR' },
];

// Same Fed-identification pattern CentralBankEventsView.tsx's BANK_PATTERNS already uses for its
// FED row - matched against speaker/source/title since LiveEvent carries no dedicated
// "central bank" field. Only used to find the freshest FINALIZED Fed speech/testimony/press
// event, never to change what the FOMC-decision-based stance gauge itself reads.
// 'warsh' added (2026-08-29 audit): the named-official list had only ever tracked Powell by name -
// a real Warsh speech would have been silently excluded by name alone if it ever reached this
// filter via a source/title that names him but doesn't also say "Fed"/"FOMC"/"Federal Reserve".
// Institutional terms already cover every OFFICIAL Fed source in live-intel-watcher.config.ts
// (their labels all say "Federal Reserve"), so this only widens the narrower case. Still a
// standing gap worth knowing: any future Chair not already named here needs the same one-line
// addition, this list does not auto-track "whoever is Chair" on its own.
const FED_SPEAKER_PATTERN = /\b(fomc|fed|federal reserve|powell|warsh)\b/i;

// Roadmap §B4: foreign 10Y government bond yields (OECD MEI long-term rate series), same
// currency set OTHER_BANKS already covers - deliberately no CN/ID rows here either (product
// decision, round 2: no OECD MEI or other free/legal series exists for China or Indonesia at all,
// so the gap is left out of the UI entirely rather than shown as a "not wired" placeholder).
const FOREIGN_YIELDS: Array<{ code: string; id: EconIndicatorId }> = [
  { code: 'DE', id: 'DE10Y' },
  { code: 'GB', id: 'GB10Y' },
  { code: 'JP', id: 'JP10Y' },
  { code: 'AU', id: 'AU10Y' },
  { code: 'CA', id: 'CA10Y' },
];

const TENORS: Array<{ id: EconIndicatorId; label: string }> = [
  { id: 'DGS3MO', label: '3M' },
  { id: 'DGS2', label: '2Y' },
  { id: 'DGS5', label: '5Y' },
  { id: 'DGS10', label: '10Y' },
  { id: 'DGS30', label: '30Y' },
];

// Roadmap §A3: the daily TIPS real-yield curve. No 1Y tenor - Treasury has never issued a 1-year
// TIPS, so there is no official 1Y real-yield series to show (5Y is the shortest original
// maturity on the real curve). Said out loud in the panel rather than silently omitted.
const REAL_TENORS: Array<{ id: EconIndicatorId; label: string }> = [
  { id: 'DFII5', label: '5Y' },
  { id: 'DFII10', label: '10Y' },
  { id: 'DFII30', label: '30Y' },
];

// Data-freshness audit (2026-08-26): OTHER_BANKS/FOREIGN_YIELDS are OECD MEI series with a real
// 1-2 month publication lag by design (macro.otherBanksMethod/macro.foreignYieldsMethod already
// say so) - "Jun 2026" showing in August is normal for these, not a fetch bug (confirmed: FRED
// caching, just tightened in PRIORITY 1, was never the bottleneck for a monthly-cadence series).
// The actual problem was that this fact only lived in a click-to-reveal tooltip; a reader who
// never opens it sees a bare rate number and a barely-legible 8px raw ISO date next to it, which
// reads as a live quote rather than what it is. `formatAsOfMonth` turns that into "AS OF JUN
// 2026" at a size someone will actually notice, and each card also gets an explicit MONTHLY badge.
const formatAsOfMonth = (dateStr: string): string => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d).toUpperCase();
};

const ALL_IDS: EconIndicatorId[] = [
  'FOMC',
  'EFFR',
  'WALCL',
  'M2SL',
  'VIXCLS',
  ...TENORS.map((t) => t.id),
  ...REAL_TENORS.map((t) => t.id),
  ...OTHER_BANKS.map((b) => b.id),
  ...FOREIGN_YIELDS.map((y) => y.id),
];

export const PolicyRatesHub: React.FC<{ onOpen: (route: string) => void }> = ({ onOpen }) => {
  const { t } = useTranslation();
  const { series, isLoading, needsSetup, lastUpdated } = useFredSeries(ALL_IDS, 60);
  const dxy = useEndpoint<DxyResponse>('/api/macro/dxy', 60_000);
  // PRIORITY 3A (2026-08-26 data-freshness audit): Treasury auction schedule/results, free via
  // api.fiscaldata.treasury.gov, no key - server-cached 1h (server.ts), polled here at the same
  // cadence as the rest of this page's slower feeds.
  const treasuryAuctions = useEndpoint<TreasuryAuctionsResponse>('/api/macro/treasury-auctions', 60 * 60_000);
  // Roadmap §A2 replacement (round 2): CME FedWatch was investigated and never wired (CME market
  // data needs a paid license) - Kalshi (server.ts fetchKalshiFedProbabilities) is a genuinely
  // different but free/public/no-key prediction-market alternative, server-cached 5min. Polled at
  // the same cadence as the cache TTL so a client left open doesn't sit on stale market prices.
  const kalshiFed = useEndpoint<KalshiFedProbabilitiesResponse>('/api/macro/kalshi-fed-probabilities', 5 * 60_000);
  // Live Intelligence's already-built speech-analysis pipeline (server.ts computeFinalEventIntelligence
  // / finalStanceScore), read here ONLY to surface a "newer than the last FOMC decision" callout
  // beside the gauge - never merged into the lastMove-based stance number itself (see below).
  const liveEvents = useEndpoint<LiveEvent[] | { events: LiveEvent[] }>('/api/live-events?limit=40', 2 * 60_000);

  // Terminal redesign, EFFR chart fix: the shared useFredSeries hook above slices every series to
  // its last 60 *observations* (see server.ts sliceHistoryPoints) - correct for a monthly series,
  // but for daily EFFR that's ~60 trading days, about 3 calendar months, not the 60 months the
  // panel actually asks for. This is a dedicated fetch, scoped to this one chart only, that opts
  // into the server's calendarWindow=1 flag to get a real 60-calendar-month window instead. Every
  // other caller of /api/economic-history (including the shared hook above, and every other panel
  // on this page) does not pass that flag, so nothing else on this screen changes.
  const [effrFull, setEffrFull] = useState<EconHistoryResponse | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/economic-history?indicator=EFFR&months=60&calendarWindow=1')
      .then((res) => res.json())
      .then((data: EconHistoryResponse) => {
        if (!cancelled) setEffrFull(data);
      })
      .catch(() => {
        /* effrHistory below falls back to the shared (truncated) series.EFFR on failure. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const target = latestValue(series.FOMC);
  const effective = latestValue(series.EFFR);
  const balanceSheet = latestValue(series.WALCL);
  const m2Growth = latestValue(series.M2SL);
  const targetPoint = latestPoint(series.FOMC);

  const fomcPoints = (series.FOMC?.points ?? []).filter((p) => p.actual !== null);
  const lastMove =
    fomcPoints.length < 2 ? null : (fomcPoints[fomcPoints.length - 1].actual as number) - (fomcPoints[fomcPoints.length - 2].actual as number);

  // Policy stance gauge: a direct, disclosed read of the last FOMC decision's direction (hike =
  // hawkish, cut = dovish, hold = neutral), not a multi-input composite score. 50 is the neutral
  // hold point; hikes/cuts push it toward the edges in proportion to their own size (capped at 1pp
  // so one very large historical move does not permanently pin the needle).
  const stance = lastMove === null ? null : Math.max(0, Math.min(100, 50 + (lastMove / 1) * 50));
  // Same 0-40 dovish / 40-60 neutral / 60-100 hawkish read the old gauge's zones used - now
  // driving a plain word + the same up/down/neutral colour semantics, not a needle position.
  const stanceWord =
    stance === null ? '—' : stance < 40 ? t('macro.stanceDovish') : stance > 60 ? t('macro.stanceHawkish') : t('macro.stanceNeutral');
  const stanceColorClass =
    stance === null
      ? 'text-[var(--text-muted)]'
      : stance < 40
        ? 'text-[var(--color-up)]'
        : stance > 60
          ? 'text-[var(--color-down)]'
          : 'text-[var(--text-secondary)]';

  // Additional read alongside the gauge above (never merged into it): the freshest FINALIZED Fed
  // speech/testimony/press event the Live Intelligence pipeline has captured, when it postdates
  // the last FOMC decision the gauge itself reads. `finalIntelligence` (and its finalStanceScore)
  // only exists once a live session reaches 'finalized' (server.ts computeFinalEventIntelligence) -
  // an event still mid-stream is deliberately excluded, same "no partial/estimated read" rule
  // every other feed in this app already follows. Uses the exact same 0-40/40-60/60-100
  // dovish/neutral/hawkish zones LiveEventDetailPage.tsx's own finalStanceScore display uses, so
  // the two readings can never disagree about what a given score means.
  const latestFedCommunication = useMemo(() => {
    const list = Array.isArray(liveEvents.data) ? liveEvents.data : (liveEvents.data?.events ?? []);
    const fedFinalized = list
      .filter((e) => e.type !== 'market_news' && e.finalIntelligence != null)
      .filter((e) => FED_SPEAKER_PATTERN.test(`${e.speaker || ''} ${e.source || ''} ${e.title || ''}`))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return fedFinalized.length > 0 ? fedFinalized[0] : null;
  }, [liveEvents.data]);

  const communicationIsNewerThanLastDecision =
    latestFedCommunication !== null &&
    targetPoint !== null &&
    new Date(latestFedCommunication.createdAt).getTime() > new Date(targetPoint.date).getTime();

  const communicationScore = latestFedCommunication?.finalIntelligence?.finalStanceScore ?? null;
  const communicationWord =
    communicationScore === null
      ? '—'
      : communicationScore < 40
        ? t('macro.stanceDovish')
        : communicationScore > 60
          ? t('macro.stanceHawkish')
          : t('macro.stanceNeutral');
  const communicationColorClass =
    communicationScore === null
      ? 'text-[var(--text-muted)]'
      : communicationScore < 40
        ? 'text-[var(--color-up)]'
        : communicationScore > 60
          ? 'text-[var(--color-down)]'
          : 'text-[var(--text-secondary)]';

  // Visual-emphasis-only addition (no new data, no score change): a newer communication that
  // reads the SAME direction as the official decision (both dovish, both hawkish, etc.) is a
  // confirming footnote and stays as the small inline line below. One that reads the OPPOSITE
  // direction is the more decision-relevant fact for a reader right now - that's the case that
  // gets promoted to equal visual weight with the official number, not just a smaller/quieter
  // mention under it. Buckets compare the underlying 0-100 scores directly (not the localized
  // word strings) so this never breaks if the word display changes.
  const stanceBucket: 'dovish' | 'neutral' | 'hawkish' | null =
    stance === null ? null : stance < 40 ? 'dovish' : stance > 60 ? 'hawkish' : 'neutral';
  const communicationBucket: 'dovish' | 'neutral' | 'hawkish' | null =
    communicationScore === null ? null : communicationScore < 40 ? 'dovish' : communicationScore > 60 ? 'hawkish' : 'neutral';
  const communicationDivergesFromOfficial =
    communicationIsNewerThanLastDecision && stanceBucket !== null && communicationBucket !== null && stanceBucket !== communicationBucket;
  // Same three colors as communicationColorClass above, as a raw CSS var (not a Tailwind text-
  // class) for the divergent callout's border/background, which can't take a `text-*` class.
  const communicationAccentVar =
    communicationScore === null
      ? 'var(--text-muted)'
      : communicationScore < 40
        ? 'var(--color-up)'
        : communicationScore > 60
          ? 'var(--color-down)'
          : 'var(--text-secondary)';

  // Roadmap §5: "global central bank stance, briefly" - same hike/cut/hold read the Fed's own
  // stance gauge above already uses (last two prints of the same series this page already loads),
  // applied to every foreign bank too, as one quick badge row instead of a second gauge each.
  const bankLastMove = (id: EconIndicatorId): number | null => {
    const points = (series[id]?.points ?? []).filter((p) => p.actual !== null);
    if (points.length < 2) return null;
    return (points[points.length - 1].actual as number) - (points[points.length - 2].actual as number);
  };
  const globalStance: Array<{ code: string; move: number | null }> = [
    { code: 'FED', move: lastMove },
    ...OTHER_BANKS.map((bank) => ({ code: bank.code, move: bankLastMove(bank.id) })),
  ];
  const stanceLabel = (move: number | null): string =>
    move === null ? t('macro.stanceNoRead') : move > 0 ? t('macro.stanceHawkish') : move < 0 ? t('macro.stanceDovish') : t('macro.stanceNeutral');
  const stanceTone = (move: number | null): 'up' | 'down' | 'warning' | 'neutral' =>
    move === null ? 'neutral' : move > 0 ? 'down' : move < 0 ? 'up' : 'warning';

  // EFFR is daily - series.EFFR (the shared 60-*point* hook above) only covers its last ~3
  // calendar months. effrFull (the calendarWindow=1 fetch above) carries a real up-to-60-calendar-
  // month window once it lands; until then, or if it fails, this falls back to the shorter shared
  // series rather than rendering nothing. Label is YY-MM, not just MM-DD (round 2 Poin 3's earlier
  // format): a multi-year run repeats every MM-DD once a year, so YY-MM stays unambiguous - same
  // convention walclCombo below already uses.
  const effrHistory = useMemo(() => {
    const points = effrFull && !effrFull.needsSetup && effrFull.points.length > 0 ? effrFull.points : (series.EFFR?.points ?? []);
    return points.filter((p) => p.actual !== null).map((p) => ({ label: p.date.slice(2, 7), value: p.actual as number }));
  }, [effrFull, series.EFFR]);

  // Kalshi probability box (round 3, readability fix): each Kalshi market is its own cumulative
  // "will the rate end up ABOVE this threshold" read, so most of the low thresholds print ~100%
  // and most of the high ones ~0%, with only a narrow band in between actually moving - a table of
  // those raw cumulative numbers reads as "everything is 100% until it suddenly isn't", not the
  // discrete per-outcome-bracket table a FedWatch-style reader expects. This derives that discrete
  // table from the SAME already-fetched cumulative thresholds (server.ts/the fetch above are
  // untouched) - just successive differences: bracket [Ti, Ti+1) = P(above Ti) - P(above Ti+1),
  // the bottom bracket (below the lowest threshold) = 100 - P(above lowest), and the top bracket
  // (above the highest threshold) is the highest threshold's own cumulative read, unchanged.
  // Diffs are clamped at 0 - real bid/ask quotes on adjacent illiquid legs can very rarely produce
  // a hairline negative float noise, which must never render as a negative-width bar.
  const kalshiBrackets = useMemo(() => {
    const thresholds = kalshiFed.data?.probabilities?.thresholds;
    if (!thresholds || thresholds.length === 0) return [];

    const brackets: Array<{ key: string; kind: 'below' | 'range' | 'above'; lo: number; hi: number | null; probabilityPct: number }> = [];

    const first = thresholds[0];
    brackets.push({ key: `below-${first.ticker}`, kind: 'below', lo: first.floorStrike, hi: null, probabilityPct: Math.max(0, 100 - first.probabilityPct) });

    for (let i = 0; i < thresholds.length - 1; i++) {
      const lo = thresholds[i];
      const hi = thresholds[i + 1];
      brackets.push({
        key: `${lo.ticker}-${hi.ticker}`,
        kind: 'range',
        lo: lo.floorStrike,
        hi: hi.floorStrike,
        probabilityPct: Math.max(0, lo.probabilityPct - hi.probabilityPct),
      });
    }

    const last = thresholds[thresholds.length - 1];
    brackets.push({ key: `above-${last.ticker}`, kind: 'above', lo: last.floorStrike, hi: null, probabilityPct: Math.max(0, last.probabilityPct) });

    return brackets;
  }, [kalshiFed.data?.probabilities]);

  // Only 1-2 brackets are ever meaningfully likely (a real Fed-decision distribution is narrow) -
  // this is the same threshold used to decide which rows get the bold/bright "instrument" bar
  // treatment below vs. the deliberately quiet, thin treatment for the rest of the distribution
  // (kept visible, never hidden - the whole point is showing the full spread honestly).
  const KALSHI_SIGNIFICANT_PCT = 5;

  // LAST/CHANGE/HIGH/LOW/AVG(30D)/OBS stat row under the EFFR chart - every figure a real
  // reduction over effrHistory above, none estimated. AVG(30D) is the mean of the last 30 loaded
  // daily observations (~30 trading days - the closest honest reading of "30 days" a business-day
  // series can give without fabricating weekend/holiday fill values).
  const effrStats = useMemo(() => {
    if (effrHistory.length === 0) return null;
    const values = effrHistory.map((p) => p.value);
    const last = values[values.length - 1];
    const prev = values.length > 1 ? values[values.length - 2] : null;
    const window = values.slice(-30);
    return {
      last,
      change: prev === null ? null : last - prev,
      high: Math.max(...values),
      low: Math.min(...values),
      avg30: window.reduce((sum, v) => sum + v, 0) / window.length,
      obs: values.length,
    };
  }, [effrHistory]);

  // Prev EFFR reading (stat box "Prev: X%") - the point immediately before the latest one in the
  // shared series already loaded for the stat card, real, not effrHistory's separately-fetched
  // longer window.
  const effrPoints = (series.EFFR?.points ?? []).filter((p) => p.actual !== null);
  const prevEffr = effrPoints.length >= 2 ? (effrPoints[effrPoints.length - 2].actual as number) : null;

  // WALCL week-over-week change (stat box caption) - the last two loaded weekly points, real, not
  // a fabricated run-rate. Raw WALCL is millions of dollars (same unit walclCombo below converts),
  // divided down to trillions here to match the box's own $/T display.
  const walclPoints = (series.WALCL?.points ?? []).filter((p) => p.actual !== null);
  const walclWow =
    walclPoints.length >= 2
      ? ((walclPoints[walclPoints.length - 1].actual as number) - (walclPoints[walclPoints.length - 2].actual as number)) / 1_000_000
      : null;

  const curve = useMemo(() => TENORS.map((tenor) => ({ ...tenor, value: latestValue(series[tenor.id]) })), [series]);
  const realCurve = useMemo(() => REAL_TENORS.map((tenor) => ({ ...tenor, value: latestValue(series[tenor.id]) })), [series]);
  const spread2s10s = useMemo(() => {
    const two = latestValue(series.DGS2);
    const ten = latestValue(series.DGS10);
    return two === null || ten === null ? null : ten - two;
  }, [series]);
  const spreadHistory = useMemo(() => {
    const twos = new Map((series.DGS2?.points ?? []).filter((p) => p.actual !== null).map((p) => [p.date, p.actual as number]));
    const rows: Array<{ label: string; value: number }> = [];
    for (const point of series.DGS10?.points ?? []) {
      if (point.actual === null) continue;
      const two = twos.get(point.date);
      if (two === undefined) continue;
      rows.push({ label: point.date.slice(5), value: point.actual - two });
    }
    return rows;
  }, [series]);

  // Balance sheet + M2 growth combo (chart-style upgrade, Masalah 3 first checkpoint): WALCL
  // publishes weekly, M2SL monthly - the two are not resampled onto WALCL's own weekly grid by
  // forcing a shared array length (which would silently misalign them), they're forward-filled
  // pointer-walk style, and any WALCL date that falls before M2's own first reading is dropped
  // rather than backfilled with a fabricated early value.
  const walclCombo = useMemo(() => {
    const walcl = (series.WALCL?.points ?? []).filter((p) => p.actual !== null);
    const m2 = (series.M2SL?.points ?? []).filter((p) => p.actual !== null);
    const primary: Array<{ label: string; value: number }> = [];
    const secondary: Array<{ label: string; value: number }> = [];
    let mi = 0;
    for (const point of walcl) {
      while (mi + 1 < m2.length && (m2[mi + 1].date as string) <= point.date) mi++;
      if (m2.length === 0 || (m2[mi].date as string) > point.date) continue;
      // WALCL is reported in millions of dollars (same raw unit the stat tile above already
      // multiplies by 1e6 before formatCompact) - divided down to trillions here so the chart's
      // own $/T formatting doesn't need a second, separate scale factor threaded through it.
      primary.push({ label: point.date.slice(2, 7), value: (point.actual as number) / 1_000_000 });
      secondary.push({ label: point.date.slice(2, 7), value: m2[mi].actual as number });
    }
    return { primary, secondary };
  }, [series]);

  // PRIORITY 3A: the endpoint returns a flat, most-recent-first list mixing already-settled
  // auctions and still-scheduled ones (Treasury publishes both under the same auction_date sort) -
  // split here so "next up" and "most recent result" render as two distinct short lists instead of
  // one undifferentiated feed, capped at 4 each to stay inside this card's own space budget.
  const auctionSplit = useMemo(() => {
    const rows = treasuryAuctions.data?.auctions ?? [];
    const now = Date.now();
    const upcoming = rows
      .filter((r) => r.auctionDate && new Date(r.auctionDate).getTime() >= now)
      .sort((a, b) => new Date(a.auctionDate as string).getTime() - new Date(b.auctionDate as string).getTime())
      .slice(0, 4);
    const recent = rows
      .filter((r) => r.auctionDate && new Date(r.auctionDate).getTime() < now && r.auctionRate !== null)
      .sort((a, b) => new Date(b.auctionDate as string).getTime() - new Date(a.auctionDate as string).getTime())
      .slice(0, 4);
    return { upcoming, recent };
  }, [treasuryAuctions.data]);

  if (isLoading) return <LoadingState variant="cards" />;
  if (needsSetup) return <FredSetupNotice />;

  const anyValue = target !== null || effective !== null || balanceSheet !== null;
  // Strongly dovish or strongly hawkish (not just leaning) is the reading worth the eye first.
  const stanceGlow = stance === null ? null : stance <= 20 ? 'up' : stance >= 80 ? 'down' : null;

  return (
    <div className="space-y-4 font-mono">
      <Panel className={glowClass(stanceGlow)}>
        {/* ===== Terminal redesign: one compact header row, no eyebrow/title/subtitle stack.
            Deliberately not <PanelHeader> here (that component stays untouched for every other
            module that uses it) - this is local markup for this panel only. ===== */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Landmark className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)] truncate">
              {t('category.macro')} | {t('macro.policyHubTitle')}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <DataQualityBadge
              meta={{ source: 'FRED', lastUpdated, status: statusFromAge(lastUpdated, 6 * 60 * 60_000, 3 * 24 * 60 * 60_000) }}
            />
            <InfoTooltip text={t('macro.overviewMethod')} />
          </div>
        </div>

        {!anyValue ? (
          <div className="mt-4">
            <UnavailableState source="FRED (DFEDTARU / EFFR / WALCL)" />
          </div>
        ) : (
          <>
            {/* ===== 4-up stat grid: Policy Stance / Target Fed Funds / EFFR / Fed Balance Sheet.
                Visual polish: now reuses .hev-card-v2 (the same glass-gradient card every other
                module, including the Foreign 10Y Government Bond Yields grid below in this same
                file, is built on) instead of the old plain bordered box with no gradient/glow -
                content/logic inside each box is unchanged, only the wrapper's style. ===== */}
            <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] grid grid-cols-2 lg:grid-cols-4 gap-3">
              {/* overflow: visible (inline, local to this one card only) - .hev-card-v2's own
                  overflow:hidden would otherwise clip the InfoTooltip popover below, which is the
                  only one of the 4 stat boxes that has one. Everything else about the shared class
                  (gradient, border, radius) is untouched. */}
              <div className="hev-card-v2 !p-3 flex flex-col gap-1.5" style={{ overflow: 'visible' }}>
                <div className="flex items-center justify-between gap-1">
                  {/* When a newer, opposite-direction communication is being promoted to equal
                      billing below, this box's own label switches from the generic "Policy
                      Stance" to an explicit "Last Official Decision" - so it reads as history,
                      not as "right now", once it's no longer the only figure on screen. Reuses
                      the existing macro.stanceOfficialLabel string (already used as the small
                      inline prefix below) rather than adding a new key. */}
                  <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                    {communicationDivergesFromOfficial ? t('macro.stanceOfficialLabel') : t('macro.stanceLabel')}
                  </span>
                  <InfoTooltip text={t('macro.stanceMethod')} />
                </div>
                {/* Horizontal 0-100 bar, not a radial gauge - GaugeRadial stays reserved for the
                    other modules built on it (Market Regime, Positioning, Geopolitical Risk). */}
                <div className="h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${stance ?? 0}%`, background: 'var(--color-warn)' }} />
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-black tabular-nums text-[var(--color-warn)]">
                    {stance === null ? '—' : formatNumber(stance, 0)}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${stanceColorClass}`}>{stanceWord}</span>
                </div>
                <span className="text-[8px] text-[var(--text-muted)]">{t('macro.stanceScaleCaption')}</span>
              </div>

              <div className="hev-card-v2 !p-3 flex flex-col gap-1.5">
                <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('macro.fedTarget')}</span>
                <LiveValue
                  value={target}
                  as="span"
                  className="block text-xl font-black tabular-nums text-[var(--color-warn)]"
                  render={(v) => (v === null ? '—' : `${formatNumber(v as number, 2)}%`)}
                />
                {targetPoint && <span className="block text-[9px] text-[var(--text-muted)]">{t('macro.asOf')} {targetPoint.date}</span>}
              </div>

              <div className="hev-card-v2 !p-3 flex flex-col gap-1.5">
                <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">EFFR</span>
                <LiveValue
                  value={effective}
                  className="block text-xl font-black tabular-nums text-[var(--color-warn)]"
                  render={(v) => (v === null ? '—' : `${formatNumber(v as number, 2)}%`)}
                />
                {prevEffr !== null && (
                  <span className="block text-[9px] text-[var(--text-muted)]">
                    {t('macro.prevLabel')}: {formatNumber(prevEffr, 2)}%
                  </span>
                )}
              </div>

              <div className="hev-card-v2 !p-3 flex flex-col gap-1.5">
                <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('macro.balanceSheet')}</span>
                <LiveValue
                  value={balanceSheet}
                  className="block text-xl font-black tabular-nums text-[var(--color-warn)]"
                  render={(v) => (v === null ? '—' : `$${formatCompact((v as number) * 1_000_000, 2)}`)}
                />
                {walclWow !== null && (
                  <span
                    className={`block text-[9px] font-bold tabular-nums ${walclWow >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}
                  >
                    {formatNumber(walclWow, 2, { signed: true })}T WoW
                  </span>
                )}
              </div>
            </div>

            {/* ===== Latest-communication callout: shown ONLY when a finalized Fed speech/press
                event postdates the last FOMC decision above. Deliberately two separate readings,
                never merged into the gauge's own number - the official decision and the tone of
                the most recent communication are different things, and a reader needs to tell
                them apart, not see one blended score.

                Two renderings of the exact same underlying data, chosen by
                communicationDivergesFromOfficial (data/scores untouched either way - this is a
                visual-weight decision only, per the audit that found the small-print version was
                burying the more decision-relevant reading when it disagreed with the official
                figure):
                - Diverges (opposite direction from the official decision): promoted to the same
                  font size/weight as the official "38 Dovish" number above, in its own bordered
                  callout - this is the reading worth noticing first right now.
                - Agrees or same-direction lean: stays exactly as the original small inline line -
                  a confirming footnote, not something that needs equal visual weight. ===== */}
            {communicationIsNewerThanLastDecision && latestFedCommunication && targetPoint && (
              communicationDivergesFromOfficial ? (
                <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
                  <div
                    className="rounded p-2.5 flex flex-col gap-1.5 border-2"
                    style={{ borderColor: communicationAccentVar, background: `color-mix(in srgb, ${communicationAccentVar} 8%, transparent)` }}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('macro.stanceCommunicationLabel')}</span>
                      <InfoTooltip text={t('macro.stanceCommunicationMethod')} />
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpen(`/intel/live/${encodeURIComponent(latestFedCommunication.id)}`)}
                      className={`text-left text-xl font-black uppercase tracking-wider hover:opacity-80 ${communicationColorClass}`}
                    >
                      {communicationWord}
                    </button>
                    <span className="text-[9px] text-[var(--text-muted)] truncate">
                      ({latestFedCommunication.title || latestFedCommunication.speaker || t('intel.sourceUnknown')}, {formatAge(latestFedCommunication.createdAt)})
                    </span>
                    <span className="text-[9px] text-[var(--text-muted)] pt-1 border-t border-[var(--border-subtle)]">
                      {t('macro.stanceOfficialLabel')}: <span className={`font-bold uppercase ${stanceColorClass}`}>{stanceWord}</span>{' '}
                      <span className="tabular-nums">({targetPoint.date})</span>
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-x-2 gap-y-1">
                  <InfoTooltip text={t('macro.stanceCommunicationMethod')} />
                  <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('macro.stanceOfficialLabel')}:</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${stanceColorClass}`}>{stanceWord}</span>
                  <span className="text-[9px] text-[var(--text-muted)] tabular-nums">({targetPoint.date})</span>
                  <span className="text-[var(--text-muted)]">·</span>
                  <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('macro.stanceCommunicationLabel')}:</span>
                  <button
                    type="button"
                    onClick={() => onOpen(`/intel/live/${encodeURIComponent(latestFedCommunication.id)}`)}
                    className={`text-[10px] font-bold uppercase tracking-wider underline decoration-dotted hover:opacity-80 ${communicationColorClass}`}
                  >
                    {communicationWord}
                  </button>
                  <span className="text-[9px] text-[var(--text-muted)] truncate max-w-[220px]">
                    ({latestFedCommunication.title || latestFedCommunication.speaker || t('intel.sourceUnknown')}, {formatAge(latestFedCommunication.createdAt)})
                  </span>
                </div>
              )
            )}

            {/* ===== Policy Transmission - one dense text line, no SVG/diagram/animation. ===== */}
            <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
              <SectionLabel className="mb-1.5 block">{t('macro.transmissionTitle')}</SectionLabel>
              <div className="font-mono text-[11px] text-[var(--text-secondary)] overflow-x-auto whitespace-nowrap">
                <span className="font-bold text-[var(--text-primary)]">FED</span> {target === null ? '—' : `${formatNumber(target, 2)}%`}
                <span className="mx-1.5 text-[var(--text-muted)]">&gt;</span>
                <span className="font-bold text-[var(--text-primary)]">{t('macro.flowRates')}</span>{' '}
                {effective === null ? '—' : `${formatNumber(effective, 2)}%`}
                <span className="mx-1.5 text-[var(--text-muted)]">&gt;</span>
                <span className="font-bold text-[var(--text-primary)]">{t('macro.flowLiquidity')}</span>{' '}
                {balanceSheet === null ? '—' : `$${formatCompact(balanceSheet * 1_000_000, 1)}`}
                <span className="mx-1.5 text-[var(--text-muted)]">&gt;</span>
                <span className="font-bold text-[var(--text-primary)]">{t('macro.flowMarkets')}</span>
              </div>
            </div>

            {effrHistory.length > 1 && (
              <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-1.5">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--text-primary)]">
                    {t('macro.effrChartTitle')}
                  </span>
                  <span className="font-mono text-[9px] text-[var(--text-muted)]">{t('macro.effrChartSource')}</span>
                </div>
                {/* Step interpolation (round 2, Poin 3): EFFR holds flat for long stretches then
                    jumps once - a diagonal line between those sparse points reads as a broken
                    staircase. Only this chart on this page gets it; Yield Curve/Spread/Treasury
                    below already look right with the default linear line and stay untouched.
                    xAxisTicks: this chart alone now spans up to 60 real calendar months worth of
                    daily data (see effrHistory above), so a handful of interior month ticks
                    replace the default first/last-only footer every other LineChart caller still
                    gets unchanged. Y-axis stays auto-scaled to whatever effrHistory actually
                    contains - never forced to a fixed range.

                    Inset container (visual polish, this call site only): a plain surface + border
                    + rounded corners around the chart AND its stat row below, so both feel like
                    one unit set into the panel instead of the chart sitting bare against the
                    panel's own edge - not a second .hev-card-v2 glass card, which would compete
                    with the panel around it instead of blending into it. LineChart's own default
                    rendering (used unchanged by Yield Curve/Spread/Treasury below and every other
                    caller app-wide) is untouched - this is purely a wrapper around the call. */}
                <div className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                  <LineChart points={effrHistory} valueDigits={2} valueSuffix="%" color="var(--color-warn)" interpolation="step" xAxisTicks={6} />
                  {effrStats && (
                    <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9px] text-[var(--text-muted)]">
                      <span>
                        {t('macro.statLast')} <b className="text-[var(--text-primary)] tabular-nums">{formatNumber(effrStats.last, 2)}%</b>
                      </span>
                      <span>
                        {t('macro.statChange')}{' '}
                        <b
                          className={`tabular-nums ${
                            effrStats.change === null
                              ? 'text-[var(--text-primary)]'
                              : effrStats.change >= 0
                                ? 'text-[var(--color-up)]'
                                : 'text-[var(--color-down)]'
                          }`}
                        >
                          {effrStats.change === null ? '—' : `${formatNumber(effrStats.change, 2, { signed: true })}pp`}
                        </b>
                      </span>
                      <span>
                        {t('macro.statHigh')} <b className="text-[var(--text-primary)] tabular-nums">{formatNumber(effrStats.high, 2)}%</b>
                      </span>
                      <span>
                        {t('macro.statLow')} <b className="text-[var(--text-primary)] tabular-nums">{formatNumber(effrStats.low, 2)}%</b>
                      </span>
                      <span>
                        {t('macro.statAvg30d')} <b className="text-[var(--text-primary)] tabular-nums">{formatNumber(effrStats.avg30, 2)}%</b>
                      </span>
                      <span>
                        {t('macro.statObs')} <b className="text-[var(--text-primary)] tabular-nums">{effrStats.obs}</b>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Roadmap §A2 replacement (round 2): CME FedWatch was investigated and confirmed
                never wired (see macro.fedWatchNote) - Kalshi (server.ts
                fetchKalshiFedProbabilities), a CFTC-regulated prediction-market exchange, is a
                free/public/no-key alternative with a genuinely different methodology, always
                labelled as Kalshi (never presented as CME data). The event for "the next FOMC
                meeting" is picked dynamically server-side every cache refresh, never hardcoded.
                Honest fallback: UnavailableState (never a guessed number) if Kalshi fails to
                respond, or hasn't opened a market for the next meeting yet. */}
            <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <SectionLabel className="!mb-0">{t('macro.fedWatchTitle')}</SectionLabel>
                  <InfoTooltip text={t('macro.fedWatchNote')} />
                </div>
                {kalshiFed.data?.fetchedAt && (
                  <DataQualityBadge
                    compact
                    meta={{
                      source: 'Kalshi',
                      lastUpdated: kalshiFed.data.fetchedAt,
                      status: kalshiFed.data.stale ? 'STALE' : statusFromAge(kalshiFed.data.fetchedAt, 10 * 60_000, 60 * 60_000),
                    }}
                  />
                )}
              </div>

              {kalshiFed.data?.probabilities && kalshiBrackets.length > 0 ? (
                <div className="space-y-2">
                  {kalshiFed.data.probabilities.meetingDate && (
                    <span className="block text-[9px] text-[var(--text-muted)] font-mono">
                      {new Date(kalshiFed.data.probabilities.meetingDate).toLocaleDateString(undefined, {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  )}
                  {/* Per-bracket rows (not the raw cumulative thresholds - see kalshiBrackets
                      above): only the 1-2 brackets a real Fed decision actually clusters around get
                      the bold/bright "instrument" bar (gradient + glow + inset highlight, same
                      premium treatment the Performance tab's category bars use -
                      HistoryView.tsx - reused here locally since it isn't a shared component).
                      Everything else in the distribution stays visible but deliberately quiet
                      (thin, muted, no glow) so the full spread is still honestly shown, not hidden,
                      just not competing for attention with the actual likely outcome(s). */}
                  {kalshiBrackets.map((b) => {
                    const isSignificant = b.probabilityPct >= KALSHI_SIGNIFICANT_PCT;
                    const label =
                      b.kind === 'below'
                        ? `< ${formatNumber(b.lo, 2)}%`
                        : b.kind === 'above'
                          ? t('macro.kalshiAboveThreshold').replace('{value}', formatNumber(b.lo, 2))
                          : `${formatNumber(b.lo, 2)}%–${formatNumber(b.hi as number, 2)}%`;
                    return (
                      <div key={b.key} className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-mono">
                          <span className={isSignificant ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>{label}</span>
                          <span className={`tabular-nums ${isSignificant ? 'font-bold text-[var(--color-warn)]' : 'font-medium text-[var(--text-muted)]'}`}>
                            {formatNumber(b.probabilityPct, 1)}%
                          </span>
                        </div>
                        <div
                          className={`w-full rounded-full bg-[var(--bg-surface)] overflow-hidden border border-[var(--border-subtle)] ${
                            isSignificant ? 'h-3' : 'h-1.5'
                          }`}
                        >
                          <div
                            className="hev-bar-grow h-full rounded-full"
                            style={{
                              width: `${Math.min(100, b.probabilityPct)}%`,
                              background: isSignificant
                                ? 'linear-gradient(90deg, color-mix(in srgb, var(--color-warn) 30%, transparent), var(--color-warn))'
                                : 'color-mix(in srgb, var(--color-warn) 45%, transparent)',
                              boxShadow: isSignificant
                                ? '0 0 10px -1px color-mix(in srgb, var(--color-warn) 70%, transparent), inset 0 1px 0 rgba(255,255,255,0.16)'
                                : 'none',
                              transition: 'width 400ms cubic-bezier(0.16, 1, 0.3, 1)',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <UnavailableState
                  title={t('macro.licensedProviderNotWired')}
                  source="Kalshi"
                  detail={kalshiFed.data?.error ?? t('macro.fedWatchNote')}
                />
              )}
            </div>

            {/* Decorative status footer (optional, terminal-style) - static text, no keyboard
                handlers actually wired to F1/F2. */}
            <div className="mt-4 pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between font-mono text-[8px] uppercase tracking-wider text-[var(--text-muted)]">
              <span>
                {t('category.macro')} {t('macro.policyHubTitle')} | {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—'}
              </span>
              <span>{t('macro.footerHelpMenu')}</span>
            </div>
          </>
        )}
      </Panel>

      {/* ===== Policy Factors: other central banks with trend ===== */}
      <Panel>
        <PanelHeader
          title={t('macro.otherBanksTitle')}
          subtitle={t('macro.otherBanksSubtitleWired')}
          actions={<InfoTooltip text={t('macro.otherBanksMethod')} />}
        />

        <div className="mt-4 pb-4 border-b border-[var(--border-subtle)]">
          <SectionLabel className="mb-2 block">{t('macro.globalStanceTitle')}</SectionLabel>
          <div className="flex flex-wrap items-center gap-2">
            {globalStance.map((bank) => (
              <span key={bank.code} className="inline-flex items-center gap-1">
                <Badge tone={stanceTone(bank.move)}>
                  {bank.code} · {stanceLabel(bank.move)}
                </Badge>
                {/* Fed-status consistency audit (2026-08-30, landed independently of the gauge
                    emphasis change above): this compact badge deliberately only reads bank.move
                    (the same official hike/cut/hold as the gauge's OFFICIAL reading above) -
                    there's no room in a multi-bank badge row for the gauge's second "latest
                    communication" dimension, so the FED entry specifically gets a pointer to the
                    full gauge instead of silently looking like the complete picture. Other banks
                    don't have that second dimension at all, so they're left as-is. InfoTooltip
                    (click-to-reveal), not a native `title` - a hover-only tooltip is invisible on
                    touch devices. */}
                {bank.code === 'FED' && <InfoTooltip text={t('macro.fedBadgeOfficialOnlyNote')} />}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {OTHER_BANKS.map((bank) => {
            const rate = latestValue(series[bank.id]);
            const point = latestPoint(series[bank.id]);
            const history = (series[bank.id]?.points ?? []).filter((p) => p.actual !== null).map((p) => p.actual as number);
            // Roadmap §5: interest rate differential vs the Fed's own target - same two series
            // already loaded on this page (`target` above, `rate` here), just subtracted. Positive
            // = Fed higher (the classic USD carry-favourable direction vs that currency).
            const differential = target !== null && rate !== null ? target - rate : null;
            return (
              <div key={bank.code} className="hev-card-v2 !p-3">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{bank.code}</span>
                  <Badge tone="neutral" title={t('macro.otherBanksMethod')}>{t('macro.monthlyBadge')}</Badge>
                </div>
                {rate === null ? (
                  <span className="block text-lg font-black text-[var(--text-muted)] mt-1">—</span>
                ) : (
                  <>
                    <span className="block text-xl font-black tabular-nums text-[var(--text-primary)]">{formatNumber(rate, 2)}%</span>
                    {differential !== null && (
                      <span
                        className={`block text-[10px] font-bold tabular-nums mt-0.5 ${differential >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}
                        title={t('macro.rateDifferentialNote')}
                      >
                        {t('macro.vsFed')} {formatNumber(differential, 2, { signed: true })}pp
                      </span>
                    )}
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      {history.length > 1 && <SparklineCell values={history} />}
                      {point && (
                        <span className="text-[9px] font-bold text-[var(--text-secondary)]">
                          {t('macro.asOf')} {formatAsOfMonth(point.date)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      {/* ===== Foreign 10Y Government Bond Yields (Roadmap §B4) ===== */}
      <Panel>
        <PanelHeader
          title={t('macro.foreignYieldsTitle')}
          subtitle={t('macro.foreignYieldsSubtitle')}
          actions={<InfoTooltip text={t('macro.foreignYieldsMethod')} />}
        />
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {FOREIGN_YIELDS.map((y) => {
            const value = latestValue(series[y.id]);
            const point = latestPoint(series[y.id]);
            const history = (series[y.id]?.points ?? []).filter((p) => p.actual !== null).map((p) => p.actual as number);
            return (
              <div key={y.code} className="hev-card-v2 !p-3">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{y.code}</span>
                  <Badge tone="neutral" title={t('macro.foreignYieldsMethod')}>{t('macro.monthlyBadge')}</Badge>
                </div>
                {value === null ? (
                  <span className="block text-lg font-black text-[var(--text-muted)] mt-1">—</span>
                ) : (
                  <>
                    <span className="block text-xl font-black tabular-nums text-[var(--text-primary)]">{formatNumber(value, 2)}%</span>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      {history.length > 1 && <SparklineCell values={history} />}
                      {point && (
                        <span className="text-[9px] font-bold text-[var(--text-secondary)]">
                          {t('macro.asOf')} {formatAsOfMonth(point.date)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      {/* ===== Yield Curve ===== */}
      <Panel className={glowClass(spread2s10s !== null && spread2s10s < 0 ? 'warn' : null)}>
        <PanelHeader
          title={t('module.yieldCurve')}
          subtitle={t('macro.yieldCurveSubtitle')}
          titleVariant="chart"
          actions={
            <div className="flex items-center gap-2">
              {spread2s10s !== null && (
                <Badge tone={spread2s10s < 0 ? 'down' : 'up'}>{spread2s10s < 0 ? t('macro.inverted') : t('macro.normal')}</Badge>
              )}
              <InfoTooltip text={t('macro.spreadNote')} />
            </div>
          }
        />

        {!curve.some((c) => c.value !== null) ? (
          <div className="mt-4">
            <UnavailableState source="FRED" detail={t('macro.noTenors')} />
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
              {curve.map((tenor) => (
                <div key={tenor.id} className="hev-card-v2 !p-3">
                  <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{tenor.label}</span>
                  <LiveValue
                    value={tenor.value}
                    className="block text-lg font-black tabular-nums text-[var(--text-primary)]"
                    render={(v) => (v === null ? '—' : `${formatNumber(v as number, 2)}%`)}
                  />
                </div>
              ))}
            </div>
            <div className="mt-5">
              <LineChart
                points={curve.filter((c) => c.value !== null).map((c) => ({ label: c.label, value: c.value as number }))}
                valueDigits={2}
                valueSuffix="%"
                color="var(--color-up)"
              />
            </div>

            <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex items-end gap-4 flex-wrap">
              <div>
                <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('macro.spreadTitle')} (10Y − 2Y)</span>
                <LiveValue
                  value={spread2s10s}
                  className={`block text-2xl font-black tabular-nums ${spread2s10s === null ? 'text-[var(--text-muted)]' : spread2s10s < 0 ? 'text-[var(--color-down)]' : 'text-[var(--color-up)]'}`}
                  render={(v) => (v === null ? '—' : `${formatNumber(v as number, 2)} pp`)}
                />
              </div>
              {spreadHistory.length > 1 && (
                <div className="flex-1 min-w-[240px]">
                  <LineChart points={spreadHistory} valueDigits={2} valueSuffix=" pp" color="var(--color-warn)" />
                </div>
              )}
            </div>

            {/* Roadmap §A3: real (TIPS) yield curve, same panel as the nominal curve above since
                both are "yield curve" data - one home, not a second panel elsewhere. */}
            <div className="mt-5 pt-4 border-t border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('macro.realYieldCurveTitle')}</span>
                <InfoTooltip text={t('macro.realYieldCurveNote')} />
              </div>
              {!realCurve.some((c) => c.value !== null) ? (
                <div className="mt-3">
                  <UnavailableState source="FRED" detail={t('macro.noTenors')} />
                </div>
              ) : (
                <>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    {realCurve.map((tenor) => (
                      <div key={tenor.id} className="hev-card-v2 !p-3">
                        <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{tenor.label}</span>
                        <LiveValue
                          value={tenor.value}
                          className="block text-lg font-black tabular-nums text-[var(--text-primary)]"
                          render={(v) => (v === null ? '—' : `${formatNumber(v as number, 2)}%`)}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-4">
                    <LineChart
                      points={realCurve.filter((c) => c.value !== null).map((c) => ({ label: c.label, value: c.value as number }))}
                      valueDigits={2}
                      valueSuffix="%"
                      color="var(--color-warn)"
                    />
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </Panel>

      {/* ===== Treasury & Liquidity ===== */}
      <Panel>
        <PanelHeader
          title={t('module.treasury')}
          subtitle={t('macro.treasurySubtitle')}
          titleVariant="chart"
          actions={<InfoTooltip text={t('macro.auctionSubtitle')} />}
        />

        {balanceSheet === null && m2Growth === null ? (
          <div className="mt-4">
            <UnavailableState source="FRED (WALCL / M2SL)" />
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="hev-card-v2 !p-3">
                <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('macro.balanceSheet')}</span>
                <LiveValue
                  value={balanceSheet}
                  className="block text-2xl font-black tabular-nums text-[var(--text-primary)]"
                  render={(v) => (v === null ? '—' : `$${formatCompact((v as number) * 1_000_000, 2)}`)}
                />
              </div>
              <div className="hev-card-v2 !p-3">
                <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('macro.m2Growth')}</span>
                <LiveValue
                  value={m2Growth}
                  className={`block text-2xl font-black tabular-nums ${m2Growth === null ? 'text-[var(--text-muted)]' : m2Growth >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}
                  render={(v) => (v === null ? '—' : `${formatNumber(v as number, 2)}%`)}
                />
                <span className="block text-[9px] text-[var(--text-muted)] mt-1">{t('macro.yoy')}</span>
              </div>
            </div>
            {walclCombo.primary.length > 1 && (
              <div className="mt-5">
                <DualAxisAreaChart
                  primary={{
                    points: walclCombo.primary,
                    color: 'var(--color-warn)',
                    label: t('macro.balanceSheet'),
                    valueDigits: 1,
                    valuePrefix: '$',
                    valueSuffix: 'T',
                  }}
                  secondary={
                    walclCombo.secondary.length === walclCombo.primary.length
                      ? {
                          points: walclCombo.secondary,
                          color: 'var(--color-up)',
                          label: t('macro.m2Growth'),
                          valueDigits: 1,
                          valueSuffix: '%',
                        }
                      : undefined
                  }
                  height={220}
                />
              </div>
            )}
          </>
        )}

        <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('macro.auctionTitle')}</span>
            {treasuryAuctions.data?.fetchedAt && (
              <DataQualityBadge
                compact
                meta={{
                  source: treasuryAuctions.data.source,
                  lastUpdated: treasuryAuctions.data.fetchedAt,
                  status: treasuryAuctions.data.stale
                    ? 'STALE'
                    : statusFromAge(treasuryAuctions.data.fetchedAt, 2 * 60 * 60_000, 24 * 60 * 60_000),
                }}
              />
            )}
          </div>

          {treasuryAuctions.data?.unavailable || (auctionSplit.upcoming.length === 0 && auctionSplit.recent.length === 0) ? (
            <UnavailableState source="U.S. Treasury Fiscal Data API" detail={treasuryAuctions.data?.error} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className="block text-[8px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                  {t('macro.auctionUpcoming')}
                </span>
                <div className="space-y-1">
                  {auctionSplit.upcoming.length === 0 && <span className="text-[9px] text-[var(--text-muted)]">—</span>}
                  {auctionSplit.upcoming.map((a) => (
                    <div key={a.cusip ?? `${a.securityType}-${a.auctionDate}`} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="text-[var(--text-secondary)] truncate">{a.securityType} {a.securityTerm}</span>
                      <span className="text-[var(--text-primary)] font-bold tabular-nums shrink-0">
                        {a.auctionDate ? new Date(a.auctionDate).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <span className="block text-[8px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                  {t('macro.auctionRecent')}
                </span>
                <div className="space-y-1">
                  {auctionSplit.recent.length === 0 && <span className="text-[9px] text-[var(--text-muted)]">—</span>}
                  {auctionSplit.recent.map((a) => (
                    <div key={a.cusip ?? `${a.securityType}-${a.auctionDate}`} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="text-[var(--text-secondary)] truncate">{a.securityType} {a.securityTerm}</span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {a.auctionRate && (
                          <span
                            className="text-[var(--text-primary)] font-bold tabular-nums"
                            title={a.auctionRate.kind === 'high_yield' ? t('macro.auctionHighYield') : t('macro.auctionHighDiscount')}
                          >
                            {formatNumber(a.auctionRate.percent, 3)}%
                          </span>
                        )}
                        {a.bidToCoverRatio !== null && (
                          <span className="text-[var(--text-muted)]" title={t('macro.auctionBidToCover')}>
                            BtC {formatNumber(a.bidToCoverRatio, 2)}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </Panel>

      {/* ===== Cross-links: same quick tiles Macro Snapshot used to expose ===== */}
      <Panel>
        <PanelHeader title={t('macro.relatedTitle')} subtitle={t('macro.relatedSubtitle')} />
        <div className="mt-4 grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            {
              label: t('macro.realYield'),
              raw: latestValue(series.DFII10),
              render: (v: number | null) => (v === null ? '—' : `${formatNumber(v, 2)}%`),
              route: '/analysis/overview',
              note: 'FRED DFII10',
            },
            {
              label: t('macro.vix'),
              raw: latestValue(series.VIXCLS),
              render: (v: number | null) => (v === null ? '—' : formatNumber(v, 2)),
              route: '/analysis/overview',
              note: 'FRED VIXCLS',
            },
            {
              label: t('module.dxy'),
              raw: dxy.data && !dxy.data.unavailable ? dxy.data.price : null,
              render: (v: number | null) => (v === null ? '—' : formatNumber(v, 3)),
              route: '/macro/dxy',
              note: 'Yahoo DX-Y.NYB',
            },
          ].map((tile) => (
            <button
              key={tile.label}
              type="button"
              onClick={() => onOpen(tile.route)}
              className="text-left hev-card-v2 !p-3 hover:border-[var(--border-strong)] transition-colors cursor-pointer"
            >
              <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{tile.label}</span>
              <LiveValue
                value={tile.raw}
                className="block text-xl font-black tabular-nums text-[var(--text-primary)] mt-0.5"
                render={(v) => tile.render(v as number | null)}
              />
              <span className="block text-[9px] text-[var(--text-muted)] mt-1">{tile.note}</span>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
};
