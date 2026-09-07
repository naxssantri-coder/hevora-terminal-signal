import React, { useEffect, useMemo, useState } from 'react';
import { Globe2 } from 'lucide-react';
import { MarketPrice, PairId } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { statusFromAge } from '../../lib/dataState';
import { CandlesResponse } from '../../lib/analytics';
import {
  getAllSessionStatuses,
  sessionRangeFromCandles,
  TRADING_SESSIONS,
  type SessionStatus,
  type TradingSessionDef,
} from '../../lib/market/sessions';
import { formatNumber } from '../../lib/format';
import { PAIRS_LIST } from '../../data/pairs';
import { Badge, DataQualityBadge, LoadingState, Panel, PanelHeader } from '../ui';
import { HeatmapGrid, InfoTooltip, ProgressRing, SparklineCell, type HeatRow } from '../viz';

/**
 * Session Intelligence (Tahap E §22, rebuilt for Nav Consolidation follow-up). Still exactly two
 * things, both pure computation over data this app already has live - no new provider:
 *
 * 1. Session clock: which of the 4 major trading sessions (Sydney/Tokyo/London/New York) are
 *    open right now, drawn as a 24h UTC timeline (one row per session, overlaps visible where
 *    bars stack) plus a city-clock card per session with a ProgressRing showing how far through
 *    the session window it is. Fixed UTC hours, not DST-adjusted - see lib/market/sessions.ts's
 *    header comment.
 *
 * 2. Per-pair session range: high/low since the current session opened, rendered as a heat-scan
 *    (HeatmapGrid) instead of a flat table - bar length and colour intensity both driven by the
 *    real range, amber rather than green/red since a range has no bullish/bearish direction.
 *    Honestly capped - the engine's candleStore only keeps a rolling ~2.5h window (server.ts, 30x
 *    5m bars), which is shorter than most sessions run for. When the session has been open longer
 *    than the candle window covers, this says so explicitly ("Partial") instead of presenting a
 *    partial range as if it were the full session's range.
 */

const formatDuration = (ms: number): string => {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
};

/** Splits a session's UTC window into 1-2 [startHour, endHour] segments for the timeline bar -
 *  two segments when the session wraps past midnight (e.g. Sydney 22:00->07:00). */
const timelineSegments = (def: TradingSessionDef): Array<[number, number]> =>
  def.closeUtcHour <= def.openUtcHour
    ? [
        [def.openUtcHour, 24],
        [0, def.closeUtcHour],
      ]
    : [[def.openUtcHour, def.closeUtcHour]];

