import React, { useMemo } from 'react';
import { Zap } from 'lucide-react';
import { GeopoliticalRiskResponse, MarketPrice, PairId } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { useMarketRegime } from '../../lib/useMarketRegime';
import { CandlesResponse, correlationMatrix, regimeLabelKey, toReturns, volatilityRow } from '../../lib/analytics';
import { PAIRS_LIST, PAIRS_MAP } from '../../data/pairs';
import { Panel, PanelHeader } from '../ui';
import { InfoTooltip } from '../viz';

interface MatterItem {
  id: string;
  label: string;
  value: string;
  tone: 'up' | 'down' | 'warning' | 'neutral';
}

const TONE_CLASS: Record<MatterItem['tone'], string> = {
  up: 'text-[var(--color-up)]',
  down: 'text-[var(--color-down)]',
  warning: 'text-[var(--color-warn)]',
  neutral: 'text-[var(--text-secondary)]',
};

/**
 * What Matters Now (spec §S, new module) - the fastest-to-read summary on the page, max 4-5
 * ranked items. Each value is read straight off the same computation an existing card already
 * shows in full (Market Regime's score, Correlation's top pair, Volatility's crypto-class regime,
 * Geopolitical Risk's score) - duplicated fetches here follow the same already-established pattern
 * InsightSummaryView uses (this codebase's useEndpoint has no shared cache to dedupe through). An
 * item is included only when its source data is actually available and crosses a real threshold -
 * never a placeholder row.
 */
export const WhatMattersNowView: React.FC<{ prices: Record<PairId, MarketPrice> }> = ({ prices }) => {
  const { t } = useTranslation();
  const { regime } = useMarketRegime(prices);
  const geoRisk = useEndpoint<GeopoliticalRiskResponse>('/api/intelligence/geopolitical-risk', 15 * 60_000);
  const candles = useEndpoint<CandlesResponse>('/api/market/candles', 60_000);

  const items = useMemo(() => {
    const rows: MatterItem[] = [];
    const candleData = candles.data?.candles ?? {};

    const usableSymbols = Object.keys(candleData).filter((s) => (candleData[s] ?? []).length >= 4);
    if (usableSymbols.length >= 2) {
      const returnsBySymbol: Record<string, number[]> = {};
      for (const s of usableSymbols) returnsBySymbol[s] = toReturns(candleData[s]);
      const cells = correlationMatrix(returnsBySymbol, usableSymbols);
      let extreme: { a: string; b: string; value: number } | null = null;
      for (const cell of cells) {
        if (cell.a >= cell.b || cell.value === null) continue;
        if (!extreme || Math.abs(cell.value) > Math.abs(extreme.value)) extreme = { a: cell.a, b: cell.b, value: cell.value };
      }
      if (extreme && Math.abs(extreme.value) >= 0.7) {
        rows.push({
          id: 'correlation',
          label: `${PAIRS_MAP[extreme.a as PairId]?.name ?? extreme.a} ↔ ${PAIRS_MAP[extreme.b as PairId]?.name ?? extreme.b}`,
          value: `${extreme.value.toFixed(2)} CORRELATION`,
          tone: 'warning',
        });
      }
    }

    const cryptoRows = PAIRS_LIST.filter((p) => p.category === 'crypto').map((p) => volatilityRow(p.id, candleData[p.id] ?? [], prices[p.id]));
    const cryptoAtr = cryptoRows.map((r) => r.atrPercent).filter((v): v is number => v !== null);
    if (cryptoAtr.length > 0) {
      const avg = cryptoAtr.reduce((sum, v) => sum + v, 0) / cryptoAtr.length;
      const label = avg >= 5 ? 'ELEVATED' : avg >= 2 ? 'MODERATE' : 'LOW';
      rows.push({ id: 'volatility', label: 'CRYPTO VOLATILITY', value: label, tone: avg >= 5 ? 'down' : avg >= 2 ? 'warning' : 'up' });
    }

    if (geoRisk.data && !geoRisk.data.unavailable && geoRisk.data.score !== null) {
      const score = geoRisk.data.score;
      const band = score >= 66 ? 'ELEVATED' : score >= 33 ? 'MODERATE' : 'LOW';
      rows.push({ id: 'georisk', label: 'GEOPOLITICAL RISK', value: `${Math.round(score)} ${band}`, tone: score >= 66 ? 'down' : score >= 33 ? 'warning' : 'up' });
    }

    if (regime.score !== null) {
      rows.push({
        id: 'regime',
        // Renamed from hardcoded 'MARKET REGIME' (naming-consistency audit, 2026-08-30) - reuses
        // the same overview.marketRegime key the Dashboard card / Analysis panel already render,
        // so this row never drifts from either. Was too easily confused with Economic History's
        // "Macro Regime Score (Economic)", a completely different metric.
        label: t('overview.marketRegime'),
        value: `${Math.round(regime.score)} ${t(regimeLabelKey(regime.score))}`,
        tone: regime.score >= 55 ? 'up' : regime.score <= 45 ? 'down' : 'warning',
      });
    }

    return rows.slice(0, 5);
  }, [regime.score, geoRisk.data, candles.data, prices, t]);

  return (
    <Panel className="flex flex-col">
      <PanelHeader
        eyebrow="ANALYSIS"
        title="WHAT MATTERS NOW"
        icon={<Zap className="w-4 h-4" />}
        actions={<InfoTooltip text="The fastest-to-read read of this page: each row is a real number an adjacent card already shows in full, ranked by what crosses a real threshold." />}
      />

      {items.length === 0 ? (
        <p className="mt-4 text-[11px] text-[var(--text-muted)]">Nothing crosses a notable threshold right now.</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {items.map((item, i) => (
            <div key={item.id} className="flex items-start gap-2">
              <span className="text-[10px] font-black tabular-nums text-[var(--text-muted)] pt-0.5">{String(i + 1).padStart(2, '0')}</span>
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] truncate">{item.label}</div>
                <div className={`text-[12px] font-black tabular-nums uppercase ${TONE_CLASS[item.tone]}`}>{item.value}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
};
