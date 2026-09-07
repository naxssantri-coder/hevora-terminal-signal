import React, { useMemo, useState } from 'react';
import { Droplet, Flame, Star } from 'lucide-react';
import {
  CommoditiesResponse,
  CommodityHistoryResponse,
  CommodityQuote,
  CotResponse,
  CrudeStocksResponse,
  DxyResponse,
  EconHistoryResponse,
  EconomicEvent,
} from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { latestPoint, latestValue } from '../../lib/useFredSeries';
import { formatNumber, formatPercent } from '../../lib/format';
import { DataStatus, statusFromAge } from '../../lib/dataState';
import { buildCommodityConfluence } from '../../lib/confluence/commodity';
import { COMMODITY_SPECS, getCommoditySpec } from '../../lib/confluence/commoditySpecs';
import { Badge, DataQualityBadge, ErrorState, LoadingState, Panel, PanelHeader, UnavailableState } from '../ui';
import { ConfluenceView } from '../confluence/ConfluenceView';
import { useWatchlist } from '../../lib/watchlist';
import { InfoTooltip, LiveValue } from '../viz';

/**
 * Markets > Commodities: the futures board, and the Confluence Engine read for whichever contract
 * the reader selects (§4, replicated from XAU).
 *
 * Every symbol on this board was probed live before it was wired (verify:sources run #3, Yahoo
 * futures 15/15). A contract the provider could not quote shows an em dash with its own error
 * rather than being hidden, and its confluence read simply loses that factor - which the coverage
 * floor makes visible instead of filling the gap with a neutral-looking zero.
 */

const GROUP_ORDER: Array<CommodityQuote['group']> = ['energy', 'metals', 'agriculture'];

