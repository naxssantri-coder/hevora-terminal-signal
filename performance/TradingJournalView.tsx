import React, { useMemo, useState } from 'react';
import { NotebookPen, Save } from 'lucide-react';
import { HistoryResponse, SignalHistoryRecord } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { useJournal } from '../../lib/journal';
import { formatNumber } from '../../lib/format';
import { Badge, EmptyState, LoadingState, Panel, PanelHeader } from '../ui';

/**
 * Notes against trades that actually happened.
 *
 * Rows come from /api/history - the engine's real closed signals - and the journal only ever adds
 * the user's own words on top. It cannot create a trade, and an entry whose signal has left the
 * history window simply stops being listed rather than rendering as a trade with no record
 * behind it.
 */
export const TradingJournalView: React.FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useEndpoint<HistoryResponse>('/api/history', 5 * 60_000);
  const { entries, save } = useJournal();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'all' | 'journalled' | 'unjournalled'>('all');

  const records = useMemo(() => {
    const list: SignalHistoryRecord[] = Array.isArray(data?.history) ? data!.history : [];
    return list
      .slice()
      .sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime())
      .filter((record) => {
        if (filter === 'journalled') return Boolean(entries[record.id]);
        if (filter === 'unjournalled') return !entries[record.id];
        return true;
      });
  }, [data, entries, filter]);

  if (isLoading && !data) return <LoadingState variant="table" />;

  const journalledCount = records.filter((record) => entries[record.id]).length;

  return (
    <div className="space-y-4 font-mono">
      <Panel>
        <PanelHeader
          eyebrow={t('category.performance')}
          title={t('module.tradingJournal')}
          subtitle={t('perf.journalSubtitle')}
          icon={<NotebookPen className="w-4 h-4" />}
          actions={
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {journalledCount}/{records.length} {t('perf.journalled')}
            </span>
          }
        />

        <div className="flex flex-wrap items-center gap-1 mt-4 pt-3 border-t border-[var(--border-subtle)]">
          {(
            [
              ['all', t('signals.all')],
              ['journalled', t('perf.journalled')],
              ['unjournalled', t('perf.notJournalled')],
            ] as Array<['all' | 'journalled' | 'unjournalled', string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border transition-colors cursor-pointer ${
                filter === value
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-strong)]'
                  : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Panel>

      {records.length === 0 ? (
        <EmptyState title={t('perf.journalEmpty')} detail={t('perf.journalEmptyDetail')} />
      ) : (
        <div className="space-y-2">
          {records.map((record) => {
            const entry = entries[record.id];
            const draft = drafts[record.id] ?? entry?.note ?? '';
            const isWin = record.pnlRMultiple > 0;

            return (
              <Panel key={record.id}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[var(--text-primary)]">{record.pairName}</span>
                      <Badge tone={record.type === 'BUY' ? 'up' : 'down'}>{record.type}</Badge>
                      <Badge tone={isWin ? 'up' : 'down'}>{record.finalStatus}</Badge>
                      {entry && <Badge tone="info">{t('perf.journalled')}</Badge>}
                    </span>
                    <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)] mt-1">
                      {new Date(record.closedAt).toLocaleString()} · {record.outcomeCategory}
                    </span>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                      {t('perf.rMultiple')}
                    </span>
                    <span
                      className={`block text-lg font-black tabular-nums ${
                        isWin ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'
                      }`}
                    >
                      {formatNumber(record.pnlRMultiple, 2, { signed: true })}R
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [record.id]: e.target.value }))}
                    placeholder={t('perf.notePlaceholder')}
                    rows={2}
                    className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2.5 py-2 text-[11px] text-[var(--text-primary)] placeholder-[var(--text-muted)] resize-y focus:outline-none focus:border-[var(--border-strong)]"
                  />
                  <button
                    type="button"
                    onClick={() => save(record.id, draft, entry?.rating)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors cursor-pointer shrink-0"
                  >
                    <Save className="w-3 h-3" />
                    {t('perf.saveNote')}
                  </button>
                </div>

                {entry?.updatedAt && (
                  <span className="block text-[9px] text-[var(--text-muted)] mt-1.5">
                    {t('perf.savedAt')} {new Date(entry.updatedAt).toLocaleString()}
                  </span>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed px-1">{t('perf.journalMethod')}</p>
    </div>
  );
};
