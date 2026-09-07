import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, Check, ChevronDown, ChevronUp, Minus, X } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext';
import type { ConfluenceFactor, ConfluenceResult, MarketStateBias } from '../../lib/confluence/types';
import { formatAge } from '../../lib/dataState';
import { LineChart } from '../charts';
import { Badge, Panel, PanelHeader } from '../ui';
import { GaugeRadial, glowClass, type GaugeZone } from '../viz';

const CONFIDENCE_ZONES: GaugeZone[] = [
  { from: 0, to: 45, color: 'var(--color-down)', label: 'BEARISH' },
  { from: 45, to: 55, color: 'var(--color-warn)', label: 'MIXED' },
  { from: 55, to: 100, color: 'var(--color-up)', label: 'BULLISH' },
];

/**
 * MARKET STATE block, rendered from an already-built ConfluenceResult (§4).
 *
 * Presentation only: every asset's engine produces the same result shape, so gold, a barrel of
 * crude and a coffee contract are read the same way rather than each growing its own layout - and
 * more importantly, its own quietly different idea of what may be shown. Two things this
 * deliberately is not: a trade recommendation - entry, stop and target stay with the signal engine
 * and are not repeated here - and its historical analog is not a probability. Every factor row
 * prints the provider's own number, its source, how often that source updates, and a link to the
 * module that owns it, so a reader can walk from the conclusion down to the raw metric.
 *
 * Two-level display (Fase 11 §2): every one of these sections rendering at once, on every asset
 * page, pushed the Signal card far below the fold. Collapsed by default now: gauge + bias label +
 * the one-sentence narrative is enough to answer "why is price moving like this" at a glance. The
 * full breakdown (what changed, supporting/contradicting, trend chart, invalidation, catalyst,
 * analog, unwired inputs) is one click away, not gone - a reader who wants to verify the read still
 * gets the whole drill-down chain. The disclaimer stays visible either way; it is a trust framing
 * statement, not detail content someone would choose to hide.
 */
const biasTone = (bias: MarketStateBias): 'up' | 'down' | 'warning' | 'neutral' => {
  if (bias === 'Bullish') return 'up';
  if (bias === 'Bearish') return 'down';
  if (bias === 'Signal Conflict' || bias === 'Transition' || bias === 'Mixed') return 'warning';
  return 'neutral';
};

const FactorRow: React.FC<{ factor: ConfluenceFactor; onOpen: (route: string) => void }> = ({ factor, onOpen }) => {
  const Icon = factor.stance === 'supporting' ? Check : factor.stance === 'contradicting' ? X : Minus;
  const color =
    factor.stance === 'supporting'
      ? 'var(--color-up)'
      : factor.stance === 'contradicting'
        ? 'var(--color-down)'
        : 'var(--text-muted)';

  return (
    <button
      type="button"
      onClick={() => factor.route && onOpen(factor.route)}
      className="w-full text-left flex items-start gap-2.5 py-2 border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--card-hover-bg)] transition-colors cursor-pointer"
    >
      <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color }} />
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[11px] font-bold text-[var(--text-primary)]">{factor.label}</span>
          <span className="text-[11px] tabular-nums text-[var(--text-primary)]">{factor.rawValue}</span>
          {factor.change && (
            <span className="text-[10px] tabular-nums" style={{ color }}>
              {factor.change}
            </span>
          )}
        </span>
        <span className="block text-[10px] text-[var(--text-secondary)] leading-relaxed mt-0.5">
          {factor.reasoning}
        </span>
        {/* Provenance line - the bottom of the drill-down chain, always visible rather than in a
            tooltip, because a weekly input reading as live is the failure this whole block guards. */}
        <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)] mt-1">
          {factor.source} · {factor.frequency}
          {factor.timestamp ? ` · ${formatAge(factor.timestamp)}` : ''}
        </span>
      </span>
      {factor.route && <ArrowRight className="w-3 h-3 text-[var(--text-muted)] shrink-0 mt-1" />}
    </button>
  );
};

