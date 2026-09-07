import React, { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { EconomicEvent } from '../../types';
import { EmptyState, Panel, PanelHeader } from '../ui';
import { InfoTooltip } from '../viz';

const MAX_ROWS = 5;

/**
 * Next Market Catalyst (spec §T) - replaces the previous "today only" table with a compact
 * horizontal timeline of the next few HIGH/MEDIUM-impact events ahead, date + event name only
 * (no actual/forecast/previous columns - the full calendar detail lives on its own Calendar tab,
 * per §AE's "don't duplicate the Macro/Calendar tab" rule). Reuses the same `calendarEvents` prop
 * App.tsx already fetches - no second calendar fetch. Clicking a row still opens that event; the
 * header itself links out to the Calendar tab for the full view.
 *
 * REVISED 2026-08-26 (explicit user request): §AE's own rule was "don't duplicate the Calendar
 * tab's detail", not "never show forecast/previous" - and the user asked specifically for those
 * two fields back on this card. `EconomicEvent.forecast`/`.previous` are already populated on the
 * same `events` prop (server.ts's calendar feed fills them, falling back to '—' when the provider
 * has none), so this is a display-only change: a second small line per row, not a second fetch.
 * Still deliberately terse (short "F: … · P: …" line, not the Calendar tab's full layout) so the
 * distinction from that tab stays real, and it stays within MAX_ROWS x 460px.
 */
export const TodayCalendarView: React.FC<{
  events: EconomicEvent[];
  onOpenEvent?: (id: string) => void;
  onOpenCalendar?: () => void;
}> = ({ events, onOpenEvent, onOpenCalendar }) => {
  const upcoming = useMemo(() => {
    const now = Date.now();
    return events
      .filter((e) => e.dateISO && new Date(e.dateISO).getTime() >= now && e.impact !== 'Low')
      .sort((a, b) => new Date(a.dateISO).getTime() - new Date(b.dateISO).getTime())
      .slice(0, MAX_ROWS);
  }, [events]);

  return (
    <Panel className="flex flex-col h-full">
      <PanelHeader
        eyebrow="ANALYSIS"
        title="NEXT MARKET CATALYST"
        icon={<CalendarDays className="w-4 h-4" />}
        actions={<InfoTooltip text="Next high/medium-impact economic release ahead. Click any event, or the title, to open the full Calendar tab." />}
      />

      {upcoming.length === 0 ? (
        <div className="mt-4 flex-1 min-h-0 flex items-center justify-center">
          <EmptyState className="w-full" title="No upcoming catalyst" detail="No high/medium-impact events scheduled." />
        </div>
      ) : (
        <div className="mt-4 flex-1 min-h-0 overflow-y-auto space-y-2">
          {upcoming.map((evt) => (
            <button
              key={evt.id}
              type="button"
              onClick={() => (onOpenEvent ? onOpenEvent(evt.id) : onOpenCalendar?.())}
              className="w-full flex items-center justify-between gap-2 text-left hover:bg-[var(--card-hover-bg)] rounded px-1 py-1 -mx-1 transition-colors cursor-pointer"
            >
              <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] w-14 shrink-0">
                {new Date(evt.dateISO).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[11px] font-bold text-[var(--text-primary)] truncate">{evt.event}</span>
                <span className="block text-[8px] font-mono text-[var(--text-muted)] truncate">
                  F: {evt.forecast || '—'} &middot; P: {evt.previous || '—'}
                </span>
              </span>
              <span
                className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded shrink-0 ${
                  evt.impact === 'High' ? 'text-[var(--color-down)] bg-[var(--color-down)]/10' : 'text-[var(--color-warn)] bg-[var(--color-warn)]/10'
                }`}
              >
                {evt.impact}
              </span>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onOpenCalendar}
        className="mt-3 pt-2 border-t border-[var(--border-subtle)] text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-left"
      >
        OPEN FULL CALENDAR
      </button>
    </Panel>
  );
};
