import React, { useMemo } from 'react';
import { Brain } from 'lucide-react';
import { EconomicEvent, LiveEvent, LiveEventReactionSnapshotSet } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { formatPercent } from '../../lib/format';
import { Badge, EmptyState, LoadingState, Panel, PanelHeader } from '../ui';

/**
 * Event intelligence: what the AI said an event meant, next to what the market actually did.
 *
 * The reaction columns are the forward-collected snapshots the server captures at publish, +15m
 * and +1h (captureLiveEventReactionSnapshots) - measured prices, never modelled ones. A window
 * that has not elapsed yet shows a dash, because "not captured yet" and "no move" are different.
 *
 * Deliberately absent: any pre-event prediction. Upcoming releases are listed with the forecast
 * the calendar provider publishes and nothing more - an AI-generated guess at an unreleased
 * number would be exactly the fabrication this product forbids.
 */
const moveOf = (
  before: LiveEventReactionSnapshotSet | null | undefined,
  after: LiveEventReactionSnapshotSet | null | undefined,
  key: 'xauPrice' | 'dxyPrice' | 'btcPrice'
): number | null => {
  const from = before?.[key];
  const to = after?.[key];
  if (typeof from !== 'number' || typeof to !== 'number' || from === 0) return null;
  return ((to - from) / from) * 100;
};

const MoveCell: React.FC<{ value: number | null }> = ({ value }) => (
  <span
    className={`tabular-nums font-bold ${
      value === null
        ? 'text-[var(--text-muted)]'
        : value >= 0
          ? 'text-[var(--color-up)]'
          : 'text-[var(--color-down)]'
    }`}
  >
    {value === null ? '—' : formatPercent(value, 2, { signed: true })}
  </span>
);

export const EventIntelligenceView: React.FC<{
  events: EconomicEvent[];
  onOpenEvent: (id: string) => void;
}> = ({ events, onOpenEvent }) => {
  const { t } = useTranslation();
  const live = useEndpoint<LiveEvent[] | { events: LiveEvent[] }>('/api/live-events?limit=40', 2 * 60_000);

  const analysed = useMemo(() => {
    const list = Array.isArray(live.data) ? live.data : (live.data?.events ?? []);
    return list
      .filter((event) => event.reaction?.atPublish)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 15);
  }, [live.data]);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return events
      .filter((event) => event.impact === 'High' && new Date(event.dateISO).getTime() >= now)
      .sort((a, b) => new Date(a.dateISO).getTime() - new Date(b.dateISO).getTime())
      .slice(0, 8);
  }, [events]);

  return (
    <div className="space-y-4 font-mono">
      <Panel flush>
        <div className="p-4 sm:p-5">
          <PanelHeader
            eyebrow={t('category.calendar')}
            title={t('intel.postEventTitle')}
            subtitle={t('intel.postEventSubtitle')}
            icon={<Brain className="w-4 h-4" />}
          />
        </div>

        {live.isLoading && !live.data ? (
          <div className="p-4 sm:p-5 border-t border-[var(--border-subtle)]">
            <LoadingState variant="table" />
          </div>
        ) : analysed.length === 0 ? (
          <div className="p-4 sm:p-5 border-t border-[var(--border-subtle)]">
            <EmptyState title={t('intel.noAnalysed')} detail={t('intel.noAnalysedDetail')} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-y border-[var(--border-subtle)]">
                  <th className="text-left font-bold px-4 py-2">{t('intel.colEvent')}</th>
                  <th className="text-left font-bold px-3 py-2">{t('intel.colVerdict')}</th>
                  <th className="text-right font-bold px-3 py-2">XAU +15m</th>
                  <th className="text-right font-bold px-3 py-2">XAU +1h</th>
                  <th className="text-right font-bold px-3 py-2">DXY +1h</th>
                  <th className="text-right font-bold px-4 py-2">BTC +1h</th>
                </tr>
              </thead>
              <tbody>
                {analysed.map((event) => (
                  <tr
                    key={event.id}
                    onClick={() => onOpenEvent(event.id)}
                    className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--card-hover-bg)] transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-2.5 max-w-[320px]">
                      <span className="block font-bold text-[var(--text-primary)] truncate">{event.title}</span>
                      <span className="block text-[9px] text-[var(--text-muted)] uppercase tracking-wider">
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-1.5">
                        <Badge tone={event.verdict === 'Bullish' ? 'up' : event.verdict === 'Bearish' ? 'down' : 'neutral'}>
                          {event.verdict}
                        </Badge>
                        <Badge tone="neutral">{event.tone}</Badge>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <MoveCell value={moveOf(event.reaction.atPublish, event.reaction.after15m, 'xauPrice')} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <MoveCell value={moveOf(event.reaction.atPublish, event.reaction.after1h, 'xauPrice')} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <MoveCell value={moveOf(event.reaction.atPublish, event.reaction.after1h, 'dxyPrice')} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <MoveCell value={moveOf(event.reaction.atPublish, event.reaction.after1h, 'btcPrice')} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="px-4 py-2.5 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-secondary)] leading-relaxed">
          {t('intel.postEventMethod')}
        </p>
      </Panel>

      <Panel>
        <PanelHeader title={t('intel.preEventTitle')} subtitle={t('intel.preEventSubtitle')} />

        {upcoming.length === 0 ? (
          <p className="mt-3 text-[11px] text-[var(--text-secondary)]">{t('intel.noUpcoming')}</p>
        ) : (
          <div className="mt-3 space-y-1.5">
            {upcoming.map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between gap-3 py-1.5 border-b border-[var(--border-subtle)] last:border-b-0 text-[11px]"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Badge tone="down">{event.currency}</Badge>
                  <span className="font-bold text-[var(--text-primary)] truncate">{event.event}</span>
                </span>
                <span className="flex items-center gap-3 shrink-0 text-[var(--text-secondary)] tabular-nums">
                  <span>{event.dateISO?.slice(0, 10)} {event.time}</span>
                  <span className="text-[var(--text-muted)]">
                    {t('intel.forecastShort')} {event.forecast || '—'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="mt-3 pt-3 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-secondary)] leading-relaxed">
          {t('intel.preEventMethod')}
        </p>
      </Panel>
    </div>
  );
};
