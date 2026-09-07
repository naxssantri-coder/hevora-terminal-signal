import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Clock, Globe, AlertTriangle, LineChart } from 'lucide-react';
import { EconomicEvent, EconHistoryResponse } from '../types';
import { useTranslation } from '../i18n/LanguageContext';
import { EconomicHistoryView, EVENT_MATCH_PATTERNS, formatIndicatorValue, type CalendarTrackedIndicatorId } from './EconomicHistoryView';
import { DataQualityBadge, EmptyState, UnavailableState } from './ui';
import { statusFromAge } from '../lib/dataState';

interface EconomicCalendarViewProps {
  events: EconomicEvent[];
  /** True when the server had to fall back to a previously-cached calendar snapshot because the
   * live ForexFactory fetch failed - the data shown is real, just possibly not the freshest. */
  stale?: boolean;
  /** True when the server has never successfully fetched calendar data (no live data, no cache).
   * The view shows an explicit "unavailable" message instead of any placeholder/fake events. */
  unavailable?: boolean;
  /** FASE C quick fix: timestamp of the server's last genuinely successful ForexFactory fetch,
   * regardless of whether this poll served fresh/stale/empty - null if it has never succeeded.
   * Shown next to the stale/unavailable banners so a reader always knows how old the data is. */
  lastFetchedAt?: string | null;
}

// PRIORITY 2 (2026-08-26 audit): distinguishes "this release hasn't happened yet" from "this
// release already happened but ForexFactory hasn't published the Actual value yet" - only the
// second case gets the "not yet updated by source" hint; a future event showing '—' is simply
// normal and gets no extra label.
const isAwaitingActual = (evt: EconomicEvent): boolean => {
  if (!evt.dateISO) return false;
  if (evt.actual && evt.actual !== '—') return false;
  return new Date(evt.dateISO).getTime() < Date.now();
};

const formatSyncTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—';

// Production bug fix (2026-08-26): a past-due event with an empty Actual is either genuinely
// still awaiting a fresh number (this indicator has a dedicated fallback - BLS today, BEA once
// wired) or is an indicator ForexFactory's free mirror structurally never carries Actual for
// (verified live - 0/36 past-event Actuals on a direct probe). These render different copy so
// the second case never reads as "will arrive any moment".
const hasNoFreeActualSource = (evt: EconomicEvent): boolean => isAwaitingActual(evt) && !evt.actualFallbackAvailable;

// Coverage expansion (2026-08-26): provenance badge for every non-ForexFactory fallback source,
// generalized from the BLS-only badge - short code shown on the Actual value, full disclosure in
// the tooltip, one entry per actualSource so a new fallback source is a one-line addition here.
const SOURCE_BADGE: Record<NonNullable<EconomicEvent['actualSource']>, { code: string; tooltipKey: string }> = {
  bls: { code: 'BLS', tooltipKey: 'calendar.actualFromBls' },
  eurostat: { code: 'EUROSTAT', tooltipKey: 'calendar.actualFromEurostat' },
  statcan: { code: 'STATCAN', tooltipKey: 'calendar.actualFromStatcan' },
  ons: { code: 'ONS', tooltipKey: 'calendar.actualFromOns' },
  fred: { code: 'FRED', tooltipKey: 'calendar.actualFromFred' },
};

// Calendar/Riwayat Ekonomi merge - reuses the app's OWN already-genuine FRED data (the exact same
// /api/economic-history pipeline that fills the Economic History tab) to answer the events the
// BLS/Eurostat/StatCan/ONS fallbacks above don't cover: USD releases with no dedicated fallback at
// all (PPI, Unemployment Rate, FOMC, GDP among the tracked patterns - CPI/NFP already have BLS
// above and are never touched here). Client-side only: no new provider, no change to how the
// Economic History tab itself fetches or computes anything - this only reads the same response.
//
// Matching by "closest FRED observation on or before the event's own date, within a bounded
// window" rather than "same calendar month": FRED's point date is the release's REFERENCE period
// (e.g. "2026-07-01" for July CPI), not ForexFactory's publication date (typically ~2-4 weeks into
// the following month for CPI/PPI/GDP, within days of month-end for NFP/UNRATE, same-day for FOMC)
// - same-month matching would silently miss every one of those. A live-past-due event's release
// has, by definition, already happened, so if FRED's cache is current it should already carry that
// reading; the ~45-day window is generous enough to span the slowest of these (CPI/PPI/GDP's
// publication lag) while still safely excluding the PRIOR month's/meeting's reading, which sits a
// full release cycle further back.
const FRED_MATCH_WINDOW_MS = 45 * 24 * 3600 * 1000;

