import React, { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Info,
  Grid3x3,
  Radar as RadarIcon,
  CalendarDays,
  Sparkles,
  Gauge,
  ChevronDown,
  Workflow,
  CalendarClock,
  FileText,
  Activity,
} from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext';
import type { EconIndicatorId, EconIndicatorMeta, EconHistoryPoint, DxyPanelSnapshot, PriceAverageComparison, EconomicEvent, MacroNarrativeResponse, MacroNarrativeStructured } from '../types';
import { Sparkline } from './charts';
import { InfoTooltip, LivePulseDot } from './viz';

/**
 * The indicator set THIS page displays.
 *
 * EconIndicatorId also carries macro-only FRED series (DGS2/DGS5/DGS30/EFFR/WALCL/DGS3MO) added
 * for the Macro modules, which deliberately never appear as chips, suffixes or correlation
 * columns here. Narrowing to this alias keeps the maps below exhaustively type-checked against
 * what the page actually renders, instead of forcing every new backend series to grow a label
 * and an abbreviation it will never use.
 */
export type PageIndicatorId = Extract<
  EconIndicatorId,
  'CPI' | 'PPI' | 'UNRATE' | 'NFP' | 'FOMC' | 'GDP' | 'ADP' | 'PMI_MFG' | 'PMI_SVC' | 'DGS10' | 'DFII10' | 'M2SL' | 'VIXCLS'
>;

import { REGIME_LABEL_KEYS, classifyCategoryTrend, classifyTrendAtLookback, type CategoryId, type TrendDir } from '../lib/macroRegime';

interface EconHistoryApiResponse {
  success: boolean;
  indicator: EconIndicatorMeta;
  points: EconHistoryPoint[];
  lastUpdated: string | null;
  needsSetup: boolean;
  collectingSince: string | null;
  currencyNotSupported?: boolean;
  error?: string;
}

// Shape of the /api/economic-history/market-context response - read-only, purely to feed the
// "Market Summary & Interpretation" panel's USD/XAU reads. No signal logic touched.
interface MarketContextResponse {
  success: boolean;
  dxyPanel: DxyPanelSnapshot;
  priceComparison: PriceAverageComparison | null;
}


// Order matches the indicator chips previously used across this page.
const CHIP_INDICATOR_IDS: PageIndicatorId[] = ['ADP', 'NFP', 'FOMC', 'PMI_MFG', 'PMI_SVC', 'CPI', 'PPI', 'UNRATE', 'GDP'];
// DGS10 (10Y Treasury Yield) and DFII10 (10Y Real Yield) are fetched too, via the same generic
// endpoint used for every other indicator on this page - not shown as their
// own indicator chip/row, only used as real inputs behind the interpretation panel and the Rates
// historical chart below.
const FETCH_INDICATOR_IDS: PageIndicatorId[] = [...CHIP_INDICATOR_IDS, 'DGS10', 'DFII10'];

// Bug fix (2026-08-26): `months=N` on /api/economic-history means "last N raw observations", not
// "last N calendar months" - correct for a monthly-release series (CPI, NFP, UNRATE, GDP, ...)
// where each point already is one month, but for a DAILY FRED series it silently returns the last
// N *trading days* instead (~1 calendar month for months=24, not 24). FOMC's underlying series
// (DFEDTARU) and DGS10/DFII10 are all daily - without the server's calendarWindow=1 flag (already
// used by PolicyRatesHub's EFFR chart for the exact same reason), the Monthly Data table showed
// these three rows empty for almost the whole loaded year. ADP/PMI/CPI/PPI/UNRATE/NFP/GDP are
// monthly or quarterly releases already, so they need no change.
const CALENDAR_WINDOW_INDICATOR_IDS = new Set<PageIndicatorId>(['FOMC', 'DGS10', 'DFII10']);

const INDICATOR_LABEL_KEYS: Record<PageIndicatorId, string> = {
  CPI: 'econHistory.ind.CPI',
  PPI: 'econHistory.ind.PPI',
  UNRATE: 'econHistory.ind.UNRATE',
  NFP: 'econHistory.ind.NFP',
  FOMC: 'econHistory.ind.FOMC',
  GDP: 'econHistory.ind.GDP',
  ADP: 'econHistory.ind.ADP',
  PMI_MFG: 'econHistory.ind.PMI_MFG',
  PMI_SVC: 'econHistory.ind.PMI_SVC',
  DGS10: 'econHistory.ind.DGS10',
  DFII10: 'econHistory.ind.DFII10',
  M2SL: 'econHistory.ind.M2SL',
  VIXCLS: 'econHistory.ind.VIXCLS',
};

const INDICATOR_SUFFIX: Record<PageIndicatorId, string> = {
  CPI: '%',
  PPI: '%',
  UNRATE: '%',
  NFP: 'K',
  FOMC: '%',
  GDP: '%',
  ADP: 'K',
  PMI_MFG: '',
  PMI_SVC: '',
  DGS10: '%',
  DFII10: '%',
  M2SL: '%',
  VIXCLS: '',
};

// Short, mutually-distinct codes for the correlation matrix's compact headers - fixes a bug where
// PMI_MFG and PMI_SVC's translated labels both truncated down to the same "PMI " text. Not
// user-facing translated strings (they're abbreviations, not language-dependent phrases), so a
// single language-agnostic map is correct here.
const CORRELATION_ABBR: Record<PageIndicatorId, string> = {
  CPI: 'CPI',
  PPI: 'PPI',
  UNRATE: 'UNR',
  NFP: 'NFP',
  FOMC: 'FOMC',
  GDP: 'GDP',
  ADP: 'ADP',
  PMI_MFG: 'PMI-M',
  PMI_SVC: 'PMI-S',
  DGS10: 'Y10',
  DFII10: 'RY10',
  M2SL: 'M2',
  VIXCLS: 'VIX',
};

const SIGNED_INDICATORS = new Set<PageIndicatorId>(['NFP', 'ADP', 'CPI', 'PPI', 'GDP']);

const CATEGORIES: { id: CategoryId; labelKey: string; shortLabelKey: string; indicators: PageIndicatorId[] }[] = [
  { id: 'inflation', labelKey: 'econHistory.cat.inflation', shortLabelKey: 'econHistory.cat.inflationShort', indicators: ['CPI', 'PPI'] },
  { id: 'employment', labelKey: 'econHistory.cat.employment', shortLabelKey: 'econHistory.cat.employmentShort', indicators: ['NFP', 'ADP', 'UNRATE'] },
  { id: 'pmi', labelKey: 'econHistory.cat.pmi', shortLabelKey: 'econHistory.cat.pmiShort', indicators: ['PMI_MFG', 'PMI_SVC'] },
  { id: 'rates', labelKey: 'econHistory.cat.rates', shortLabelKey: 'econHistory.cat.ratesShort', indicators: ['FOMC'] },
  { id: 'growth', labelKey: 'econHistory.cat.growth', shortLabelKey: 'econHistory.cat.growthShort', indicators: ['GDP'] },
];

// Historical Macro Charts (Perbaikan 3): which indicators overlay as real lines sharing one honest
// Y-axis (only ever same-unit series - CPI/PPI both %, PMI both index, rate series all %) vs which
// get shown as a separate number below the chart because their unit doesn't match (Unemployment
// Rate is % while NFP/ADP are thousands of jobs - overlaying them on one axis would misrepresent
// scale). Core CPI and Retail Sales are NOT in this app's tracked indicator set (no free/reliable
// source wired up) so they're honestly omitted rather than guessed at.
const CATEGORY_CHART_CONFIG: { id: CategoryId; labelKey: string; lineIndicators: PageIndicatorId[]; separateIndicators: PageIndicatorId[]; isPmi: boolean }[] = [
  { id: 'inflation', labelKey: 'econHistory.cat.inflation', lineIndicators: ['CPI', 'PPI'], separateIndicators: [], isPmi: false },
  { id: 'employment', labelKey: 'econHistory.cat.employment', lineIndicators: ['NFP', 'ADP'], separateIndicators: ['UNRATE'], isPmi: false },
  { id: 'pmi', labelKey: 'econHistory.cat.pmi', lineIndicators: ['PMI_MFG', 'PMI_SVC'], separateIndicators: [], isPmi: true },
  { id: 'rates', labelKey: 'econHistory.cat.rates', lineIndicators: ['FOMC', 'DGS10', 'DFII10'], separateIndicators: [], isPmi: false },
  { id: 'growth', labelKey: 'econHistory.cat.growth', lineIndicators: ['GDP'], separateIndicators: [], isPmi: false },
];

// Terminal redesign: display order for the Macro Overview strip / Regime Score / Momentum
// heatmap - INFLATION, LABOR(=employment), GROWTH, RATES, PMI, per the redesign spec. Same 5
// CategoryId values CATEGORIES already defines, just a different display order for these
// glance-first widgets (the detailed Macro Regime row below keeps CATEGORIES' own order).
const OVERVIEW_STRIP_ORDER: CategoryId[] = ['inflation', 'employment', 'growth', 'rates', 'pmi'];

// Momentum heatmap windows (Bagian 3, P1) - labelled in *releases* back, not calendar months:
// these categories' lead indicators don't all publish monthly (FOMC ~8x/yr, GDP quarterly), so a
// "3M" label would be honest for CPI/NFP/PMI but wrong for FOMC/GDP. "1R/3R/6R/12R" (R = release)
// is the one label that's true for every category - see econHistory.momentumNote. Each cell is
// only ever a real direction or an honest "insufficient sample" mark, never guessed.
const MOMENTUM_WINDOWS: { key: string; label: string; lookback: number }[] = [
  { key: '1r', label: '1R', lookback: 1 },
  { key: '3r', label: '3R', lookback: 3 },
  { key: '6r', label: '6R', lookback: 6 },
  { key: '12r', label: '12R', lookback: 12 },
];

const YEARS = ['2025', '2026'];

type AssetTabId = 'USD' | 'XAUUSD' | 'BTCUSDT' | 'FOREX';
const ASSET_TABS: { id: AssetTabId; labelKey: string }[] = [
  { id: 'USD', labelKey: 'econHistory.asset.usd' },
  { id: 'XAUUSD', labelKey: 'econHistory.asset.xauusd' },
  { id: 'BTCUSDT', labelKey: 'econHistory.asset.btcusdt' },
  { id: 'FOREX', labelKey: 'econHistory.asset.forex' },
];
// Maps this page's asset tabs to the "asset" strings the AI Macro Narrative's marketImpactTable
// uses (EURUSD stands in for the "Forex" tab, matching the prompt sent to Gemini server-side).
const ASSET_TAB_TO_NARRATIVE_ASSET: Record<AssetTabId, string> = { USD: 'USD', XAUUSD: 'XAUUSD', BTCUSDT: 'BTCUSDT', FOREX: 'EURUSD' };

// Overview/Deep Dive (Terminal redesign, renamed from Simple/Professional, spec §28): Overview
// shows the glance-first sections (regime, what changed, momentum, key indicators, next events);
// Deep Dive is the superset that also shows the full monthly table, historical charts,
// correlation matrix and percentile/radar analytics. Internal value renamed alongside the label so
// the two never drift out of sync.
type ViewMode = 'overview' | 'deepdive';

// Calendar/FRED merge follow-up: PCEPILFE (Core PCE) is tracked in ECON_INDICATORS but is not one
// of this page's own chip/correlation indicators (PageIndicatorId), so it doesn't belong in every
// Record<PageIndicatorId, ...> map above - widening PageIndicatorId itself would force a
// (meaningless) entry into all of them. This narrow union is EVENT_MATCH_PATTERNS' own indicatorId
// type instead, exported so EconomicCalendarView.tsx's FRED-merge code can type its indicator ids
// against it without touching this page's own indicator set.
export type CalendarTrackedIndicatorId = PageIndicatorId | 'PCEPILFE';

