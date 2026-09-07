import React, { useMemo } from 'react';
import { Building2 } from 'lucide-react';
import { EconomicEvent, LiveEvent } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { formatAge } from '../../lib/dataState';
import { Badge, EmptyState, LoadingState, Panel, PanelHeader } from '../ui';

/**
 * Central-bank agenda: scheduled policy events from the calendar feed, plus the speeches and
 * press conferences the Live Intelligence pipeline has already captured.
 *
 * The calendar side is a keyword filter over the same /api/calendar payload the Economic Calendar
 * module renders - matching is on the event title the provider publishes, so an event this list
 * misses is a naming difference, not a hidden event. Nothing is added to the schedule locally.
 */
const BANK_PATTERNS: Array<{ label: string; test: RegExp }> = [
  // 'warsh' added (2026-08-29 audit, same fix as PolicyRatesHub.tsx's FED_SPEAKER_PATTERN) - the
  // named-official list had only ever tracked Powell by name.
  { label: 'FED', test: /\b(fomc|fed|federal reserve|powell|warsh)\b/i },
  { label: 'ECB', test: /\b(ecb|lagarde|european central bank)\b/i },
  { label: 'BOJ', test: /\b(boj|bank of japan|ueda)\b/i },
  { label: 'BOE', test: /\b(boe|bank of england|bailey)\b/i },
  { label: 'SNB', test: /\b(snb|swiss national bank)\b/i },
  { label: 'BOC', test: /\b(boc|bank of canada)\b/i },
];

const bankFor = (text: string): string | null =>
  BANK_PATTERNS.find((pattern) => pattern.test.test(text))?.label ?? null;

export const CentralBankEventsView: React.FC<{
  events: EconomicEvent[];
  onOpenEvent: (id: string) => void;
}> = ({ events, onOpenEvent }) => {
  const { t } = useTranslation();
  const live = useEndpoint<LiveEvent[] | { events: LiveEvent[] }>('/api/live-events?limit=40', 2 * 60_000);

  const scheduled = useMemo(
    () =>
      events
        .map((event) => ({ event, bank: bankFor(event.event) }))
        .filter((row): row is { event: EconomicEvent; bank: string } => row.bank !== null)
        .sort((a, b) => new Date(a.event.dateISO).getTime() - new Date(b.event.dateISO).getTime()),
    [events]
  );

  const speeches = useMemo(() => {
    const list = Array.isArray(live.data) ? live.data : (live.data?.events ?? []);
    return list
      .filter((event) => event.type === 'speech' || event.type === 'press_conference' || event.type === 'testimony')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 12);
  }, [live.data]);

  return (
    <div className="space-y-4 font-mono">
      <Panel flush>
        <div className="p-4 sm:p-5">
          <PanelHeader
            eyebrow={t('category.calendar')}
            title={t('module.centralBankEvents')}
            subtitle={t('intel.cbSubtitle')}
            icon={<Building2 className="w-4 h-4" />}
            actions={
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                {scheduled.length} {t('intel.scheduled')}
              </span>
            }
          />
        </div>

        {scheduled.length === 0 ? (
          <div className="p-4 sm:p-5 border-t border-[var(--border-subtle)]">
            <EmptyState title={t('intel.cbNoEvents')} detail={t('intel.cbNoEventsDetail')} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-y border-[var(--border-subtle)]">
                  <th className="text-left font-bold px-4 py-2">{t('intel.colBank')}</th>
                  <th className="text-left font-bold px-3 py-2">{t('intel.colEvent')}</th>
                  <th className="text-left font-bold px-3 py-2">{t('intel.colWhen')}</th>
                  <th className="text-right font-bold px-3 py-2">{t('intel.colForecast')}</th>
                  <th className="text-right font-bold px-4 py-2">{t('intel.colActual')}</th>
                </tr>
              </thead>
              <tbody>
                {scheduled.map(({ event, bank }) => (
                  <tr key={event.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
                    <td className="px-4 py-2.5">
                      <Badge tone={event.impact === 'High' ? 'down' : event.impact === 'Medium' ? 'warning' : 'neutral'}>
                        {bank}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-primary)] font-bold">{event.event}</td>
                    <td className="px-3 py-2.5 text-[var(--text-secondary)] tabular-nums">
                      {event.dateISO?.slice(0, 10)} {event.time}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-secondary)]">
                      {event.forecast || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-primary)] font-bold">
                      {event.actual || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader title={t('intel.cbSpeeches')} subtitle={t('intel.cbSpeechesSub')} />
        <div className="mt-3 space-y-2">
          {live.isLoading && !live.data ? (
            <LoadingState variant="text" />
          ) : speeches.length === 0 ? (
            <p className="text-[11px] text-[var(--text-secondary)]">{t('intel.cbNoSpeeches')}</p>
          ) : (
            speeches.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => onOpenEvent(event.id)}
                className="w-full text-left flex items-start gap-2.5 py-2 border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--card-hover-bg)] transition-colors cursor-pointer"
              >
                <Badge tone={event.tone === 'Hawkish' ? 'down' : event.tone === 'Dovish' ? 'up' : 'neutral'}>
                  {event.tone}
                </Badge>
                <span className="flex-1 min-w-0">
                  <span className="block text-[11px] font-bold text-[var(--text-primary)] truncate">
                    {event.title}
                  </span>
                  <span className="block text-[9px] text-[var(--text-muted)] uppercase tracking-wider">
                    {event.speaker || event.source || t('intel.sourceUnknown')} · {formatAge(event.createdAt)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
};