/** The distinct FRED-backed indicator ids actually needed for the events currently on screen -
 * only the ones with a real "Tak tersedia" gap to fill, so this never fetches an indicator with
 * nothing to attach it to. */
function collectNeededFredIndicators(events: EconomicEvent[]): CalendarTrackedIndicatorId[] {
  const needed = new Set<CalendarTrackedIndicatorId>();
  for (const evt of events) {
    if (evt.currency !== 'USD') continue;
    if (!hasNoFreeActualSource(evt)) continue;
    const pattern = EVENT_MATCH_PATTERNS.find((p) => p.test(evt.event));
    if (pattern) needed.add(pattern.indicatorId);
  }
  return Array.from(needed);
}

/** Finds the FRED reading that best answers a given past-due event, or null if none exists close
 * enough in time - null means "genuinely nothing to show", never a fabricated/guessed value. */
function findFredActual(points: EconHistoryResponse['points'], eventDateISO: string): number | null {
  const eventTime = new Date(eventDateISO).getTime();
  if (isNaN(eventTime)) return null;
  let best: { time: number; actual: number } | null = null;
  for (const p of points) {
    if (p.actual === null || p.actual === undefined) continue;
    const pTime = new Date(p.date).getTime();
    if (isNaN(pTime) || pTime > eventTime) continue;
    if (eventTime - pTime > FRED_MATCH_WINDOW_MS) continue;
    if (!best || pTime > best.time) best = { time: pTime, actual: p.actual };
  }
  return best ? best.actual : null;
}

const getJakartaDayKey = (dateISO: string): string => {
  if (!dateISO) return '';
  const d = new Date(dateISO);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
};

const getDayHeaderLabel = (dayKey: string, dateISO: string, locale: string, todayLabel: string, tomorrowLabel: string, fallbackLabel: string): string => {
  const now = new Date();
  const todayKey = getJakartaDayKey(now.toISOString());
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
  const tomorrowKey = getJakartaDayKey(tomorrow.toISOString());

  if (dayKey && dayKey === todayKey) return todayLabel;
  if (dayKey && dayKey === tomorrowKey) return tomorrowLabel;

  if (!dateISO) return dayKey || fallbackLabel;
  const d = new Date(dateISO);
  if (isNaN(d.getTime())) return dayKey;

  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
};

