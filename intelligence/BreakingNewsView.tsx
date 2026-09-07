import React, { useMemo } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { LiveEvent } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { formatAge, statusFromAge } from '../../lib/dataState';
import { Badge, DataQualityBadge, EmptyState, LoadingState, Panel, PanelHeader } from '../ui';

/**
 * High-impact headlines only, newest first.
 *
 * A filtered view of the same /api/live-events feed the Intel module reads - the filter is the
 * pipeline's own `impact: 'High'` classification, not a re-scoring done here. The window is
 * explicit (48 hours) so an empty page reads as "nothing high-impact landed recently" rather than
 * as a broken feed.
 */
const WINDOW_MS = 48 * 60 * 60_000;

const toneBadge = (verdict: LiveEvent['verdict']) =>
  verdict === 'Bullish' ? 'up' : verdict === 'Bearish' ? 'down' : 'neutral';

export const BreakingNewsView: React.FC<{ onOpenEvent: (id: string) => void }> = ({ onOpenEvent }) => {
  const { t } = useTranslation();
  const { data, isLoading } = useEndpoint<LiveEvent[] | { events: LiveEvent[] }>('/api/live-events?limit=60', 60_000);

  const events = useMemo(() => {
    const list = Array.isArray(data) ? data : (data?.events ?? []);
    const cutoff = Date.now() - WINDOW_MS;
    return list
      .filter((event) => event.impact === 'High')
      .filter((event) => new Date(event.createdAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [data]);

  const newest = useMemo(() => {
    const list = Array.isArray(data) ? data : (data?.events ?? []);
    return list.map((event) => event.createdAt).sort().pop() ?? null;
  }, [data]);

  if (isLoading && !data) return <LoadingState variant="table" />;

  return (
    <div className="space-y-4 font-mono">
      <Panel>
        <PanelHeader
          eyebrow={t('category.intelligence')}
          title={t('module.breakingNews')}
          subtitle={t('intel.breakingSubtitle')}
          icon={<AlertTriangle className="w-4 h-4" />}
          actions={
            <DataQualityBadge
              meta={{
                source: 'HEVORA Live Intelligence',
                lastUpdated: newest,
                // "LIVE" here means "not stale" (same freshness-window convention every other
                // DataQualityBadge in the app uses), not a continuous push feed - the note below
                // states the actual ~15-minute publish cadence explicitly so that isn't assumed.
                status: statusFromAge(newest, 6 * 60 * 60_000, 48 * 60 * 60_000),
              }}
            />
          }
        />
      </Panel>

      {/* 2026-08-31 audit: same freshness-cadence disclosure as IntelView's news feed - this is a
          scheduled ~15-minute publish cycle, not a realtime stream. */}
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] font-mono px-1 -mt-2">
        <span>{t('intel.newsFreshnessNote')}</span>
      </div>

      {events.length === 0 ? (
        <EmptyState title={t('intel.breakingEmpty')} detail={t('intel.breakingEmptyDetail')} />
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => onOpenEvent(event.id)}
              className="w-full text-left hev-card-v2 border border-[var(--border-subtle)] hover:border-[var(--border-strong)] rounded-[14px] p-4 transition-colors cursor-pointer"
              style={{ borderLeftWidth: '3px', borderLeftColor: 'var(--color-down)' }}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="flex items-center gap-1.5">
                  <Badge tone="down">{event.impact}</Badge>
                  <Badge tone={toneBadge(event.verdict)}>{event.verdict}</Badge>
                  <Badge tone="neutral">{event.tone}</Badge>
                </span>
                <span className="text-[9px] text-[var(--text-muted)] tabular-nums uppercase tracking-wider">
                  {formatAge(event.createdAt)} · {event.source || t('intel.sourceUnknown')}
                </span>
              </div>

              <h3 className="mt-2 text-sm font-bold text-[var(--text-primary)] leading-snug">{event.title}</h3>
              <p className="mt-1.5 text-[11px] text-[var(--text-secondary)] leading-relaxed line-clamp-3">
                {event.summary}
              </p>

              {(event.assetClassImpacts?.length ?? 0) > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {event.assetClassImpacts?.map((impact) => (
                    <Badge key={impact.assetClass} tone={toneBadge(impact.direction)}>
                      {impact.assetClass} {impact.direction}
                    </Badge>
                  ))}
                </div>
              )}

              <span className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold text-[var(--text-primary)]">
                {t('intel.openEvent')}
                <ArrowRight className="w-3 h-3" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