export const CommodityBoard: React.FC<{
  events: EconomicEvent[];
  onOpen: (route: string) => void;
}> = ({ events, onOpen }) => {
  const { t } = useTranslation();
  // WTI is the default read: it is the contract with the deepest factor set on this board, being
  // the only one with an inventory series wired behind it.
  const [selected, setSelected] = useState('CL=F');
  // Same personal watchlist store OverviewView's PAIRS_LIST rows write to (lib/watchlist.ts) -
  // it already accepts any asset-universe id, commodity symbols included (see universe.ts's
  // COMMODITY_ASSETS), so wiring the star here needed no change to the storage layer itself.
  const { has: isWatched, toggle: toggleWatch } = useWatchlist();

  const board = useEndpoint<CommoditiesResponse>('/api/market/commodities', 60_000);
  const history = useEndpoint<CommodityHistoryResponse>(
    `/api/market/commodity-history?symbol=${encodeURIComponent(selected)}`,
    30 * 60_000
  );
  const stocks = useEndpoint<CrudeStocksResponse>('/api/energy/crude-stocks', 60 * 60_000);
  const dxy = useEndpoint<DxyResponse>('/api/macro/dxy', 60_000);
  const cot = useEndpoint<CotResponse>('/api/positioning/cot', 60 * 60_000);
  const vix = useEndpoint<EconHistoryResponse>(
    '/api/economic-history?indicator=VIXCLS&currency=USD&months=12',
    15 * 60_000
  );
  const realYield = useEndpoint<EconHistoryResponse>(
    '/api/economic-history?indicator=DFII10&currency=USD&months=12',
    15 * 60_000
  );

  const quotes = board.data?.commodities ?? [];
  const spec = getCommoditySpec(selected);
  const quote = quotes.find((q) => q.symbol === selected);

  const result = useMemo(() => {
    // A deferring spec (Gold -> XAU/USD) never needs its own confluence build - its card is
    // replaced by a short "same as above" note instead (dedupe fix, Poin 9), so there's nothing
    // for this result to feed.
    if (!spec || spec.defersTo) return null;
    const ryPoints = (realYield.data?.points ?? []).filter((p) => p.actual !== null);
    const contractCot = cot.data?.positions?.[spec.symbol];
    // History only counts when it belongs to the selected contract: the endpoint is re-fetched on
    // every switch, and one render with the previous contract's closes would put another market's
    // trend behind this one's name.
    const points = history.data?.symbol === spec.symbol ? (history.data?.points ?? []) : [];

    return buildCommodityConfluence({
      spec,
      quote: {
        price: quote?.price ?? null,
        changePercent: quote?.changePercent ?? null,
        quoteTime: quote?.quoteTime ?? null,
      },
      dxy: {
        price: dxy.data?.unavailable ? null : (dxy.data?.price ?? null),
        trend15m: dxy.data?.unavailable ? null : (dxy.data?.trend15m ?? null),
        lastUpdated: dxy.data?.lastUpdated ?? null,
      },
      cot: {
        net: contractCot?.netContracts ?? null,
        percentile: contractCot?.percentile ?? null,
        reportDate: contractCot?.reportDate ?? null,
      },
      vix: { latest: latestValue(vix.data ?? undefined), date: latestPoint(vix.data ?? undefined)?.date ?? null },
      realYield: {
        latest: ryPoints.length ? (ryPoints[ryPoints.length - 1].actual as number) : null,
        previous: ryPoints.length > 1 ? (ryPoints[ryPoints.length - 2].actual as number) : null,
        date: latestPoint(realYield.data ?? undefined)?.date ?? null,
      },
      crudeStocks: stocks.data?.unavailable ? [] : (stocks.data?.points ?? []),
      history: points,
      events,
    });
  }, [spec, quote, dxy.data, cot.data, vix.data, realYield.data, stocks.data, history.data, events]);

  // Roadmap §4/§5: Oil Intelligence - WTI/Brent were previously just two rows in this same
  // table, with the EIA inventory read only surfacing once WTI happened to be the selected
  // contract. Same data this board already fetches (quotes + the crude-stocks endpoint above),
  // just given its own glance-able strip so oil doesn't require a click to see, matching how Gold
  // gets its own dedicated hub.
  const wti = quotes.find((q) => q.symbol === 'CL=F');
  const brent = quotes.find((q) => q.symbol === 'BZ=F');
  const stockPoints = stocks.data?.unavailable ? [] : (stocks.data?.points ?? []);
  const latestStock = stockPoints.length > 0 ? stockPoints[stockPoints.length - 1] : null;
  const priorStock = stockPoints.length > 1 ? stockPoints[stockPoints.length - 2] : null;
  const stockChange = latestStock && priorStock ? latestStock.value - priorStock.value : null;

  if (board.isLoading && !board.data) return <LoadingState variant="table" />;

  if (board.data?.unavailable || (board.error && quotes.length === 0)) {
    return board.data?.unavailable ? (
      <UnavailableState source="Yahoo Finance" detail={board.data.error || board.error || undefined} />
    ) : (
      <ErrorState
        title={t('commodities.errorTitle')}
        detail={board.error || undefined}
        source="/api/market/commodities"
        onRetry={board.reload}
      />
    );
  }

  const status: DataStatus = board.data?.stale ? 'STALE' : statusFromAge(board.data?.fetchedAt, 90_000, 15 * 60_000);
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    rows: quotes.filter((q) => q.group === group),
  })).filter((g) => g.rows.length > 0);

  const renderRow = (row: CommodityQuote) => {
    const rowSpec = getCommoditySpec(row.symbol);
    const up = (row.changePercent ?? 0) >= 0;
    const isSelected = row.symbol === selected;
    // A deferring row (Gold -> XAU/USD) is now selectable too (dedupe fix, Poin 9): it used to be
    // a dead click, which hid the fact that its read is the SAME XAU/USD panel already on screen
    // above rather than making that visible. See the `spec?.defersTo` branch below.
    const selectable = Boolean(rowSpec);

    return (
      <tr
        key={row.symbol}
        onClick={() => selectable && setSelected(row.symbol)}
        className={`border-b border-[var(--border-subtle)] last:border-b-0 ${
          selectable ? 'cursor-pointer hover:bg-[var(--card-hover-bg)]' : ''
        } ${isSelected ? 'bg-[var(--card-hover-bg)]' : ''}`}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleWatch(row.symbol);
              }}
              aria-pressed={isWatched(row.symbol)}
              aria-label={`${isWatched(row.symbol) ? t('overview.removeFromWatchlist') : t('overview.addToWatchlist')} ${row.name}`}
              title={isWatched(row.symbol) ? t('overview.removeFromWatchlist') : t('overview.addToWatchlist')}
              className="shrink-0 p-1 -m-1 rounded cursor-pointer transition-colors text-[var(--text-muted)] hover:text-[var(--accent-gold)]"
            >
              <Star
                className="w-3.5 h-3.5"
                fill={isWatched(row.symbol) ? 'var(--accent-gold)' : 'none'}
                stroke={isWatched(row.symbol) ? 'var(--accent-gold)' : 'currentColor'}
              />
            </button>
            <div>
              <span className="block text-xs font-bold text-[var(--text-primary)]">{row.name}</span>
              <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                {row.symbol}
                {row.marketState ? ` · ${row.marketState}` : ''}
                {rowSpec?.defersTo ? ` · ${t('commodities.defersTo')} ${rowSpec.defersTo}` : ''}
              </span>
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums font-bold text-[var(--text-primary)]">
          {row.price === null ? (
            <span className="text-[var(--text-muted)]" title={row.error || t('commodities.noQuote')}>
              —
            </span>
          ) : (
            <LiveValue value={row.price} as="span" render={(v) => formatNumber(v as number, rowSpec?.digits ?? 2)} />
          )}
        </td>
        <td
          className={`px-3 py-2.5 text-right tabular-nums font-bold ${
            row.change === null ? 'text-[var(--text-muted)]' : up ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'
          }`}
        >
          {row.change === null ? (
            '—'
          ) : (
            <LiveValue
              value={row.change}
              as="span"
              render={(v) => formatNumber(v as number, rowSpec?.digits ?? 2, { signed: true })}
            />
          )}
        </td>
        <td
          className={`px-4 py-2.5 text-right tabular-nums font-bold ${
            row.changePercent === null
              ? 'text-[var(--text-muted)]'
              : up
                ? 'text-[var(--color-up)]'
                : 'text-[var(--color-down)]'
          }`}
        >
          {row.changePercent === null ? (
            '—'
          ) : (
            <LiveValue value={row.changePercent} as="span" render={(v) => formatPercent(v as number, 2, { signed: true })} />
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-4">
      <Panel className="font-mono">
        <PanelHeader
          eyebrow={t('category.market')}
          title={t('commodities.oilIntelTitle')}
          icon={<Droplet className="w-4 h-4" />}
          actions={<InfoTooltip text={t('commodities.oilIntelNote')} />}
        />
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="hev-card-v2 !p-3">
            <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">WTI (CL=F)</span>
            {wti?.price == null ? (
              <span className="block text-lg font-black text-[var(--text-muted)] mt-1">—</span>
            ) : (
              <>
                <span className="block text-xl font-black tabular-nums text-[var(--text-primary)]">${formatNumber(wti.price, 2)}</span>
                <span className={`block text-[11px] font-bold tabular-nums mt-0.5 ${(wti.changePercent ?? 0) >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                  {wti.changePercent === null ? '—' : formatPercent(wti.changePercent, 2, { signed: true })}
                </span>
              </>
            )}
          </div>
          <div className="hev-card-v2 !p-3">
            <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">Brent (BZ=F)</span>
            {brent?.price == null ? (
              <span className="block text-lg font-black text-[var(--text-muted)] mt-1">—</span>
            ) : (
              <>
                <span className="block text-xl font-black tabular-nums text-[var(--text-primary)]">${formatNumber(brent.price, 2)}</span>
                <span className={`block text-[11px] font-bold tabular-nums mt-0.5 ${(brent.changePercent ?? 0) >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                  {brent.changePercent === null ? '—' : formatPercent(brent.changePercent, 2, { signed: true })}
                </span>
              </>
            )}
          </div>
          <div className="hev-card-v2 !p-3">
            <span className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('commodities.usCrudeStocks')}</span>
            {stocks.data?.unavailable || !latestStock ? (
              <>
                <span className="block text-lg font-black text-[var(--text-muted)] mt-1">—</span>
                <Badge tone="warning">{t('analysis.providerNotWired')}</Badge>
              </>
            ) : (
              <>
                <span className="block text-xl font-black tabular-nums text-[var(--text-primary)]">
                  {formatNumber(latestStock.value / 1000, 1)}M {t('commodities.barrels')}
                </span>
                {stockChange !== null && (
                  <span className={`block text-[11px] font-bold tabular-nums mt-0.5 ${stockChange <= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                    {formatNumber(stockChange / 1000, 2, { signed: true })}M {t('commodities.wow')} · {latestStock.period}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        {stocks.data?.unavailable && (
          <p className="mt-3 text-[10px] text-[var(--text-muted)] leading-relaxed">
            {t('commodities.eiaMissing')}
            {stocks.data.signupUrl ? ` ${stocks.data.signupUrl}` : ''}
          </p>
        )}
      </Panel>

      <Panel flush>
        <div className="p-4 sm:p-5">
          <PanelHeader
            eyebrow={t('category.market')}
            title={t('commodities.title')}
            subtitle={t('commodities.subtitle')}
            icon={<Flame className="w-4 h-4" />}
            actions={
              <DataQualityBadge
                meta={{ source: board.data?.source || 'Yahoo Finance', lastUpdated: board.data?.fetchedAt ?? null, status }}
              />
            }
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-y border-[var(--border-subtle)]">
                <th className="text-left font-bold px-4 py-2">{t('commodities.colContract')}</th>
                <th className="text-right font-bold px-3 py-2">{t('commodities.colLast')}</th>
                <th className="text-right font-bold px-3 py-2">{t('commodities.colChange')}</th>
                <th className="text-right font-bold px-4 py-2">{t('commodities.colChangePct')}</th>
              </tr>
            </thead>
            {grouped.map((group) => (
              <tbody key={group.group}>
                <tr className="bg-[var(--bg-surface)]">
                  <td colSpan={4} className="px-4 py-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                    {t(`commodities.group.${group.group}`)}
                  </td>
                </tr>
                {group.rows.map(renderRow)}
              </tbody>
            ))}
          </table>
        </div>

        <div className="px-4 py-2.5 border-t border-[var(--border-subtle)] text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
          {t('commodities.footnote')}
        </div>
      </Panel>

      {/* The read for the selected contract. Rendered by the same component as the XAU panel, so a
          barrel of crude and an ounce of gold are held to the same disclosure rules - except when
          the selected contract defers (Gold -> XAU/USD): that panel is already on screen above,
          since XAU/USD is the only commodities-category pair, so a second "MARKET STATE —
          XAU/USD" card here would be two identical answers to one question (dedupe fix, Poin 9).
          A short note replaces it instead of a full duplicate card + disclaimer. */}
      {spec?.defersTo ? (
        <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-[var(--text-secondary)] font-mono">
            {t('commodities.defersToNote').replace('{symbol}', spec.defersTo)}
          </p>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="shrink-0 text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            {t('commodities.scrollToTop')} ↑
          </button>
        </div>
      ) : (
        result && <ConfluenceView result={result} onOpen={onOpen} />
      )}

      {stocks.data?.unavailable && (
        <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
          {t('commodities.eiaMissing')}
          {stocks.data.signupUrl ? ` ${stocks.data.signupUrl}` : ''}
        </p>
      )}
    </div>
  );
};

export const COMMODITY_BOARD_SYMBOLS = COMMODITY_SPECS.map((s) => s.symbol);
