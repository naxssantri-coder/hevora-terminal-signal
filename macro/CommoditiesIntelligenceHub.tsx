import React from 'react';
import { Flame } from 'lucide-react';
import { EconomicEvent } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { Panel, PanelHeader } from '../ui';
import { LivePulseDot } from '../viz';
import { CommodityBoard } from '../commodities/CommodityBoard';

/**
 * Macro Hub - "Commodities Intelligence" (mobile pill-row cleanup, item 3).
 *
 * Oil Intelligence, the futures board and the Market State confluence read used to sit under
 * Markets > Commodities. That confluence read is built by the exact same engine
 * (buildCommodityConfluence, lib/confluence/) and rendered by the exact same component
 * (ConfluenceView) as XAU/BTC/Forex's panels - a RAW DATA -> HEVORA ENGINE -> ANALYSIS ->
 * human-readable intelligence read, the same shape as the rest of this Macro section. It gets its
 * own hub here, sibling to Gold Intelligence (the equivalent hub for XAU), instead of living
 * inside a pair-trading page whose other three classes have no such secondary board.
 *
 * CommodityBoard.tsx itself is completely unchanged - same endpoints, same confluence engine,
 * same futures board, same Oil Intelligence strip. This file only wraps it with the hub header
 * every other Macro module has; no data, logic or markup inside CommodityBoard was touched.
 */
export const CommoditiesIntelligenceHub: React.FC<{
  events: EconomicEvent[];
  onOpen: (route: string) => void;
}> = ({ events, onOpen }) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 font-mono">
      <Panel flush className="p-4 sm:p-5">
        <PanelHeader
          eyebrow={t('category.macro')}
          title={t('commoditiesHub.title')}
          subtitle={t('commoditiesHub.subtitle')}
          icon={<Flame className="w-4 h-4" />}
          actions={<LivePulseDot />}
        />
      </Panel>

      <CommodityBoard events={events} onOpen={onOpen} />
    </div>
  );
};