export const ConfluenceView: React.FC<{
  result: ConfluenceResult;
  onOpen: (route: string) => void;
}> = ({ result, onOpen }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const glow =
    result.confidence === null
      ? null
      : result.confidence >= 55
        ? 'up'
        : result.confidence <= 45
          ? 'down'
          : null;

  return (
    <Panel className={glowClass(glow)}>
      <PanelHeader
        eyebrow={t('confluence.eyebrow')}
        title={`${t('confluence.title')} — ${result.asset}`}
        subtitle={t('confluence.subtitle')}
        actions={
          result.anomaly ? (
            <Badge tone="warning" title={result.anomaly.detail}>
              <AlertTriangle className="w-2.5 h-2.5" />
              {t('confluence.anomaly')}
            </Badge>
          ) : undefined
        }
      />

      {/* Ringkas (always visible): gauge + bias label + the one-sentence narrative. Enough to
          answer "why", on its own, without scrolling past it to reach the Signal card below. */}
      <div className="flex flex-col lg:flex-row gap-6 mt-5">
        <div className="shrink-0 flex flex-col items-center gap-2">
          <GaugeRadial
            value={result.confidence}
            zones={CONFIDENCE_ZONES}
            captionOverride={result.bias.toUpperCase()}
            label={`${result.liveFactorCount}/${result.factors.length} ${t('confluence.factorsLive')}`}
            size={168}
          />
          {result.confidence !== null && (
            <Badge tone={biasTone(result.bias)}>{result.convictionLabel}</Badge>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          {/* Trader-language read, always closing with what to watch next (§11). */}
          <p className="text-[12px] text-[var(--text-primary)] leading-relaxed">{result.narrative}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="mt-4 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
      >
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {expanded ? t('confluence.hideDetail') : t('confluence.viewDetail')}
      </button>

      {/* Detail (Fase 11 §2): the full breakdown, one click away rather than always on screen.
          2026-09-02 (Pasar page visual polish): each section below used to be separated only by a
          flat hairline border-t - reads as one long scroll of text rather than the card-based
          language the rest of this app uses (Signal card's ENTRY/SL/TP tiles, etc.). Same
          bg-surface/rounded/bordered sub-card treatment now wraps each one instead, with spacing
          between cards doing the separating job the dividers used to - purely a presentation
          change, every label/value/route below is untouched. */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] space-y-3">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[12px] p-3.5 space-y-3">
            {result.whatChanged.length > 0 && (
              <div>
                <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] mb-1.5">
                  {t('confluence.whatChanged')}
                </h3>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {result.whatChanged.map((factor) => (
                    <span key={factor.id} className="text-[11px] text-[var(--text-secondary)]">
                      {factor.label}{' '}
                      <span className="tabular-nums font-bold text-[var(--text-primary)]">{factor.change}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed border-l-2 border-[var(--border-strong)] pl-3">
              {result.conflictNote}
            </div>
          </div>

          {/* §9: the one visual proof behind the 'trend' factor's number. Rendered only when that
              factor actually exists (see core.ts's trendChart) - a chart illustrates a claim the
              engine already made, it never adds a new one of its own. */}
          {result.trendChart && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[12px] p-3.5">
              <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] mb-2">
                {t('confluence.trendChart')} · {t('confluence.trendChartWindow').replace('{n}', String(result.trendChart.window))}
              </h3>
              <LineChart
                points={result.trendChart.price}
                secondary={result.trendChart.movingAverage}
                secondaryLabel={`MA${result.trendChart.window}`}
                valueDigits={result.trendChart.digits}
                color="var(--color-up)"
              />
            </div>
          )}

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[12px] p-3.5 grid grid-cols-1 lg:grid-cols-2 gap-x-6">
            <div>
              <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--color-up)] mb-1">
                {t('confluence.supporting')} ({result.supporting.length})
              </h3>
              {result.supporting.length === 0 ? (
                <p className="text-[10px] text-[var(--text-muted)] py-2">{t('confluence.none')}</p>
              ) : (
                result.supporting.map((factor) => <FactorRow key={factor.id} factor={factor} onOpen={onOpen} />)
              )}
            </div>

            <div>
              <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--color-down)] mb-1 mt-4 lg:mt-0">
                {t('confluence.contradicting')} ({result.contradicting.length})
              </h3>
              {result.contradicting.length === 0 ? (
                <p className="text-[10px] text-[var(--text-muted)] py-2">{t('confluence.none')}</p>
              ) : (
                result.contradicting.map((factor) => <FactorRow key={factor.id} factor={factor} onOpen={onOpen} />)
              )}
            </div>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[12px] p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] mb-1.5">
                {t('confluence.invalidation')}
              </h3>
              {result.invalidation.length === 0 ? (
                <p className="text-[10px] text-[var(--text-muted)]">{t('confluence.none')}</p>
              ) : (
                result.invalidation.map((item) => (
                  <div key={item.condition} className="mb-2">
                    <p className="text-[10px] text-[var(--text-primary)] leading-relaxed">• {item.condition}</p>
                    <p className="text-[9px] text-[var(--text-muted)] leading-relaxed pl-2">{item.basis}</p>
                  </div>
                ))
              )}
            </div>

            <div>
              <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] mb-1.5">
                {t('confluence.nextCatalyst')}
              </h3>
              {result.nextCatalyst ? (
                <>
                  <p className="text-[11px] font-bold text-[var(--text-primary)]">{result.nextCatalyst.event}</p>
                  <p className="text-[10px] text-[var(--text-secondary)] tabular-nums">
                    {result.nextCatalyst.dateISO.slice(0, 10)} · {result.nextCatalyst.currency}
                  </p>
                  <Badge tone="down" className="mt-1">
                    {result.nextCatalyst.impact} impact
                  </Badge>
                </>
              ) : (
                <p className="text-[10px] text-[var(--text-muted)]">{t('confluence.noCatalyst')}</p>
              )}
            </div>

            <div>
              <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] mb-1.5">
                {t('confluence.analog')}
              </h3>
              {result.analog ? (
                <>
                  <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">{result.analog.summary}</p>
                  <p className="text-[9px] text-[var(--text-muted)] leading-relaxed mt-1">{t('confluence.analogNote')}</p>
                </>
              ) : (
                <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">{t('confluence.analogInsufficient')}</p>
              )}
            </div>
          </div>

          {/* Inputs this read SHOULD have and does not (§10). Naming them is the whole point: a
              factor that is simply absent from the list looks identical to a factor that is quiet
              today, and flow data is exactly where an invented number would hide. */}
          {result.unavailableInputs.length > 0 && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[12px] p-3.5">
              <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--color-warn)] mb-1.5">
                {t('confluence.notWired')}
              </h3>
              {result.unavailableInputs.map((item) => (
                <div key={item.label} className="mb-2 last:mb-0">
                  <p className="text-[10px] text-[var(--text-primary)] leading-relaxed">
                    • {item.label} — <span className="font-bold text-[var(--color-warn)]">{item.status}</span>
                  </p>
                  <p className="text-[9px] text-[var(--text-muted)] leading-relaxed pl-2">{item.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="mt-4 pt-3 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-secondary)] leading-relaxed">
        {t('confluence.disclaimer')}
      </p>
    </Panel>
  );
};
