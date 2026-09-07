import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, Star } from 'lucide-react';
import { IndicesResponse, IndexQuote } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { formatNumber, formatPercent } from '../../lib/format';
import { DataStatus, statusFromAge } from '../../lib/dataState';
import { DataQualityBadge, ErrorState, LoadingState, Panel, PanelHeader, UnavailableState } from '../ui';
import { useWatchlist } from '../../lib/watchlist';
import { LiveValue } from '../viz';

/**
 * Markets > Indices - global equity indices, VIX and DXY from Yahoo Finance via /api/indices.
 *
 * These are context instruments, not tradable symbols in this terminal: there is no signal engine
 * coverage behind them, so the module shows the quote and nothing more. A symbol the provider
 * could not return is rendered as an em dash with its own error tooltip rather than being hidden
 * or filled in - a missing index is information too.
 */

const REGION_ORDER = ['US', 'EU', 'UK', 'JP'];

export const IndicesView: React.FC = () => {
  const { t } = useTranslation();
  const [data, setData] = useState<IndicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Same personal watchlist store the Dashboard's PAIRS_LIST rows write to (lib/watchlist.ts) -
  // index symbols are already registered asset-universe ids (universe.ts's INDEX_ASSETS), so the
  // star here just needed wiring, not a new storage mechanism.
  const { has: isWatched, toggle: toggleWatch } = useWatchlist();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/indices');
      const payload: IndicesResponse | null = await res.json().catch(() => null);
      if (!payload) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setData(payload);
      setError(payload.unavailable ? payload.error || 'Provider unavailable' : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Indices are daily-resolution instruments; a one-minute refresh matches the server cache TTL
    // and is far more than enough (§7.10 - cache TTL follows the character of the data).
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  if (isLoading && !data) return <LoadingState variant="table" />;

  if (error && (!data || data.indices.length === 0)) {
    return data?.unavailable ? (
      <UnavailableState source="Yahoo Finance" detail={error} />
    ) : (
      <ErrorState title={t('indices.errorTitle')} detail={error} source="/api/indices" onRetry={load} />
    );
  }

  const quotes = data?.indices ?? [];
  const grouped = REGION_ORDER.map((region) => ({
    region,
    rows: quotes.filter((q) => q.region === region),
  })).filter((group) => group.rows.length > 0);

  const status: DataStatus = data?.stale ? 'STALE' : statusFromAge(data?.fetchedAt, 90_000, 15 * 60_000);

  const renderRow = (quote: IndexQuote) => {
    const up = (quote.changePercent ?? 0) >= 0;
    return (
      <tr key={quote.symbol} className="border-b border-[var(--border-subtle)] last:border-b-0">
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleWatch(quote.symbol);
              }}
              aria-pressed={isWatched(quote.symbol)}
              aria-label={`${isWatched(quote.symbol) ? t('overview.removeFromWatchlist') : t('overview.addToWatchlist')} ${quote.name}`}
              title={isWatched(quote.symbol) ? t('overview.removeFromWatchlist') : t('overview.addToWatchlist')}
              className="shrink-0 p-1 -m-1 rounded cursor-pointer transition-colors text-[var(--text-muted)] hover:text-[var(--accent-gold)]"
            >
              <Star
                className="w-3.5 h-3.5"
                fill={isWatched(quote.symbol) ? 'var(--accent-gold)' : 'none'}
                stroke={isWatched(quote.symbol) ? 'var(--accent-gold)' : 'currentColor'}
              />
            </button>
            <div>
              <span className="block text-xs font-bold text-[var(--text-primary)]">{quote.name}</span>
              <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                {quote.symbol}
                {quote.marketState ? ` · ${quote.marketState}` : ''}
              </span>
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-primary)] font-bold">
          {quote.value === null ? (
            <span className="text-[var(--text-muted)]" title={quote.error || t('indices.noQuote')}>
              —
            </span>
          ) : (
            <LiveValue value={quote.value} as="span" render={(v) => formatNumber(v as number, 2)} />
          )}
        </td>
        <td
          className={`px-3 py-2.5 text-right tabular-nums font-bold ${
            quote.change === null
              ? 'text-[var(--text-muted)]'
              : up
                ? 'text-[var(--color-up)]'
                : 'text-[var(--color-down)]'
          }`}
        >
          {quote.change === null ? (
            '—'
          ) : (
            <LiveValue value={quote.change} as="span" render={(v) => formatNumber(v as number, 2, { signed: true })} />
          )}
        </td>
        <td
          className={`px-4 py-2.5 text-right tabular-nums font-bold ${
            quote.changePercent === null
              ? 'text-[var(--text-muted)]'
              : up
                ? 'text-[var(--color-up)]'
                : 'text-[var(--color-down)]'
          }`}
        >
          {quote.changePercent === null ? (
            '—'
          ) : (
            <LiveValue value={quote.changePercent} as="span" render={(v) => formatPercent(v as number, 2, { signed: true })} />
          )}
        </td>
      </tr>
    );
  };

  return (
    <Panel flush>
      <div className="p-4 sm:p-5">
        <PanelHeader
          eyebrow={t('category.market')}
          title={t('module.marketIndices')}
          subtitle={t('indices.subtitle')}
          icon={<BarChart3 className="w-4 h-4" />}
          actions={
            <DataQualityBadge
              meta={{ source: data?.source || 'Yahoo Finance', lastUpdated: data?.fetchedAt ?? null, status }}
            />
          }
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-y border-[var(--border-subtle)]">
              <th className="text-left font-bold px-4 py-2">{t('indices.colIndex')}</th>
              <th className="text-right font-bold px-3 py-2">{t('indices.colLast')}</th>
              <th className="text-right font-bold px-3 py-2">{t('indices.colChange')}</th>
              <th className="text-right font-bold px-4 py-2">{t('indices.colChangePct')}</th>
            </tr>
          </thead>
          {grouped.map((group) => (
            <tbody key={group.region}>
              <tr className="bg-[var(--bg-surface)]">
                <td
                  colSpan={4}
                  className="px-4 py-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]"
                >
                  {group.region}
                </td>
              </tr>
              {group.rows.map(renderRow)}
            </tbody>
          ))}
        </table>
      </div>

      <div className="px-4 py-2.5 border-t border-[var(--border-subtle)] text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
        {t('indices.footnote')}
      </div>
    </Panel>
  );
};
