import React, { useMemo } from 'react';
import { Brain } from 'lucide-react';
import { LiveEvent, MacroNarrativeResponse, PairId, Signal } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { isActiveSignal } from '../../lib/signals';
import { formatAge, statusFromAge } from '../../lib/dataState';
import { Badge, DataQualityBadge, LoadingState, Panel, PanelHeader, UnavailableState } from '../ui';

/**
 * AI Market Brief.
 *
 * The AI layer is an interpreter, never a source of numbers (§7.6). Everything on this page is
 * either (a) Gemini's own words about macro prints the server actually gathered, served from the
 * existing /api/economic-history/macro-narrative endpoint, or (b) counts and classifications
 * taken directly from the live signal book and the event pipeline. There is no generated figure
 * anywhere, and when the narrative endpoint has nothing the page says so rather than writing a
 * filler paragraph.
 */
const biasTone = (bias: string) => {
  const value = bias.toLowerCase();
  if (value.includes('bull') || value.includes('naik') || value.includes('positif')) return 'up' as const;
  if (value.includes('bear') || value.includes('turun') || value.includes('negatif')) return 'down' as const;
  return 'neutral' as const;
};

export const AiMarketBriefView: React.FC<{
  signals: Record<PairId, Signal | null>;
  onOpenEvent: (id: string) => void;
}> = ({ signals, onOpenEvent }) => {
  const { t } = useTranslation();
  const narrative = useEndpoint<MacroNarrativeResponse>('/api/economic-history/macro-narrative', 30 * 60_000);
  const live = useEndpoint<LiveEvent[] | { events: LiveEvent[] }>('/api/live-events?limit=20', 5 * 60_000);

  const book = useMemo(() => {
    const active = (Object.values(signals) as Array<Signal | null>).filter(
      (signal): signal is Signal => Boolean(signal) && isActiveSignal(signal as Signal)
    );
    const buys = active.filter((signal) => signal.type === 'BUY').length;
    return { buys, sells: active.length - buys, total: active.length };
  }, [signals]);

  const recentHighImpact = useMemo(() => {
    const list = Array.isArray(live.data) ? live.data : (live.data?.events ?? []);
    return list
      .filter((event) => event.impact === 'High')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 4);
  }, [live.data]);

  if (narrative.isLoading && !narrative.data) return <LoadingState variant="cards" />;

  const story = narrative.data?.narrative ?? null;
  const generatedAt = narrative.data?.generatedAt ?? null;

  return (
    <div className="space-y-4 font-mono">
      <Panel>
        <PanelHeader
          eyebrow={t('category.intelligence')}
          title={t('module.aiMarketBrief')}
          subtitle={t('intel.briefSubtitle')}
          icon={<Brain className="w-4 h-4" />}
          actions={
            generatedAt ? (
              <DataQualityBadge
                meta={{
                  source: 'Gemini over FRED prints',
                  lastUpdated: generatedAt,
                  status: statusFromAge(generatedAt, 6 * 60 * 60_000, 3 * 24 * 60 * 60_000),
                }}
              />
            ) : undefined
          }
        />

        {!story ? (
          <div className="mt-4">
            <UnavailableState
              source="/api/economic-history/macro-narrative"
              detail={t('intel.briefUnavailable')}
            />
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {[
              { key: 'intel.whatHappened', body: story.whatHappened },
              { key: 'intel.whyItMatters', body: story.whyItMatters },
              { key: 'intel.whatToWatch', body: story.whatToWatch },
            ].map((section) => (
              <div key={section.key}>
                <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                  {t(section.key)}
                </h3>
                <p className="mt-1.5 text-[11px] text-[var(--text-secondary)] leading-relaxed">{section.body}</p>
              </div>
            ))}

            {story.marketImpactTable.length > 0 && (
              <div className="pt-3 border-t border-[var(--border-subtle)]">
                <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] mb-2">
                  {t('intel.impactRead')}
                </h3>
                <div className="space-y-1.5">
                  {story.marketImpactTable.map((row) => (
                    <div key={row.asset} className="flex items-start gap-3 text-[11px]">
                      <span className="w-20 shrink-0 font-bold text-[var(--text-primary)] uppercase">{row.asset}</span>
                      <Badge tone={biasTone(row.bias)}>{row.bias}</Badge>
                      <span className="flex-1 text-[var(--text-secondary)] leading-relaxed">{row.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="pt-3 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-secondary)] leading-relaxed">
              {t('intel.briefMethod')}
            </p>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel>
          <PanelHeader title={t('intel.bookTitle')} subtitle={t('intel.bookSubtitle')} />
          <div className="mt-4 flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-2">
              <Badge tone="up">BUY</Badge>
              <span className="text-lg font-black tabular-nums text-[var(--color-up)]">{book.buys}</span>
            </span>
            <span className="flex items-center gap-2">
              <Badge tone="down">SELL</Badge>
              <span className="text-lg font-black tabular-nums text-[var(--color-down)]">{book.sells}</span>
            </span>
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {book.total} {t('signals.active')}
            </span>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title={t('intel.recentHighImpact')} subtitle={t('intel.recentHighImpactSub')} />
          <div className="mt-3 space-y-2">
            {recentHighImpact.length === 0 ? (
              <p className="text-[11px] text-[var(--text-secondary)]">{t('intel.noHighImpact')}</p>
            ) : (
              recentHighImpact.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => onOpenEvent(event.id)}
                  className="w-full text-left flex items-start gap-2 py-1.5 border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--card-hover-bg)] transition-colors cursor-pointer"
                >
                  <Badge tone={event.verdict === 'Bullish' ? 'up' : event.verdict === 'Bearish' ? 'down' : 'neutral'}>
                    {event.verdict}
                  </Badge>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] font-bold text-[var(--text-primary)] truncate">
                      {event.title}
                    </span>
                    <span className="block text-[9px] text-[var(--text-muted)] uppercase tracking-wider">
                      {formatAge(event.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
};
