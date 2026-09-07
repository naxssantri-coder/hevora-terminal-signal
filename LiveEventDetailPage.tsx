import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Calendar, Mic, Youtube, ExternalLink, Zap, AlertTriangle, Radio } from 'lucide-react';
import { LiveEvent, PairId } from '../types';
import { useTranslation } from '../i18n/LanguageContext';

// Same palette as IntelView's Live Intelligence cards - kept as a local copy rather than a
// shared export since this page and IntelView don't otherwise share component internals.
const LIVE_TONE_COLOR: Record<string, string> = {
  Hawkish: '#FF4D4F',
  Dovish: '#2ECC71',
  Neutral: '#a1a1aa',
};
const LIVE_DIRECTION_COLOR: Record<string, string> = {
  Bullish: '#2ECC71',
  Bearish: '#FF4D4F',
  Neutral: '#a1a1aa',
};
const LIVE_IMPACT_COLOR: Record<string, string> = {
  High: '#FF4D4F',
  Medium: '#F5B942',
  Low: '#a1a1aa',
};
const IMPORTANCE_COLOR: Record<string, string> = {
  Low: '#a1a1aa',
  Medium: '#60a5fa',
  High: '#F5B942',
  Extreme: '#FF4D4F',
};

// Same significance threshold as server.ts's LIVE_STANCE_SHIFT_THRESHOLD - kept as a literal
// copy here (this is a client-only display decision, not logic that needs to match exactly;
// worst case a borderline shift shows/hides slightly differently client vs. server's own count).
const STANCE_SHIFT_DISPLAY_THRESHOLD = 10;

function formatVideoTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Human-readable labels for the 8 pairs LIVE_EVENT_TRACKED_PAIRS (server.ts) always covers when
// pairImpacts is present - kept in the same order server.ts emits them so the table reads in a
// stable, predictable order every time. Partial, not Record<PairId,...>: this is a deliberately
// curated 8-pair subset for AI market-reaction tracking, not the full asset universe - Tahap C's
// new data-only pairs are intentionally NOT added here (both call sites already fall back to the
// raw pairId when a label is missing).
const PAIR_LABELS: Partial<Record<PairId, string>> = {
  XAUUSD: 'XAU/USD (Gold)',
  BTCUSDT: 'BTC/USDT Perpetual',
  ETHUSDT: 'ETH/USDT Perpetual',
  SOLUSDT: 'SOL/USDT Perpetual',
  EURUSD: 'EUR/USD',
  USDCHF: 'USD/CHF',
  USDCAD: 'USD/CAD',
  GBPUSD: 'GBP/USD',
};

/** Extracts a YouTube embeddable URL from a real sourceUrl, only when it actually carries a
 * resolvable video ID (watch?v=, youtu.be/ID, /live/ID, /embed/ID) - moved here verbatim from
 * IntelView.tsx's old modal (which this page replaces). Never fabricates a video - returns null
 * for anything that isn't really a YouTube video link. */
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

function isYoutubeUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com';
  } catch {
    return false;
  }
}

interface LiveEventDetailPageProps {
  id: string;
  onBack: () => void;
}

