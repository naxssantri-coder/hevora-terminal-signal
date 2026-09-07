import React, { useMemo, useState } from 'react';
import { Compass, Plus, Trash2 } from 'lucide-react';
import { MarketPrice, PairId } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { PAIRS_LIST } from '../../data/pairs';
import { PaperSide, positionPnl, positionPnlPercent, usePaperTrading } from '../../lib/paperTrading';
import { aggregateFeedMeta } from '../../lib/dataState';
import { formatNumber, formatPercent } from '../../lib/format';
import { PairIcon } from '../PairIcon';
import { Badge, DataQualityBadge, EmptyState, Panel, PanelHeader } from '../ui';

/**
 * Practice execution against the live feed.
 *
 * There is no entry-price field on purpose: a position opens at whatever the feed is quoting the
 * moment the button is pressed, and closes the same way. A typed-in fill at a price the market
 * never printed would make the resulting track record fiction, which is worse than having none.
 * When a quote is unavailable the trade button is disabled and says why.
 */
export const PaperTradingView: React.FC<{ prices: Record<PairId, MarketPrice> }> = ({ prices }) => {
  const { t } = useTranslation();
  const { open, closed, openPosition, closePosition, removePosition } = usePaperTrading();
  const [pairId, setPairId] = useState<PairId>('XAUUSD');
  const [side, setSide] = useState<PaperSide>('BUY');
  const [size, setSize] = useState<string>('1');
  const [error, setError] = useState<string | null>(null);

  const quote = prices[pairId];
  const canTrade = Boolean(quote && Number.isFinite(quote.price) && Number(size) > 0);

  const stats = useMemo(() => {
    const realized = closed.map((position) => positionPnl(position, prices[position.pairId]) ?? 0);
    const wins = realized.filter((value) => value > 0).length;
    return {
      closedCount: closed.length,
      wins,
      winRate: closed.length === 0 ? null : (wins / closed.length) * 100,
      realizedTotal: realized.reduce((sum, value) => sum + value, 0),
      unrealizedTotal: open.reduce((sum, position) => sum + (positionPnl(position, prices[position.pairId]) ?? 0), 0),
    };
  }, [closed, open, prices]);

  const handleOpen = () => {
    const created = openPosition(pairId, side, Number(size), quote);
    setError(created ? null : t('perf.openFailed'));
  };

  const pnlCell = (value: number | null, digits = 2) => (
    <span
      className={`tabular-nums font-bold ${
        value === null
          ? 'text-[var(--text-muted)]'
          : value >= 0
            ? 'text-[var(--color-up)]'
            : 'text-[var(--color-down)]'
      }`}
    >
      {value === null ? '—' : formatNumber(value, digits, { signed: true })}
    </span>
  );

  return (
    <div className="space-y-4 font-mono">
      <Panel>
        <PanelHeader
          eyebrow={t('category.performance')}
          title={t('module.paperTrading')}
          subtitle={t('perf.paperSubtitle')}
          icon={<Compass className="w-4 h-4" />}
          actions={
            <DataQualityBadge
              meta={aggregateFeedMeta('HEVORA Price Feed', PAIRS_LIST.map((pair) => prices[pair.id]), 15_000, 120_000)}
            />
          }
        />

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('perf.asset')}</span>
            <select
              value={pairId}
              onChange={(e) => setPairId(e.target.value as PairId)}
              className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-[11px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-strong)] cursor-pointer"
            >
              {PAIRS_LIST.map((pair) => (
                <option key={pair.id} value={pair.id}>
                  {pair.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('perf.side')}</span>
            <div className="flex gap-1">
              {(['BUY', 'SELL'] as PaperSide[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSide(value)}
                  className={`px-3 py-1.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                    side === value
                      ? value === 'BUY'
                        ? 'bg-[var(--color-up)]/15 text-[var(--color-up)] border-[var(--color-up)]/40'
                        : 'bg-[var(--color-down)]/15 text-[var(--color-down)] border-[var(--color-down)]/40'
                      : 'text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('perf.size')}</span>
            <input
              type="number"
              min="0"
              step="any"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="w-24 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-[11px] text-[var(--text-primary)] tabular-nums focus:outline-none focus:border-[var(--border-strong)]"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('perf.entryPrice')}</span>
            <span className="px-2 py-1.5 text-[11px] font-bold tabular-nums text-[var(--text-primary)]">
              {quote ? formatNumber(quote.price, quote.digits) : '—'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleOpen}
            disabled={!canTrade}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[var(--text-primary)] text-[var(--bg-base)] text-[10px] font-extrabold uppercase tracking-wider hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-3 h-3" />
            {t('perf.openPosition')}
          </button>
        </div>

        {!quote && (
          <p className="mt-2 text-[10px] text-[var(--color-warn)]">{t('perf.noQuote')}</p>
        )}
        {error && <p className="mt-2 text-[10px] text-[var(--color-down)]">{error}</p>}

        <div className="mt-5 pt-4 border-t border-[var(--border-subtle)] grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('perf.openPositions')}</span>
            <span className="block text-lg font-black tabular-nums text-[var(--text-primary)]">{open.length}</span>
          </div>
          <div>
            <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('perf.unrealized')}</span>
            <span className="block text-lg font-black">{pnlCell(stats.unrealizedTotal)}</span>
          </div>
          <div>
            <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('perf.realized')}</span>
            <span className="block text-lg font-black">{pnlCell(stats.realizedTotal)}</span>
          </div>
          <div>
            <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('perf.winRate')}</span>
            <span className="block text-lg font-black tabular-nums text-[var(--text-primary)]">
              {stats.winRate === null ? '—' : `${formatNumber(stats.winRate, 0)}%`}
            </span>
            <span className="block text-[9px] text-[var(--text-muted)]">
              {stats.wins}/{stats.closedCount} {t('perf.closed')}
            </span>
          </div>
        </div>
      </Panel>

      <Panel flush>
        <div className="p-4 sm:p-5">
          <PanelHeader title={t('perf.openTitle')} subtitle={t('perf.openSubtitle')} />
        </div>

        {open.length === 0 ? (
          <div className="p-4 sm:p-5 border-t border-[var(--border-subtle)]">
            <EmptyState title={t('perf.noOpen')} detail={t('perf.noOpenDetail')} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-y border-[var(--border-subtle)]">
                  <th className="text-left font-bold px-4 py-2">{t('perf.asset')}</th>
                  <th className="text-left font-bold px-3 py-2">{t('perf.side')}</th>
                  <th className="text-right font-bold px-3 py-2">{t('perf.size')}</th>
                  <th className="text-right font-bold px-3 py-2">{t('perf.entry')}</th>
                  <th className="text-right font-bold px-3 py-2">{t('perf.last')}</th>
                  <th className="text-right font-bold px-3 py-2">{t('perf.pnl')}</th>
                  <th className="text-right font-bold px-3 py-2">%</th>
                  <th className="text-right font-bold px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {open.map((position) => {
                  const market = prices[position.pairId];
                  const digits = market?.digits ?? 2;
                  return (
                    <tr key={position.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2">
                          <PairIcon pairId={position.pairId} size={16} />
                          <span className="font-bold text-[var(--text-primary)]">{position.pairId}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={position.side === 'BUY' ? 'up' : 'down'}>{position.side}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-secondary)]">
                        {formatNumber(position.size, 2)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-secondary)]">
                        {formatNumber(position.entryPrice, digits)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-primary)]">
                        {market ? formatNumber(market.price, digits) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right">{pnlCell(positionPnl(position, market))}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span
                          className={`tabular-nums font-bold ${
                            (positionPnlPercent(position, market) ?? 0) >= 0
                              ? 'text-[var(--color-up)]'
                              : 'text-[var(--color-down)]'
                          }`}
                        >
                          {positionPnlPercent(position, market) === null
                            ? '—'
                            : formatPercent(positionPnlPercent(position, market), 2, { signed: true })}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => closePosition(position.id, market)}
                          disabled={!market}
                          className="px-2 py-1 rounded border border-[var(--border-strong)] text-[9px] font-bold uppercase tracking-wider text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title={market ? undefined : t('perf.noQuote')}
                        >
                          {t('perf.close')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {closed.length > 0 && (
        <Panel flush>
          <div className="p-4 sm:p-5">
            <PanelHeader title={t('perf.closedTitle')} subtitle={t('perf.closedSubtitle')} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-y border-[var(--border-subtle)]">
                  <th className="text-left font-bold px-4 py-2">{t('perf.asset')}</th>
                  <th className="text-left font-bold px-3 py-2">{t('perf.side')}</th>
                  <th className="text-right font-bold px-3 py-2">{t('perf.entry')}</th>
                  <th className="text-right font-bold px-3 py-2">{t('perf.exit')}</th>
                  <th className="text-right font-bold px-3 py-2">{t('perf.pnl')}</th>
                  <th className="text-right font-bold px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {closed.map((position) => {
                  const digits = prices[position.pairId]?.digits ?? 2;
                  return (
                    <tr key={position.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
                      <td className="px-4 py-2.5 font-bold text-[var(--text-primary)]">{position.pairId}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone={position.side === 'BUY' ? 'up' : 'down'}>{position.side}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-secondary)]">
                        {formatNumber(position.entryPrice, digits)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-secondary)]">
                        {formatNumber(position.exitPrice ?? null, digits)}
                      </td>
                      <td className="px-3 py-2.5 text-right">{pnlCell(positionPnl(position, prices[position.pairId]))}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => removePosition(position.id)}
                          aria-label={t('perf.remove')}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--color-down)] transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed px-1">{t('perf.paperMethod')}</p>
    </div>
  );
};
