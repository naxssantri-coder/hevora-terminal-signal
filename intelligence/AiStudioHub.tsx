import React, { useState } from 'react';
import { Brain, BookOpen, MessageCircle } from 'lucide-react';
import { PairId, Signal } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { Panel, PanelHeader, TabBar, type TabItem } from '../ui';
import { LivePulseDot } from '../viz';
import { useShell } from '../shell/ShellContext';
import { ResearchView } from './ResearchView';
import { AiMarketBriefView } from './AiMarketBriefView';

/**
 * Roadmap Batch D's third tab, "Ask AI" (AskAiView.tsx), was removed in the Terminal redesign
 * (PR 3) - it duplicated the global HEVAI panel (HevaiPanel.tsx, opened from the floating launcher
 * in every tab) in an older, smaller "card" visual style, so the app had two differently-styled
 * HEVAI surfaces sharing one useAskAi() feature. The button below opens that exact same panel
 * (ShellContext.openHevai) instead of hosting a second copy of the conversation UI in-page.
 */
type TabId = 'brief' | 'research';

export const AiStudioHub: React.FC<{
  signals: Record<PairId, Signal | null>;
  onOpenEvent: (id: string) => void;
}> = ({ signals, onOpenEvent }) => {
  const { t } = useTranslation();
  const { openHevai } = useShell();
  const [tab, setTab] = useState<TabId>('brief');

  const tabs: TabItem[] = [
    { id: 'brief', label: t('module.aiMarketBrief'), icon: <Brain className="w-3 h-3" /> },
    { id: 'research', label: t('module.research'), icon: <BookOpen className="w-3 h-3" /> },
  ];

  return (
    <div className="space-y-4 font-mono">
      <Panel flush className="p-4 sm:p-5">
        <PanelHeader
          eyebrow={t('category.intelligence')}
          title={t('aiStudioHub.title')}
          subtitle={t('aiStudioHub.subtitle')}
          icon={<Brain className="w-4 h-4" />}
          actions={<LivePulseDot />}
        />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <TabBar tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} />
          <button
            type="button"
            onClick={openHevai}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[11px] font-bold text-[var(--text-primary)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)] transition-colors cursor-pointer"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            {t('aiStudioHub.openAskAiButton')}
          </button>
        </div>
        <p className="mt-2 text-[10px] text-[var(--text-muted)] leading-relaxed">{t('aiStudioHub.openAskAiHint')}</p>
      </Panel>

      {tab === 'brief' && <AiMarketBriefView signals={signals} onOpenEvent={onOpenEvent} />}
      {tab === 'research' && <ResearchView />}
    </div>
  );
};