// Event Intelligence (Perbaikan 5): recognizes upcoming calendar events for our tracked
// indicators, purely for display grouping - independent copy of similar matching done server-side
// for the ADP/PMI archive, since the client only has the calendar feed's event titles to go on.
// Exported (Calendar Actual/FRED merge) so EconomicCalendarView.tsx reuses this EXACT list rather
// than duplicating the regexes - one definition, so the two views can never silently drift apart
// on which titles count as "CPI", "NFP", etc.
export const EVENT_MATCH_PATTERNS: { indicatorId: CalendarTrackedIndicatorId; test: (title: string) => boolean }[] = [
  { indicatorId: 'CPI', test: (title) => /\bcpi\b/i.test(title) || /consumer price index/i.test(title) },
  { indicatorId: 'PPI', test: (title) => /\bppi\b/i.test(title) || /producer price index/i.test(title) },
  { indicatorId: 'UNRATE', test: (title) => /unemployment rate/i.test(title) },
  { indicatorId: 'NFP', test: (title) => /non-?farm payrolls/i.test(title) || /\bnfp\b/i.test(title) },
  { indicatorId: 'FOMC', test: (title) => /\bfomc\b/i.test(title) || /fed(eral)? (funds )?rate/i.test(title) || /interest rate decision/i.test(title) },
  { indicatorId: 'GDP', test: (title) => /\bgdp\b/i.test(title) },
  { indicatorId: 'ADP', test: (title) => /\badp\b/i.test(title) },
  { indicatorId: 'PMI_MFG', test: (title) => /pmi/i.test(title) && /manufacturing/i.test(title) },
  { indicatorId: 'PMI_SVC', test: (title) => /pmi/i.test(title) && /(services|non-manufacturing)/i.test(title) },
  // Follow-up to the Calendar/FRED merge (HEVAI_MAKRO_FRESHNESS_FIX): Core PCE has no dedicated
  // fallback of its own (unlike CPI/NFP's BLS fallback), so a past-due "Core PCE" event stayed
  // "Tak tersedia" even though PCEPILFE's real FRED data was already sitting in ECON_INDICATORS.
  // Note: PCEPILFE is fetched/transformed YoY only (see fetchFredSeriesPoints's YoY branch in
  // server.ts) - if ForexFactory ever publishes a SEPARATE "Core PCE ... m/m" row alongside a
  // "... y/y" row (the same split CPI/PPI have), this pattern matches both and the y/y-computed
  // figure would attach to the m/m one too. Checked live before shipping (see the session's audit)
  // and this is a one-line follow-up widening an already-reused pattern, not a new mechanism.
  { indicatorId: 'PCEPILFE', test: (title) => /\bcore pce\b/i.test(title) },
];

// Economic Transmission diagram (Perbaikan 6) - purely conceptual/educational node sequence, not
// a claim about any specific validated data relationship.
const TRANSMISSION_NODES: { key: string; labelKey: string }[] = [
  { key: 'cpi', labelKey: 'econHistory.transmission.cpi' },
  { key: 'inflationExpectations', labelKey: 'econHistory.transmission.inflationExpectations' },
  { key: 'fedPolicy', labelKey: 'econHistory.transmission.fedPolicy' },
  { key: 'treasuryYield', labelKey: 'econHistory.transmission.treasuryYield' },
  { key: 'usd', labelKey: 'econHistory.transmission.usd' },
  { key: 'assets', labelKey: 'econHistory.transmission.assets' },
];

// Exported (Calendar Actual/FRED merge) so EconomicCalendarView.tsx formats a FRED-sourced Actual
// the exact same way this page already does - same sign convention, same per-indicator suffix.
export function formatIndicatorValue(id: CalendarTrackedIndicatorId, v: number | null): string {
  if (v === null || v === undefined) return '—';
  // PCEPILFE isn't one of this page's own PageIndicatorId chips (see the CalendarTrackedIndicatorId
  // comment above), so it has no entry in INDICATOR_SUFFIX/SIGNED_INDICATORS - handled as its own
  // branch instead of adding a meaningless row to those exhaustive Records. Same signed-% shape
  // CPI/PPI already use (ECON_INDICATORS' PCEPILFE entry is unit: 'percent').
  if (id === 'PCEPILFE') {
    const sign = v > 0 ? '+' : '';
    return `${sign}${v}%`;
  }
  const sign = v > 0 && SIGNED_INDICATORS.has(id) ? '+' : '';
  return `${sign}${v}${INDICATOR_SUFFIX[id]}`;
}

/** Buckets an indicator's real releases by calendar year+month (e.g. "2026-7" for Aug 2026,
 * 0-indexed month). If two releases somehow land in the same month, the later one wins. */
function bucketByYearMonth(points: EconHistoryPoint[]): Map<string, EconHistoryPoint> {
  const map = new Map<string, EconHistoryPoint>();
  points.forEach((p) => {
    if (p.actual === null || p.actual === undefined) return;
    const d = new Date(p.date);
    if (isNaN(d.getTime())) return;
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const existing = map.get(key);
    if (!existing || new Date(existing.date).getTime() < d.getTime()) map.set(key, p);
  });
  return map;
}

/** Pearson correlation coefficient between two real value arrays (already aligned 1:1 by
 * overlapping month). Returns null when there isn't enough shared history to mean anything. */
function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 6) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return null;
  return num / Math.sqrt(denX * denY);
}

function correlationColor(v: number | null): string {
  if (v === null) return 'transparent';
  const abs = Math.min(1, Math.abs(v));
  if (v > 0) return `rgba(46,204,113,${0.1 + abs * 0.45})`;
  if (v < 0) return `rgba(255,77,79,${0.1 + abs * 0.45})`;
  return 'rgba(128,128,128,0.1)';
}

/** Deterministic, threshold-based interpretation of a real computed correlation coefficient -
 * never AI-generated, never a fabricated claim, purely a plain-language read of the |r| value. */
function correlationInterpretationKey(r: number): string {
  const abs = Math.abs(r);
  if (abs < 0.15) return 'econHistory.corrNegligible';
  const strength = abs >= 0.7 ? 'Strong' : abs >= 0.4 ? 'Moderate' : 'Weak';
  const sign = r > 0 ? 'Pos' : 'Neg';
  return `econHistory.corr${strength}${sign}`;
}

/** Monotone cubic (Fritsch-Carlson) Hermite interpolation - the same curve family as D3's
 * curveMonotoneX / most chart libraries' "monotone" line mode. Produces smooth bezier segments
 * strictly *between* the given real points; guaranteed not to overshoot past adjacent points, so
 * it never implies a data value that isn't there. Purely a rendering technique - adds no points. */
function monotoneCubicPath(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${points[0].x} ${points[0].y}`;
  if (n === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  const dx: number[] = [];
  const dy: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    dy.push(points[i + 1].y - points[i].y);
    slope.push(dx[i] === 0 ? 0 : dy[i] / dx[i]);
  }

  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    m.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  }
  m.push(slope[n - 2]);

  // Fritsch-Carlson: clip tangents so the interpolant stays monotone between each pair of points.
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = Math.sqrt(a * a + b * b);
    if (h > 3) {
      const t = 3 / h;
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const x0 = points[i].x;
    const y0 = points[i].y;
    const x1 = points[i + 1].x;
    const y1 = points[i + 1].y;
    const cp1x = x0 + dx[i] / 3;
    const cp1y = y0 + (m[i] * dx[i]) / 3;
    const cp2x = x1 - dx[i] / 3;
    const cp2y = y1 - (m[i + 1] * dx[i]) / 3;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x1} ${y1}`;
  }
  return d;
}

/** Splits a node label onto up to 2 short lines for the Transmission diagram's fixed-width SVG
 * columns - short labels ("USD", "CPI") stay on one line; longer ones ("Inflation Expectations")
 * wrap near their midpoint rather than overflowing into the neighbouring node's column. */
function wrapLabel(label: string): string[] {
  if (label.length <= 10) return [label];
  const spaceIdx = label.indexOf(' ', Math.max(0, Math.floor(label.length / 2) - 3));
  if (spaceIdx === -1) return [label];
  return [label.slice(0, spaceIdx), label.slice(spaceIdx + 1)];
}

// ---- Small presentational sub-components ------------------------------------------------------

const MULTI_LINE_COLORS = ['#3B82F6', '#F5B942', '#2ECC71'];

/** One Historical Macro Charts panel (Perbaikan 3) - overlays same-unit indicators as real lines
 * sharing one honest Y-axis, positioned on a real shared TIME axis (not point-index) so lines with
 * different release cadences (e.g. FOMC ~8x/yr vs a monthly series) still align chronologically.
 * Indicators with too little data are simply not drawn (never faked); indicators with an
 * incompatible unit are shown as a plain number below instead of a misleading shared-scale line. */
