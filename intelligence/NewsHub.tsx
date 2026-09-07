import React, { useState } from 'react';
import { AlertTriangle, Newspaper } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext';
import { Panel, PanelHeader, TabBar, type TabItem } from '../ui';
import { LivePulseDot } from '../viz';
import { IntelView } from '../IntelView';
import { BreakingNewsView } from './BreakingNewsView';

/**
 * Intelligence Hub 5a - "News" (Nav Consolidation Fase 5).
 *
 * Merges News Feed and Breaking News into one page with a filter toggle instead of two routes.
 * Both stay their own components rather than one rewritten feed: IntelView (689 lines) already
 * owns its own filters/search/categorisation over the Live Intelligence pipeline, and
 * BreakingNewsView is a genuinely different read of the SAME /api/live-events feed (impact=High,
 * 48h window, its own card layout) - toggling between them is a real filter switch even though
 * it swaps components rather than re-filtering one shared list.
 */
type FilterId = 'all' | 'breaking';

export const NewsHub: React.FC<{ onOpenEvent: (id: string) => void }> = ({ onOpenEvent }) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<FilterId>('all');

  const tabs: TabItem[] = [
    { id: 'all', label: t('newsHub.filterAll'), icon: <Newspaper className="w-3 h-3" /> },
    { id: 'breaking', label: t('module.breakingNews'), icon: <AlertTriangle className="w-3 h-3" /> },
  ];

  return (
    <div className="space-y-4 font-mono">
      <Panel flush className="p-4 sm:p-5">
        <PanelHeader
          eyebrow={t('category.intelligence')}
          title={t('newsHub.title')}
          subtitle={t('newsHub.subtitle')}
          icon={<Newspaper className="w-4 h-4" />}
          actions={<LivePulseDot />}
        />
        <div className="mt-4">
          <TabBar tabs={tabs} active={filter} onChange={(id) => setFilter(id as FilterId)} />
        </div>
      </Panel>

      {filter === 'all' ? <IntelView onNavigateToLiveEvent={onOpenEvent} /> : <BreakingNewsView onOpenEvent={onOpenEvent} />}
    </div>
  );
};
