import React, { useEffect, useMemo, useState } from 'react';
import {
  Radio,
  Mic,
  Search,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Newspaper,
  Calendar as CalendarIcon,
  ExternalLink,
  Youtube,
  Gauge as GaugeIcon,
  ListChecks,
  Coins,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Info,
  X,
} from 'lucide-react';
import type {
  EconomicEvent,
  LiveEvent,
  LiveEventDirection,
  LiveEventSegmentTopic,
  LiveDeskNarrativeResponse,
  LiveDeskAlertsResponse,
  LiveDeskAlert,
  LiveDeskImpactMatrixResponse,
  LiveDeskChatContext,
  MarketPrice,
  PairId,
  FearGreedResponse,
  CryptoDerivativesResponse,
  CentralBankGoldResponse,
  GldHoldingsResponse,
  KalshiFedProbabilitiesResponse,
  CrossAssetCorrelationResponse,
} from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useEndpoint } from '../../lib/useEndpoint';
import { useFredSeries, latestValue } from '../../lib/useFredSeries';
import { formatAge, statusFromAge } from '../../lib/dataState';
import { PAIRS_LIST } from '../../data/pairs';
import { LIVE_DESK_VIDEO_CHANNELS, liveDeskVideoChannelEmbedUrl, type LiveDeskVideoChannel } from '../../data/liveDeskVideoChannels';
import { Panel, PanelHeader, Badge, DataQualityBadge, LoadingState, EmptyState } from '../ui';
import { LivePulseDot } from '../viz';
import { WatchlistSidebar } from '../market/WatchlistSidebar';
import { useShell } from '../shell/ShellContext';

// ---------------------------------------------------------------------------------------------
// Live Desk - "Intelligence" tab #3. Everything here reads from data that already exists
// elsewhere in HEVORA:
//   - The live broadcast/transcript/AI-analysis panels surface the existing Live Intelligence
//     pipeline (scripts/live-intel-watcher.ts: YouTube auto-captions + official RSS -> Gemini
//     topic/tone/causal-chain/pair-impact analysis) - see /api/live-desk/* in server.ts for the
//     scope note explaining why this does NOT add a new paid audio-STT provider.
//   - Impact Matrix / Smart Alerts / Narrative panels call the three new (but zero-new-cost)
//     aggregation endpoints, /api/live-desk/{narrative,alerts,impact-matrix}.
//   - Everything else (Fear & Greed, funding rate, central bank gold, GLD holdings, Kalshi Fed
//     probabilities, cross-asset correlation, economic calendar, market news, watchlist) reuses
//     endpoints/components that already ship in other tabs - never re-implemented here.
// Every AI-derived number on this page is explicitly labeled an AI estimate, never presented as
// an official market/financial indicator - see the disclaimer strings throughout.
// ---------------------------------------------------------------------------------------------

const TONE_COLOR: Record<string, string> = { Hawkish: '#FF4D4F', Dovish: '#2ECC71', Neutral: '#a1a1aa' };
const DIRECTION_COLOR: Record<LiveEventDirection, string> = { Bullish: '#2ECC71', Bearish: '#FF4D4F', Neutral: '#a1a1aa' };
const IMPACT_COLOR: Record<string, string> = { High: '#FF4D4F', Medium: '#F5B942', Low: '#a1a1aa' };
const SEVERITY_COLOR: Record<string, string> = { HIGH: '#FF4D4F', MEDIUM: '#F5B942', INFO: '#a1a1aa' };

const DirectionArrow: React.FC<{ direction: LiveEventDirection; className?: string }> = ({ direction, className }) => {
  if (direction === 'Bullish') return <TrendingUp className={className} />;
  if (direction === 'Bearish') return <TrendingDown className={className} />;
  return <Minus className={className} />;
};

/** Verbatim copy of LiveEventDetailPage's YouTube URL helpers (same small, self-contained
 *  duplication convention already used between IntelView/LiveEventDetailPage in this codebase -
 *  never fabricates a video, returns null for anything not a resolvable YouTube link). */
function extractYoutubeEmbedUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'youtube.com' && host !== 'youtu.be' && host !== 'm.youtube.com') return null;
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1);
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    const v = u.searchParams.get('v');
    if (v) return `https://www.youtube.com/embed/${v}`;
    const liveMatch = u.pathname.match(/^\/live\/([^/?]+)/);
    if (liveMatch) return `https://www.youtube.com/embed/${liveMatch[1]}`;
    const embedMatch = u.pathname.match(/^\/embed\/([^/?]+)/);
    if (embedMatch) return url;
    return null;
  } catch {
    return null;
  }
}

/** Bolds every case-insensitive match of `query` inside `text` - the transcript search's only
 *  job, no fuzzy matching invented. */
function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-[var(--color-warn)]/40 text-[var(--text-primary)] rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/** Reusable in-page "view all" overlay (fix round §4): every Live Desk "Lihat Semua" affordance
 *  expands HERE, inline, instead of navigating to a different tab - same overlay markup pattern
 *  IntelView.tsx's research detail modal already uses elsewhere in this app, reused rather than
 *  inventing a new modal style. */
const ExpandModal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 bg-[var(--overlay-backdrop)] backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
    <div
      className="hev-card-v2 !p-0 border border-[var(--border-strong)] rounded-2xl max-w-lg w-full max-h-[80vh] overflow-hidden font-mono shadow-2xl flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="sticky top-0 bg-[var(--bg-panel)] border-b border-[var(--border-subtle)] px-4 py-3 flex items-center justify-between shrink-0">
        <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">{title}</span>
        <button type="button" onClick={onClose} className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="overflow-y-auto p-3 space-y-2">{children}</div>
    </div>
  </div>
);

// Live Desk audit (2026-09-06), item §2/§3: manual "Live Sekarang" picker - lets the user open ANY
// of the always-live international news channels directly, independent of the Economic
// Calendar/live-intel pipeline entirely (breaking news that was never a scheduled macro event has
// no calendar entry to auto-trigger anything). Pure video embed, no transcript/AI analysis - see
// src/data/liveDeskVideoChannels.ts's header comment for why these channels are deliberately never
// wired into the caption/audio pipelines.
const LiveNowPicker: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<LiveDeskVideoChannel | null>(null);

  return (
    <ExpandModal title={t('liveDesk.liveNowTitle')} onClose={onClose}>
      <p className="text-[9px] text-[var(--text-muted)] leading-relaxed mb-1">{t('liveDesk.liveNowDescription')}</p>
      {selected ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="text-[9.5px] font-bold text-[var(--color-brand)] flex items-center gap-1"
          >
            <ChevronLeft className="w-3 h-3" /> {t('liveDesk.liveNowBackToList')}
          </button>
          {/* Live Desk audit follow-up (2026-09-06): a real network test (GET on the exact
              embed/live_stream?channel=<id> URL below, from a machine with real internet, via
              .github/workflows/verify-live-desk-video-sources.yml) found this embed does NOT
              reliably resolve to a playable player - it returned YouTube's own "unavailable" page
              for all 7 channels tested, not just the one a user reported. A cross-origin iframe
              also can't be inspected from here to detect that failure and swap in a message (this
              is exactly why an earlier report wrongly called this "verified working" - only the
              iframe's src attribute was ever checked, never what it actually renders). So: the
              reliable "open on YouTube" action is now the PRIMARY control, always shown with equal
              or greater visual weight than the embed attempt below it - never the only thing left
              on screen if the embed silently fails. */}
          <a
            href={selected.channelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-brand)] text-[var(--bg-base)] font-bold text-[11px]"
          >
            <Youtube className="w-3.5 h-3.5" />
            {t('liveDesk.liveNowWatchOnYoutube')} {selected.label}
            <ExternalLink className="w-3 h-3" />
          </a>
          <p className="text-[8.5px] text-[var(--text-muted)] leading-relaxed">{t('liveDesk.liveNowEmbedDisclaimer')}</p>
          <div className="rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-black aspect-video">
            <iframe
              src={liveDeskVideoChannelEmbedUrl(selected)}
              title={selected.label}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      ) : (
        LIVE_DESK_VIDEO_CHANNELS.map((ch) => (
          <button
            key={ch.id}
            type="button"
            onClick={() => setSelected(ch)}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-left"
          >
            <Youtube className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
            <span className="text-[10.5px] font-bold text-[var(--text-primary)] flex-1 truncate">{ch.label}</span>
            <ChevronRight className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
          </button>
        ))
      )}
    </ExpandModal>
  );
};