export const EconomicCalendarView: React.FC<EconomicCalendarViewProps> = ({
  events,
  stale = false,
  unavailable = false,
  lastFetchedAt = null,
}) => {
  const { t, language } = useTranslation();
  const [impactFilter, setImpactFilter] = useState<string>('All');
  const [countdown, setCountdown] = useState<string>('00:00:00');
  const [subTab, setSubTab] = useState<'calendar' | 'econHistory'>('calendar');

  // Realtime countdown calculated directly from timestamp of nearest future event
  useEffect(() => {
    const calculateNextCountdown = () => {
      if (!events || events.length === 0) return '00:00:00';

      const now = Date.now();
      const futureEvents = events
        .filter((e) => e.dateISO && new Date(e.dateISO).getTime() > now)
        .sort((a, b) => new Date(a.dateISO).getTime() - new Date(b.dateISO).getTime());

      if (futureEvents.length === 0) return '00:00:00';

      const nextEvt = futureEvents[0];
      const diffMs = new Date(nextEvt.dateISO).getTime() - now;
      if (diffMs <= 0) return '00:00:00';

      const totalSecs = Math.floor(diffMs / 1000);
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      const s = totalSecs % 60;

      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    const updateTimer = () => setCountdown(calculateNextCountdown());
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [events]);

  // Calendar/Riwayat Ekonomi merge: fetch the same FRED history already backing the Economic
  // History tab, but only for the indicators this specific set of events actually has a genuine
  // "Tak tersedia" gap for. Re-runs only when that need set changes (a fresh calendar poll every
  // 5 minutes rarely changes which indicators are needed, so this rarely re-fetches).
  const neededIndicatorIds = useMemo(() => collectNeededFredIndicators(events || []), [events]);
  const neededKey = neededIndicatorIds.join(',');
  const [fredHistory, setFredHistory] = useState<Partial<Record<CalendarTrackedIndicatorId, EconHistoryResponse>>>({});
  useEffect(() => {
    const ids = neededKey.split(',').filter(Boolean) as CalendarTrackedIndicatorId[];
    if (ids.length === 0) return;
    let cancelled = false;
    Promise.all(
      ids.map(async (id) => {
        try {
          // Small window - only recent months are ever needed to answer a past-due event, and
          // this hits the exact same server-side FRED cache the Economic History tab's own
          // (much larger) months=24 request already shares, so this adds no new fetch burden.
          const res = await fetch(`/api/economic-history?indicator=${id}&currency=USD&months=6`);
          const payload = (await res.json().catch(() => null)) as EconHistoryResponse | null;
          return [id, payload] as const;
        } catch {
          return [id, null] as const;
        }
      })
    ).then((results) => {
      if (cancelled) return;
      setFredHistory((prev) => {
        const next = { ...prev };
        for (const [id, payload] of results) if (payload) next[id] = payload;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [neededKey]);

  // Overlays a FRED-sourced Actual onto events that currently have none, never touching an event
  // that already has one (ForexFactory's own, or an existing BLS/Eurostat/StatCan/ONS fallback) -
  // `hasNoFreeActualSource` is the exact same gate the render below already uses, so this can only
  // ever fill the true "Tak tersedia" case, nothing else.
  const enrichedEvents = useMemo(() => {
    if (neededIndicatorIds.length === 0) return events || [];
    return (events || []).map((evt) => {
      if (evt.currency !== 'USD' || !hasNoFreeActualSource(evt)) return evt;
      const pattern = EVENT_MATCH_PATTERNS.find((p) => p.test(evt.event));
      if (!pattern) return evt;
      const payload = fredHistory[pattern.indicatorId];
      // Only ever trust points this response's own metadata marks as FRED-sourced - excludes the
      // ADP/PMI_MFG/PMI_SVC indicators in EVENT_MATCH_PATTERNS, which are the app's own
      // forward-archived-from-ForexFactory store, not FRED, and would just be empty here anyway
      // for an event that hasn't happened before (nothing to backfill from).
      if (!payload || payload.indicator.source !== 'fred') return evt;
      const value = findFredActual(payload.points, evt.dateISO);
      if (value === null) return evt;
      const formatted = formatIndicatorValue(pattern.indicatorId, value);
      // PCEPILFE (Core PCE) follow-up: ForexFactory titles this event "... m/m", but the only FRED
      // series wired for it is YoY (fetchFredSeriesPoints's YoY branch in server.ts) - the number
      // is genuine, just a different period than the title implies. Appended right on the value
      // rather than left implicit, so a reader can't mistake it for the m/m figure the title
      // names. Every other indicator here (PPI/UNRATE/FOMC/GDP) already carries a period/unit that
      // matches its calendar title, so this caption is PCEPILFE-only, not a general FRED-badge
      // behavior.
      const captioned = pattern.indicatorId === 'PCEPILFE' ? `${formatted} (YoY)` : formatted;
      return { ...evt, actual: captioned, actualSource: 'fred' as const };
    });
  }, [events, neededIndicatorIds, fredHistory]);

  const getFlag = (currency: string) => {
    switch (currency) {
      case 'USD':
        return '🇺🇸';
      case 'EUR':
        return '🇪🇺';
      case 'GBP':
        return '🇬🇧';
      case 'JPY':
        return '🇯🇵';
      case 'AUD':
        return '🇦🇺';
      case 'NZD':
        return '🇳🇿';
      case 'CAD':
        return '🇨🇦';
      case 'CHF':
        return '🇨🇭';
      case 'CNY':
        return '🇨🇳';
      default:
        return '🌐';
    }
  };

  // Sort events by dateISO ascending - enrichedEvents is `events` with a FRED Actual overlaid
  // wherever one applies, otherwise byte-for-byte the same objects.
  const sortedEvents = [...enrichedEvents].sort((a, b) => {
    const timeA = a.dateISO ? new Date(a.dateISO).getTime() : 0;
    const timeB = b.dateISO ? new Date(b.dateISO).getTime() : 0;
    return timeA - timeB;
  });

  const filteredEvents = sortedEvents.filter((e) => {
    if (impactFilter === 'High' && e.impact !== 'High') return false;
    return true;
  });

  // Group events by day in Asia/Jakarta timezone
  const groupedEvents: { dayKey: string; label: string; events: EconomicEvent[] }[] = [];
  filteredEvents.forEach((evt) => {
    const dayKey = getJakartaDayKey(evt.dateISO || '');
    const label = getDayHeaderLabel(
      dayKey,
      evt.dateISO || '',
      language === 'id' ? 'id-ID' : 'en-US',
      t('calendar.today'),
      t('calendar.tomorrow'),
      t('calendar.schedule')
    );
    let group = groupedEvents.find((g) => g.dayKey === dayKey);
    if (!group) {
      group = { dayKey, label, events: [] };
      groupedEvents.push(group);
    }
    group.events.push(evt);
  });

  return (
    <div className="space-y-4 animate-in fade-in duration-200 text-xs font-mono">
      {/* Header with Next Event Countdown */}
      <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] p-6 space-y-4 relative overflow-hidden group transition-colors duration-200">
        {/* Large Card Watermark */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[clamp(80px,12vw,150px)] font-black tracking-[0.12em] text-[var(--text-primary)] opacity-[0.012] dark:opacity-[0.018] group-hover:opacity-[0.03] transition-opacity duration-250 select-none blur-[0.8px] leading-none whitespace-nowrap z-0">
          HEVORA
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-4 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-[var(--bg-surface)] border border-[var(--border-strong)] flex items-center justify-center text-[var(--text-primary)] shadow-sm">
              <Calendar className="w-4 h-4 text-[var(--text-primary)]" />
            </div>
            <div>
              <h1 className="text-xl font-black text-[var(--text-primary)] tracking-tight uppercase">
                {t('calendar.title')}
              </h1>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-medium">
                {t('calendar.subtitle')}
              </p>
            </div>
          </div>

          {/* Live Countdown Badge */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-4 py-2 rounded flex items-center gap-3 shadow-sm">
            <div className="text-[10px] text-[var(--text-muted)] font-medium flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <span>{t('calendar.nextEvent')}</span>
            </div>
            <div className="text-sm font-black text-[var(--text-primary)] tabular-nums flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#2ECC71] animate-pulse" />
              <span>{countdown}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-tab Toggle: Calendar (unchanged, existing view) vs Economic History (new) */}
      <div className="inline-flex items-center gap-1 bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setSubTab('calendar')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer inline-flex items-center gap-2 ${
            subTab === 'calendar'
              ? 'bg-[var(--text-primary)] text-[var(--bg-base)] font-black'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          {t('calendar.subTabCalendar')}
        </button>
        <button
          type="button"
          onClick={() => setSubTab('econHistory')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer inline-flex items-center gap-2 ${
            subTab === 'econHistory'
              ? 'bg-[var(--text-primary)] text-[var(--bg-base)] font-black'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
          }`}
        >
          <LineChart className="w-3.5 h-3.5" />
          {t('calendar.subTabEconHistory')}
        </button>
      </div>

      {subTab === 'econHistory' ? (
        <EconomicHistoryView />
      ) : (
        <>
      {/* Stale Data Notice - shown when the server had to serve a previously-cached snapshot
          because the live ForexFactory fetch failed. Real data, just possibly not the freshest. */}
      {stale && !unavailable && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] border-l-4 border-l-[#3B82F6] text-[11px] text-[var(--text-secondary)]">
          <AlertTriangle className="w-3.5 h-3.5 text-[#3B82F6] shrink-0" />
          <span>{t('calendar.staleNotice')}</span>
          {/* FASE C quick fix: last-successful-fetch timestamp travels with the banner, same
              DataQualityBadge/statusFromAge pattern every other feed in this app uses. */}
          <DataQualityBadge
            meta={{ source: 'ForexFactory', lastUpdated: lastFetchedAt, status: statusFromAge(lastFetchedAt, 5 * 60_000, 60 * 60_000) }}
            compact
          />
        </div>
      )}

      {/* Impact Filter Toolbar */}
      <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] p-4 flex items-center justify-between transition-colors duration-200">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider">{t('calendar.impactFilter')}</span>
          <div className="flex items-center gap-1.5">
            {[
              { id: 'All', label: t('calendar.allEvents') },
              { id: 'High', label: t('calendar.highVolatilityOnly') },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setImpactFilter(f.id)}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all duration-200 cursor-pointer ${
                  impactFilter === f.id
                    ? 'bg-[var(--text-primary)] text-[var(--bg-base)] font-black'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[var(--text-secondary)] text-[11px] hidden sm:flex items-center gap-1.5 font-medium">
            <Globe className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <span>{t('calendar.timezone')} <span className="text-[var(--text-primary)] font-extrabold">Asia/Jakarta (WIB)</span></span>
          </div>
          {/* PRIORITY 2 (2026-08-26 audit): last-synced freshness used to show only inside the
              stale banner above - invisible the rest of the time, which is exactly when a reader
              wondering "why is Actual still empty for this event" needs it most. Always visible
              here now, same DataQualityBadge/statusFromAge pattern, so "the app looks stuck" and
              "ForexFactory just hasn't updated yet" read differently at a glance. */}
          {!unavailable && (
            <DataQualityBadge
              meta={{ source: 'ForexFactory', lastUpdated: lastFetchedAt, status: statusFromAge(lastFetchedAt, 5 * 60_000, 60 * 60_000) }}
              compact
            />
          )}
        </div>
      </div>

      {/* Economic Calendar List */}
      <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] overflow-hidden p-6 space-y-4 relative group transition-colors duration-200">
        {/* Large Card Watermark */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[clamp(80px,12vw,150px)] font-black tracking-[0.12em] text-[var(--text-primary)] opacity-[0.012] dark:opacity-[0.018] group-hover:opacity-[0.03] transition-opacity duration-250 select-none blur-[0.8px] leading-none whitespace-nowrap z-0">
          HEVORA
        </div>

        {groupedEvents.length === 0 ? (
          <div className="relative z-10">
            {unavailable ? (
              <UnavailableState source="ForexFactory" detail={t('calendar.unavailable')} timestamp={lastFetchedAt} />
            ) : (
              <EmptyState detail={t('calendar.noEvents')} />
            )}
          </div>
        ) : (
          <>
            {/* Mobile: per-event cards (below sm) - the table below needs horizontal scroll to
                fit 7 columns, which cut information off on narrow screens. Cards show every
                field (time, currency+flag, impact, event name, actual/forecast/previous) without
                any scrolling. */}
            <div className="sm:hidden space-y-4 relative z-10 max-h-[680px] overflow-y-auto">
              {groupedEvents.map((group) => (
                <div key={group.dayKey || group.label} className="space-y-2">
                  <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-xs font-bold text-[var(--text-secondary)] font-mono uppercase tracking-wider">
                    📅 {group.label}
                  </div>
                  {group.events.map((evt) => {
                    const isHigh = evt.impact === 'High';
                    const flag = getFlag(evt.currency);
                    return (
                      <div
                        key={evt.id}
                        className="hev-card-v2 !p-3.5 space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-base shrink-0">{flag}</span>
                            <span className="font-extrabold text-xs text-[var(--text-primary)] shrink-0">{evt.currency}</span>
                            <span className="text-[#2ECC71] font-black text-xs tabular-nums whitespace-nowrap">
                              {evt.time.endsWith('WIB') ? evt.time : `${evt.time} WIB`}
                            </span>
                          </div>
                          <span
                            className={`text-[9px] font-black px-2 py-0.5 rounded border inline-flex items-center gap-1 shrink-0 ${
                              isHigh
                                ? 'bg-[#FF4D4F]/10 text-[#FF4D4F] border-[#FF4D4F]/30'
                                : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${isHigh ? 'bg-[#FF4D4F] animate-pulse' : 'bg-[var(--text-muted)]'}`} />
                            {evt.impact}
                          </span>
                        </div>

                        <div className="font-extrabold text-sm text-[var(--text-primary)] leading-snug">{evt.event}</div>

                        <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-[var(--border-subtle)]">
                          <div>
                            <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">{t('calendar.actual')}</span>
                            {hasNoFreeActualSource(evt) ? (
                              <span className="text-[10px] italic text-[var(--text-muted)]" title={t('calendar.actualNoFreeSource')}>
                                {t('calendar.actualNoFreeSourceShort')}
                              </span>
                            ) : isAwaitingActual(evt) ? (
                              <span
                                className="text-[10px] italic text-[var(--text-muted)]"
                                title={t('calendar.awaitingActual').replace('{time}', formatSyncTime(lastFetchedAt))}
                              >
                                {t('calendar.awaitingActualShort')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1">
                                <span className="text-xs font-black text-[#2ECC71] tabular-nums">{evt.actual}</span>
                                {evt.actualSource && SOURCE_BADGE[evt.actualSource] && (
                                  <span
                                    className="text-[7px] font-black text-[var(--text-muted)] border border-[var(--border-subtle)] rounded px-1 uppercase tracking-wider"
                                    title={t(SOURCE_BADGE[evt.actualSource].tooltipKey)}
                                  >
                                    {SOURCE_BADGE[evt.actualSource].code}
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                          <div>
                            <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">{t('calendar.forecast')}</span>
                            <span className="text-xs font-extrabold text-[var(--text-secondary)] tabular-nums">{evt.forecast}</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider block">{t('calendar.previous')}</span>
                            <span className="text-xs text-[var(--text-muted)] font-medium tabular-nums">{evt.previous}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Desktop/tablet: unchanged table */}
            <div className="hidden sm:block overflow-x-auto max-h-[680px] overflow-y-auto relative z-10">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[var(--bg-header)] z-10 border-b border-[var(--border-subtle)]">
                  <tr className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                    <th className="py-3 px-4 font-bold w-28">{t('calendar.timeWib')}</th>
                    <th className="py-3 px-4 font-bold w-28">{t('calendar.currency')}</th>
                    <th className="py-3 px-4 font-bold w-28">{t('calendar.impact')}</th>
                    <th className="py-3 px-4 font-bold">{t('calendar.macroEvent')}</th>
                    <th className="py-3 px-4 font-bold w-28 text-right">{t('calendar.actual')}</th>
                    <th className="py-3 px-4 font-bold w-28 text-right">{t('calendar.forecast')}</th>
                    <th className="py-3 px-4 font-bold w-28 text-right">{t('calendar.previous')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {groupedEvents.map((group) => (
                    <React.Fragment key={group.dayKey || group.label}>
                      <tr className="bg-[var(--bg-surface)] border-y border-[var(--border-subtle)] text-xs font-bold text-[var(--text-secondary)]">
                        <td colSpan={7} className="py-2.5 px-4 font-mono uppercase tracking-wider">
                          📅 {group.label}
                        </td>
                      </tr>
                      {group.events.map((evt) => {
                        const isHigh = evt.impact === 'High';
                        const flag = getFlag(evt.currency);

                        return (
                          <tr key={evt.id} className="hover:bg-[var(--card-hover-bg)] transition-all duration-200 h-[56px]">
                            <td className="py-3 px-4 text-[#2ECC71] font-black whitespace-nowrap text-xs tabular-nums">
                              {evt.time.endsWith('WIB') ? evt.time : `${evt.time} WIB`}
                            </td>

                            <td className="py-3 px-4 text-[var(--text-primary)] font-extrabold whitespace-nowrap text-xs flex items-center gap-1.5 h-[56px]">
                              <span className="text-base">{flag}</span>
                              <span>{evt.currency}</span>
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap">
                              <span
                                className={`text-[10px] font-black px-2.5 py-0.5 rounded border inline-flex items-center gap-1.5 ${
                                  isHigh
                                    ? 'bg-[#FF4D4F]/10 text-[#FF4D4F] border-[#FF4D4F]/30'
                                    : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${isHigh ? 'bg-[#FF4D4F] animate-pulse' : 'bg-[var(--text-muted)]'}`} />
                                <span>{evt.impact}</span>
                              </span>
                            </td>

                            <td className="py-3 px-4 font-extrabold text-[var(--text-primary)] text-xs">
                              {evt.event}
                            </td>

                            <td className="py-3 px-4 text-right text-xs whitespace-nowrap tabular-nums">
                              {hasNoFreeActualSource(evt) ? (
                                <span className="italic text-[var(--text-muted)] text-[10px] font-normal" title={t('calendar.actualNoFreeSource')}>
                                  {t('calendar.actualNoFreeSourceShort')}
                                </span>
                              ) : isAwaitingActual(evt) ? (
                                <span
                                  className="italic text-[var(--text-muted)] text-[10px] font-normal"
                                  title={t('calendar.awaitingActual').replace('{time}', formatSyncTime(lastFetchedAt))}
                                >
                                  {t('calendar.awaitingActualShort')}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <span className="font-black text-[#2ECC71]">{evt.actual}</span>
                                  {evt.actualSource && SOURCE_BADGE[evt.actualSource] && (
                                    <span
                                      className="text-[7px] font-black text-[var(--text-muted)] border border-[var(--border-subtle)] rounded px-1 uppercase tracking-wider"
                                      title={t(SOURCE_BADGE[evt.actualSource].tooltipKey)}
                                    >
                                      {SOURCE_BADGE[evt.actualSource].code}
                                    </span>
                                  )}
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-4 text-right font-extrabold text-[var(--text-secondary)] text-xs whitespace-nowrap tabular-nums">
                              {evt.forecast}
                            </td>

                            <td className="py-3 px-4 text-right text-[var(--text-muted)] text-xs whitespace-nowrap tabular-nums font-medium">
                              {evt.previous}
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      </>
      )}
    </div>
  );
};
