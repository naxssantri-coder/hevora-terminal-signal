import React from 'react';
import { useTranslation } from '../../i18n/LanguageContext';
import { Badge, Panel, PanelHeader } from '../ui';

/**
 * Other Flow Sources (spot ETF flow BTC/ETH, GLD holdings) - split out of the former
 * LiquidityFlowView along with Sweep Watch / Stablecoin Liquidity / Institutional Flow, but NOT
 * wired into the Market Intelligence grid redesign: it doesn't appear in that layout's reference
 * and every field here is an honesty placeholder rather than live data.
 *
 * Kept as a standalone, currently-unused export rather than deleted - the disclosure itself is the
 * point (§10: no free source returns spot ETF flow or GLD holdings as parseable JSON; GLD's own
 * page serves an XLSX workbook and a PDF bar list, not a number, and building a binary-format
 * scraper for one figure was rejected as exactly the fragility the original audit flagged). Wire
 * this back in wherever it's next needed instead of re-deriving the same honesty note from
 * scratch.
 */
export const OtherFlowsView: React.FC = () => {
  const { t } = useTranslation();

  return (
    <Panel>
      <PanelHeader title={t('analysis.otherFlowsTitle')} subtitle={t('analysis.otherFlowsSubtitle')} />
      <div className="mt-3 space-y-2.5">
        <div>
          <Badge tone="warning">
            {t('analysis.etfFlowLabel')} · {t('analysis.providerNotWired')}
          </Badge>
          <p className="mt-1 text-[9px] text-[var(--text-muted)] leading-relaxed">{t('analysis.etfFlowDetail')}</p>
        </div>
        <div>
          <Badge tone="warning">
            {t('analysis.gldFlowLabel')} · {t('analysis.providerNotWired')}
          </Badge>
          <p className="mt-1 text-[9px] text-[var(--text-muted)] leading-relaxed">{t('analysis.gldFlowDetail')}</p>
        </div>
      </div>
    </Panel>
  );
};
