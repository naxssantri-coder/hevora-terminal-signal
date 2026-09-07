import React, { useState } from 'react';
import { BarChart3, Compass, NotebookPen } from 'lucide-react';
import { MarketPrice, PairId } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { Panel, PanelHeader, TabBar, type TabItem } from '../ui';
import { HistoryView } from '../HistoryView';
import { PaperTradingView } from './PaperTradingView';
import { TradingJournalView } from './TradingJournalView';

/**
 * Performance Hub (Nav Consolidation Fase 5).
 *
 * Merges Performance, Paper Trading and Trading Journal into one route with three in-page tabs -
 * functionally different tools (a results dashboard, a simulator, a log), so each keeps its own
 * tab rather than being blended into one screen, but they no longer need three separate sidebar
 * rows to reach. Paper Trading and Trading Journal were hidden from navigation entirely in Fase
 * 10 §4 (mobileVisibility/desktopVisibility: false on their old registry entries) pending exactly
 * this kind of reachable-but-not-cluttering home - this hub is that home, so both become visible
 * again as tabs. Neither their components, routes-as-tabs, nor stored data changed.
 */
type TabId = 'performance' | 'paper-trading' | 'journal';

export const PerformanceHub: React.FC<{
  prices: Record<PairId, MarketPrice>;
  marketDataPending: boolean;
  onSelectPair: (pairId: PairId) => void;
  onNavigateToSignal: () => void;
}> = ({ prices, marketDataPending, onSelectPair, onNavigateToSignal }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>('performance');

  const tabs: TabItem[] = [
    { id: 'performance', label: t('module.performance'), icon: <BarChart3 className="w-3 h-3" /> },
    { id: 'paper-trading', label: t('module.paperTrading'), icon: <Compass className="w-3 h-3" /> },
    { id: 'journal', label: t('module.tradingJournal'), icon: <NotebookPen className="w-3 h-3" /> },
  ];

  return (
    <div className="space-y-4 font-mono">
      <Panel flush className="p-4 sm:p-5">
        <PanelHeader
          eyebrow={t('category.performance')}
          title={t('performanceHub.title')}
          subtitle={t('performanceHub.subtitle')}
          icon={<BarChart3 className="w-4 h-4" />}
        />
        <div className="mt-4">
          <TabBar tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} />
        </div>
      </Panel>

      {tab === 'performance' && <HistoryView onSelectPair={onSelectPair} onNavigateToSignal={onNavigateToSignal} />}
      {tab === 'paper-trading' && (marketDataPending ? null : <PaperTradingView prices={prices} />)}
      {tab === 'journal' && <TradingJournalView />}
    </div>
  );
};
