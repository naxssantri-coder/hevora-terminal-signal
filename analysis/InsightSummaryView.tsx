import React, { useMemo, useState, useEffect } from 'react';
import { ArrowRight, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { EconomicEvent, GeopoliticalRiskResponse, MarketPrice, PairId } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { useMarketRegime } from '../../lib/useMarketRegime';
import {
  CandlesResponse,
  correlationMatrix,
  currencyStrength,
  regimeLabelKey,
  toReturns,
  volatilityRow,
} from '../../lib/analytics';
import { formatJakartaTime } from '../../lib/format';
import { PAIRS_LIST, PAIRS_MAP } from '../../data/pairs';
import { Panel, PanelHeader } from '../ui';
import { InfoTooltip, LivePulseDot } from '../viz';

// Roadmap §B3: same widened set CurrencyStrengthView now uses, kept in sync so this card's
// "biggest currency spread" read never disagrees with the dedicated Currency Strength panel.
const FX_PAIRS: PairId[] = ['EURUSD', 'GBPUSD', 'USDCHF', 'USDCAD', 'USDJPY', 'AUDUSD', 'NZDUSD'];

type InsightTone = 'up' | 'down' | 'warning';

interface Insight {
  id: string;
  tone: InsightTone;
  text: string;
}

const TONE_ICON: Record<InsightTone, React.ReactNode> = {
  up: <TrendingUp className="w-3.5 h-3.5 text-[var(--color-up)]" />,
  down: <TrendingDown className="w-3.5 h-3.5 text-[var(--color-down)]" />,
  warning: <ShieldAlert className="w-3.5 h-3.5 text-[var(--color-warn)]" />,
};

/**
 * Insight AI (Ringkasan) - Market Intelligence grid, new card.
 *
 * NOT a new AI call or endpoint: every sentence here is a rule-based read of data this SAME tab's
 * other cards already fetch (Market Regime, Currency Strength, Geopolitical Risk, Correlation,
 * Volatility). Each hook call below duplicates a fetch a sibling card also makes - the same
 * already-established pattern this codebase already has (CorrelationView and VolatilityView both
 * independently call `/api/market/candles`; useEndpoint has no shared cache to dedupe through), so
 * this isn't a new inefficiency class, just one more caller of it.
 *
 * A row is included only when its source data is actually available and crosses a real threshold
 * worth surfacing - never a placeholder sentence for a metric that has nothing to say yet. If
 * every source is unavailable, the empty state below says so instead of an empty card.
 */
export const InsightSummaryView: React.FC<{
  prices: Record<PairId, MarketPrice>;
  onNavigate?: (route: string) => void;
  /** Roadmap Batch D: "Calendar <-> Regime <-> AI integration" - the same `calendarEvents` state
   *  App.tsx already fetches for the Calendar tab and TodayCalendarView (this card's own sibling
   *  in this row), not a second calendar fetch. Optional so this card still renders correctly
   *  from any caller that has not been threaded to pass it. */
  calendarEvents?: EconomicEvent[];
}> = ({ prices, onNavigate, calendarEvents = [] }) => {
  const { t } = useTranslation();
  const { regime } = useMarketRegime(prices);
  const geoRisk = useEndpoint<GeopoliticalRiskResponse>('/api/intelligence/geopolitical-risk', 15 * 60_000);
  const candles = useEndpoint<CandlesResponse>('/api/market/candles', 60_000);

  // Client render time (not a fetch timestamp) - this card composes existing reads locally rather
  // than calling anything of its own, so there is no server-side "fetched at" to show instead.
  const [renderedAt, setRenderedAt] = useState(() => formatJakartaTime());
  useEffect(() => {
    setRenderedAt(formatJakartaTime());
  }, [regime.score, geoRisk.data, candles.data]);

  const insights = useMemo(() => {
    const rows: Insight[] = [];

    if (regime.score !== null) {
      rows.push({
        id: 'regime',
        tone: regime.score >= 55 ? 'up' : regime.score <= 45 ? 'down' : 'warning',
        text: t('analysis.insightRegime')
          .replace('{score}', String(Math.round(regime.score)))
          .replace('{label}', t(regimeLabelKey(regime.score))),
      });
    }

    const fxRows = currencyStrength(prices, FX_PAIRS);
    if (fxRows.length >= 2) {
      const sorted = [...fxRows].sort((a, b) => b.score - a.score);
      const strongest = sorted[0];
      const weakest = sorted[sorted.length - 1];
      // Only worth a sentence once the spread is a real signal, not noise around zero.
      if (strongest.score - weakest.score >= 0.2) {
        rows.push({
          id: 'currency',
          tone: 'warning',
          text: t('analysis.insightCurrency').replace('{strong}', strongest.currency).replace('{weak}', weakest.currency),
        });
      }
    }

    if (geoRisk.data && !geoRisk.data.unavailable && geoRisk.data.score !== null) {
      const score = geoRisk.data.score;
      rows.push({
        id: 'georisk',
        tone: score >= 66 ? 'down' : score >= 33 ? 'warning' : 'up',
        text: t('analysis.insightGeoRisk')
          .replace('{band}', t(score >= 66 ? 'geoRisk.bandElevated' : score >= 33 ? 'geoRisk.bandModerate' : 'geoRisk.bandLow'))
          .replace('{score}', String(Math.round(score))),
      });
    }

    const candleData = candles.data?.candles ?? {};
    const usableSymbols = Object.keys(candleData).filter((symbol) => (candleData[symbol] ?? []).length >= 4);
    if (usableSymbols.length >= 2) {
      const returnsBySymbol: Record<string, number[]> = {};
      for (const symbol of usableSymbols) returnsBySymbol[symbol] = toReturns(candleData[symbol]);
      const cells = correlationMatrix(returnsBySymbol, usableSymbols);
      let extreme: { a: string; b: string; value: number } | null = null;
      for (const cell of cells) {
        if (cell.a >= cell.b || cell.value === null) continue;
        if (!extreme || Math.abs(cell.value) > Math.abs(extreme.value)) extreme = { a: cell.a, b: cell.b, value: cell.value };
      }
      if (extreme && Math.abs(extreme.value) >= 0.8) {
        rows.push({
          id: 'correlation',
          tone: 'warning',
          text: t('analysis.insightCorrelation')
            .replace('{a}', PAIRS_MAP[extreme.a as PairId]?.name ?? extreme.a)
            .replace('{b}', PAIRS_MAP[extreme.b as PairId]?.name ?? extreme.b)
            .replace('{value}', extreme.value.toFixed(2)),
        });
      }
    }

    if (Object.keys(candleData).length > 0) {
      const allRows = PAIRS_LIST.map((pair) => volatilityRow(pair.id, candleData[pair.id] ?? [], prices[pair.id]));
      const cryptoRows = PAIRS_LIST.filter((pair) => pair.category === 'crypto').map(
        (pair) => volatilityRow(pair.id, candleData[pair.id] ?? [], prices[pair.id])
      );
      const avgOf = (list: typeof allRows) => {
        const values = list.map((r) => r.atrPercent).filter((v): v is number => v !== null);
        return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
      };
      const overallAvg = avgOf(allRows);
      const cryptoAvg = avgOf(cryptoRows);
      if (overallAvg !== null && cryptoAvg !== null && overallAvg > 0 && cryptoAvg >= overallAvg * 1.5) {
        rows.push({
          id: 'volatility',
          tone: 'warning',
          text: t('analysis.insightVolatility')
            .replace('{crypto}', cryptoAvg.toFixed(2))
            .replace('{overall}', overallAvg.toFixed(2)),
        });
      }
    }

    // Roadmap Batch D: Calendar <-> Regime <-> AI integration - a high-impact release still ahead
    // today is exactly the kind of thing that can move the regime score this same card already
    // reports on above, so it belongs in this synthesis rather than only living on the separate
    // Calendar tab / TodayCalendarView card. Real event data already passed in as a prop, not a
    // second calendar fetch or a predicted/invented reaction.
    const upcomingHighImpact = calendarEvents
      .filter((e) => e.impact === 'High' && e.dateISO && new Date(e.dateISO).getTime() > Date.now())
      .sort((a, b) => new Date(a.dateISO).getTime() - new Date(b.dateISO).getTime());
    if (upcomingHighImpact.length > 0) {
      const next = upcomingHighImpact[0];
      rows.push({
        id: 'calendar',
        tone: 'warning',
        text: t('analysis.insightCalendar')
          .replace('{n}', String(upcomingHighImpact.length))
          .replace('{event}', next.event)
          .replace('{currency}', next.currency)
          .replace('{time}', next.time),
      });
    }

    return rows;
  }, [regime, geoRisk.data, candles.data, prices, calendarEvents, t]);

  const regimeInsight = insights.find((i) => i.id === 'regime');
  const drivers = insights.filter((i) => i.id !== 'regime');
  const marketStateBand = regime.score === null ? null : t(regimeLabelKey(regime.score));

  return (
    <Panel className="h-full flex flex-col">
      <PanelHeader
        eyebrow={t('category.analysis')}
        title="HEVORA INTELLIGENCE"
        actions={
          <div className="flex items-center gap-2">
            <LivePulseDot />
            <span className="font-mono text-[9px] text-[var(--text-muted)] tabular-nums">{renderedAt}</span>
            <InfoTooltip text={t('analysis.insightSubtitle')} />
          </div>
        }
      />

      {insights.length === 0 ? (
        <p className="mt-4 text-[11px] text-[var(--text-muted)]">{t('analysis.insightEmpty')}</p>
      ) : (
        <div className="mt-4 flex-1 space-y-3">
          {marketStateBand && (
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">MARKET STATE</div>
              <div className="text-lg font-black uppercase text-[var(--text-primary)]">{marketStateBand} REGIME</div>
            </div>
          )}

          {drivers.length > 0 && (
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">DRIVERS</div>
              <div className="space-y-1.5">
                {drivers.map((insight) => (
                  <div key={insight.id} className="hev-event-in flex items-start gap-2 text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    <span className="shrink-0 mt-0.5">{TONE_ICON[insight.tone]}</span>
                    <span>{insight.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {regimeInsight && (
            <div className="pt-2 border-t border-[var(--border-subtle)]">
              <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">ONE-LINE INTERPRETATION</div>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{regimeInsight.text}</p>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => onNavigate?.('/intelligence/ai-brief')}
        className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex items-center gap-1.5 text-[10px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        OPEN FULL INTELLIGENCE
        <ArrowRight className="w-3 h-3" />
      </button>
    </Panel>
  );
};
