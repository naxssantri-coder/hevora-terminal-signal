import React, { useMemo, useState } from 'react';
import { Download, Layers } from 'lucide-react';
import { CotClass, CotPosition, CotResponse } from '../../types';
import { Language, useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { statusFromAge } from '../../lib/dataState';
import { formatCompact, formatNumber } from '../../lib/format';
import { LineChart } from '../charts';
import { Badge, DataQualityBadge, LoadingState, Panel, PanelHeader, TabBar, UnavailableState, type TabItem } from '../ui';
import { InfoTooltip, SparklineCell } from '../viz';

/**
 * COT Heat Scan (2026-09-02 master-detail redesign, structure only from a user-supplied
 * reference mockup - not a data spec to copy). Same CFTC Commitment of Traders data as before
 * this pass plus what a live GitHub Actions verification pass (scripts/verify-cot-breakdown-
 * sources.ts) actually confirmed real: Commercial long/short (same Legacy dataset already
 * fetched), and a per-market trader-category breakdown from two DIFFERENT real CFTC reports -
 * "Traders in Financial Futures" (Dealer/Asset Manager/Leveraged Funds/Other Reportables) for
 * FX/Index/Crypto, "Disaggregated" (Producer-Merchant/Swap Dealers/Managed Money/Other
 * Reportables) for physical commodities. The two category systems are never merged into one fake
 * universal label set - `CotBreakdown.system` says which one a market's `categories` came from,
 * and the labels rendered below always come from the server's own `label` field, never a
 * hardcoded guess of what a market "should" have.
 *
 * Deliberately NOT built from this pass: a live "next release" countdown (the mockup's own
 * "In 4d 18h 23m") - CFTC's exact publish calendar (weekends/holidays shift it) isn't verified
 * data here, so showing a countdown with that precision would be inventing confidence this
 * doesn't have. The real `reportDate` per market is shown instead.
 */

type ClassFilter = 'ALL' | CotClass;

const CLASS_TABS: TabItem[] = [
  { id: 'ALL', label: 'ALL' },
  { id: 'METALS', label: 'METALS' },
  { id: 'FX', label: 'FX' },
  { id: 'ENERGY', label: 'ENERGY' },
  { id: 'AGRI', label: 'AGRI' },
  { id: 'INDEX', label: 'INDEX' },
  { id: 'CRYPTO', label: 'CRYPTO' },
];

/** Short display symbol for the list row - strips the Yahoo futures/index ticker punctuation
 *  (=F, ^, .NYB) that means nothing to a reader here, keeps the CFTC market code out of the UI
 *  entirely (that's an internal lookup key, never shown). */
const shortSymbol = (symbol: string): string =>
  symbol.replace('=F', '').replace(/^\^/, '').replace('.NYB', '');

const downloadCsv = (rows: CotPosition[]) => {
  const header = [
    'Symbol', 'Market', 'Class', 'Net Position', 'Percentile', 'Open Interest',
    'Commercial Long', 'Commercial Short', 'Non-Commercial Long', 'Non-Commercial Short',
    'Weekly Change', 'Report Date',
  ];
  const lines = rows.map((p) =>
    [
      p.symbol, p.market, p.cotClass, p.netContracts, p.percentile ?? '', p.openInterest ?? '',
      p.commercialLong ?? '', p.commercialShort ?? '', p.longContracts, p.shortContracts,
      p.weeklyChange ?? '', p.reportDate ?? '',
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  );
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cot-heat-scan-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/** Deterministic interpretation sentence, built only from this market's own real numbers
 *  (percentile, weekly change, net direction) - no template placeholder text, no AI call, no
 *  invented commentary. Mirrors the "computed, not decorated" reasoning pattern already used by
 *  ConfluenceView elsewhere in this app. */
const buildInterpretation = (p: CotPosition, language: Language): string => {
  const isLong = p.netContracts >= 0;
  const pct = p.percentile;
  const extreme = pct !== null && (pct >= 90 || pct <= 10);
  const changeDirection = p.weeklyChange === null ? null : p.weeklyChange >= 0 ? 'up' : 'down';

  if (language === 'id') {
    if (pct === null) {
      return 'Belum cukup histori mingguan untuk menghitung persentil - posisi net di bawah dianggap terlalu tipis untuk disimpulkan.';
    }
    const posisi = isLong ? 'net long' : 'net short';
    const level = extreme ? 'level ekstrem' : pct >= 65 || pct <= 35 ? 'level cukup tinggi' : 'level netral';
    const arah = changeDirection === 'up' ? 'meningkat' : changeDirection === 'down' ? 'menurun' : null;
    const perubahan = arah ? `, dan ${arah} dari minggu sebelumnya` : '';
    const risiko = extreme
      ? ' Positioning yang sejauh ini biasanya jadi sinyal crowd positioning ekstrem - berpotensi rawan koreksi kalau sentimen berbalik.'
      : '';
    return `Positioning berada pada persentil ke-${Math.round(pct)} (${level}) dengan ${posisi}${perubahan}.${risiko}`;
  }

  if (pct === null) {
    return 'Not enough weekly history yet to compute a percentile - the net position below is too thin a sample to draw a conclusion from.';
  }
  const posLabel = isLong ? 'net long' : 'net short';
  const level = extreme ? 'an extreme level' : pct >= 65 || pct <= 35 ? 'an elevated level' : 'a neutral level';
  const dir = changeDirection === 'up' ? 'increasing' : changeDirection === 'down' ? 'decreasing' : null;
  const change = dir ? `, ${dir} from the prior week` : '';
  const risk = extreme
    ? ' Positioning this stretched typically signals extreme crowd positioning - a higher-risk setup if sentiment reverses.'
    : '';
  return `Positioning sits at the ${Math.round(pct)}th percentile (${level}) with ${posLabel}${change}.${risk}`;
};

const biasTag = (p: CotPosition, t: (key: string) => string): { label: string; tone: 'up' | 'down' } =>
  p.netContracts >= 0 ? { label: t('analysis.long'), tone: 'up' } : { label: t('analysis.short'), tone: 'down' };

export const PositioningView: React.FC = () => {
  const { t, language } = useTranslation();
  const { data, isLoading } = useEndpoint<CotResponse>('/api/positioning/cot', 60 * 60_000);
  const [classFilter, setClassFilter] = useState<ClassFilter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const allPositions = useMemo(() => Object.values(data?.positions ?? {}), [data]);

  const filtered = useMemo(
    () => (classFilter === 'ALL' ? allPositions : allPositions.filter((p) => p.cotClass === classFilter)),
    [allPositions, classFilter]
  );

  // Most-stretched-first: the reader's eye should land on what is actually unusual, not on
  // whatever order the API happened to return.
  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const ea = a.percentile === null ? -1 : Math.abs(a.percentile - 50);
        const eb = b.percentile === null ? -1 : Math.abs(b.percentile - 50);
        return eb - ea;
      }),
    [filtered]
  );

  const selected: CotPosition | null = sorted.find((p) => p.symbol === selectedId) ?? sorted[0] ?? null;

  if (isLoading && !data) return <LoadingState variant="cards" />;

  if (allPositions.length === 0) {
    return (
      <Panel>
        <PanelHeader eyebrow={t('category.macro')} title={t('analysis.cotTitle')} subtitle={t('analysis.cotSubtitle')} icon={<Layers className="w-4 h-4" />} />
        <div className="mt-4">
          <UnavailableState source={data?.source ?? 'CFTC Socrata'} detail={data?.error ?? t('analysis.cotUnavailable')} />
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-4 font-mono">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 items-start">
        {/* Left: instrument list */}
        <Panel flush className="overflow-hidden">
          <div className="p-4 sm:p-5 pb-0 space-y-3">
            <PanelHeader
              eyebrow={t('category.macro')}
              title={t('analysis.cotTitle')}
              subtitle={t('analysis.cotSubtitle')}
              icon={<Layers className="w-4 h-4" />}
              actions={
                <div className="flex items-center gap-2">
                  {data?.fetchedAt && (
                    <DataQualityBadge
                      meta={{
                        source: data.source,
                        lastUpdated: data.fetchedAt,
                        status: data.stale ? 'STALE' : statusFromAge(data.fetchedAt, 24 * 60 * 60_000, 10 * 24 * 60 * 60_000),
                      }}
                    />
                  )}
                  <InfoTooltip text={t('analysis.cotMethod')} />
                  <button
                    type="button"
                    onClick={() => downloadCsv(sorted)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    {t('analysis.cotExport')}
                  </button>
                </div>
              }
            />
            <TabBar tabs={CLASS_TABS} active={classFilter} onChange={(id) => setClassFilter(id as ClassFilter)} className="pb-0 border-b-0" />
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-y border-[var(--border-subtle)]">
                  <th className="text-left font-bold px-4 py-2">{t('analysis.cotColInstrument')}</th>
                  <th className="text-left font-bold px-3 py-2">{t('analysis.cotColNet')}</th>
                  <th className="text-center font-bold px-3 py-2">{t('analysis.cotColPercentile')}</th>
                  <th className="text-right font-bold px-3 py-2 hidden sm:table-cell">{t('analysis.cotColOi')}</th>
                  <th className="text-center font-bold px-3 py-2 hidden md:table-cell">{t('analysis.cotColBias')}</th>
                  <th className="text-right font-bold px-4 py-2 hidden lg:table-cell">{t('analysis.cotColTrend')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const isSelected = p.symbol === selected?.symbol;
                  const bias = biasTag(p, t);
                  const maxAbsNet = Math.max(...sorted.map((r) => Math.abs(r.netContracts)), 1);
                  const barPct = Math.min(100, (Math.abs(p.netContracts) / maxAbsNet) * 100);
                  return (
                    <tr
                      key={p.symbol}
                      onClick={() => setSelectedId(p.symbol)}
                      className={`cursor-pointer border-b border-[var(--border-subtle)] transition-colors ${
                        isSelected ? 'bg-[var(--bg-surface)]' : 'hover:bg-[var(--card-hover-bg)]'
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${bias.tone === 'up' ? 'bg-[var(--color-up)]' : 'bg-[var(--color-down)]'}`}
                          />
                          <span className="font-bold text-[var(--text-primary)]">{shortSymbol(p.symbol)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-1 min-w-[90px]">
                          <span className={`tabular-nums font-bold ${p.netContracts >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                            {formatNumber(p.netContracts, 0, { signed: true })}
                          </span>
                          <div className="h-1 rounded-full bg-[var(--bg-panel)] overflow-hidden w-full">
                            <div
                              className={`h-full rounded-full ${p.netContracts >= 0 ? 'bg-[var(--color-up)]' : 'bg-[var(--color-down)]'}`}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {p.percentile === null ? (
                          <span className="text-[var(--text-muted)]">—</span>
                        ) : (
                          <Badge tone={p.percentile >= 80 || p.percentile <= 20 ? 'warning' : 'neutral'}>
                            {Math.round(p.percentile)}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-secondary)] hidden sm:table-cell">
                        {formatCompact(p.openInterest)}
                      </td>
                      <td className="px-3 py-2.5 text-center hidden md:table-cell">
                        <Badge tone={bias.tone}>{bias.label}</Badge>
                      </td>
                      <td className="px-4 py-2.5 hidden lg:table-cell">
                        {p.history.length > 1 ? (
                          <div className="flex justify-end">
                            <SparklineCell values={[...p.history].slice(0, 8).reverse().map((h) => h.net)} />
                          </div>
                        ) : (
                          <span className="text-[var(--text-muted)] text-right block">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 sm:px-5 py-3 text-[10px] text-[var(--text-muted)] border-t border-[var(--border-subtle)]">
            {t('analysis.cotShowingCount')} {sorted.length}
          </div>
        </Panel>

        {/* Right: detail panel */}
        {selected && <CotDetailPanel position={selected} t={t} language={language} />}
      </div>

      <Panel>
        <PanelHeader title={t('analysis.retailTitle')} subtitle={t('analysis.retailSubtitle')} />
        <div className="mt-3">
          <Badge tone="warning">{t('analysis.providerNotWired')}</Badge>
        </div>
      </Panel>
    </div>
  );
};

const CotDetailPanel: React.FC<{ position: CotPosition; t: (key: string) => string; language: Language }> = ({
  position: p,
  t,
  language,
}) => {
  const bias = biasTag(p, t);
  const historyPoints = useMemo(
    () =>
      [...p.history]
        .reverse()
        .map((h) => ({ label: h.date ? h.date.slice(5, 10) : '', value: h.net })),
    [p.history]
  );

  return (
    <Panel className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{p.cotClass}</div>
          <div className="font-black text-base text-[var(--text-primary)] truncate">{shortSymbol(p.symbol)}</div>
          <div className="text-[10px] text-[var(--text-secondary)] truncate" title={p.market}>{p.market}</div>
        </div>
        <Badge tone={bias.tone} className="shrink-0">{bias.label}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <StatTile label={t('analysis.cotColNet')} value={formatNumber(p.netContracts, 0, { signed: true })} tone={p.netContracts >= 0 ? 'up' : 'down'} />
        <StatTile label={t('analysis.percentile')} value={p.percentile === null ? '—' : `${Math.round(p.percentile)}`} />
        <StatTile label={t('analysis.cotColOi')} value={formatCompact(p.openInterest)} />
        <StatTile
          label={t('analysis.cotWeeklyChange')}
          value={p.weeklyChange === null ? '—' : formatNumber(p.weeklyChange, 0, { signed: true })}
          tone={p.weeklyChange === null ? undefined : p.weeklyChange >= 0 ? 'up' : 'down'}
        />
      </div>

      <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('analysis.cotBreakdownTitle')}</span>
          {p.breakdown && (
            <span className="text-[9px] text-[var(--text-muted)]">
              {p.breakdown.system === 'tff' ? 'TFF' : t('analysis.cotDisaggregatedShort')}
            </span>
          )}
        </div>
        {p.breakdown ? (
          <div className="space-y-2">
            <CategoryRow label={t('analysis.cotCommercial')} value={p.commercialLong !== null && p.commercialShort !== null ? p.commercialLong - p.commercialShort : null} />
            <CategoryRow label={t('analysis.cotNonCommercial')} value={p.longContracts - p.shortContracts} />
            {p.breakdown.categories.map((c) => (
              <CategoryRow key={c.key} label={c.label} value={c.net} />
            ))}
          </div>
        ) : (
          <div className="text-[10px] text-[var(--text-muted)] italic">{t('analysis.cotBreakdownUnavailable')}</div>
        )}
      </div>

      <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2">
        <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('analysis.cotHistoryTitle')}</span>
        {historyPoints.length > 1 ? (
          <LineChart
            points={historyPoints}
            height={130}
            valueDigits={0}
            color="var(--color-brand)"
            xAxisTicks={6}
            areaFill
            highlightLast
            fitToContainer
          />
        ) : (
          <div className="text-[10px] text-[var(--text-muted)] italic">{t('analysis.cotHistoryThin')}</div>
        )}
      </div>

      <div className="pt-3 border-t border-[var(--border-subtle)] space-y-1.5">
        <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{t('analysis.cotInterpretationTitle')}</span>
        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{buildInterpretation(p, language)}</p>
        {p.reportDate && (
          <p className="text-[9px] text-[var(--text-muted)]">{t('analysis.reportDate')} {p.reportDate.slice(0, 10)}</p>
        )}
      </div>
    </Panel>
  );
};

const StatTile: React.FC<{ label: string; value: string; tone?: 'up' | 'down' }> = ({ label, value, tone }) => (
  <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[10px] p-2.5">
    <div className="text-[8px] uppercase tracking-wider text-[var(--text-muted)] mb-1">{label}</div>
    <div
      className={`font-black text-sm tabular-nums ${
        tone === 'up' ? 'text-[var(--color-up)]' : tone === 'down' ? 'text-[var(--color-down)]' : 'text-[var(--text-primary)]'
      }`}
    >
      {value}
    </div>
  </div>
);

const CategoryRow: React.FC<{ label: string; value: number | null }> = ({ label, value }) => {
  if (value === null) {
    return (
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[var(--text-secondary)]">{label}</span>
        <span className="text-[var(--text-muted)]">—</span>
      </div>
    );
  }
  const isUp = value >= 0;
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="text-[var(--text-secondary)] w-28 shrink-0 truncate">{label}</span>
      <span className={`tabular-nums font-bold w-20 shrink-0 text-right ${isUp ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
        {formatNumber(value, 0, { signed: true })}
      </span>
      <div className="h-1.5 rounded-full bg-[var(--bg-panel)] overflow-hidden flex-1">
        <div
          className={`h-full rounded-full ${isUp ? 'bg-[var(--color-up)]' : 'bg-[var(--color-down)]'}`}
          style={{ width: `${Math.min(100, Math.abs(value) / 1000)}%` }}
        />
      </div>
    </div>
  );
};
