import React, { useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { ResearchItem } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { EmptyState, ErrorState, LoadingState, Panel, PanelHeader } from '../ui';

/**
 * Desk research, split out of the combined Intel feed into its own module.
 *
 * Same /api/research endpoint the Intel tab already reads - this is a second view of the same
 * published items, not a second store. Items are editorial, written through the admin panel, so
 * there is no data-quality badge here: provenance is the author, shown on each card.
 */
const CATEGORIES = ['All', 'Forex', 'Crypto', 'Commodities', 'Macro'] as const;
type CategoryFilter = (typeof CATEGORIES)[number];

export const ResearchView: React.FC = () => {
  const { t } = useTranslation();
  const { data, error, isLoading, reload } = useEndpoint<ResearchItem[]>('/api/research', 5 * 60_000);
  const [category, setCategory] = useState<CategoryFilter>('All');
  const [selected, setSelected] = useState<ResearchItem | null>(null);

  const items = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    const filtered = category === 'All' ? list : list.filter((item) => item.category === category);
    return filtered
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [data, category]);

  if (isLoading && !data) return <LoadingState variant="cards" />;
  if (error && !data) return <ErrorState title={t('intel.researchError')} detail={error} source="/api/research" onRetry={reload} />;

  return (
    <div className="space-y-4 font-mono">
      <Panel>
        <PanelHeader
          eyebrow={t('category.intelligence')}
          title={t('module.research')}
          subtitle={t('intel.researchSubtitle')}
          icon={<BookOpen className="w-4 h-4" />}
          actions={
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {items.length} {t('intel.items')}
            </span>
          }
        />

        <div className="flex flex-wrap items-center gap-1 mt-4 pt-3 border-t border-[var(--border-subtle)]">
          {CATEGORIES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setCategory(value)}
              className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border transition-colors duration-150 cursor-pointer ${
                value === category
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-strong)]'
                  : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </Panel>

      {items.length === 0 ? (
        <EmptyState title={t('intel.researchEmpty')} detail={t('intel.researchEmptyDetail')} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(selected?.id === item.id ? null : item)}
              className="text-left hev-card-v2 border border-[var(--border-subtle)] hover:border-[var(--border-strong)] rounded-[14px] p-4 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-warn)]">
                  {item.category}
                </span>
                <span className="text-[9px] text-[var(--text-muted)] tabular-nums">
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
              </div>

              <h3 className="mt-2 text-sm font-bold text-[var(--text-primary)] leading-snug">{item.title}</h3>
              <p className="mt-1.5 text-[11px] text-[var(--text-secondary)] leading-relaxed">{item.summary}</p>

              {selected?.id === item.id && item.content && (
                <p className="mt-3 pt-3 border-t border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-line">
                  {item.content}
                </p>
              )}

              <div className="mt-3 flex items-center justify-between text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                <span>{item.author || t('intel.deskAuthor')}</span>
                <span>{selected?.id === item.id ? t('intel.collapse') : t('intel.expand')}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