const MiniGauge: React.FC<{ label: string; value: number | null; leftLabel: string; rightLabel: string; color: string }> = ({
  label,
  value,
  leftLabel,
  rightLabel,
  color,
}) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
      <span className="font-bold">{label}</span>
      <span className="tabular-nums">{value === null ? '—' : `${Math.round(value)}/100`}</span>
    </div>
    <div className="h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden border border-[var(--border-subtle)]">
      <div className="h-full rounded-full transition-all" style={{ width: `${value ?? 0}%`, backgroundColor: color }} />
    </div>
    <div className="flex items-center justify-between text-[8px] text-[var(--text-muted)]">
      <span>{leftLabel}</span>
      <span>{rightLabel}</span>
    </div>
  </div>
);

// -------------------------------------------------------------------------------------------
// Panel 1 (row 1, left): Live Broadcast + Transcript
// -------------------------------------------------------------------------------------------
interface LiveBroadcastPanelProps {
  focusEvent: LiveEvent | null;
  onOpenEvent: (id: string) => void;
  /** Fix round §5: real, data-driven filter options - every distinct `source` label actually
   *  present in the fetched events, never a hardcoded/fabricated taxonomy (see the root
   *  component's own comment on why "FOMC"/"CPI" can't be literal dropdown entries). */
  sourceOptions: string[];
  selectedSource: string;
  onSelectSource: (source: string) => void;
  /** 1-indexed position within the current filter's session list, and its total - lets "SESI
   *  TERAKHIR" become "browse previous sessions of this same event type" (fix round §5) instead of
   *  only ever showing the single most recent one. */
  sessionPosition: { index: number; total: number };
  onPrevSession: () => void;
  onNextSession: () => void;
}