const MultiLineCategoryChart: React.FC<{
  lines: { id: PageIndicatorId; label: string; points: EconHistoryPoint[] }[];
  separate: { id: PageIndicatorId; label: string; points: EconHistoryPoint[] }[];
  isPmi: boolean;
  collectingLabel: string;
  collectingSubLabel: string;
  locale: string;
}> = ({ lines, separate, isPmi, collectingLabel, collectingSubLabel, locale }) => {
  const w = 300;
  const h = 148;
  const padX = 34;
  const padTop = 12;
  const padBottom = 22;
  const plotRight = w - 8;

  const drawable = lines.map((l) => ({ ...l, pts: l.points.filter((p) => p.actual !== null) })).filter((l) => l.pts.length >= 2);
  const notDrawable = lines.filter((l) => !drawable.find((d) => d.id === l.id));

  const separateLatest = separate.map((s) => {
    const sp = s.points.filter((p) => p.actual !== null);
    return { id: s.id, label: s.label, latest: sp.length > 0 ? sp[sp.length - 1] : null };
  });

  const fmtMonth = (t: number) => {
    const d = new Date(t);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { month: 'short', year: '2-digit' });
  };

  if (drawable.length === 0) {
    return (
      <div>
        <div className="h-9 flex items-center gap-1.5 text-left">
          <span className="text-[10px] text-[var(--text-muted)]">{collectingLabel}</span>
          <span className="text-[9px] text-[var(--text-muted)] opacity-60">· {collectingSubLabel}</span>
        </div>
        {separateLatest.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
            {separateLatest.map((s) => (
              <span key={s.id} className="text-[9px] text-[var(--text-muted)]">
                {s.label}: <span className="font-bold text-[var(--text-secondary)]">{s.latest ? formatIndicatorValue(s.id, s.latest.actual) : collectingLabel}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  const allTimes = drawable.flatMap((l) => l.pts.map((p) => new Date(p.date).getTime())).filter((tm) => !isNaN(tm));
  const minTime = Math.min(...allTimes);
  const maxTime = Math.max(...allTimes);
  const allValues = drawable.flatMap((l) => l.pts.map((p) => p.actual as number));
  let minV = Math.min(...allValues);
  let maxV = Math.max(...allValues);
  if (isPmi) {
    minV = Math.min(minV, 45);
    maxV = Math.max(maxV, 55);
  }
  if (minV === maxV) {
    minV -= 1;
    maxV += 1;
  }
  const range = maxV - minV;
  minV -= range * 0.1;
  maxV += range * 0.1;

  const xScale = (tm: number) => padX + ((plotRight - padX) * (tm - minTime)) / Math.max(1, maxTime - minTime);
  const yScale = (v: number) => padTop + (h - padTop - padBottom) * (1 - (v - minV) / (maxV - minV));
  const pmiY = isPmi ? yScale(50) : null;
  const animKey = drawable.map((l) => `${l.id}:${l.pts.length}:${l.pts[l.pts.length - 1].date}`).join('|');

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-36 overflow-visible">
        {[0.25, 0.5, 0.75].map((r, i) => (
          <line
            key={i}
            x1={padX}
            y1={padTop + (h - padTop - padBottom) * r}
            x2={plotRight}
            y2={padTop + (h - padTop - padBottom) * r}
            stroke="rgba(128,128,128,0.08)"
            strokeDasharray="2 3"
            strokeWidth="0.75"
          />
        ))}
        <text x={padX - 5} y={padTop + 4} fontSize="8" fill="var(--text-muted)" textAnchor="end" fontFamily="monospace">
          {maxV.toFixed(1)}
        </text>
        <text x={padX - 5} y={h - padBottom + 2} fontSize="8" fill="var(--text-muted)" textAnchor="end" fontFamily="monospace">
          {minV.toFixed(1)}
        </text>
        {isPmi && pmiY !== null && <line x1={padX} y1={pmiY} x2={plotRight} y2={pmiY} stroke="var(--color-warn)" strokeDasharray="3 3" strokeWidth="1" opacity={0.7} />}
        {drawable.map((l, li) => {
          const coords = l.pts.map((p) => ({ x: xScale(new Date(p.date).getTime()), y: yScale(p.actual as number) }));
          const lineD = monotoneCubicPath(coords);
          const color = MULTI_LINE_COLORS[li % MULTI_LINE_COLORS.length];
          const areaD = li === 0 ? `${lineD} L ${coords[coords.length - 1].x} ${h - padBottom} L ${coords[0].x} ${h - padBottom} Z` : null;
          return (
            <g key={l.id}>
              {areaD && <path d={areaD} fill={color} opacity={0.05} />}
              <path
                key={`${l.id}-${animKey}`}
                d={lineD}
                fill="none"
                stroke={color}
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1000}
                className="eh-draw-line"
              />
            </g>
          );
        })}
        <text x={xScale(minTime)} y={h - 6} fontSize="8" fill="var(--text-muted)" textAnchor="start" fontFamily="monospace">
          {fmtMonth(minTime)}
        </text>
        <text x={xScale(maxTime)} y={h - 6} fontSize="8" fill="var(--text-muted)" textAnchor="end" fontFamily="monospace">
          {fmtMonth(maxTime)}
        </text>
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
        {drawable.map((l, li) => {
          const latest = l.pts[l.pts.length - 1];
          return (
            <span key={l.id} className="text-[9px] text-[var(--text-muted)] inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: MULTI_LINE_COLORS[li % MULTI_LINE_COLORS.length] }} />
              {l.label} <span className="font-bold text-[var(--text-secondary)]">{formatIndicatorValue(l.id, latest.actual)}</span>
            </span>
          );
        })}
        {notDrawable.map((l) => (
          <span key={l.id} className="text-[9px] text-[var(--text-muted)]">
            {l.label}: {collectingLabel}
          </span>
        ))}
        {separateLatest.map((s) => (
          <span key={s.id} className="text-[9px] text-[var(--text-muted)]">
            {s.label}: <span className="font-bold text-[var(--text-secondary)]">{s.latest ? formatIndicatorValue(s.id, s.latest.actual) : collectingLabel}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

type Stance = 'up' | 'down' | 'neutral' | 'collecting';

const StanceRow: React.FC<{ label: string; value: string; stance: Stance; detail: string; tooltip?: string }> = ({ label, value, stance, detail, tooltip }) => {
  const color = stance === 'up' ? 'var(--color-up)' : stance === 'down' ? 'var(--color-down)' : stance === 'neutral' ? 'var(--text-secondary)' : 'var(--text-muted)';
  const Icon = stance === 'up' ? TrendingUp : stance === 'down' ? TrendingDown : Minus;
  return (
    <div className="py-2.5 border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider inline-flex items-center gap-1">
          {label}
          {/* Fed-stance consistency audit (2026-08-30): only this row's own tooltip is optional -
              other StanceRow callers (USD Strength, XAU Bias) don't pass one and render unchanged.
              Visible (i) icon, not a bare hover title= with no on-screen trigger. */}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        <span className="text-xs font-black inline-flex items-center gap-1" style={{ color }}>
          <Icon className="w-3 h-3" />
          {value}
        </span>
      </div>
      <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">{detail}</p>
    </div>
  );
};

/** Economic Surprise (Actual vs Forecast) as a flat diverging bar (Terminal redesign, P1) - only
 * FRED-sourced indicators (CPI/PPI/UNRATE/NFP/FOMC/GDP) never carry a forecast (FRED doesn't
 * publish consensus figures), so those honestly render "FORECAST —" rather than a fabricated 0.
 * ADP/PMI_MFG/PMI_SVC are archived from the live calendar feed WITH a real forecast, and get the
 * bar. `range` is that indicator's own real min-max span (same concept classifyCategoryTrend's
 * deadzone and the What Changed/What Matters Now ranking both already use) - it turns a raw
 * surprise value into "how big a beat/miss is this, relative to this indicator's own history"
 * rather than an arbitrary fixed scale. */
const SurpriseCell: React.FC<{
  point: EconHistoryPoint | null;
  suffix: string;
  range: number;
  unavailableLabel: string;
}> = ({ point, suffix, range, unavailableLabel }) => {
  if (!point || point.forecast === null || point.surprise === null) {
    return <span className="text-[9px] text-[var(--text-muted)] whitespace-nowrap">{unavailableLabel}</span>;
  }
  const pct = Math.max(-50, Math.min(50, (point.surprise / range) * 50));
  const color = point.surprise > 0 ? 'var(--color-up)' : point.surprise < 0 ? 'var(--color-down)' : 'var(--text-secondary)';
  return (
    <div className="flex items-center justify-end gap-1.5">
      <span className="text-[10px] font-bold tabular-nums whitespace-nowrap" style={{ color }}>
        {point.surprise >= 0 ? '+' : ''}
        {point.surprise}
        {suffix}
      </span>
      <div className="relative w-10 h-2.5 rounded-sm bg-[var(--bg-surface)] overflow-hidden shrink-0">
        <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-strong)]" />
        <span
          className="absolute inset-y-0 rounded-sm"
          style={{
            left: pct >= 0 ? '50%' : `${50 + pct}%`,
            width: `${Math.abs(pct)}%`,
            background: color,
            transition: 'width 300ms cubic-bezier(0.16, 1, 0.3, 1), left 300ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </div>
    </div>
  );
};

const REGIME_COLORS: Record<TrendDir, string> = {
  up: '#3B82F6',
  down: '#F5B942',
  stable: 'var(--text-secondary)',
  collecting: 'var(--text-muted)',
};
const REGIME_ICONS: Record<TrendDir, string> = { up: '▲', down: '▼', stable: '–', collecting: '···' };

// Macro Regime Score methodology (see the regimeScore useMemo below for the full computation):
// which direction is the historically risk-on read for each category. Falling inflation,
// strengthening jobs, accelerating growth, a cutting-bias Fed and expanding PMI are the risk-on
// side; their opposites are risk-off. "Stable" always contributes 0 regardless of category.
const CATEGORY_RISK_ON_DIRECTION: Record<CategoryId, 'up' | 'down'> = {
  inflation: 'down',
  employment: 'up',
  growth: 'up',
  rates: 'down',
  pmi: 'up',
};

export const EconomicHistoryView: React.FC = () => {
  const { t, language } = useTranslation();
  const locale = language === 'id' ? 'id-ID' : 'en-US';

  const [dataMap, setDataMap] = useState<Partial<Record<PageIndicatorId, EconHistoryApiResponse>>>({});
  const [marketContext, setMarketContext] = useState<MarketContextResponse | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<EconomicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<string>('2026');
  const [selectedAsset, setSelectedAsset] = useState<AssetTabId>('XAUUSD');
  const [viewMode, setViewMode] = useState<ViewMode>('deepdive');
  const [macroNarrative, setMacroNarrative] = useState<MacroNarrativeResponse | null>(null);
  const [narrativeLoading, setNarrativeLoading] = useState(true);
  const [expandedIndicator, setExpandedIndicator] = useState<PageIndicatorId | null>(null);
  const [corrPopover, setCorrPopover] = useState<{ rowId: PageIndicatorId; colId: PageIndicatorId } | null>(null);
  // Advanced Analytics (radar chart) collapsible - collapsed by default on mobile so the page
  // doesn't scroll past a chart most users won't dig into, expanded by default on desktop where
  // there's room. Purely a display default, not a hard cutoff - user can toggle either way.
  const [advancedOpen, setAdvancedOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true));
  // AI Macro Narrative (Terminal redesign, P0): collapsed by default - only a one-sentence summary
  // shows until the reader explicitly asks for the full analyst note (whatHappened/whyItMatters/
  // marketImpactTable/whatToWatch, unchanged content, just hidden behind this toggle).
  const [analystNoteOpen, setAnalystNoteOpen] = useState(false);

  // PRIORITY 1b (2026-08-26 audit): this used to fetch once on mount and never again - even after
  // shortening the server's FRED_CACHE_DURATION_MS and adding targeted invalidation on a fresh
  // calendar Actual (server.ts), a reader who had this page open before a release would keep
  // looking at pre-release numbers until they manually reloaded, since nothing here ever asked the
  // server for new data. Polled every 10 minutes now - inside the server's cache window (30 min)
  // often enough to catch a release-triggered invalidation soon after it fires, without adding a
  // background fetch on every render. `isBackgroundRefresh` skips the loading skeleton so a
  // silent poll never flashes the whole page back to a loading state while someone is reading it;
  // `setError(null)` still runs so a refresh that recovers from a prior failure clears the banner.
  useEffect(() => {
    let isMounted = true;

    const load = async (isBackgroundRefresh: boolean) => {
      if (!isBackgroundRefresh) {
        setLoading(true);
        setError(null);
      }

      try {
        const [entries, snap, cal] = await Promise.all([
          Promise.all(
            FETCH_INDICATOR_IDS.map((id) => {
              const calendarWindow = CALENDAR_WINDOW_INDICATOR_IDS.has(id) ? '&calendarWindow=1' : '';
              return fetch(`/api/economic-history?indicator=${id}&currency=USD&months=24${calendarWindow}`)
                .then((res) => res.json())
                .then((json: EconHistoryApiResponse) => [id, json] as const)
                .catch(() => [id, null] as const);
            })
          ),
          fetch('/api/economic-history/market-context')
            .then((res) => res.json())
            .catch(() => null),
          fetch('/api/calendar')
            .then((res) => res.json())
            .catch(() => null),
        ]);

        if (!isMounted) return;
        const map: Partial<Record<PageIndicatorId, EconHistoryApiResponse>> = {};
        let anySuccess = false;
        entries.forEach(([id, json]) => {
          if (json) {
            map[id] = json;
            if (json.success) anySuccess = true;
          }
        });
        setDataMap(map);
        setMarketContext(snap && snap.success ? snap : null);
        setCalendarEvents(cal && Array.isArray(cal.events) ? cal.events : []);
        if (!anySuccess) setError(t('econHistory.fetchError'));
        else setError(null);
      } catch {
        if (isMounted) setError(t('econHistory.fetchError'));
      } finally {
        if (isMounted && !isBackgroundRefresh) setLoading(false);
      }
    };

    load(false);
    const interval = setInterval(() => load(true), 10 * 60_000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [t]);

  // AI Macro Narrative - fetched separately from the rest of the page's data (Gemini can be
  // slower than the FRED reads) so it never blocks the main loading spinner. Fails silently to
  // null - the short USD/XAU/Fed labels below still work on their own either way.
  useEffect(() => {
    let isMounted = true;
    setNarrativeLoading(true);
    fetch('/api/economic-history/macro-narrative')
      .then((res) => res.json())
      .then((json: MacroNarrativeResponse) => {
        if (isMounted) setMacroNarrative(json);
      })
      .catch(() => {
        if (isMounted) setMacroNarrative(null);
      })
      .finally(() => {
        if (isMounted) setNarrativeLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const needsSetup = useMemo(() => CHIP_INDICATOR_IDS.some((id) => dataMap[id]?.needsSetup), [dataMap]);

  // ---- Monthly table -----------------------------------------------------------------------------
  const bucketsById = useMemo(() => {
    const out = {} as Record<PageIndicatorId, Map<string, EconHistoryPoint>>;
    FETCH_INDICATOR_IDS.forEach((id) => {
      out[id] = bucketByYearMonth(dataMap[id]?.points || []);
    });
    return out;
  }, [dataMap]);

  const monthLabels = useMemo(
    () => Array.from({ length: 12 }).map((_, m) => new Date(Date.UTC(2020, m, 1)).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })),
    [locale]
  );

  // Latest/previous/change per indicator (Perbaikan 2) - from the full fetched series, not
  // year-filtered, matching how "latest" is defined everywhere else on this page.
  const monthlyChangeById = useMemo(() => {
    const out = {} as Record<PageIndicatorId, { latest: EconHistoryPoint | null; previous: EconHistoryPoint | null; change: number | null }>;
    CHIP_INDICATOR_IDS.forEach((id) => {
      const points = (dataMap[id]?.points || []).filter((p) => p.actual !== null);
      const latest = points.length > 0 ? points[points.length - 1] : null;
      const previous = points.length > 1 ? points[points.length - 2] : null;
      const change = latest && previous && latest.actual !== null && previous.actual !== null ? Number((latest.actual - previous.actual).toFixed(2)) : null;
      out[id] = { latest, previous, change };
    });
    return out;
  }, [dataMap]);

  // ---- Category data (shared by Macro Regime + Historical Macro Charts) -------------------------
  const categorySeries = useMemo(
    () =>
      CATEGORIES.map((cat) => {
        const [primaryId] = cat.indicators;
        return {
          ...cat,
          primaryPoints: dataMap[primaryId]?.points || [],
        };
      }),
    [dataMap]
  );

  const categoryChartSeries = useMemo(
    () =>
      CATEGORY_CHART_CONFIG.map((cat) => ({
        ...cat,
        lines: cat.lineIndicators.map((id) => ({ id, label: t(INDICATOR_LABEL_KEYS[id]), points: dataMap[id]?.points || [] })),
        separate: cat.separateIndicators.map((id) => ({ id, label: t(INDICATOR_LABEL_KEYS[id]), points: dataMap[id]?.points || [] })),
      })),
    [dataMap, t]
  );

  // ---- Macro Regime Summary strip - categorical direction only, never a numeric score ----------
  const macroRegime = useMemo(
    () =>
      categorySeries.map((cat) => ({
        id: cat.id,
        labelKey: cat.shortLabelKey,
        direction: classifyCategoryTrend(cat.primaryPoints),
      })),
    [categorySeries]
  );

  // Up to 3 real driver labels for the Market Impact panel (Perbaikan 1) - directly reuses the
  // Macro Regime directions above, never a separate/fabricated per-asset factor.
  const macroDrivers = useMemo(
    () =>
      macroRegime
        .filter((r) => r.direction !== 'collecting')
        .slice(0, 3)
        .map((r) => `${t(r.labelKey)}: ${t(REGIME_LABEL_KEYS[r.id][r.direction as Exclude<TrendDir, 'collecting'>])}`),
    [macroRegime, t]
  );

  // ---- Macro Overview strip data (Terminal redesign, P0) - same categorySeries/macroRegime this
  // file already computes, just packaged in OVERVIEW_STRIP_ORDER with the lead indicator's latest
  // formatted value and its own raw value history for a small trend line. No new fetch, no new
  // classification rule.
  const overviewStripData = useMemo(
    () =>
      OVERVIEW_STRIP_ORDER.map((catId) => {
        const cat = categorySeries.find((c) => c.id === catId)!;
        const regime = macroRegime.find((r) => r.id === catId)!;
        const primaryId = cat.indicators[0];
        const points = cat.primaryPoints.filter((p) => p.actual !== null);
        const latest = points.length > 0 ? (points[points.length - 1].actual as number) : null;
        return {
          id: catId,
          labelKey: cat.shortLabelKey,
          direction: regime.direction,
          conditionKey: regime.direction === 'collecting' ? null : REGIME_LABEL_KEYS[catId][regime.direction as Exclude<TrendDir, 'collecting'>],
          valueLabel: latest === null ? null : formatIndicatorValue(primaryId, latest),
          trend: points.slice(-12).map((p) => p.actual as number),
        };
      }),
    [categorySeries, macroRegime]
  );

  // ---- Macro Regime Score (Terminal redesign, P0) - a single 0-100 composite read purely off the
  // 5 classifyCategoryTrend() directions above, never a separate model or fabricated confidence.
  // Methodology (disclosed in econHistory.regimeScoreMethod, one sentence): each category
  // contributes +1 when its direction is the historically risk-on read for that category (falling
  // inflation, strengthening jobs, accelerating growth, a cutting-bias Fed, expanding PMI), -1 for
  // the opposite (risk-off) direction, 0 for "stable"; a "collecting" category is excluded from
  // the divisor entirely rather than counted as neutral. The sum is then normalized to a 0-100
  // scale centred on 50. Purely historical/descriptive - never a forecast.
  const regimeScore = useMemo(() => {
    let sum = 0;
    let active = 0;
    macroRegime.forEach((r) => {
      if (r.direction === 'collecting') return;
      active++;
      if (r.direction === 'stable') return;
      sum += r.direction === CATEGORY_RISK_ON_DIRECTION[r.id] ? 1 : -1;
    });
    if (active === 0) return { value: null, active, total: macroRegime.length };
    const value = Math.max(0, Math.min(100, 50 + (sum / active) * 50));
    return { value, active, total: macroRegime.length };
  }, [macroRegime]);
  const regimeStateKey =
    regimeScore.value === null ? 'econHistory.collectingConclusion' : regimeScore.value < 40 ? 'econHistory.riskOff' : regimeScore.value > 60 ? 'econHistory.riskOn' : 'econHistory.riskNeutral';
  const regimeStateColor =
    regimeScore.value === null ? 'var(--text-muted)' : regimeScore.value < 40 ? 'var(--color-down)' : regimeScore.value > 60 ? 'var(--color-up)' : 'var(--text-secondary)';

  // ---- "What Changed?" / "What Matters Now" (Terminal redesign, P1) - both read off the exact
  // same ranked list: each category's latest-vs-previous-release delta, normalized by that
  // category's own real min-max range over the loaded window (the same "range" concept
  // classifyCategoryTrend already uses internally for its deadzone) so a CPI move in % and an NFP
  // move in thousands can be honestly ranked against each other by "how big a move is this,
  // relative to this indicator's own recent history" rather than raw unit magnitude. "What
  // Changed" = rank #1; "What Matters Now" = the top 3 (disclosed rule: largest normalized
  // |delta| since the previous release - no free-text/AI selection).
  const categoryDeltaRanked = useMemo(() => {
    return categorySeries
      .map((cat) => {
        const points = cat.primaryPoints.filter((p) => p.actual !== null);
        if (points.length < 2) return null;
        const values = points.map((p) => p.actual as number);
        const latest = values[values.length - 1];
        const previous = values[values.length - 2];
        const delta = latest - previous;
        const range = Math.max(...values) - Math.min(...values) || 1;
        return {
          id: cat.id,
          labelKey: cat.shortLabelKey,
          primaryId: cat.indicators[0],
          latest,
          previous,
          delta,
          normalizedDelta: delta / range,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => Math.abs(b.normalizedDelta) - Math.abs(a.normalizedDelta));
  }, [categorySeries]);

  // ---- Macro momentum mini-heatmap (Terminal redesign, P1) - classifyTrendAtLookback at 1/3/6/12
  // releases back per category. A cell is only ever a real direction or an explicit "insufficient
  // sample" mark (null) - never guessed when a category's loaded history doesn't reach that far
  // back yet.
  const momentumGrid = useMemo(
    () =>
      categorySeries.map((cat) => ({
        id: cat.id,
        labelKey: cat.shortLabelKey,
        windows: MOMENTUM_WINDOWS.map((w) => ({ key: w.key, label: w.label, direction: classifyTrendAtLookback(cat.primaryPoints, w.lookback) })),
      })),
    [categorySeries]
  );

  // ---- Market Summary & Interpretation ------------------------------------------------------------
  const summary = useMemo(() => {
    const fomcPoints = (dataMap.FOMC?.points || []).filter((p) => p.actual !== null);
    const yieldPoints = (dataMap.DGS10?.points || []).filter((p) => p.actual !== null);
    const dxyTrend = marketContext?.dxyPanel?.trend15mPercent ?? null;

    const fomcDelta = fomcPoints.length >= 2 ? (fomcPoints[fomcPoints.length - 1].actual as number) - (fomcPoints[fomcPoints.length - 2].actual as number) : null;
    const yieldDelta = yieldPoints.length >= 2 ? (yieldPoints[yieldPoints.length - 1].actual as number) - (yieldPoints[yieldPoints.length - 2].actual as number) : null;

    let usdScore = 0;
    let usdSignals = 0;
    if (fomcDelta !== null && fomcDelta !== 0) {
      usdScore += Math.sign(fomcDelta);
      usdSignals++;
    }
    if (yieldDelta !== null && yieldDelta !== 0) {
      usdScore += Math.sign(yieldDelta);
      usdSignals++;
    }
    if (dxyTrend !== null && dxyTrend !== 0) {
      usdScore += Math.sign(dxyTrend);
      usdSignals++;
    }
    const usdStance: Stance = usdSignals === 0 ? 'collecting' : usdScore > 0 ? 'up' : usdScore < 0 ? 'down' : 'neutral';
    const usdDetailParts: string[] = [];
    if (fomcDelta !== null) usdDetailParts.push(`${t('econHistory.usdDetailFomc')} ${fomcDelta >= 0 ? '+' : ''}${fomcDelta.toFixed(2)}%`);
    if (yieldDelta !== null) usdDetailParts.push(`${t('econHistory.usdDetailYield')} ${yieldDelta >= 0 ? '+' : ''}${yieldDelta.toFixed(2)}pp`);
    if (dxyTrend !== null) usdDetailParts.push(`${t('econHistory.usdDetailDxy')} ${dxyTrend >= 0 ? '+' : ''}${dxyTrend.toFixed(2)}%`);

    const priceComparison = marketContext?.priceComparison || null;
    const pctVs7d = priceComparison && priceComparison.daysAvailable >= 7 ? priceComparison.pctVs7d : null;
    const xauStance: Stance = pctVs7d === null ? 'collecting' : pctVs7d > 0.5 ? 'up' : pctVs7d < -0.5 ? 'down' : 'neutral';
    const xauDetail = pctVs7d !== null ? `${pctVs7d >= 0 ? '+' : ''}${pctVs7d.toFixed(2)}% ${t('econHistory.xauDetail7d')}` : t('econHistory.collectingConclusion');

    const recentFomc = fomcPoints.filter((p) => p.previous !== null).slice(-6);
    let hikes = 0;
    let cuts = 0;
    let holds = 0;
    recentFomc.forEach((p) => {
      const actual = p.actual as number;
      const prev = p.previous as number;
      if (actual > prev) hikes++;
      else if (actual < prev) cuts++;
      else holds++;
    });
    const fedStance: Stance = recentFomc.length === 0 ? 'collecting' : hikes > cuts ? 'up' : cuts > hikes ? 'down' : 'neutral';
    const fedDetail =
      recentFomc.length === 0
        ? t('econHistory.collectingConclusion')
        : `${hikes} ${t('econHistory.fedDetailHikes')}, ${cuts} ${t('econHistory.fedDetailCuts')}, ${holds} ${t('econHistory.fedDetailHolds')} ${t('econHistory.fedDetailWindow').replace('{n}', String(recentFomc.length))}`;

    return {
      usdStance,
      usdValue: usdStance === 'up' ? t('econHistory.usdStrong') : usdStance === 'down' ? t('econHistory.usdWeak') : usdStance === 'neutral' ? t('econHistory.usdNeutral') : t('econHistory.collectingConclusion'),
      usdDetail: usdDetailParts.length > 0 ? usdDetailParts.join(' · ') : t('econHistory.collectingConclusion'),
      xauStance,
      xauValue: xauStance === 'up' ? t('econHistory.xauBullish') : xauStance === 'down' ? t('econHistory.xauBearish') : xauStance === 'neutral' ? t('econHistory.xauNeutral') : t('econHistory.collectingConclusion'),
      xauDetail,
      fedStance,
      fedValue: fedStance === 'up' ? t('econHistory.fedHawkish') : fedStance === 'down' ? t('econHistory.fedDovish') : fedStance === 'neutral' ? t('econHistory.fedNeutral') : t('econHistory.collectingConclusion'),
      fedDetail,
    };
  }, [dataMap, marketContext, t]);

  // Per-asset Bias badge for the Market Impact tabs (Perbaikan 1) - USD/XAUUSD reuse the real
  // computed stances above; BTC/Forex have no asset-specific computation in this system, so their
  // "bias" honestly reads as the same USD stance framed as context, never an invented BTC/FX score.
  const assetBias = useMemo(() => {
    const usd = { stance: summary.usdStance, value: summary.usdValue };
    const xau = { stance: summary.xauStance, value: summary.xauValue };
    return {
      USD: usd,
      XAUUSD: xau,
      BTCUSDT: usd,
      FOREX: usd,
    } as Record<AssetTabId, { stance: Stance; value: string }>;
  }, [summary]);

  // 1-sentence interpretation per asset (Perbaikan 1) - prefers the AI narrative's per-asset
  // reason when available (already grounded/cached server-side); falls back to a deterministic
  // sentence built from the real driver labels above when AI isn't available.
  const assetInterpretation = useMemo(() => {
    const out: Record<AssetTabId, string> = { USD: '', XAUUSD: '', BTCUSDT: '', FOREX: '' };
    ASSET_TABS.forEach((tab) => {
      const narrativeAsset = ASSET_TAB_TO_NARRATIVE_ASSET[tab.id];
      const row = macroNarrative?.narrative?.marketImpactTable.find((r) => r.asset.toUpperCase() === narrativeAsset);
      if (row?.reason) {
        out[tab.id] = row.reason;
      } else if (macroDrivers.length > 0) {
        out[tab.id] = `${t(tab.labelKey)}: ${macroDrivers.join(' · ')}.`;
      } else {
        out[tab.id] = t('econHistory.collectingConclusion');
      }
    });
    return out;
  }, [macroNarrative, macroDrivers, t]);

  // ---- Correlation matrix (with sample size, for the click-popover) -------------------------------
  const correlationMatrix = useMemo(() => {
    return CHIP_INDICATOR_IDS.map((rowId) => {
      const rowMap = bucketsById[rowId] || new Map<string, EconHistoryPoint>();
      return CHIP_INDICATOR_IDS.map((colId) => {
        if (rowId === colId) return { r: 1, n: rowMap.size };
        const colMap = bucketsById[colId] || new Map<string, EconHistoryPoint>();
        const sharedKeys = Array.from(rowMap.keys()).filter((k) => colMap.has(k));
        const xs = sharedKeys.map((k) => rowMap.get(k)!.actual as number);
        const ys = sharedKeys.map((k) => colMap.get(k)!.actual as number);
        return { r: pearsonCorrelation(xs, ys), n: sharedKeys.length };
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucketsById]);

  // ---- Radar chart -----------------------------------------------------------------------------
  const radarAxes = useMemo(() => {
    return CATEGORIES.map((cat) => {
      const scores: number[] = [];
      cat.indicators.forEach((id) => {
        const points = (dataMap[id]?.points || []).filter((p) => p.actual !== null);
        if (points.length < 3) return;
        const values = points.map((p) => p.actual as number);
        const minV = Math.min(...values);
        const maxV = Math.max(...values);
        const latest = values[values.length - 1];
        if (maxV === minV) {
          scores.push(50);
        } else {
          scores.push(((latest - minV) / (maxV - minV)) * 100);
        }
      });
      const hasData = scores.length > 0;
      const value = hasData ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      return { id: cat.id, labelKey: cat.labelKey, shortLabelKey: cat.shortLabelKey, value, hasData };
    });
  }, [dataMap]);

  const radarCollectingLabels = useMemo(() => radarAxes.filter((a) => !a.hasData).map((a) => t(a.labelKey)), [radarAxes, t]);

  // ---- Radar geometry -------------------------------------------------------------------------
  const radarGeom = useMemo(() => {
    const cx = 190;
    const cy = 165;
    const maxR = 96;
    const n = radarAxes.length;
    const axisPoint = (i: number, r: number) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    };
    const rings = [0.25, 0.5, 0.75, 1].map((ratio) =>
      Array.from({ length: n })
        .map((_, i) => {
          const p = axisPoint(i, maxR * ratio);
          return `${p.x},${p.y}`;
        })
        .join(' ')
    );
    const axisLines = Array.from({ length: n }).map((_, i) => axisPoint(i, maxR));
    const labelPoints = Array.from({ length: n }).map((_, i) => axisPoint(i, maxR * 1.28));
    const dataPoly = radarAxes.map((a, i) => axisPoint(i, maxR * Math.max(0, Math.min(1, a.value / 100)))).map((p) => `${p.x},${p.y}`).join(' ');
    return { cx, cy, maxR, rings, axisLines, labelPoints, dataPoly };
  }, [radarAxes]);

  const radarAnimKey = useMemo(() => radarAxes.map((a) => `${a.id}:${a.hasData ? a.value.toFixed(0) : 'x'}`).join('|'), [radarAxes]);

  // ---- Event Intelligence (Perbaikan 5) - upcoming tracked releases only, real data only ---------
  const upcomingEvents = useMemo(() => {
    const now = Date.now();
    return calendarEvents
      .filter((e) => e.currency === 'USD' && new Date(e.dateISO).getTime() > now)
      .map((evt) => ({ evt, pattern: EVENT_MATCH_PATTERNS.find((p) => p.test(evt.event)) }))
      .filter((x): x is { evt: EconomicEvent; pattern: (typeof EVENT_MATCH_PATTERNS)[number] } => Boolean(x.pattern))
      .sort((a, b) => new Date(a.evt.dateISO).getTime() - new Date(b.evt.dateISO).getTime())
      .slice(0, 6);
  }, [calendarEvents]);

  if (loading) {
    return (
      <div className="space-y-4 animate-in fade-in duration-200 text-xs font-mono">
        <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] p-10 flex flex-col items-center justify-center gap-3">
          <div className="w-6 h-6 border-2 border-[var(--border-subtle)] border-t-[var(--color-brand)] rounded-full animate-spin" />
          <span className="text-[var(--text-muted)] text-xs">{t('econHistory.loadingAll')}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 animate-in fade-in duration-200 text-xs font-mono">
        <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] p-10 flex flex-col items-center justify-center gap-2 text-center">
          <AlertTriangle className="w-6 h-6 text-[var(--color-down)]" />
          <span className="text-[var(--text-secondary)] text-xs">{error}</span>
        </div>
      </div>
    );
  }

  // !p-0: every call site below already appends its own padding utility (p-3, p-3 lg:p-4, or none
  // for a divide-y list) - hev-card-v2's own fixed padding would otherwise override those per-
  // instance choices since a plain CSS class beats a Tailwind utility of equal position.
  const cardClass = 'hev-card-v2 !p-0 border border-[var(--border-subtle)] rounded-[14px]';
  const corrCell = corrPopover ? correlationMatrix[CHIP_INDICATOR_IDS.indexOf(corrPopover.rowId)][CHIP_INDICATOR_IDS.indexOf(corrPopover.colId)] : null;

  return (
    <div className="space-y-4 animate-in fade-in duration-200 text-xs font-mono">
      {/* Smooth draw-in animation for chart lines - shared keyframe, restarts whenever a path's
          React key changes (i.e. whenever the underlying real data it draws actually changes). */}
      <style>{`
        @keyframes eh-draw-line { to { stroke-dashoffset: 0; } }
        .eh-draw-line { stroke-dasharray: 1000; stroke-dashoffset: 1000; animation: eh-draw-line 1.1s cubic-bezier(0.4,0,0.2,1) forwards; }
      `}</style>

      {/* 1. HEADER: one compact line - page label + live state + source note, year selector, and
          the Overview/Deep Dive toggle. Replaces the old two-tier header (long static sentence +
          selector row) with the same controls in less vertical space. */}
      <div className={`${cardClass} px-3 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2`}>
        <div className="flex items-center gap-2 min-w-0">
          <Activity className="w-3.5 h-3.5 text-[var(--color-brand)] shrink-0" />
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)] whitespace-nowrap">
            {t('econHistory.pageHeaderLabel')}
          </span>
          <span className="text-[var(--border-strong)] hidden sm:inline">|</span>
          <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider hidden sm:inline whitespace-nowrap">
            {t('econHistory.usMacroDataLabel')}
          </span>
          <LivePulseDot className="hidden sm:inline-flex" />
          <InfoTooltip text={t('econHistory.usdOnlyNote')} />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-wider mr-1">{t('econHistory.yearLabel')}</span>
            {YEARS.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setSelectedYear(y)}
                className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all duration-200 cursor-pointer ${
                  selectedYear === y ? 'bg-[var(--text-primary)] text-[var(--bg-base)] font-black' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-wider mr-1">{t('econHistory.viewModeLabel')}</span>
            {(['overview', 'deepdive'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all duration-200 cursor-pointer ${
                  viewMode === mode ? 'bg-[var(--text-primary)] text-[var(--bg-base)] font-black' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
                }`}
              >
                {mode === 'overview' ? t('econHistory.viewModeOverview') : t('econHistory.viewModeDeepDive')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 1b. MACRO OVERVIEW: compact 5-category strip (label + direction + lead-indicator value)
          plus the Macro Regime Score bar - both derived purely from the same classifyCategoryTrend()
          directions already computed above (overviewStripData / regimeScore), never a separate or
          fabricated figure. Always visible (both Overview and Deep Dive). */}
      <div className={`${cardClass} p-3`}>
        <h2 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5 mb-2">
          <Gauge className="w-3.5 h-3.5 text-[var(--color-brand)]" />
          {t('econHistory.macroOverviewTitle')}
          {/* Bug fix (2026-08-26): explicit window label so this never reads as contradicting
              "What Changed?" below - same data, different comparison window, disclosed here. */}
          <span className="font-normal normal-case tracking-normal text-[var(--text-muted)]">· {t('econHistory.macroOverviewSubtitle')}</span>
        </h2>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pb-2.5 mb-2.5 border-b border-[var(--border-subtle)]">
          {overviewStripData.map((item, i) => (
            <React.Fragment key={item.id}>
              {i > 0 && <span className="hidden sm:inline text-[var(--border-strong)]">|</span>}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{t(item.labelKey)}</span>
                <span className="text-[10px] font-bold whitespace-nowrap" style={{ color: REGIME_COLORS[item.direction] }}>
                  {REGIME_ICONS[item.direction]} {item.conditionKey ? t(item.conditionKey) : t('econHistory.collectingConclusion')}
                </span>
                {item.valueLabel !== null && <span className="text-[10px] font-bold tabular-nums text-[var(--text-primary)]">{item.valueLabel}</span>}
              </div>
            </React.Fragment>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{t('econHistory.regimeScoreLabel')}</span>
            <InfoTooltip text={t('econHistory.regimeScoreMethod')} />
          </div>
          <div className="flex-1 min-w-[120px] max-w-[280px]">
            <div className="h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${regimeScore.value ?? 0}%`, background: 'var(--color-warn)', transition: 'width 400ms cubic-bezier(0.16,1,0.3,1)' }}
              />
            </div>
          </div>
          <span className="text-sm font-black tabular-nums" style={{ color: 'var(--color-warn)' }}>
            {regimeScore.value === null ? '—' : Math.round(regimeScore.value)}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: regimeStateColor }}>
            {t(regimeStateKey)}
          </span>
          <span className="text-[9px] text-[var(--text-muted)] whitespace-nowrap">{t('econHistory.regimeScoreScale')}</span>
        </div>
        <p className="text-[9px] text-[var(--text-muted)] italic mt-1.5">
          {t('econHistory.regimeScoreDisclaimer')}
          {regimeScore.active < regimeScore.total ? ` · ${regimeScore.active}/${regimeScore.total} ${t('econHistory.regimeScoreActiveNote')}` : ''}
        </p>
      </div>

      {/* 1c. WHAT CHANGED / WHAT MATTERS NOW (Terminal redesign, P1) - both read off
          categoryDeltaRanked: each category's latest-vs-previous delta, normalized by its own real
          historical range. "What Changed" highlights rank #1; "What Matters Now" is the disclosed
          top-3 (never a free/AI selection). Always visible (both Overview and Deep Dive). */}
      {categoryDeltaRanked.length > 0 && (
        <div className={`${cardClass} p-3 lg:p-4`}>
          <h2 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-[var(--color-brand)]" />
            {t('econHistory.whatChangedTitle')}
            {/* Bug fix (2026-08-26): pairs with the Macro Overview subtitle above - this panel is
                the 1-release window, that one is the 3-release window; same source data. */}
            <span className="text-[10px] font-normal text-[var(--text-muted)]">· {t('econHistory.whatChangedSubtitle')}</span>
          </h2>
          {(() => {
            const top = categoryDeltaRanked[0];
            const dir: TrendDir = top.delta > 0 ? 'up' : top.delta < 0 ? 'down' : 'stable';
            const rounded = Number(top.delta.toFixed(2));
            return (
              <p className="text-[11px] text-[var(--text-secondary)] mt-1 mb-3">
                <span className="font-bold uppercase tracking-wide text-[var(--text-muted)]">{t(top.labelKey)}</span>{' '}
                <span className="font-bold" style={{ color: REGIME_COLORS[dir] }}>
                  {REGIME_ICONS[dir]} {rounded >= 0 ? '+' : ''}
                  {rounded}
                  {INDICATOR_SUFFIX[top.primaryId]}
                </span>{' '}
                — {t('econHistory.whatChangedSince')}
              </p>
            );
          })()}

          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{t('econHistory.whatMattersTitle')}</span>
            <InfoTooltip text={t('econHistory.whatMattersMethod')} />
          </div>
          <div className="flex flex-wrap gap-2">
            {categoryDeltaRanked.slice(0, 3).map((r, i) => {
              const dir: TrendDir = r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : 'stable';
              const rounded = Number(r.delta.toFixed(2));
              return (
                <div key={r.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                  <span className="text-[9px] font-black text-[var(--text-muted)] tabular-nums">#{i + 1}</span>
                  <div>
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{t(r.labelKey)}</span>
                    <span className="text-[10px] font-bold tabular-nums whitespace-nowrap" style={{ color: REGIME_COLORS[dir] }}>
                      {REGIME_ICONS[dir]} {rounded >= 0 ? '+' : ''}
                      {rounded}
                      {INDICATOR_SUFFIX[r.primaryId]}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. MERGED PANEL: Macro Regime -> Market Impact selector (bias+drivers+interpretation) ->
          AI Narrative (structured) -> stance labels, one panel with internal dividers. */}
      <div className={`${cardClass} divide-y divide-[var(--border-subtle)]`}>
        {/* Macro Regime - per-category direction + a real mini trend line (last 12 loaded readings
            of that category's own lead indicator), never a numeric score here (the composite score
            lives in the Macro Overview panel above, from the exact same directions). */}
        <div className="p-3 lg:p-4">
          <h2 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Gauge className="w-3.5 h-3.5 text-[var(--color-brand)]" />
            {t('econHistory.macroRegimeTitle')}
          </h2>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5 mb-2">{t('econHistory.macroRegimeSub')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {macroRegime.map((r) => {
              const trendValues = (categorySeries.find((c) => c.id === r.id)?.primaryPoints ?? [])
                .filter((p) => p.actual !== null)
                .slice(-12)
                .map((p) => p.actual as number);
              return (
                <div key={r.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                  <div className="min-w-0">
                    <span className="block text-[9px] text-[var(--text-muted)] uppercase tracking-wide">{t(r.labelKey)}</span>
                    <span className="text-[10px] font-bold whitespace-nowrap" style={{ color: REGIME_COLORS[r.direction] }}>
                      {REGIME_ICONS[r.direction]} {r.direction === 'collecting' ? t('econHistory.collectingConclusion') : t(REGIME_LABEL_KEYS[r.id][r.direction])}
                    </span>
                  </div>
                  {trendValues.length >= 2 && <Sparkline values={trendValues} width={44} height={18} color={REGIME_COLORS[r.direction]} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Market Impact selector (Perbaikan 1: bias + drivers + interpretation per asset) */}
        <div className="p-3 lg:p-4">
          <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Info className="w-4 h-4 text-[var(--color-up)]" />
            {t('econHistory.summaryTitle')}
          </h2>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5 mb-2">{t('econHistory.summaryInputsNote')}</p>

          <div className="flex flex-wrap gap-1 mb-2">
            {ASSET_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedAsset(tab.id)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all duration-200 cursor-pointer ${
                  selectedAsset === tab.id ? 'bg-[var(--text-primary)] text-[var(--bg-base)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
                }`}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </div>

          {(() => {
            const bias = assetBias[selectedAsset];
            const biasColor = bias.stance === 'up' ? 'var(--color-up)' : bias.stance === 'down' ? 'var(--color-down)' : bias.stance === 'neutral' ? 'var(--text-secondary)' : 'var(--text-muted)';
            return (
              <div className="mb-2.5 p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">{t('econHistory.biasLabel')}</span>
                  <span className="text-xs font-black" style={{ color: biasColor }}>
                    {bias.value}
                  </span>
                </div>
                {macroDrivers.length > 0 ? (
                  <div className="mb-1.5">
                    <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block mb-1">{t('econHistory.driversLabel')}</span>
                    <ul className="space-y-0.5">
                      {macroDrivers.map((d, i) => (
                        <li key={i} className="text-[10px] text-[var(--text-secondary)] flex items-start gap-1">
                          <span className="text-[var(--text-muted)]">·</span>
                          {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-[10px] text-[var(--text-muted)] mb-1.5">{t('econHistory.collectingConclusion')}</p>
                )}
                <div>
                  <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block mb-0.5">{t('econHistory.interpretationLabel')}</span>
                  <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">{assetInterpretation[selectedAsset]}</p>
                </div>
                {(selectedAsset === 'BTCUSDT' || selectedAsset === 'FOREX') && (
                  <p className="text-[9px] text-[var(--text-muted)] italic mt-1.5 leading-relaxed">
                    {t(selectedAsset === 'BTCUSDT' ? 'econHistory.assetNoteBtc' : 'econHistory.assetNoteForex')}
                  </p>
                )}
              </div>
            );
          })()}

          {/* AI Macro Narrative (Terminal redesign, P0) - the old always-expanded two-paragraph
              block (whatHappened + whyItMatters, each 2-4 sentences) is replaced with one real
              sentence (a deterministic substring of the same AI-generated whatHappened text - the
              first sentence, not a re-summary) plus a [VIEW ANALYST NOTE] toggle. Nothing is
              deleted: the full whatHappened/whyItMatters/marketImpactTable/whatToWatch content
              below is exactly what used to render unconditionally, just collapsed by default. The
              compact per-category icon row (Macro Regime, directly above this panel) already
              covers the "which categories moved which way" read, so it isn't repeated a third time
              here. */}
          {narrativeLoading ? (
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] py-2">
              <div className="w-3 h-3 border-2 border-[var(--border-subtle)] border-t-[var(--color-brand)] rounded-full animate-spin" />
              {t('econHistory.narrativeLoading')}
            </div>
          ) : macroNarrative?.narrative ? (
            (() => {
              const firstSentence = macroNarrative.narrative.whatHappened.split(/(?<=[.!?])\s+/)[0] || macroNarrative.narrative.whatHappened;
              return (
                <div className="mb-2.5 p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] text-[var(--text-primary)] leading-relaxed flex-1">{firstSentence}</p>
                    <button
                      type="button"
                      onClick={() => setAnalystNoteOpen((v) => !v)}
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--border-subtle)] text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)] transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <FileText className="w-3 h-3" />
                      {analystNoteOpen ? t('econHistory.analystNoteHide') : t('econHistory.analystNoteShow')}
                    </button>
                  </div>

                  {analystNoteOpen && (
                    <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                      <div>
                        <span className="text-[9px] text-[var(--color-brand)] uppercase tracking-wider font-bold block mb-0.5">{t('econHistory.whatHappenedLabel')}</span>
                        <p className="text-[11px] text-[var(--text-primary)] leading-relaxed">{macroNarrative.narrative.whatHappened}</p>
                      </div>
                      <div>
                        <span className="text-[9px] text-[var(--color-warn)] uppercase tracking-wider font-bold block mb-0.5">{t('econHistory.whyItMattersLabel')}</span>
                        <p className="text-[11px] text-[var(--text-primary)] leading-relaxed">{macroNarrative.narrative.whyItMatters}</p>
                      </div>
                      {macroNarrative.narrative.marketImpactTable.length > 0 && (
                        <div>
                          <span className="text-[9px] text-[var(--color-up)] uppercase tracking-wider font-bold block mb-1">{t('econHistory.marketImpactLabel')}</span>
                          <div className="overflow-x-auto">
                            <table className="border-collapse text-[10px] w-full">
                              <thead>
                                <tr className="border-b border-[var(--border-subtle)]">
                                  <th className="text-left py-1 pr-2 text-[var(--text-muted)] font-bold">{t('econHistory.impactTableAsset')}</th>
                                  <th className="text-left py-1 pr-2 text-[var(--text-muted)] font-bold">{t('econHistory.impactTableBias')}</th>
                                  <th className="text-left py-1 text-[var(--text-muted)] font-bold">{t('econHistory.impactTableReason')}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--border-subtle)]">
                                {macroNarrative.narrative.marketImpactTable.map((row, i) => (
                                  <tr key={i}>
                                    <td className="py-1 pr-2 font-bold text-[var(--text-primary)] whitespace-nowrap">{row.asset}</td>
                                    <td className="py-1 pr-2 text-[var(--text-secondary)] whitespace-nowrap">{row.bias}</td>
                                    <td className="py-1 text-[var(--text-secondary)]">{row.reason}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                      <div>
                        <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider font-bold block mb-0.5">{t('econHistory.whatToWatchLabel')}</span>
                        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{macroNarrative.narrative.whatToWatch}</p>
                      </div>
                      <p className="text-[9px] text-[var(--text-muted)] flex items-center gap-1 pt-1">
                        <Sparkles className="w-2.5 h-2.5" />
                        {t('econHistory.narrativeAttribution')}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()
          ) : null}

          <div>
            <StanceRow label={t('econHistory.usdStrengthLabel')} value={summary.usdValue} stance={summary.usdStance} detail={summary.usdDetail} />
            {selectedAsset === 'XAUUSD' && <StanceRow label={t('econHistory.xauBiasLabel')} value={summary.xauValue} stance={summary.xauStance} detail={summary.xauDetail} />}
            <StanceRow
              label={t('econHistory.fedStanceLabel')}
              value={summary.fedValue}
              stance={summary.fedStance}
              detail={summary.fedDetail}
              tooltip={t('econHistory.fedStanceTooltip')}
            />
          </div>
        </div>
      </div>

      {/* 3. Economic Transmission diagram (Terminal redesign) - node+line SVG replacing the old
          box+chevron row. Conceptual/educational chain, not a claim about a validated data
          relationship or a price forecast - only the 'usd' node ever carries a real number (the
          same DXY trend read the old version showed). The connecting line "draws in" once per
          real data fingerprint (transmissionKey below) via the shared .eh-draw-line keyframe this
          file already uses elsewhere - it never loops, only re-animates when the underlying FOMC
          reading or DXY trend actually changes. */}
      <div className={`${cardClass} p-3 lg:p-4`}>
        <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
          <Workflow className="w-4 h-4 text-[var(--color-warn)]" />
          {t('econHistory.transmissionTitle')}
        </h2>
        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{t('econHistory.transmissionNote')}</p>
        <p className="text-[9px] text-[var(--text-muted)] italic mb-3">{t('econHistory.transmissionDisclaimer')}</p>
        {(() => {
          const w = 720;
          const h = 92;
          const marginX = 46;
          const n = TRANSMISSION_NODES.length;
          const stepX = (w - marginX * 2) / (n - 1);
          const y = h / 2 + 4;
          const xs = Array.from({ length: n }, (_, i) => marginX + i * stepX);
          const linePath = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
          const fomcLatest = (dataMap.FOMC?.points || []).filter((p) => p.actual !== null).slice(-1)[0] ?? null;
          const dxyTrend = marketContext?.dxyPanel?.trend15mPercent ?? null;
          const transmissionKey = `${fomcLatest?.date ?? 'x'}:${fomcLatest?.actual ?? 'x'}:${dxyTrend ?? 'x'}`;
          return (
            <div className="overflow-x-auto">
              <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[560px] h-auto">
                <path key={transmissionKey} d={linePath} fill="none" stroke="var(--border-strong)" strokeWidth="1.25" pathLength={1000} className="eh-draw-line" />
                {TRANSMISSION_NODES.map((node, i) => {
                  const isUsd = node.key === 'usd';
                  const dxyKnown = isUsd && dxyTrend !== null;
                  const lines = wrapLabel(t(node.labelKey));
                  return (
                    <g key={node.key}>
                      <circle cx={xs[i]} cy={y} r={isUsd ? 5 : 4} fill={isUsd ? 'var(--color-brand)' : 'var(--bg-panel)'} stroke="var(--border-strong)" strokeWidth="1.25" />
                      {lines.map((line, li) => (
                        <text
                          key={li}
                          x={xs[i]}
                          y={y - 14 - (lines.length - 1 - li) * 10}
                          textAnchor="middle"
                          fontSize="9"
                          fontFamily="monospace"
                          fontWeight="700"
                          fill="var(--text-primary)"
                        >
                          {line}
                        </text>
                      ))}
                      {dxyKnown && (
                        <text x={xs[i]} y={y + 20} textAnchor="middle" fontSize="8.5" fontFamily="monospace" fontWeight="700" fill={(dxyTrend as number) >= 0 ? 'var(--color-up)' : 'var(--color-down)'}>
                          DXY {(dxyTrend as number) >= 0 ? '+' : ''}
                          {(dxyTrend as number).toFixed(2)}%
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          );
        })()}
      </div>

      {/* 3b. Macro momentum mini-heatmap (Terminal redesign, P1) - classifyTrendAtLookback at
          1/3/6/12 releases back per category (momentumGrid above). A cell only ever shows a real
          direction or an honest "—" (insufficient sample for that lookback yet) - never a guess. */}
      <div className={`${cardClass} p-3 lg:p-4`}>
        <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
          <Grid3x3 className="w-4 h-4 text-[var(--color-brand)]" />
          {t('econHistory.momentumTitle')}
        </h2>
        <div className="flex items-center gap-1.5 mt-0.5 mb-2">
          <p className="text-[10px] text-[var(--text-muted)]">{t('econHistory.momentumSub')}</p>
          <InfoTooltip text={t('econHistory.momentumNote')} />
        </div>
        <div className="overflow-x-auto">
          <table className="border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="text-left py-1 pr-3 text-[var(--text-muted)] font-bold uppercase tracking-wider">{t('econHistory.monthlyTableIndicator')}</th>
                {MOMENTUM_WINDOWS.map((w) => (
                  <th key={w.key} className="py-1 px-2 text-center text-[var(--text-muted)] font-bold">
                    {w.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {momentumGrid.map((row) => (
                <tr key={row.id}>
                  <td className="py-1.5 pr-3 font-bold text-[var(--text-primary)] whitespace-nowrap">{t(row.labelKey)}</td>
                  {row.windows.map((win) => (
                    <td key={win.key} className="py-1.5 px-2 text-center">
                      {win.direction === null ? (
                        <span className="text-[9px] text-[var(--text-muted)]">—</span>
                      ) : (
                        <span
                          className="inline-flex items-center justify-center w-6 h-5 rounded-sm font-bold"
                          style={{ color: REGIME_COLORS[win.direction], background: `color-mix(in srgb, ${REGIME_COLORS[win.direction]} 12%, transparent)` }}
                        >
                          {REGIME_ICONS[win.direction]}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {needsSetup && (
        <div className={`${cardClass} p-3 flex items-start gap-2.5`}>
          <Info className="w-4 h-4 text-[var(--color-brand)] shrink-0 mt-0.5" />
          <span className="text-[11px] text-[var(--text-secondary)]">{t('econHistory.needsSetupBody')}</span>
        </div>
      )}

      {/* 4. Monthly Data table (Deep Dive) - Change + Surprise (Actual vs Forecast, visual bar
          where forecast data exists) + Trend (sparkline of the full loaded history) columns,
          sticky header+first column, bounded height so a long table scrolls instead of pushing
          every section below it down the page. */}
      {viewMode === 'deepdive' && (
      <div className={`${cardClass} p-3 lg:p-4`}>
        <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-[var(--color-brand)]" />
          {t('econHistory.monthlyTableTitle')}
        </h2>
        <p className="text-[10px] text-[var(--text-muted)] mt-0.5 mb-2">{t('econHistory.monthlyTableSub')}</p>
        <div className="overflow-auto max-h-[440px] rounded-md border border-[var(--border-subtle)]">
          <table className="border-collapse text-[10px] min-w-[880px]">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 bg-[var(--bg-panel)] text-left py-1.5 pr-2 pl-2 text-[var(--text-muted)] uppercase tracking-wider font-bold">
                  {t('econHistory.monthlyTableIndicator')}
                </th>
                {monthLabels.map((m, i) => (
                  <th key={i} className="sticky top-0 z-10 bg-[var(--bg-panel)] py-1.5 px-1.5 text-right text-[var(--text-muted)] font-bold whitespace-nowrap">
                    {m}
                  </th>
                ))}
                <th className="sticky top-0 z-10 bg-[var(--bg-panel)] py-1.5 px-2 text-right text-[var(--text-muted)] font-bold whitespace-nowrap border-l border-[var(--border-subtle)]">
                  {t('econHistory.changeColumn')}
                </th>
                <th className="sticky top-0 z-10 bg-[var(--bg-panel)] py-1.5 px-2 text-right text-[var(--text-muted)] font-bold whitespace-nowrap">
                  {t('econHistory.tableSurprise')}
                </th>
                <th className="sticky top-0 z-10 bg-[var(--bg-panel)] py-1.5 pl-2 pr-2 text-right text-[var(--text-muted)] font-bold whitespace-nowrap">
                  {t('econHistory.tableTrend')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {CHIP_INDICATOR_IDS.map((id) => {
                const bucket = bucketsById[id];
                const mc = monthlyChangeById[id];
                const isExpanded = expandedIndicator === id;
                const fullValues = (dataMap[id]?.points || []).filter((p) => p.actual !== null).map((p) => p.actual as number);
                const fullRange = fullValues.length > 1 ? Math.max(...fullValues) - Math.min(...fullValues) || 1 : 1;
                return (
                  <React.Fragment key={id}>
                    <tr onClick={() => setExpandedIndicator(isExpanded ? null : id)} className="cursor-pointer hover:bg-[var(--card-hover-bg)] transition-colors">
                      <td className="sticky left-0 z-10 bg-[var(--bg-panel)] py-1.5 pr-2 pl-2 text-[var(--text-primary)] font-bold whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <ChevronDown className={`w-3 h-3 text-[var(--text-muted)] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                          {t(INDICATOR_LABEL_KEYS[id])}
                          {/* Bug fix (2026-08-26): GDP is a real quarterly release - most of its 12
                              monthly cells are honestly empty (—) by design, not missing data. This
                              note stops that from reading as broken next to the daily/monthly rows. */}
                          {id === 'GDP' && <InfoTooltip text={t('econHistory.gdpQuarterlyNote')} />}
                        </span>
                      </td>
                      {Array.from({ length: 12 }).map((_, m) => {
                        const p = bucket?.get(`${selectedYear}-${m}`);
                        return (
                          <td key={m} className="py-1.5 px-1.5 text-right tabular-nums text-[var(--text-secondary)] whitespace-nowrap">
                            {p ? formatIndicatorValue(id, p.actual) : '—'}
                          </td>
                        );
                      })}
                      <td className="py-1.5 px-2 text-right tabular-nums font-bold whitespace-nowrap border-l border-[var(--border-subtle)]">
                        {mc.change === null ? (
                          <span className="text-[var(--text-muted)]">—</span>
                        ) : (
                          <span style={{ color: mc.change > 0 ? 'var(--color-up)' : mc.change < 0 ? 'var(--color-down)' : 'var(--text-secondary)' }}>
                            {mc.change >= 0 ? '+' : ''}
                            {mc.change}
                            {INDICATOR_SUFFIX[id]}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-2">
                        <SurpriseCell point={mc.latest} suffix={INDICATOR_SUFFIX[id]} range={fullRange} unavailableLabel={t('econHistory.forecastUnavailable')} />
                      </td>
                      <td className="py-1.5 pl-2 pr-2 text-right">
                        {fullValues.length >= 2 ? (
                          <Sparkline values={fullValues.slice(-24)} width={56} height={18} />
                        ) : (
                          <span className="text-[9px] text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={16} className="bg-[var(--bg-surface)] p-3">
                          {!mc.latest ? (
                            <p className="text-[10px] text-[var(--text-muted)]">{t('econHistory.collectingCategory')}</p>
                          ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              <div>
                                <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">{t('econHistory.latestLabel')}</span>
                                <span className="text-sm font-black text-[var(--text-primary)] tabular-nums">{formatIndicatorValue(id, mc.latest.actual)}</span>
                              </div>
                              <div>
                                <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">{t('calendar.previous')}</span>
                                <span className="text-sm font-black text-[var(--text-secondary)] tabular-nums">{mc.previous ? formatIndicatorValue(id, mc.previous.actual) : '—'}</span>
                              </div>
                              <div>
                                <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">{t('econHistory.changeColumn')}</span>
                                <span
                                  className="text-sm font-black tabular-nums"
                                  style={{ color: mc.change === null ? 'var(--text-muted)' : mc.change > 0 ? 'var(--color-up)' : mc.change < 0 ? 'var(--color-down)' : 'var(--text-secondary)' }}
                                >
                                  {mc.change === null ? '—' : `${mc.change >= 0 ? '+' : ''}${mc.change}${INDICATOR_SUFFIX[id]}`}
                                </span>
                              </div>
                              <div className="col-span-2 sm:col-span-1">
                                <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">{t('econHistory.interpretationLabel')}</span>
                                <span className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                                  {mc.change === null
                                    ? t('econHistory.rowNoPrevious')
                                    : mc.change > 0
                                      ? t('econHistory.rowChangeUp').replace('{indicator}', t(INDICATOR_LABEL_KEYS[id])).replace('{prev}', formatIndicatorValue(id, mc.previous!.actual)).replace('{latest}', formatIndicatorValue(id, mc.latest.actual))
                                      : mc.change < 0
                                        ? t('econHistory.rowChangeDown').replace('{indicator}', t(INDICATOR_LABEL_KEYS[id])).replace('{prev}', formatIndicatorValue(id, mc.previous!.actual)).replace('{latest}', formatIndicatorValue(id, mc.latest.actual))
                                        : t('econHistory.rowChangeFlat').replace('{indicator}', t(INDICATOR_LABEL_KEYS[id]))}
                                </span>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* 5. Historical Macro Charts (Deep Dive) - 5 separate panels, 2-col grid on desktop */}
      {viewMode === 'deepdive' && (
      <div className={`${cardClass} p-3 lg:p-4`}>
        <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
          <LineChart className="w-4 h-4 text-[var(--color-warn)]" />
          {t('econHistory.macroChartsTitle')}
        </h2>
        <p className="text-[10px] text-[var(--text-muted)] mt-0.5 mb-2">{t('econHistory.macroChartsSub')}</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {categoryChartSeries.map((cat) => (
            <div key={cat.id} className="p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <p className="text-[11px] font-bold text-[var(--text-primary)] mb-1">{t(cat.labelKey)}</p>
              <MultiLineCategoryChart
                lines={cat.lines}
                separate={cat.separate}
                isPmi={cat.isPmi}
                collectingLabel={t('econHistory.collectingCategory')}
                collectingSubLabel={t('econHistory.notEnoughDataMin')}
                locale={locale}
              />
            </div>
          ))}
        </div>
      </div>
      )}

      {/* 6. Event Intelligence (Perbaikan 5) - honest-gated: only real calendar fields filled in,
          model/confidence/scenario explicitly empty until a validated model exists.

          "Event -> Market Response" (Terminal redesign checklist, explicitly SKIPPED - investigated,
          not built): showing how USD/XAU/BTC/EURUSD actually moved 5M/30M/1H/4H/1D after each past
          release would need a persisted intraday price archive queryable by an arbitrary historical
          timestamp. Checked server.ts: the only price stores this app has are (a) short rolling
          live candle windows (Bybit/Binance klines, ~30 candles deep, kept for the signal engine's
          own real-time reads, not a long-horizon archive) and (b) xau_daily_price_history.json,
          which is DAILY resolution - far too coarse to resolve a 5-minute or 30-minute post-release
          reaction. Neither can honestly answer "what did XAUUSD do 30 minutes after the March CPI
          print". Building this would mean fabricating the reaction figures, so it stays unbuilt -
          this needs a new intraday price-archive data source, wired up as its own task. */}
      <div className={`${cardClass} p-3 lg:p-4`}>
        <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-[var(--color-brand)]" />
          {t('econHistory.eventIntelTitle')}
        </h2>
        <p className="text-[10px] text-[var(--text-muted)] mt-0.5 mb-2">{t('econHistory.eventIntelSub')}</p>
        {upcomingEvents.length === 0 ? (
          <p className="text-[10px] text-[var(--text-muted)] py-2">{t('econHistory.eventIntelNoUpcoming')}</p>
        ) : (
          <div className="space-y-2">
            {upcomingEvents.map(({ evt }, i) => (
              <div key={i} className="p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <span className="text-[11px] font-bold text-[var(--text-primary)]">{evt.event}</span>
                  <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
                    {new Date(evt.dateISO).toLocaleDateString(locale, { day: 'numeric', month: 'short' })} · {evt.time}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                  <div>
                    <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">{t('econHistory.eventConsensusLabel')}</span>
                    <span className="text-[11px] font-bold text-[var(--text-secondary)]">{evt.forecast && evt.forecast !== '—' ? evt.forecast : '—'}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">{t('econHistory.eventPreviousLabel')}</span>
                    <span className="text-[11px] font-bold text-[var(--text-secondary)]">{evt.previous && evt.previous !== '—' ? evt.previous : '—'}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">{t('econHistory.eventModelLabel')}</span>
                    <span className="text-[10px] text-[var(--text-muted)] italic leading-tight block">{t('econHistory.eventModelEmpty')}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">{t('econHistory.eventConfidenceLabel')}</span>
                    <span className="text-[10px] text-[var(--text-muted)] italic leading-tight block">{t('econHistory.eventConfidenceEmpty')}</span>
                  </div>
                </div>
                <div className="mt-1.5 pt-1.5 border-t border-[var(--border-subtle)]">
                  <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">{t('econHistory.eventScenarioLabel')}</span>
                  <span className="text-[10px] text-[var(--text-muted)] italic">{t('econHistory.eventScenarioEmpty')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 7. Correlation Matrix (Perbaikan 7: reading guide + click popover) - Professional only */}
      {viewMode === 'deepdive' && (
        <div className={`${cardClass} p-3 lg:p-4`}>
          <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Grid3x3 className="w-4 h-4 text-[var(--color-brand)]" />
            {t('econHistory.correlationTitle')}
          </h2>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5 mb-2">{t('econHistory.correlationSub')}</p>

          <div className="mb-2 p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider font-bold">{t('econHistory.howToReadLabel')}</span>
            <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">{t('econHistory.howToReadBody')}</p>
          </div>

          <div className="overflow-x-auto">
            <table className="border-collapse text-[9px] min-w-[560px]">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-[var(--bg-panel)] py-1 pr-1" />
                  {CHIP_INDICATOR_IDS.map((id) => (
                    <th key={id} className="py-1 px-1 text-[var(--text-muted)] font-bold whitespace-nowrap" title={t(INDICATOR_LABEL_KEYS[id])}>
                      {CORRELATION_ABBR[id]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CHIP_INDICATOR_IDS.map((rowId, ri) => (
                  <tr key={rowId}>
                    <td className="sticky left-0 bg-[var(--bg-panel)] py-1 pr-2 text-[var(--text-primary)] font-bold whitespace-nowrap" title={t(INDICATOR_LABEL_KEYS[rowId])}>
                      {CORRELATION_ABBR[rowId]}
                    </td>
                    {CHIP_INDICATOR_IDS.map((colId, ci) => {
                      const cell = correlationMatrix[ri][ci];
                      return (
                        <td key={colId} className="p-0.5">
                          <button
                            type="button"
                            onClick={() => setCorrPopover(corrPopover?.rowId === rowId && corrPopover?.colId === colId ? null : { rowId, colId })}
                            className="w-9 h-7 rounded-md flex items-center justify-center tabular-nums text-[var(--text-primary)] cursor-pointer border-0"
                            style={{ backgroundColor: correlationColor(cell.r) }}
                            title={cell.r === null ? t('econHistory.correlationInsufficient') : `${t(INDICATOR_LABEL_KEYS[rowId])} × ${t(INDICATOR_LABEL_KEYS[colId])}: ${cell.r.toFixed(2)}`}
                          >
                            {cell.r === null ? '·' : cell.r.toFixed(1)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {corrPopover &&
            corrCell &&
            (() => {
              const rowLabel = t(INDICATOR_LABEL_KEYS[corrPopover.rowId]);
              const colLabel = t(INDICATOR_LABEL_KEYS[corrPopover.colId]);
              return (
                <div className="mt-2 p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                  <p className="text-[11px] font-bold text-[var(--text-primary)]">
                    {rowLabel} × {colLabel}
                  </p>
                  <div className="flex items-center gap-4 mt-1">
                    <div>
                      <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">r</span>
                      <span className="text-sm font-black tabular-nums text-[var(--text-primary)]">{corrCell.r === null ? '—' : corrCell.r.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">{t('econHistory.correlationPopoverSample')}</span>
                      <span className="text-sm font-black tabular-nums text-[var(--text-primary)]">{corrCell.n}</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-[var(--text-secondary)] mt-1.5">
                    {corrCell.r === null ? t('econHistory.correlationInsufficient') : t(correlationInterpretationKey(corrCell.r))}
                  </p>
                  <p className="text-[9px] text-[var(--text-muted)] mt-1.5 italic">{t('econHistory.correlationWarning')}</p>
                </div>
              );
            })()}
        </div>
      )}

      {/* 8. Advanced Analytics (Radar chart) - moved to the very bottom, collapsible so it doesn't
          force extra scroll on mobile. Professional mode only, same as the Correlation Matrix. */}
      {viewMode === 'deepdive' && (
        <div className={cardClass}>
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="w-full flex items-center justify-between p-3 lg:p-4 cursor-pointer text-left"
          >
            <div>
              <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <RadarIcon className="w-4 h-4 text-[var(--color-brand)]" />
                {t('econHistory.advancedAnalyticsTitle')}
              </h2>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{t('econHistory.advancedAnalyticsSub')}</p>
            </div>
            <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] shrink-0 transition-transform duration-200 ${advancedOpen ? 'rotate-180' : ''}`} />
          </button>
          {advancedOpen && (
            <div className="p-3 lg:p-4 pt-0 border-t border-[var(--border-subtle)]">
              <p className="text-[10px] text-[var(--text-muted)] mt-2 mb-2">{t('econHistory.radarSub')}</p>

              {/* Percentile bars (P1) - the primary, linear rendering of radarAxes[i].value (reused
                  directly, not recomputed): each category's lead indicator's latest reading as a
                  percentile of its own real 24-month range. The radar chart below is the same
                  numbers as a secondary/supplementary view (Bagian 1: radar is never the primary
                  visual). */}
              <div className="space-y-2 mb-4">
                {radarAxes.map((a) => {
                  const leadId = CATEGORIES.find((c) => c.id === a.id)!.indicators[0];
                  return (
                    <div key={a.id}>
                      <div className="flex items-center justify-between text-[10px] mb-0.5">
                        <span className="font-bold text-[var(--text-primary)]">
                          {t(INDICATOR_LABEL_KEYS[leadId])} <span className="text-[var(--text-muted)] font-normal">— {t('econHistory.percentileLabel')}</span>
                        </span>
                        <span className="font-bold tabular-nums" style={{ color: a.hasData ? 'var(--color-brand)' : 'var(--text-muted)' }}>
                          {a.hasData ? `${Math.round(a.value)}%` : t('econHistory.collectingConclusion')}
                        </span>
                      </div>
                      <div className="h-2 rounded-sm bg-[var(--bg-surface)] overflow-hidden">
                        {a.hasData && (
                          <div
                            className="h-full rounded-sm"
                            style={{ width: `${a.value}%`, background: 'var(--color-brand)', transition: 'width 400ms cubic-bezier(0.16,1,0.3,1)' }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-center">
                <svg viewBox="0 0 380 330" className="w-full max-w-[400px] h-auto">
                  {radarGeom.rings.map((ring, i) => (
                    <polygon key={i} points={ring} fill="none" stroke="rgba(128,128,128,0.14)" strokeWidth="0.75" />
                  ))}
                  {radarGeom.axisLines.map((p, i) => (
                    <line key={i} x1={radarGeom.cx} y1={radarGeom.cy} x2={p.x} y2={p.y} stroke="rgba(128,128,128,0.14)" strokeWidth="0.75" />
                  ))}
                  <polygon
                    key={radarAnimKey}
                    points={radarGeom.dataPoly}
                    fill="color-mix(in srgb, var(--color-brand) 10%, transparent)"
                    stroke="var(--color-brand)"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                    pathLength={1000}
                    className="eh-draw-line"
                  />
                  {radarAxes.map((a, i) => {
                    const cx = radarGeom.cx;
                    const cy = radarGeom.cy;
                    const r = radarGeom.maxR * Math.max(0, Math.min(1, a.value / 100));
                    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / radarAxes.length;
                    const px = cx + r * Math.cos(angle);
                    const py = cy + r * Math.sin(angle);
                    return <circle key={i} cx={px} cy={py} r={a.hasData ? 3 : 1.75} fill={a.hasData ? 'var(--color-brand)' : 'var(--text-muted)'} />;
                  })}
                  {radarGeom.labelPoints.map((p, i) => (
                    <text key={i} x={p.x} y={p.y} fill="var(--text-secondary)" fontSize="9" fontFamily="monospace" textAnchor="middle" dominantBaseline="middle">
                      {t(radarAxes[i].shortLabelKey)}
                    </text>
                  ))}
                </svg>
              </div>
              {radarCollectingLabels.length > 0 && (
                <p className="text-[10px] text-[var(--text-muted)] mt-2 text-center">
                  {t('econHistory.radarCollectingPrefix')} {radarCollectingLabels.join(', ')}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