const SessionTimeline: React.FC<{ sessions: SessionStatus[]; now: Date; t: (key: string) => string }> = ({
  sessions,
  now,
  t,
}) => {
  const nowFraction = (now.getUTCHours() + now.getUTCMinutes() / 60) / 24;

  return (
    <div className="font-mono">
      <div className="relative" style={{ paddingLeft: '4.5rem' }}>
        {/* Hour gridlines */}
        <div className="absolute inset-y-0 left-[4.5rem] right-0 flex justify-between pointer-events-none">
          {[0, 6, 12, 18, 24].map((h) => (
            <span key={h} className="w-px bg-[var(--border-subtle)] h-full" />
          ))}
        </div>
        {/* Now marker */}
        <div
          className="absolute top-0 bottom-0 w-px bg-[var(--color-down)] z-10"
          style={{ left: `calc(4.5rem + ${nowFraction * 100}%)` }}
        >
          <span className="absolute -top-4 -translate-x-1/2 text-[8px] font-bold text-[var(--color-down)] whitespace-nowrap">
            {now.toISOString().slice(11, 16)}
          </span>
        </div>

        <div className="space-y-1.5 py-4">
          {TRADING_SESSIONS.map((def) => {
            const status = sessions.find((s) => s.id === def.id);
            return (
              <div key={def.id} className="flex items-center gap-0 h-5">
                <span className="w-[4.5rem] shrink-0 pr-2 text-right text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  {t(def.labelKey)}
                </span>
                <div className="flex-1 relative h-3.5 rounded-sm bg-[var(--bg-surface)]">
                  {timelineSegments(def).map(([start, end], i) => (
                    <span
                      key={i}
                      className={`absolute inset-y-0 rounded-sm ${status?.isOpen ? 'bg-[var(--color-up)]/50 border border-[var(--color-up)]' : 'bg-[var(--border-strong)]/40'}`}
                      style={{ left: `${(start / 24) * 100}%`, width: `${((end - start) / 24) * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex justify-between text-[8px] text-[var(--text-muted)] tabular-nums" style={{ paddingLeft: '4.5rem' }}>
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00 UTC</span>
      </div>
    </div>
  );
};

const CityClockCard: React.FC<{ status: SessionStatus; t: (key: string) => string }> = ({ status, t }) => {
  const durationMs = status.windowClose.getTime() - status.windowOpen.getTime();
  const pct = status.isOpen && status.elapsedMs !== null && durationMs > 0 ? (status.elapsedMs / durationMs) * 100 : 0;

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
        status.isOpen ? 'border-[var(--color-up)]/40 bg-[var(--color-up)]/5' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
      }`}
    >
      <ProgressRing value={status.isOpen ? pct : null} size={40} strokeWidth={3.5} color={status.isOpen ? 'var(--color-up)' : 'var(--text-muted)'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-primary)] truncate">{t(status.labelKey)}</span>
          <Badge tone={status.isOpen ? 'up' : 'neutral'}>{status.isOpen ? t('session.open') : t('session.closed')}</Badge>
        </div>
        <span className="block text-[9px] font-mono text-[var(--text-muted)] mt-0.5">
          {status.isOpen
            ? `${t('session.closesIn')} ${status.remainingMs !== null ? formatDuration(status.remainingMs) : '—'}`
            : `${t('session.opensIn')} ${status.remainingMs !== null ? formatDuration(status.remainingMs) : '—'}`}
        </span>
      </div>
    </div>
  );
};

export const SessionIntelligenceView: React.FC<{ prices: Record<PairId, MarketPrice> }> = ({ prices }) => {
  const { t } = useTranslation();
  const { data, isLoading } = useEndpoint<CandlesResponse>('/api/market/candles', 60_000);
  const [now, setNow] = useState(() => new Date());

  // Countdown text only needs to be roughly right, not to the second - a 30s tick keeps the
  // "closes in Xh Ym" figures and the timeline's now-marker fresh without re-rendering the whole
  // panel every second.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const sessions = useMemo(() => getAllSessionStatuses(now), [now]);
  const openSessions = sessions.filter((s) => s.isOpen);
  // The session that's been running longest is the most inclusive boundary to measure range
  // against - if London opened 3h ago and New York just opened, "the session" for range purposes
  // is London's open, not New York's.
  const anchorSession = openSessions.length > 0
    ? [...openSessions].sort((a, b) => (b.elapsedMs ?? 0) - (a.elapsedMs ?? 0))[0]
    : null;

  const candles = data?.candles ?? {};

  const heatRows: HeatRow[] = useMemo(() => {
    if (!anchorSession) return [];
    const rows = PAIRS_LIST.map((pair) => {
      const range = sessionRangeFromCandles(candles[pair.id] ?? [], anchorSession.windowOpen.getTime());
      const closes = (candles[pair.id] ?? []).map((c) => c.c);
      return { pair, range, closes };
    }).filter((r) => r.range !== null);

    const maxSpan = Math.max(...rows.map((r) => (r.range as NonNullable<typeof r.range>).high - (r.range as NonNullable<typeof r.range>).low), 0.0001);

    return rows.map(({ pair, range, closes }) => {
      const r = range as NonNullable<typeof range>;
      const span = r.high - r.low;
      return {
        id: pair.id,
        label: pair.id,
        value: span,
        heat: span / maxSpan,
        color: 'var(--color-warn)',
        rightText: r.coversFullSession ? t('session.fullSession') : t('session.partial'),
        sublabel: `${formatNumber(r.high, pair.digits)} / ${formatNumber(r.low, pair.digits)}`,
        trailing: closes.length > 1 ? <SparklineCell values={closes} /> : undefined,
      } satisfies HeatRow;
    });
  }, [anchorSession, candles, t]);

  if (isLoading && !data) return <LoadingState variant="table" />;

  return (
    <div className="space-y-4 font-mono">
      <Panel flush>
        <div className="p-4 sm:p-5">
          <PanelHeader
            eyebrow={t('category.analysis')}
            title={t('module.sessionIntelligence')}
            subtitle={t('session.subtitle')}
            icon={<Globe2 className="w-4 h-4" />}
            actions={
              <DataQualityBadge
                meta={{
                  source: 'HEVORA Engine Candle Store',
                  lastUpdated: data?.newestAt ?? null,
                  status: statusFromAge(data?.newestAt, 6 * 60_000, 30 * 60_000),
                }}
              />
            }
          />
        </div>

        <div className="px-4 sm:px-5">
          <SessionTimeline sessions={sessions} now={now} t={t} />
        </div>

        {openSessions.length >= 2 && (
          <p className="px-4 sm:px-5 mt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-up)]">
            {t('session.overlapActive')}: {openSessions.map((s) => t(s.labelKey)).join(' + ')}
          </p>
        )}

        <div className="mt-5 px-4 sm:px-5 pb-4 sm:pb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {sessions.map((s) => (
            <CityClockCard key={s.id} status={s} t={t} />
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow={t('category.analysis')}
          title={t('session.rangeTitle')}
          subtitle={anchorSession ? `${t(anchorSession.labelKey)} · ${t('session.rangeSubtitle')}` : t('session.noSessionOpen')}
          actions={<InfoTooltip text={t('session.methodNote')} />}
        />

        <div className="mt-4">
          {!anchorSession || heatRows.length === 0 ? (
            <p className="text-[11px] text-[var(--text-muted)]">{t('session.noSessionOpen')}</p>
          ) : (
            <HeatmapGrid rows={heatRows} diverging={false} digits={2} unit="" />
          )}
        </div>
      </Panel>
    </div>
  );
};