const LiveBroadcastPanel: React.FC<LiveBroadcastPanelProps> = ({
  focusEvent,
  onOpenEvent,
  sourceOptions,
  selectedSource,
  onSelectSource,
  sessionPosition,
  onPrevSession,
  onNextSession,
}) => {
  const { t } = useTranslation();
  const [view, setView] = useState<'original' | 'id'>('id');
  const [query, setQuery] = useState('');
  const [showLiveNow, setShowLiveNow] = useState(false);

  const isLive = focusEvent?.liveSession?.status === 'live';
  const embedUrl = extractYoutubeEmbedUrl(focusEvent?.sourceUrl ?? null);

  const segmentLines = useMemo(() => {
    const list = focusEvent?.segments ?? [];
    if (!query.trim()) return list;
    return list.filter((s) => s.statement.toLowerCase().includes(query.toLowerCase()) || s.topic.toLowerCase().includes(query.toLowerCase()));
  }, [focusEvent, query]);

  return (
    <Panel className="p-4 flex flex-col gap-3 min-h-[420px]">
      <PanelHeader
        eyebrow={t('liveDesk.broadcastEyebrow')}
        title={t('liveDesk.broadcastTitle')}
        icon={<Radio className="w-4 h-4" />}
        actions={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowLiveNow(true)}
              title={t('liveDesk.liveNowButton')}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[8.5px] font-bold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              <Youtube className="w-3 h-3" />
              {t('liveDesk.liveNowButton')}
            </button>
            {isLive ? (
              <Badge tone="down" className="animate-pulse">{t('liveDesk.liveBadge')}</Badge>
            ) : (
              <Badge tone="neutral">{sessionPosition.index > 0 ? t('liveDesk.previousSessionBadge') : t('liveDesk.replayBadge')}</Badge>
            )}
          </div>
        }
      />
      {showLiveNow && <LiveNowPicker onClose={() => setShowLiveNow(false)} />}

      {/* Fix round §5: "Jenis Event" filter (real source labels, not a fabricated taxonomy) +
          session browsing - replaces the old single always-latest-only view. */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0">
          <select
            value={selectedSource}
            onChange={(e) => onSelectSource(e.target.value)}
            className="w-full appearance-none pl-2 pr-6 py-1.5 text-[9.5px] font-bold uppercase tracking-wide bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md text-[var(--text-secondary)] outline-none truncate"
          >
            <option value="all">{t('liveDesk.eventTypeAll')}</option>
            {sourceOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
        </div>
        {sessionPosition.total > 0 && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={onPrevSession}
              disabled={sessionPosition.index >= sessionPosition.total - 1}
              title={t('liveDesk.previousSession')}
              className="p-1 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] disabled:opacity-30 hover:border-[var(--border-strong)]"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
            <span className="text-[8px] tabular-nums text-[var(--text-muted)] px-0.5 whitespace-nowrap">
              {sessionPosition.index + 1}/{sessionPosition.total}
            </span>
            <button
              type="button"
              onClick={onNextSession}
              disabled={sessionPosition.index <= 0}
              title={t('liveDesk.nextSession')}
              className="p-1 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] disabled:opacity-30 hover:border-[var(--border-strong)]"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {!focusEvent ? (
        <EmptyState title={t('liveDesk.noBroadcastTitle')} detail={t('liveDesk.noBroadcastDetail')} />
      ) : (
        <>
          {embedUrl ? (
            <div className="rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-black aspect-video shrink-0">
              <iframe
                src={embedUrl}
                title={focusEvent.title}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : focusEvent.sourceUrl ? (
            <a
              href={focusEvent.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <Youtube className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{focusEvent.source || focusEvent.sourceUrl}</span>
              <ExternalLink className="w-3 h-3 ml-auto shrink-0" />
            </a>
          ) : null}

          <button
            type="button"
            onClick={() => onOpenEvent(focusEvent.id)}
            className="text-left text-[11px] font-bold text-[var(--text-primary)] hover:text-[var(--color-brand)] leading-snug"
          >
            {focusEvent.title}
          </button>
          <div className="flex items-center gap-1.5 text-[9px] text-[var(--text-muted)]">
            <Mic className="w-3 h-3" />
            <span>{focusEvent.speaker || t('intel.liveUnknownSpeaker')}</span>
            <span>·</span>
            <span>{formatAge(focusEvent.createdAt)}</span>
          </div>

          {/* Transcript: real/original vs the AI's Indonesian segment analysis - NOT a live
              translation pipeline (see server.ts's scope note). rawTranscript is literally the
              original captured caption/press-release text; segments are Gemini's own Indonesian
              analysis of it - both are real, already-stored fields. */}
          <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] pb-1.5">
            <button
              type="button"
              onClick={() => setView('id')}
              className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider ${view === 'id' ? 'bg-[var(--color-brand)]/15 text-[var(--color-brand)]' : 'text-[var(--text-muted)]'}`}
            >
              {t('liveDesk.transcriptTabId')}
            </button>
            <button
              type="button"
              onClick={() => setView('original')}
              className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider ${view === 'original' ? 'bg-[var(--color-brand)]/15 text-[var(--color-brand)]' : 'text-[var(--text-muted)]'}`}
            >
              {t('liveDesk.transcriptTabOriginal')}
            </button>
            <div className="ml-auto relative">
              <Search className="w-3 h-3 absolute left-1.5 top-1.5 text-[var(--text-muted)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('liveDesk.transcriptSearchPlaceholder')}
                className="pl-5 pr-2 py-1 text-[10px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md w-32 focus:w-44 transition-all outline-none"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto max-h-64 space-y-1.5 pr-1">
            {view === 'id' ? (
              segmentLines.length > 0 ? (
                segmentLines.map((s, i) => (
                  <div key={i} className="text-[10.5px] leading-relaxed border-l-2 pl-2" style={{ borderColor: TONE_COLOR[s.tone] }}>
                    <span className="text-[8px] font-bold uppercase tracking-wider mr-1.5" style={{ color: TONE_COLOR[s.tone] }}>
                      {s.topic}
                    </span>
                    <span className="text-[var(--text-secondary)]">{highlight(s.statement, query)}</span>
                  </div>
                ))
              ) : (
                <p className="text-[10.5px] text-[var(--text-secondary)] leading-relaxed">{highlight(focusEvent.summary, query)}</p>
              )
            ) : (
              <p className="text-[10.5px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                {highlight(focusEvent.rawTranscript || t('liveDesk.noRawTranscript'), query)}
              </p>
            )}
          </div>
        </>
      )}
    </Panel>
  );
};

// -------------------------------------------------------------------------------------------
// Panel 2 (row 1, center): AI Real-Time Analysis
// -------------------------------------------------------------------------------------------
const AiAnalysisPanel: React.FC<{ focusEvent: LiveEvent | null; previousEvent: LiveEvent | null }> = ({ focusEvent, previousEvent }) => {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    if (!focusEvent) return null;
    const segs = focusEvent.segments || [];
    const avgStance = segs.length > 0 ? segs.reduce((a, s) => a + s.stanceScore, 0) / segs.length : focusEvent.tone === 'Hawkish' ? 75 : focusEvent.tone === 'Dovish' ? 25 : 50;
    const confidences = segs.map((s) => s.confidence).filter((c): c is number => typeof c === 'number');
    const avgConfidence = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;
    const importanceMap: Record<string, number> = { Low: 2, Medium: 5, High: 8, Extreme: 10 };
    const importances = segs.map((s) => (s.importance ? importanceMap[s.importance] : null)).filter((v): v is number => v !== null);
    const importanceScore = importances.length > 0 ? importances.reduce((a, b) => a + b, 0) / importances.length : { Low: 3, Medium: 6, High: 9 }[focusEvent.impact];
    const topics = [...new Set(segs.map((s) => s.topic))];
    const keyPoints = focusEvent.finalIntelligence?.majorRisks?.length
      ? focusEvent.finalIntelligence.majorRisks
      : segs.filter((s) => s.importance === 'High' || s.importance === 'Extreme').map((s) => s.keyStatement || s.statement).slice(0, 3);
    return { avgStance, avgConfidence, importanceScore, topics, keyPoints };
  }, [focusEvent]);

  const narrativeChange = useMemo(() => {
    if (focusEvent?.finalIntelligence?.biggestStanceShift) {
      const shift = focusEvent.finalIntelligence.biggestStanceShift;
      return `${shift.reason || t('liveDesk.stanceShiftGeneric')} (${shift.delta > 0 ? '+' : ''}${shift.delta} poin stance).`;
    }
    if (previousEvent && focusEvent && previousEvent.tone !== focusEvent.tone) {
      return `${t('liveDesk.toneWas')} ${previousEvent.tone} ("${previousEvent.title}") -> ${t('liveDesk.toneNow')} ${focusEvent.tone}.`;
    }
    return null;
  }, [focusEvent, previousEvent, t]);

  return (
    <Panel className="p-4 flex flex-col gap-3 min-h-[420px]">
      <PanelHeader eyebrow={t('liveDesk.aiAnalysisEyebrow')} title={t('liveDesk.aiAnalysisTitle')} icon={<GaugeIcon className="w-4 h-4" />} />

      <div className="text-[9px] text-[var(--text-muted)] leading-relaxed border border-[var(--border-subtle)] rounded-lg p-2 bg-[var(--bg-panel)]">
        <Info className="w-3 h-3 inline mr-1 -mt-0.5" />
        {t('liveDesk.pipelineNote')}
      </div>

      {!focusEvent || !stats ? (
        <EmptyState title={t('liveDesk.noAnalysisTitle')} detail={t('liveDesk.noBroadcastDetail')} />
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            {stats.topics.length > 0 ? (
              stats.topics.map((topic) => (
                <Badge key={topic} tone="info">
                  {topic}
                </Badge>
              ))
            ) : (
              <span className="text-[10px] text-[var(--text-muted)]">{t('liveDesk.noTopics')}</span>
            )}
          </div>

          <MiniGauge label={t('liveDesk.hawkishDovishGauge')} value={stats.avgStance} leftLabel={t('liveDesk.dovish')} rightLabel={t('liveDesk.hawkish')} color={TONE_COLOR[focusEvent.tone]} />

          <div className="bg-[var(--bg-panel)] border-l-2 border-[var(--text-primary)] p-2.5 rounded-r-lg text-[10.5px] text-[var(--text-secondary)] leading-relaxed">
            <span className="font-bold text-[var(--text-primary)] text-[9px] uppercase tracking-wider block mb-1">{t('liveDesk.oneLineSummary')}</span>
            {focusEvent.summary}
          </div>

          {stats.keyPoints.length > 0 && (
            <div>
              <span className="font-bold text-[9px] uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1 mb-1">
                <ListChecks className="w-3 h-3" /> {t('liveDesk.keyPoints')}
              </span>
              <ul className="space-y-1">
                {stats.keyPoints.map((p, i) => (
                  <li key={i} className="text-[10px] text-[var(--text-secondary)] flex gap-1.5">
                    <span className="text-[var(--text-muted)]">•</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[var(--bg-surface)] rounded-lg p-2 border border-[var(--border-subtle)]">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text-muted)]">{t('liveDesk.importanceScore')}</div>
              <div className="text-sm font-bold tabular-nums text-[var(--text-primary)]">{stats.importanceScore.toFixed(1)}/10</div>
            </div>
            <div className="bg-[var(--bg-surface)] rounded-lg p-2 border border-[var(--border-subtle)]">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text-muted)]">{t('liveDesk.confidenceScore')}</div>
              <div className="text-sm font-bold tabular-nums text-[var(--text-primary)]">{stats.avgConfidence !== null ? `${Math.round(stats.avgConfidence)}%` : '—'}</div>
            </div>
          </div>
          <div className="text-[8px] text-[var(--text-muted)]">{t('liveDesk.aiEstimateDisclaimer')}</div>

          {narrativeChange && (
            <div className="text-[10px] text-[var(--text-secondary)] bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-lg p-2">
              <span className="font-bold text-[9px] uppercase tracking-wider text-[var(--text-muted)] block mb-1">{t('liveDesk.narrativeChange')}</span>
              {narrativeChange}
            </div>
          )}
        </>
      )}
    </Panel>
  );
};

// -------------------------------------------------------------------------------------------
// Panel 3 (row 1, right): Smart Alerts
// -------------------------------------------------------------------------------------------
const AlertRow: React.FC<{ a: LiveDeskAlert; onOpenEvent: (id: string) => void }> = ({ a, onOpenEvent }) => (
  <button
    type="button"
    onClick={() => (a.link?.startsWith('/intel/live/') ? onOpenEvent(a.link.replace('/intel/live/', '')) : undefined)}
    className="w-full text-left rounded-lg border border-[var(--border-subtle)] p-2 hover:border-[var(--border-strong)] transition-colors"
    style={{ borderLeftWidth: '3px', borderLeftColor: SEVERITY_COLOR[a.severity] }}
  >
    <div className="flex items-center gap-1.5">
      <Badge tone={a.severity === 'HIGH' ? 'down' : a.severity === 'MEDIUM' ? 'warning' : 'neutral'}>{a.severity}</Badge>
      <span className="text-[8px] text-[var(--text-muted)] ml-auto tabular-nums">{formatAge(a.at)}</span>
    </div>
    <div className="text-[10.5px] font-bold text-[var(--text-primary)] mt-1 leading-snug">{a.title}</div>
    <div className="text-[9.5px] text-[var(--text-muted)] mt-0.5 leading-snug line-clamp-2">{a.description}</div>
  </button>
);

const SmartAlertsPanel: React.FC<{ onOpenEvent: (id: string) => void }> = ({ onOpenEvent }) => {
  const { t } = useTranslation();
  const { data, isLoading } = useEndpoint<LiveDeskAlertsResponse>('/api/live-desk/alerts', 60_000);
  const [showAll, setShowAll] = useState(false);

  return (
    <Panel className="p-4 flex flex-col gap-2.5 min-h-[420px]">
      <PanelHeader
        eyebrow={t('liveDesk.alertsEyebrow')}
        title={t('liveDesk.alertsTitle')}
        icon={<AlertTriangle className="w-4 h-4" />}
        actions={
          <DataQualityBadge meta={{ source: 'HEVORA Live Desk', lastUpdated: data?.generatedAt || null, status: data ? statusFromAge(data.generatedAt, 5 * 60_000, 30 * 60_000) : 'LOADING' }} compact />
        }
      />
      {isLoading && !data ? (
        <LoadingState variant="cards" />
      ) : !data || data.alerts.length === 0 ? (
        <EmptyState title={t('liveDesk.noAlertsTitle')} detail={t('liveDesk.noAlertsDetail')} />
      ) : (
        <div className="flex-1 overflow-y-auto max-h-72 space-y-1.5 pr-1">
          {data.alerts.slice(0, 10).map((a) => (
            <AlertRow key={a.id} a={a} onOpenEvent={onOpenEvent} />
          ))}
        </div>
      )}
      {/* Fix round §4: expands IN-PAGE (modal), never navigates to another tab. */}
      {data && data.alerts.length > 10 && (
        <button type="button" onClick={() => setShowAll(true)} className="text-[9.5px] text-[var(--color-brand)] font-bold flex items-center gap-1 mt-auto pt-1">
          {t('liveDesk.viewAllAlerts')} ({data.alerts.length}) <ChevronRight className="w-3 h-3" />
        </button>
      )}
      {showAll && data && (
        <ExpandModal title={t('liveDesk.alertsTitle')} onClose={() => setShowAll(false)}>
          {data.alerts.map((a) => (
            <AlertRow key={a.id} a={a} onOpenEvent={onOpenEvent} />
          ))}
        </ExpandModal>
      )}
      {data && data.unavailableTriggers.length > 0 && (
        <div className="text-[8px] text-[var(--text-muted)] border-t border-[var(--border-subtle)] pt-1.5 space-y-0.5">
          {data.unavailableTriggers.map((u) => (
            <div key={u.type}>
              <span className="font-bold">{u.label}:</span> {u.reason}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
};

// -------------------------------------------------------------------------------------------
// Panel 4 (row 2, left): Impact Matrix
// -------------------------------------------------------------------------------------------
const ImpactMatrixPanel: React.FC<{}> = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useEndpoint<LiveDeskImpactMatrixResponse>('/api/live-desk/impact-matrix', 60_000);

  return (
    <Panel className="p-4 flex flex-col gap-2.5">
      <PanelHeader eyebrow={t('liveDesk.impactEyebrow')} title={t('liveDesk.impactTitle')} icon={<GaugeIcon className="w-4 h-4" />} />
      {isLoading && !data ? (
        <LoadingState variant="table" />
      ) : (
        <>
          {data?.primary ? (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-[8px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="text-left px-1 py-1">{t('liveDesk.colAsset')}</th>
                    <th className="text-right px-1 py-1">{t('liveDesk.colPrice')}</th>
                    <th className="text-right px-1 py-1">{t('liveDesk.colImpact')}</th>
                    <th className="text-right px-1 py-1">{t('liveDesk.colConfidence')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.primary.rows.map((r) => (
                    <tr key={r.pairId} className="border-t border-[var(--border-subtle)]">
                      <td className="px-1 py-1.5 font-bold text-[var(--text-primary)]">{r.label}</td>
                      <td className="px-1 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">{r.price !== null ? r.price.toLocaleString() : '—'}</td>
                      <td className="px-1 py-1.5 text-right">
                        <span className="inline-flex items-center gap-1 font-bold" style={{ color: DIRECTION_COLOR[r.direction] }}>
                          <DirectionArrow direction={r.direction} className="w-3 h-3" />
                          {r.direction}
                        </span>
                      </td>
                      <td className="px-1 py-1.5 text-right tabular-nums text-[var(--text-muted)]">{r.confidence}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-[8px] text-[var(--text-muted)] mt-1 px-1">
                {t('liveDesk.impactSourceNote')} "{data.primary.sourceEventTitle}" · {formatAge(data.primary.sourceEventAt)}
              </div>
            </div>
          ) : (
            <EmptyState title={t('liveDesk.noImpactTitle')} detail={t('liveDesk.noBroadcastDetail')} />
          )}

          {data && data.assetClasses.length > 0 && (
            <div className="border-t border-[var(--border-subtle)] pt-2 space-y-1.5">
              <span className="text-[8px] uppercase tracking-wider text-[var(--text-muted)] font-bold">{t('liveDesk.assetClassReadTitle')}</span>
              {data.assetClasses.map((ac) => (
                <div key={ac.assetClass} className="flex items-center justify-between text-[10px]">
                  <span className="capitalize text-[var(--text-secondary)]">{ac.assetClass}</span>
                  <span className="flex items-center gap-1 font-bold" style={{ color: DIRECTION_COLOR[ac.majorityDirection] }}>
                    <DirectionArrow direction={ac.majorityDirection} className="w-3 h-3" />
                    {ac.majorityDirection} <span className="text-[var(--text-muted)] font-normal">({ac.sampleSize})</span>
                  </span>
                </div>
              ))}
              <div className="text-[8px] text-[var(--text-muted)]">{t('liveDesk.assetClassReadNote')}</div>
            </div>
          )}
          <div className="text-[8px] text-[var(--text-muted)] italic">{data?.disclaimer}</div>
        </>
      )}
    </Panel>
  );
};

// -------------------------------------------------------------------------------------------
// Panel 5 (row 2, center): Sentiment Dashboard
// -------------------------------------------------------------------------------------------
const SentimentDashboardPanel: React.FC<{
  impact: LiveDeskImpactMatrixResponse | null;
  narrative: LiveDeskNarrativeResponse | null;
  geoRiskScore: number | null;
  fearGreed: number | null;
  /** Most recent speech/press-conference events (non market_news), newest first - used to
   *  average the "Monetary Tone" gauge over several recent readings rather than just one. */
  recentSpeeches: LiveEvent[];
}> = ({ impact, narrative, geoRiskScore, fearGreed, recentSpeeches }) => {
  const { t } = useTranslation();

  const marketSentiment = useMemo(() => {
    if (!impact?.primary) return null;
    const bullish = impact.primary.rows.filter((r) => r.direction === 'Bullish').length;
    const bearish = impact.primary.rows.filter((r) => r.direction === 'Bearish').length;
    const total = impact.primary.rows.length || 1;
    return ((bullish - bearish) / total) * 50 + 50;
  }, [impact]);

  const monetaryTone = useMemo(() => {
    const sample = recentSpeeches.slice(0, 5);
    if (sample.length === 0) return null;
    const toneScore: Record<string, number> = { Hawkish: 100, Neutral: 50, Dovish: 0 };
    return sample.reduce((sum, e) => sum + toneScore[e.tone], 0) / sample.length;
  }, [recentSpeeches]);

  const riskAppetite = useMemo(() => {
    if (fearGreed === null && geoRiskScore === null) return null;
    const fgComponent = fearGreed !== null ? fearGreed : 50;
    const geoComponent = geoRiskScore !== null ? 100 - geoRiskScore : 50;
    return (fgComponent + geoComponent) / 2;
  }, [fearGreed, geoRiskScore]);

  const totalToday = narrative ? narrative.hottestToday.reduce((a, b) => a + b.count, 0) : 0;

  return (
    <Panel className="p-4 flex flex-col gap-3">
      <PanelHeader eyebrow={t('liveDesk.sentimentEyebrow')} title={t('liveDesk.sentimentTitle')} icon={<GaugeIcon className="w-4 h-4" />} />
      <MiniGauge label={t('liveDesk.marketSentimentGauge')} value={marketSentiment} leftLabel={t('liveDesk.bearish')} rightLabel={t('liveDesk.bullish')} color={marketSentiment !== null && marketSentiment >= 50 ? '#2ECC71' : '#FF4D4F'} />
      <MiniGauge label={t('liveDesk.monetaryToneGauge')} value={monetaryTone} leftLabel={t('liveDesk.dovish')} rightLabel={t('liveDesk.hawkish')} color={monetaryTone !== null && monetaryTone >= 50 ? '#FF4D4F' : '#2ECC71'} />
      <MiniGauge label={t('liveDesk.riskAppetiteGauge')} value={riskAppetite} leftLabel={t('liveDesk.riskOff')} rightLabel={t('liveDesk.riskOn')} color={riskAppetite !== null && riskAppetite >= 50 ? '#2ECC71' : '#FF4D4F'} />
      <div className="text-[8px] text-[var(--text-muted)]">{t('liveDesk.gaugeDisclaimer')}</div>

      <div className="border-t border-[var(--border-subtle)] pt-2">
        <span className="text-[8px] uppercase tracking-wider text-[var(--text-muted)] font-bold">{t('liveDesk.narrativeTrackerTitle')}</span>
        {!narrative || narrative.hottestToday.length === 0 ? (
          <p className="text-[10px] text-[var(--text-muted)] mt-1">{t('liveDesk.noNarrativeYet')}</p>
        ) : (
          <div className="space-y-1.5 mt-1.5">
            {narrative.hottestToday.map((topic) => (
              <div key={topic.topic}>
                <div className="flex items-center justify-between text-[9.5px] mb-0.5">
                  <span className="text-[var(--text-secondary)]">{topic.topic}</span>
                  <span className="tabular-nums text-[var(--text-muted)]">{topic.count}x</span>
                </div>
                <div className="h-1 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                  <div className="h-full bg-[var(--color-brand)] rounded-full" style={{ width: `${totalToday > 0 ? (topic.count / totalToday) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
};

/** Latest non-null GLD (SPDR Gold Shares) tonnes reading - never a fabricated fallback. */
function latestGldTonnes(gld: GldHoldingsResponse | null | undefined): number | null {
  if (!gld || gld.unavailable) return null;
  for (let i = gld.points.length - 1; i >= 0; i--) {
    if (gld.points[i].tonnes !== null) return gld.points[i].tonnes;
  }
  return null;
}

// -------------------------------------------------------------------------------------------
// Panel 6 (row 2, right): Crypto & Commodity Intelligence
// -------------------------------------------------------------------------------------------
const CryptoCommodityPanel: React.FC<{}> = () => {
  const { t } = useTranslation();
  const { data: fearGreed } = useEndpoint<FearGreedResponse>('/api/sentiment/fear-greed', 5 * 60_000);
  const { data: derivatives } = useEndpoint<CryptoDerivativesResponse>('/api/crypto/derivatives?symbol=BTCUSDT', 5 * 60_000);
  const { data: cbGold } = useEndpoint<CentralBankGoldResponse>('/api/macro/central-bank-gold', 60 * 60_000);
  const { data: gld } = useEndpoint<GldHoldingsResponse>('/api/macro/gld-holdings', 60 * 60_000);

  const latestFg = fearGreed?.points?.[fearGreed.points.length - 1] ?? null;

  return (
    <Panel className="p-4 flex flex-col gap-2.5">
      <PanelHeader eyebrow={t('liveDesk.cryptoCommodityEyebrow')} title={t('liveDesk.cryptoCommodityTitle')} icon={<Coins className="w-4 h-4" />} />

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[var(--bg-surface)] rounded-lg p-2 border border-[var(--border-subtle)]">
          <div className="text-[8px] uppercase tracking-wider text-[var(--text-muted)]">{t('liveDesk.fearGreed')}</div>
          <div className="text-sm font-bold tabular-nums text-[var(--text-primary)]">{latestFg ? latestFg.value : '—'}</div>
          <div className="text-[8px] text-[var(--text-muted)]">{latestFg?.classification || (fearGreed?.unavailable ? t('liveDesk.unavailable') : '')}</div>
        </div>
        <div className="bg-[var(--bg-surface)] rounded-lg p-2 border border-[var(--border-subtle)]">
          <div className="text-[8px] uppercase tracking-wider text-[var(--text-muted)]">{t('liveDesk.fundingRate')}</div>
          <div className="text-sm font-bold tabular-nums" style={{ color: (derivatives?.fundingRate ?? 0) >= 0 ? '#2ECC71' : '#FF4D4F' }}>
            {derivatives?.fundingRate !== null && derivatives?.fundingRate !== undefined ? `${(derivatives.fundingRate * 100).toFixed(4)}%` : '—'}
          </div>
          <div className="text-[8px] text-[var(--text-muted)]">BTC-USDT · {derivatives?.source || ''}</div>
        </div>
      </div>

      <div className="border-t border-[var(--border-subtle)] pt-2">
        <span className="text-[8px] uppercase tracking-wider text-[var(--text-muted)] font-bold">{t('liveDesk.centralBankGoldTitle')}</span>
        {cbGold?.unavailable || !cbGold?.rows?.length ? (
          <p className="text-[10px] text-[var(--text-muted)] mt-1">{t('liveDesk.unavailable')}</p>
        ) : (
          <div className="mt-1 space-y-0.5">
            {cbGold.rows.slice(0, 3).map((r) => (
              <div key={r.country} className="flex items-center justify-between text-[10px]">
                <span className="text-[var(--text-secondary)]">{r.country}</span>
                <span className={`tabular-nums font-bold ${r.changeTonnes >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                  {r.changeTonnes >= 0 ? '+' : ''}
                  {r.changeTonnes}t
                </span>
              </div>
            ))}
            <div className="text-[8px] text-[var(--text-muted)]">{cbGold.lastReportedMonth}</div>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border-subtle)] pt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[9.5px]">
        <div className="flex items-center justify-between col-span-2">
          <span className="text-[var(--text-secondary)]">{t('liveDesk.gldHoldings')}</span>
          <span className="font-bold tabular-nums text-[var(--text-primary)]">{latestGldTonnes(gld) !== null ? `${latestGldTonnes(gld)!.toFixed(1)}t` : t('liveDesk.unavailable')}</span>
        </div>
        <div className="flex items-center justify-between col-span-2 text-[var(--text-muted)]">
          <span>{t('liveDesk.opecCompliance')}</span>
          <span>{t('liveDesk.notAvailableShort')}</span>
        </div>
        <div className="flex items-center justify-between col-span-2 text-[var(--text-muted)]">
          <span>{t('liveDesk.cryptoEtfFlow')}</span>
          <span>{t('liveDesk.notAvailableShort')}</span>
        </div>
      </div>
      <div className="text-[8px] text-[var(--text-muted)] italic">{t('liveDesk.aiEstimateDisclaimer')}</div>
    </Panel>
  );
};

// -------------------------------------------------------------------------------------------
// Row 3 panels
// -------------------------------------------------------------------------------------------
const CalendarMiniPanel: React.FC<{ events: EconomicEvent[]; onNavigate: (route: string) => void }> = ({ events, onNavigate }) => {
  const { t } = useTranslation();
  const upcoming = useMemo(() => {
    const now = Date.now();
    return events
      .filter((e) => e.impact === 'High' || e.impact === 'Medium')
      .filter((e) => new Date(e.dateISO).getTime() >= now - 30 * 60_000)
      .sort((a, b) => new Date(a.dateISO).getTime() - new Date(b.dateISO).getTime())
      .slice(0, 5);
  }, [events]);

  return (
    <Panel className="p-3.5 flex flex-col gap-2">
      <PanelHeader eyebrow={t('category.calendar')} title={t('liveDesk.calendarMiniTitle')} icon={<CalendarIcon className="w-3.5 h-3.5" />} />
      {upcoming.length === 0 ? (
        <p className="text-[10px] text-[var(--text-muted)]">{t('liveDesk.noUpcomingEvents')}</p>
      ) : (
        <div className="space-y-1.5">
          {upcoming.map((ev) => (
            <div key={ev.id} className="flex items-center justify-between text-[10px]">
              <span className="truncate mr-2">
                <Badge tone={ev.impact === 'High' ? 'down' : 'warning'} className="mr-1">{ev.currency}</Badge>
                {ev.event}
              </span>
              <span className="text-[var(--text-muted)] tabular-nums shrink-0">{ev.time}</span>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => onNavigate('/calendar/economic')} className="text-[9.5px] text-[var(--color-brand)] font-bold flex items-center gap-1 mt-auto pt-1">
        {t('liveDesk.viewFullCalendar')} <ChevronRight className="w-3 h-3" />
      </button>
    </Panel>
  );
};

const NewsRow: React.FC<{ n: LiveEvent; onOpenEvent: (id: string) => void }> = ({ n, onOpenEvent }) => {
  const { t } = useTranslation();
  return (
    <button type="button" onClick={() => onOpenEvent(n.id)} className="w-full text-left text-[10px] flex items-start gap-1.5">
      <span className="mt-0.5 shrink-0" style={{ color: DIRECTION_COLOR[n.verdict] }}>
        <DirectionArrow direction={n.verdict} className="w-2.5 h-2.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[var(--text-secondary)] line-clamp-2 leading-snug">{n.title}</span>
        <span className="block text-[8px] text-[var(--text-muted)] mt-0.5">
          {n.type === 'market_news' ? t('liveDesk.newsTagMarketNews') : n.source || t('liveDesk.newsTagSpeech')} · {formatAge(n.createdAt)}
        </span>
      </span>
    </button>
  );
};

/** Fix round §3: broadened beyond `type === 'market_news'` on purpose - the narrower filter was
 *  why this panel (and the standalone Intelligence > News tab, see IntelView.tsx's own matching
 *  fix) could sit empty while Live Desk's other panels were genuinely full of real content: the
 *  newly-enabled official-institution sources (Fed/ECB/BOJ/... - live-intel-watcher.config.ts)
 *  publish `type: 'speech'|'press_release'|...`, never `'market_news'` (that type is reserved for
 *  the separate copyright-constrained commercial-RSS pipeline). "News" here now means anything
 *  genuinely newsworthy Live Desk has published: the market-news feed OR a Medium/High-impact
 *  institutional event - not literally every low-impact item, to stay a skimmable list. */
function isNewsworthy(e: LiveEvent): boolean {
  return e.type === 'market_news' || e.impact === 'High' || e.impact === 'Medium';
}

const NewsMiniPanel: React.FC<{ events: LiveEvent[]; onOpenEvent: (id: string) => void }> = ({ events, onOpenEvent }) => {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const news = useMemo(() => events.filter(isNewsworthy), [events]);

  return (
    <Panel className="p-3.5 flex flex-col gap-2">
      <PanelHeader eyebrow={t('category.intelligence')} title={t('liveDesk.newsMiniTitle')} icon={<Newspaper className="w-3.5 h-3.5" />} />
      {news.length === 0 ? (
        <p className="text-[10px] text-[var(--text-muted)]">{t('liveDesk.noNewsYet')}</p>
      ) : (
        <div className="space-y-1.5">
          {news.slice(0, 5).map((n) => (
            <NewsRow key={n.id} n={n} onOpenEvent={onOpenEvent} />
          ))}
        </div>
      )}
      {/* Fix round §4: expands IN-PAGE (modal), never navigates to another tab. */}
      {news.length > 5 && (
        <button type="button" onClick={() => setShowAll(true)} className="text-[9.5px] text-[var(--color-brand)] font-bold flex items-center gap-1 mt-auto pt-1">
          {t('liveDesk.viewAllNews')} ({news.length}) <ChevronRight className="w-3 h-3" />
        </button>
      )}
      {showAll && (
        <ExpandModal title={t('liveDesk.newsMiniTitle')} onClose={() => setShowAll(false)}>
          {news.map((n) => (
            <NewsRow key={n.id} n={n} onOpenEvent={onOpenEvent} />
          ))}
        </ExpandModal>
      )}
    </Panel>
  );
};

// AiChatMiniPanel removed (UX fix round §1) - it duplicated the ONE global HEVAI widget every
// page already has (bottom-right launcher, AiAssistantWidget.tsx/HevaiPanel.tsx). Capability is
// preserved, not lost: LiveDeskView pushes a live snapshot into ShellContext
// (setLiveDeskChatContext below) whenever this page is open, and useAskAi.ts relays it on every
// question so that SAME global panel answers Live-Desk-scoped questions ("apa dampak berita ini
// ke BTC") with real context - see LiveDeskChatContext's doc comment in types.ts and
// sanitizeLiveDeskChatContext in server.ts for the full path data takes to reach the prompt.

const CorrelationMiniPanel: React.FC<{}> = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useEndpoint<CrossAssetCorrelationResponse>('/api/analysis/cross-asset-correlation', 5 * 60_000);

  const rows = useMemo(() => {
    if (!data) return [];
    const btcIdx = data.symbols.indexOf('BTCUSDT') !== -1 ? 'BTCUSDT' : data.symbols[0];
    return data.symbols
      .filter((s) => s !== btcIdx)
      .map((s) => {
        const cell = data.cells.find((c) => (c.a === btcIdx && c.b === s) || (c.a === s && c.b === btcIdx));
        return { symbol: s, label: data.labels[s] || s, value: cell?.value ?? null };
      })
      .slice(0, 5);
  }, [data]);

  return (
    <Panel className="p-3.5 flex flex-col gap-2">
      <PanelHeader eyebrow={t('liveDesk.correlationEyebrow')} title={t('liveDesk.correlationTitle')} icon={<GaugeIcon className="w-3.5 h-3.5" />} />
      {isLoading && !data ? (
        <LoadingState variant="table" />
      ) : rows.length === 0 ? (
        <p className="text-[10px] text-[var(--text-muted)]">{t('liveDesk.unavailable')}</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.symbol} className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--text-secondary)]">{r.label}</span>
              <span className={`tabular-nums font-bold ${r.value !== null && r.value >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>{r.value !== null ? r.value.toFixed(2) : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
};

const ScenarioPanel: React.FC<{}> = () => {
  const { t } = useTranslation();
  const { data } = useEndpoint<KalshiFedProbabilitiesResponse>('/api/macro/kalshi-fed-probabilities', 15 * 60_000);
  const topThreshold = data?.probabilities?.thresholds?.[0] ?? null;

  return (
    <Panel className="p-3.5 flex flex-col gap-2">
      <PanelHeader eyebrow={t('liveDesk.scenarioEyebrow')} title={t('liveDesk.scenarioTitle')} icon={<GaugeIcon className="w-3.5 h-3.5" />} />
      <div className="space-y-1.5 text-[10px]">
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-secondary)]">{t('liveDesk.rateCutProbability')}</span>
          <span className="font-bold tabular-nums text-[var(--text-primary)]">{topThreshold ? `${topThreshold.probabilityPct.toFixed(0)}%` : '—'}</span>
        </div>
        <div className="flex items-center justify-between text-[var(--text-muted)]">
          <span>{t('liveDesk.bullishBearish30d')}</span>
          <span>{t('liveDesk.notAvailableShort')}</span>
        </div>
        <div className="flex items-center justify-between text-[var(--text-muted)]">
          <span>{t('liveDesk.recessionProbability')}</span>
          <span>{t('liveDesk.notAvailableShort')}</span>
        </div>
      </div>
      <div className="text-[8px] text-[var(--text-muted)] italic">{t('liveDesk.scenarioNote')}</div>
    </Panel>
  );
};

const InstitutionalFlowPanel: React.FC<{}> = () => {
  const { t } = useTranslation();
  const items = [
    'ETF Flow', 'Mutual Fund Flow', 'Pension Fund Flow', 'Hedge Fund Flow', 'Sovereign Wealth Fund',
    'Options Flow', 'Block Trade Flow', 'Dark Pool Flow', 'Cross-Border Capital Flow', 'Whale/Smart Money',
  ];
  return (
    <Panel className="p-3.5 flex flex-col gap-2">
      <PanelHeader eyebrow={t('liveDesk.institutionalEyebrow')} title={t('liveDesk.institutionalTitle')} icon={<Info className="w-3.5 h-3.5" />} />
      <p className="text-[9.5px] text-[var(--text-muted)] leading-relaxed">{t('liveDesk.institutionalNote')}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((i) => (
          <Badge key={i} tone="neutral">{i}: {t('liveDesk.notAvailableShort')}</Badge>
        ))}
      </div>
    </Panel>
  );
};

/** Sidebar "ETF Tracker" expand (brief §10): a fuller read of GLD holdings history than the
 *  summary row already shown in CryptoCommodityPanel, plus an honest note that no BTC/ETH spot
 *  ETF flow endpoint exists anywhere in this codebase (audited - see server.ts's Live Desk scope
 *  comment) rather than a fabricated number. */
const EtfTrackerPanel: React.FC<{}> = () => {
  const { t } = useTranslation();
  const { data: gld, isLoading } = useEndpoint<GldHoldingsResponse>('/api/macro/gld-holdings', 60 * 60_000);
  const recentPoints = useMemo(() => (gld?.points ?? []).filter((p) => p.tonnes !== null).slice(-5).reverse(), [gld]);

  return (
    <Panel className="p-3.5 flex flex-col gap-2">
      <PanelHeader eyebrow={t('liveDesk.etfEyebrow')} title={t('liveDesk.etfTitle')} icon={<Coins className="w-3.5 h-3.5" />} />
      {isLoading && !gld ? (
        <LoadingState variant="table" />
      ) : recentPoints.length === 0 ? (
        <p className="text-[10px] text-[var(--text-muted)]">{t('liveDesk.unavailable')}</p>
      ) : (
        <div className="space-y-1">
          {recentPoints.map((p) => (
            <div key={p.date} className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--text-muted)] tabular-nums">{p.date}</span>
              <span className="font-bold tabular-nums text-[var(--text-primary)]">{p.tonnes!.toFixed(1)}t</span>
            </div>
          ))}
        </div>
      )}
      <div className="text-[8px] text-[var(--text-muted)] border-t border-[var(--border-subtle)] pt-1.5">
        <span className="font-bold">{t('liveDesk.cryptoEtfFlow')}:</span> {t('liveDesk.cryptoEtfUnavailableReason')}
      </div>
    </Panel>
  );
};

const LiquidityTrackerMini: React.FC<{ onNavigate: (route: string) => void }> = ({ onNavigate }) => {
  const { t } = useTranslation();
  const rrp = useFredSeries(['RRPONTSYD'], 3);
  const value = latestValue(rrp.series.RRPONTSYD);
  return (
    <Panel className="p-3.5 flex flex-col gap-2">
      <PanelHeader eyebrow={t('liveDesk.liquidityEyebrow')} title={t('liveDesk.liquidityTitle')} icon={<GaugeIcon className="w-3.5 h-3.5" />} />
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[var(--text-secondary)]">{t('macro.rrp')}</span>
        <span className="font-bold tabular-nums text-[var(--text-primary)]">{rrp.needsSetup ? t('liveDesk.needsSetup') : value !== null ? `$${(value / 1000).toFixed(0)}B` : '—'}</span>
      </div>
      <button type="button" onClick={() => onNavigate('/macro/global')} className="text-[9.5px] text-[var(--color-brand)] font-bold flex items-center gap-1 mt-auto pt-1">
        {t('liveDesk.viewFullLiquidity')} <ChevronRight className="w-3 h-3" />
      </button>
    </Panel>
  );
};

// -------------------------------------------------------------------------------------------
// Root component
// -------------------------------------------------------------------------------------------
interface LiveDeskViewProps {
  prices: Record<PairId, MarketPrice>;
  calendarEvents: EconomicEvent[];
  onOpenEvent: (id: string) => void;
  onNavigate: (route: string) => void;
}

export const LiveDeskView: React.FC<LiveDeskViewProps> = ({ prices, calendarEvents, onOpenEvent, onNavigate }) => {
  const { t } = useTranslation();
  const { setLiveDeskChatContext } = useShell();
  const [selectedPairId, setSelectedPairId] = useState<PairId>('XAUUSD');

  const { data: liveEventsData } = useEndpoint<{ events: LiveEvent[] }>('/api/live-events?limit=60', 60_000);
  const { data: narrative } = useEndpoint<LiveDeskNarrativeResponse>('/api/live-desk/narrative', 120_000);
  const { data: impactMatrix } = useEndpoint<LiveDeskImpactMatrixResponse>('/api/live-desk/impact-matrix', 60_000);
  const { data: geoRisk } = useEndpoint<{ score: number | null }>('/api/intelligence/geopolitical-risk', 2 * 60_000);
  const { data: fearGreedData } = useEndpoint<FearGreedResponse>('/api/sentiment/fear-greed', 5 * 60_000);

  const events = liveEventsData?.events || [];
  const speeches = useMemo(() => events.filter((e) => e.type !== 'market_news'), [events]);

  // Fix round §5: "Jenis Event" filter - real distinct `source` labels actually present in the
  // fetched events (never a fabricated FOMC/CPI/ECB taxonomy - see LiveBroadcastPanel's own doc
  // comment). CPI-style scheduled data releases have no broadcast/transcript to browse in the
  // first place (they belong to the Economic Calendar panel below, not this source-based filter) -
  // this dropdown only ever lists actual broadcast sources.
  const sourceOptions = useMemo(() => [...new Set(speeches.map((e) => e.source).filter((s): s is string => Boolean(s)))].sort(), [speeches]);
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const [sessionIndex, setSessionIndex] = useState(0);

  const filteredSpeeches = useMemo(
    () => (eventTypeFilter === 'all' ? speeches : speeches.filter((e) => e.source === eventTypeFilter)),
    [speeches, eventTypeFilter]
  );
  // A genuinely-live session always takes the front slot regardless of where it sorts by
  // createdAt, so switching between filters never hides an in-progress broadcast.
  const sessionList = useMemo(() => {
    const live = filteredSpeeches.find((e) => e.liveSession?.status === 'live');
    return live ? [live, ...filteredSpeeches.filter((e) => e.id !== live.id)] : filteredSpeeches;
  }, [filteredSpeeches]);

  const handleSelectSource = (source: string) => {
    setEventTypeFilter(source);
    setSessionIndex(0);
  };
  // Clamp defensively (e.g. the list shrinks after a filter change/refetch) instead of pointing
  // past the end and rendering nothing.
  const clampedIndex = Math.min(sessionIndex, Math.max(0, sessionList.length - 1));
  const focusEvent = sessionList[clampedIndex] ?? null;
  const previousEvent = sessionList[clampedIndex + 1] ?? null;
  const latestFg = fearGreedData?.points?.[fearGreedData.points.length - 1]?.value ?? null;

  // Fix round §1: relays a live, real snapshot of this page to ShellContext so the ONE global
  // HEVAI widget (bottom-right, every page) can answer Live-Desk-scoped questions - see
  // LiveDeskChatContext's doc comment. Cleared on unmount so a page the user has left never keeps
  // answering as if it were still open.
  useEffect(() => {
    const snapshot: LiveDeskChatContext = {
      focusEventTitle: focusEvent?.title ?? null,
      focusEventSummary: focusEvent?.summary ?? null,
      focusEventTone: focusEvent?.tone ?? null,
      focusEventVerdict: focusEvent?.verdict ?? null,
      topics: focusEvent?.segments ? [...new Set(focusEvent.segments.map((s) => s.topic))] : [],
      narrativeHotTopics: narrative?.hottestToday.map((topic) => topic.topic) ?? [],
      impactRows: impactMatrix?.primary?.rows.map((r) => ({ label: r.label, direction: r.direction, confidence: r.confidence })) ?? [],
    };
    setLiveDeskChatContext(snapshot);
    return () => setLiveDeskChatContext(null);
  }, [focusEvent, narrative, impactMatrix, setLiveDeskChatContext]);

  return (
    <div className="space-y-4 font-mono">
      <Panel flush className="p-4 sm:p-5">
        <PanelHeader
          eyebrow={t('category.intelligence')}
          title={t('liveDesk.title')}
          subtitle={t('liveDesk.subtitle')}
          icon={<Radio className="w-4 h-4" />}
          actions={<LivePulseDot />}
        />
        <p className="text-[9.5px] text-[var(--text-muted)] mt-3 leading-relaxed">{t('liveDesk.scopeDisclaimer')}</p>
      </Panel>

      {/* Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <LiveBroadcastPanel
          focusEvent={focusEvent}
          onOpenEvent={onOpenEvent}
          sourceOptions={sourceOptions}
          selectedSource={eventTypeFilter}
          onSelectSource={handleSelectSource}
          sessionPosition={{ index: clampedIndex, total: sessionList.length }}
          onPrevSession={() => setSessionIndex((i) => Math.min(sessionList.length - 1, i + 1))}
          onNextSession={() => setSessionIndex((i) => Math.max(0, i - 1))}
        />
        <AiAnalysisPanel focusEvent={focusEvent} previousEvent={previousEvent} />
        <SmartAlertsPanel onOpenEvent={onOpenEvent} />
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ImpactMatrixPanel />
        <SentimentDashboardPanel impact={impactMatrix ?? null} narrative={narrative ?? null} geoRiskScore={geoRisk?.score ?? null} fearGreed={latestFg} recentSpeeches={speeches} />
        <CryptoCommodityPanel />
      </div>

      {/* Row 3 - AI Chat Analyst removed here (fix round §1): the global HEVAI widget covers it. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <CalendarMiniPanel events={calendarEvents} onNavigate={onNavigate} />
        <NewsMiniPanel events={events} onOpenEvent={onOpenEvent} />
        <CorrelationMiniPanel />
        <ScenarioPanel />
      </div>

      {/* Sidebar-style extra panels: Watchlist, ETF/GLD detail, Liquidity, Institutional Flow */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <WatchlistSidebar pairs={PAIRS_LIST} prices={prices} selectedPairId={selectedPairId} onSelectPair={setSelectedPairId} />
        <EtfTrackerPanel />
        <LiquidityTrackerMini onNavigate={onNavigate} />
        <InstitutionalFlowPanel />
      </div>
    </div>
  );
};