export const LiveEventDetailPage: React.FC<LiveEventDetailPageProps> = ({ id, onBack }) => {
  const { t, language } = useTranslation();
  const [event, setEvent] = useState<LiveEvent | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [notFound, setNotFound] = useState<boolean>(false);

  // `silent` skips the loading spinner and doesn't flip to the "not found" error state on a
  // transient network hiccup - used by the live-session auto-refresh poll below, so a page that's
  // already showing real content never flashes back to a spinner or error screen every ~25s just
  // because one background refresh attempt failed. A real 404 (the event was actually deleted)
  // still surfaces even when silent, since that's not transient.
  const fetchEvent = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
      setNotFound(false);
    }
    try {
      const res = await fetch(`/api/live-events/${encodeURIComponent(id)}`);
      if (res.status === 404) {
        setNotFound(true);
        setEvent(null);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setEvent(data?.event || null);
        if (!data?.event) setNotFound(true);
      } else if (!silent) {
        setNotFound(true);
      }
    } catch (err) {
      console.error('Error fetching live event detail:', err);
      if (!silent) setNotFound(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  // Auto-refresh while this event's live session is still going, so new segments (appended by
  // scripts/live-intel-watcher.ts's live-poll loop) show up on their own within a few tens of
  // seconds, without the user having to manually reload the page. Keeps polling through 'ended'
  // too (the stream just stopped but the final holistic analysis may still be in flight, or
  // waiting on a retry) - stops the instant liveSession reaches 'finalized' (or the event has
  // none at all - every non-live event).
  useEffect(() => {
    const status = event?.liveSession?.status;
    if (status !== 'live' && status !== 'ended') return;
    const intervalId = setInterval(() => {
      fetchEvent({ silent: true });
    }, 20_000);
    return () => clearInterval(intervalId);
  }, [event?.liveSession?.status, fetchEvent]);

  const BackButton = (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-bold transition-colors cursor-pointer"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      <span>{t('intel.liveBackToIntel')}</span>
    </button>
  );

  if (loading) {
    return (
      <div className="space-y-6 font-mono animate-fadeIn pb-12">
        {BackButton}
        <div className="flex flex-col items-center justify-center py-24 space-y-3">
          <div className="w-7 h-7 border-2 border-[var(--border-subtle)] border-t-[#FF4D4F] rounded-full animate-spin" />
          <span className="text-xs text-[var(--text-muted)] tracking-widest uppercase">{t('intel.loading')}</span>
        </div>
      </div>
    );
  }

  if (notFound || !event) {
    return (
      <div className="space-y-6 font-mono animate-fadeIn pb-12">
        {BackButton}
        <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-xl p-12 text-center">
          <AlertTriangle className="w-10 h-10 text-[var(--text-muted)] mx-auto mb-3" />
          <p className="text-sm font-bold text-[var(--text-secondary)]">{t('intel.noResultsTitle')}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">{t('intel.noResultsBody')}</p>
        </div>
      </div>
    );
  }

  const embedUrl = extractYoutubeEmbedUrl(event.sourceUrl);
  const youtubeLink = isYoutubeUrl(event.sourceUrl);
  const hasSegments = Boolean(event.segments && event.segments.length > 0);
  const hasCausalChain = Boolean(event.causalChain && event.causalChain.length > 0);
  const hasPairImpacts = Boolean(event.pairImpacts && event.pairImpacts.length > 0);
  const isRichFormat = hasSegments || hasCausalChain || hasPairImpacts;
  const finalIntel = event.finalIntelligence;

  // "What changed?" - only the MOST RECENT consecutive-segment jump, and only when it clears the
  // significance threshold - real event-memory awareness (Conversation #N is a continuation of
  // #N-1, not an isolated read), computed straight from already-stored segment data.
  const segs = event.segments || [];
  const lastTwo = segs.length >= 2 ? [segs[segs.length - 2], segs[segs.length - 1]] : null;
  const latestShift =
    lastTwo && Math.abs(lastTwo[1].stanceScore - lastTwo[0].stanceScore) >= STANCE_SHIFT_DISPLAY_THRESHOLD
      ? { fromScore: lastTwo[0].stanceScore, toScore: lastTwo[1].stanceScore, delta: lastTwo[1].stanceScore - lastTwo[0].stanceScore }
      : null;

  return (
    <div className="space-y-6 font-mono animate-fadeIn pb-12 max-w-3xl mx-auto">
      {BackButton}

      {/* Header */}
      <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-xl p-6">
        <div className="flex items-center gap-2 text-xs mb-3">
          <span className="px-2.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-strong)] font-bold uppercase tracking-wider flex items-center gap-1.5">
            <Zap className="w-3 h-3" />
            {t('intel.liveIntelTitle')}
          </span>
          <span className="text-[var(--text-muted)]">•</span>
          <span className="text-[var(--text-secondary)] font-semibold">{event.type}</span>
          {event.liveSession?.status === 'live' && (
            <span className="px-2.5 py-0.5 rounded bg-[#FF4D4F]/15 text-[#FF4D4F] border border-[#FF4D4F]/40 font-bold uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
              <Radio className="w-3 h-3" />
              {t('intel.liveStatusBadgeLive')}
            </span>
          )}
          {event.liveSession?.status === 'ended' && (
            <span className="px-2.5 py-0.5 rounded bg-[#F5B942]/15 text-[#F5B942] border border-[#F5B942]/40 font-bold uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
              <Radio className="w-3 h-3" />
              {t('intel.liveStatusBadgeEnded')}
            </span>
          )}
        </div>

        <h1 className="text-xl md:text-2xl font-bold text-[var(--text-primary)] leading-tight">{event.title}</h1>

        <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-[var(--text-muted)] border-b border-[var(--border-subtle)] pb-4">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            <span>{new Date(event.createdAt).toLocaleString(language === 'id' ? 'id-ID' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </div>
          {event.liveSession && (
            <div className="flex items-center gap-1.5">
              <span>{t('intel.liveLastUpdated')}:</span>
              <span className="text-[var(--text-secondary)] font-medium">
                {new Date(event.liveSession.lastSegmentAt).toLocaleTimeString(language === 'id' ? 'id-ID' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              {event.liveSession.status === 'finalized' && (
                <span className="text-[var(--text-muted)]">({t('intel.liveStatusBadgeCompleted')})</span>
              )}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Mic className="w-3.5 h-3.5" />
            <span>{event.speaker || t('intel.liveUnknownSpeaker')}</span>
          </div>
          {event.source && (
            <div>
              {t('intel.liveSource')} <span className="text-[var(--text-primary)] font-medium">{event.source}</span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="font-bold uppercase" style={{ color: LIVE_TONE_COLOR[event.tone] || '#a1a1aa' }}>{event.tone}</span>
            <span className="text-[var(--text-muted)]">/</span>
            <span className="font-bold uppercase" style={{ color: LIVE_IMPACT_COLOR[event.impact] || '#a1a1aa' }}>{event.impact} {t('intel.liveImpactLabel')}</span>
          </div>
        </div>
      </div>

      {/* Video player or source link */}
      {embedUrl ? (
        <div className="rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-black aspect-video">
          <iframe
            src={embedUrl}
            title={event.title}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : event.sourceUrl ? (
        <a
          href={event.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <span className="flex items-center gap-2 truncate">
            {youtubeLink ? <Youtube className="w-3.5 h-3.5 shrink-0" /> : <ExternalLink className="w-3.5 h-3.5 shrink-0" />}
            <span className="truncate">{youtubeLink ? t('intel.liveWatchOnYoutube') : t('intel.liveOpenSource')}</span>
          </span>
          <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      ) : null}

      {/* Executive summary */}
      <div className="bg-[var(--bg-panel)] border-l-2 border-[var(--text-primary)] p-4 rounded-r-lg rounded-tl-xl rounded-bl-xl text-sm text-[var(--text-secondary)] leading-relaxed">
        <span className="font-bold text-[var(--text-primary)] text-xs block mb-1">{t('intel.executiveSummary')}</span>
        {event.summary}
      </div>

      {isRichFormat ? (
        <>
          {/* Segment timeline - each item is one "conversation" the AI processed as its own
              record. importance controls visual weight only (Low renders lightly, Extreme gets a
              prominent border) - every segment is always shown regardless, nothing is hidden. */}
          {hasSegments && (
            <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-xl p-5">
              <span className="font-bold text-[var(--text-primary)] text-sm block">{t('intel.liveSegmentTimeline')}</span>
              <span className="text-[10px] text-[var(--text-muted)] block mb-4">{t('intel.liveSegmentTimelineSub')}</span>
              <div className="space-y-0">
                {event.segments!.map((seg, idx) => {
                  const isExtreme = seg.importance === 'Extreme';
                  const isHigh = seg.importance === 'High';
                  const isLow = seg.importance === 'Low';
                  return (
                    <div key={idx} className="flex gap-3">
                      <div className="flex flex-col items-center pt-1">
                        <div
                          className={`rounded-full shrink-0 border-2 border-[var(--bg-panel)] ring-1 ${isExtreme ? 'w-3.5 h-3.5 ring-[#FF4D4F]' : 'w-2.5 h-2.5 ring-[var(--border-subtle)]'}`}
                          style={{ background: LIVE_TONE_COLOR[seg.tone] || '#a1a1aa' }}
                        />
                        {idx < event.segments!.length - 1 && <div className="w-px flex-1 bg-[var(--border-subtle)] mt-1 mb-1" />}
                      </div>
                      <div className={`flex-1 pb-4 min-w-0 ${isExtreme ? 'p-2.5 -mt-1 rounded-lg bg-[#FF4D4F]/5 border border-[#FF4D4F]/25' : ''}`}>
                        <div className={`flex items-center gap-2 mb-1.5 flex-wrap ${isLow ? 'opacity-70' : ''}`}>
                          {typeof seg.sequence === 'number' && (
                            <span className="text-[10px] font-bold text-[var(--text-muted)]">
                              {t('intel.liveConversationLabel')} #{String(seg.sequence).padStart(3, '0')}
                            </span>
                          )}
                          {typeof seg.videoTimestampSec === 'number' && (
                            <span className="text-[10px] text-[var(--text-muted)] font-mono">{formatVideoTimestamp(seg.videoTimestampSec)}</span>
                          )}
                          <span className="px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[10px] font-bold text-[var(--text-primary)] uppercase tracking-wide">
                            {seg.topic}
                          </span>
                          <span className="text-[10px] font-bold uppercase" style={{ color: LIVE_TONE_COLOR[seg.tone] || '#a1a1aa' }}>
                            {seg.tone}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)]">{seg.stanceScore}/100</span>
                          {seg.importance && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                              style={{ color: IMPORTANCE_COLOR[seg.importance], backgroundColor: `${IMPORTANCE_COLOR[seg.importance]}1A` }}
                            >
                              {seg.importance}
                            </span>
                          )}
                          {seg.isNewInformation === true && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-[#2ECC71]/10 text-[#2ECC71]">
                              {t('intel.liveNewInfoLabel')}
                            </span>
                          )}
                          {seg.isNewInformation === false && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase text-[var(--text-muted)]">
                              {t('intel.liveRepetitionLabel')}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-[var(--text-secondary)] italic leading-relaxed">&ldquo;{seg.keyStatement || seg.statement}&rdquo;</p>
                        {typeof seg.confidence === 'number' && (
                          <span className="text-[9px] text-[var(--text-muted)] block mt-1">{t('intel.confidence')}: {seg.confidence}%</span>
                        )}
                        {seg.segmentMarketImpact && seg.segmentMarketImpact.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {seg.segmentMarketImpact.map((mi, mIdx) => (
                              <span
                                key={mIdx}
                                className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                                style={{ color: LIVE_DIRECTION_COLOR[mi.direction], backgroundColor: `${LIVE_DIRECTION_COLOR[mi.direction]}1A` }}
                              >
                                {PAIR_LABELS[mi.pairId] || mi.pairId}: {mi.direction}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* "What changed?" - only shown when the most recent segment represents a genuinely
              significant stance jump from the one before it (same threshold the server uses for
              LiveEventFinalIntelligence.stanceShifts) - not shown for every minor wobble. */}
          {latestShift && (
            <div className="hev-card-v2 border border-[#F5B942]/40 rounded-xl p-5">
              <span className="font-bold text-[var(--text-primary)] text-sm block mb-4">{t('intel.liveWhatChangedTitle')}</span>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <span className="text-[9px] text-[var(--text-muted)] uppercase block mb-1">{t('intel.liveBefore')}</span>
                  <span className="font-bold text-lg text-[var(--text-primary)]">{latestShift.fromScore}</span>
                </div>
                <div>
                  <span className="text-[9px] text-[var(--text-muted)] uppercase block mb-1">{t('intel.liveNow')}</span>
                  <span className="font-bold text-lg text-[var(--text-primary)]">{latestShift.toScore}</span>
                </div>
                <div>
                  <span className="text-[9px] text-[var(--text-muted)] uppercase block mb-1">{t('intel.liveChange')}</span>
                  <span className="font-bold text-lg" style={{ color: latestShift.delta > 0 ? '#FF4D4F' : '#2ECC71' }}>
                    {latestShift.delta > 0 ? '+' : ''}{latestShift.delta}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Stance visual - one shared 0-100 dovish-to-hawkish scale, one dot per segment */}
          {hasSegments && (
            <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-xl p-5">
              <span className="font-bold text-[var(--text-primary)] text-sm block mb-6">{t('intel.liveStanceAnalysis')}</span>
              <div className="relative h-1.5 rounded-full mx-2" style={{ background: 'linear-gradient(to right, #2ECC71, #a1a1aa, #FF4D4F)' }}>
                {event.segments!.map((seg, idx) => (
                  <div
                    key={idx}
                    className="absolute top-1/2 group"
                    style={{ left: `${seg.stanceScore}%`, transform: 'translate(-50%, -50%)' }}
                  >
                    <div
                      className="w-3.5 h-3.5 rounded-full border-2 border-[var(--bg-panel)] shadow cursor-default"
                      style={{ background: LIVE_TONE_COLOR[seg.tone] || '#a1a1aa' }}
                      title={`${seg.topic}: ${seg.stanceScore}/100 (${seg.tone})`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[9px] text-[var(--text-muted)] font-mono uppercase mt-3 mx-2">
                <span>Dovish</span>
                <span>Neutral</span>
                <span>Hawkish</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-[10px] text-[var(--text-secondary)]">
                {event.segments!.map((seg, idx) => (
                  <span key={idx} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: LIVE_TONE_COLOR[seg.tone] || '#a1a1aa' }} />
                    {seg.topic}: {seg.stanceScore}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Causal chain */}
          {hasCausalChain && (
            <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-xl p-5">
              <span className="font-bold text-[var(--text-primary)] text-sm block mb-4">{t('intel.liveCausalChain')}</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {event.causalChain!.map((step, idx) => (
                  <React.Fragment key={idx}>
                    <span className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-bold text-xs">
                      {step}
                    </span>
                    {idx < event.causalChain!.length - 1 && <span className="text-[var(--text-muted)] text-sm">&rarr;</span>}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {/* 8-pair impact table */}
          {hasPairImpacts && (
            <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-xl p-5">
              <span className="font-bold text-[var(--text-primary)] text-sm block">{t('intel.livePairImpactTable')}</span>
              <span className="text-[10px] text-[var(--text-muted)] block mb-4">{t('intel.livePairImpactTableSub')}</span>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs min-w-[420px]">
                  <thead>
                    <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                      <th className="py-2 px-1 font-bold">Pair</th>
                      <th className="py-2 px-1 font-bold">Direction</th>
                      <th className="py-2 px-1 font-bold">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {event.pairImpacts!.map((pi) => (
                      <tr key={pi.pairId} className="border-b border-[var(--border-subtle)]/50 last:border-0">
                        <td className="py-2.5 px-1 font-bold text-[var(--text-primary)] whitespace-nowrap">
                          {PAIR_LABELS[pi.pairId] || pi.pairId}
                        </td>
                        <td className="py-2.5 px-1">
                          <span className="font-bold uppercase" style={{ color: LIVE_DIRECTION_COLOR[pi.direction] || '#a1a1aa' }}>
                            {pi.direction}
                          </span>
                        </td>
                        <td className="py-2.5 px-1">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden max-w-[100px]">
                              <div
                                className="hev-bar-grow h-full rounded-full"
                                style={{
                                  width: `${pi.confidence}%`,
                                  background: `linear-gradient(90deg, color-mix(in srgb, ${LIVE_DIRECTION_COLOR[pi.direction] || '#a1a1aa'} 55%, transparent), ${LIVE_DIRECTION_COLOR[pi.direction] || '#a1a1aa'})`,
                                  transition: 'width 400ms cubic-bezier(0.16, 1, 0.3, 1)',
                                }}
                              />
                            </div>
                            <span className="text-[var(--text-muted)] w-8 text-right shrink-0">{pi.confidence}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Final Event Intelligence - only once liveSession reaches 'finalized'. Counts are
              deterministic (computed server-side straight from the stored segments, never an AI
              guess); strongestDriver/majorRisks/the shift's reason are the only AI-synthesized
              parts, and stay honestly empty if that synthesis call failed rather than being
              invented. */}
          {finalIntel && (
            <div className="hev-card-v2 border border-[#FF4D4F]/30 rounded-xl p-5">
              <span className="font-bold text-[var(--text-primary)] text-sm block">{t('intel.liveFinalIntelligenceTitle')}</span>
              <span className="text-[10px] text-[var(--text-muted)] block mb-4">{t('intel.liveFinalIntelligenceSub')}</span>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
                {[
                  { label: t('intel.liveConversationsAnalyzed'), value: finalIntel.conversationsAnalyzed },
                  { label: t('intel.liveImportantStatements'), value: finalIntel.importantStatements },
                  { label: t('intel.liveMarketMovingStatements'), value: finalIntel.marketMovingStatements },
                  { label: t('intel.liveStanceShiftsCount'), value: finalIntel.stanceShifts },
                  { label: t('intel.liveExpectationChanges'), value: finalIntel.expectationChanges },
                ].map((stat, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-center">
                    <span className="text-[9px] text-[var(--text-muted)] uppercase block mb-1 leading-tight">{stat.label}</span>
                    <span className="font-bold text-base text-[var(--text-primary)]">{stat.value}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                  <span className="text-[9px] text-[var(--text-muted)] uppercase block mb-1">{t('intel.liveFinalStance')}</span>
                  <span className="font-bold text-lg" style={{ color: finalIntel.finalStanceScore >= 60 ? '#FF4D4F' : finalIntel.finalStanceScore <= 40 ? '#2ECC71' : '#a1a1aa' }}>
                    {finalIntel.finalStanceScore}/100
                  </span>
                </div>

                {finalIntel.strongestStatement && (
                  <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                    <span className="text-[9px] text-[var(--text-muted)] uppercase block mb-1">
                      {t('intel.liveStrongestStatement')}{finalIntel.strongestTopic ? ` (${finalIntel.strongestTopic})` : ''}
                    </span>
                    <p className="text-[var(--text-secondary)] italic leading-relaxed">&ldquo;{finalIntel.strongestStatement}&rdquo;</p>
                  </div>
                )}

                {finalIntel.strongestDriver && (
                  <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                    <span className="text-[9px] text-[var(--text-muted)] uppercase block mb-1">{t('intel.liveStrongestDriver')}</span>
                    <p className="text-[var(--text-primary)] font-bold">{finalIntel.strongestDriver}</p>
                  </div>
                )}

                {finalIntel.biggestStanceShift && (
                  <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                    <span className="text-[9px] text-[var(--text-muted)] uppercase block mb-1">{t('intel.liveBiggestShift')}</span>
                    <p className="text-[var(--text-primary)]">
                      <span className="font-bold">{finalIntel.biggestStanceShift.fromScore}</span>
                      <span className="text-[var(--text-muted)]"> &rarr; </span>
                      <span className="font-bold">{finalIntel.biggestStanceShift.toScore}</span>
                      <span className="text-[var(--text-muted)]"> ({finalIntel.biggestStanceShift.delta > 0 ? '+' : ''}{finalIntel.biggestStanceShift.delta}, Conversation #{String(finalIntel.biggestStanceShift.fromSequence).padStart(3, '0')} &rarr; #{String(finalIntel.biggestStanceShift.toSequence).padStart(3, '0')})</span>
                    </p>
                    {finalIntel.biggestStanceShift.reason && (
                      <p className="text-[var(--text-secondary)] text-[11px] mt-1">{t('intel.liveReason')}: {finalIntel.biggestStanceShift.reason}</p>
                    )}
                  </div>
                )}

                {finalIntel.majorRisks.length > 0 && (
                  <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                    <span className="text-[9px] text-[var(--text-muted)] uppercase block mb-1.5">{t('intel.liveMajorRisks')}</span>
                    <ul className="space-y-1">
                      {finalIntel.majorRisks.map((risk, i) => (
                        <li key={i} className="text-[var(--text-secondary)] flex items-start gap-1.5">
                          <span className="text-[#FF4D4F] shrink-0">&bull;</span>
                          <span>{risk}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Structured conclusion - short facts, not another paragraph */}
          <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-xl p-5">
            <span className="font-bold text-[var(--text-primary)] text-sm block mb-4">{t('intel.liveConclusion')}</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                <span className="text-[9px] text-[var(--text-muted)] uppercase block mb-1">{t('intel.liveOverallTone')}</span>
                <span className="font-bold text-sm uppercase" style={{ color: LIVE_TONE_COLOR[event.tone] || '#a1a1aa' }}>{event.tone}</span>
              </div>
              <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                <span className="text-[9px] text-[var(--text-muted)] uppercase block mb-1">{t('intel.liveVerdictLabel')}</span>
                <span className="font-bold text-sm uppercase" style={{ color: LIVE_DIRECTION_COLOR[event.verdict] || '#a1a1aa' }}>{event.verdict}</span>
              </div>
              <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                <span className="text-[9px] text-[var(--text-muted)] uppercase block mb-1">{t('intel.liveImpactLabel')}</span>
                <span className="font-bold text-sm uppercase" style={{ color: LIVE_IMPACT_COLOR[event.impact] || '#a1a1aa' }}>{event.impact}</span>
              </div>
              <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                <span className="text-[9px] text-[var(--text-muted)] uppercase block mb-1">{t('intel.liveSegmentsAnalyzed')}</span>
                <span className="font-bold text-sm text-[var(--text-primary)]">{event.segments?.length || 0}</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Legacy flat format - identical to the old modal's body, just as a page section now.
              Never fabricates segments/causalChain/pairImpacts for an event that doesn't have
              them. */}
          <div className="bg-[var(--bg-panel)] border border-dashed border-[var(--border-subtle)] rounded-xl p-3 text-[11px] text-[var(--text-muted)] flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{t('intel.liveLegacyEventNotice')}</span>
          </div>

          {event.marketEffects.length > 0 && (
            <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-xl p-5">
              <span className="font-bold text-[var(--text-primary)] text-xs block mb-2">{t('intel.liveMarketEffects')}</span>
              <div className="space-y-1.5">
                {event.marketEffects.map((eff, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs">
                    <span className="font-bold text-[var(--text-primary)] w-16 shrink-0">{eff.asset}</span>
                    <span className="font-bold w-16 shrink-0" style={{ color: LIVE_DIRECTION_COLOR[eff.direction] || '#a1a1aa' }}>{eff.direction}</span>
                    <span className="text-[var(--text-secondary)] leading-relaxed">{eff.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Raw transcript */}
      <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-xl p-5">
        <span className="font-bold text-[var(--text-primary)] text-xs block mb-2">{t('intel.liveRawTranscript')}</span>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed whitespace-pre-line italic">{event.rawTranscript}</p>
      </div>

      {BackButton}
    </div>
  );
};
