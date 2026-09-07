import React, { useState } from 'react';
import { Brain, Building2, Calendar as CalendarIcon } from 'lucide-react';
import { EconomicEvent } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { Panel, PanelHeader, TabBar, type TabItem } from '../ui';
import { LivePulseDot } from '../viz';
import { EconomicCalendarView } from '../EconomicCalendarView';
import { CentralBankEventsView } from './CentralBankEventsView';
import { EventIntelligenceView } from './EventIntelligenceView';

/**
 * Calendar Hub (Nav Consolidation Fase 5).
 *
 * Merges Economic Calendar, Central Bank Events and AI Event Analysis into one page with a filter
 * chip row instead of three routes. All three keep reading the same `events` prop the shell
 * already polls once (App.tsx's calendarEvents) - this hub adds no new fetch of its own, only the
 * chip switch.
 */
type FilterId = 'all' | 'central-banks' | 'ai-analysis';

export const CalendarHub: React.FC<{
  events: EconomicEvent[];
  stale: boolean;
  unavailable: boolean;
  /** FASE C quick fix: last genuinely successful upstream fetch (server-tracked), null if this
   * server instance has never fetched successfully. Shown alongside the stale/unavailable
   * banners so a reader always knows how old what's on screen actually is. */
  lastFetchedAt: string | null;
  onOpenEvent: (id: string) => void;
}> = ({ events, stale, unavailable, lastFetchedAt, onOpenEvent }) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<FilterId>('all');

  const tabs: TabItem[] = [
    { id: 'all', label: t('calendarHub.filterAll'), icon: <CalendarIcon className="w-3 h-3" /> },
    { id: 'central-banks', label: t('module.centralBankEvents'), icon: <Building2 className="w-3 h-3" /> },
    { id: 'ai-analysis', label: t('module.aiEventAnalysis'), icon: <Brain className="w-3 h-3" /> },
  ];

  return (
    <div className="space-y-4 font-mono">
      <Panel flush className="p-4 sm:p-5">
        <PanelHeader
          eyebrow={t('category.calendar')}
          title={t('calendarHub.title')}
          subtitle={t('calendarHub.subtitle')}
          icon={<CalendarIcon className="w-4 h-4" />}
          actions={<LivePulseDot />}
        />
        <div className="mt-4">
          <TabBar tabs={tabs} active={filter} onChange={(id) => setFilter(id as FilterId)} />
        </div>
      </Panel>

      {filter === 'all' && (
        <EconomicCalendarView events={events} stale={stale} unavailable={unavailable} lastFetchedAt={lastFetchedAt} />
      )}
      {filter === 'central-banks' && <CentralBankEventsView events={events} onOpenEvent={onOpenEvent} />}
      {filter === 'ai-analysis' && <EventIntelligenceView events={events} onOpenEvent={onOpenEvent} />}
    </div>
  );
};
