import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Coins,
  Gauge,
  ListChecks,
  MessageCircleQuestion,
  Newspaper,
  Radar,
  Scale,
  Send,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';
import type { CandlesResponse } from '../../lib/analytics';
import type { DxyResponse, EconHistoryResponse, EconIndicatorId, MarketPrice, PairId } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { ASK_AI_MAX_QUESTION_LENGTH, useAskAi } from '../../hooks/useAskAi';
import { useEndpoint } from '../../lib/useEndpoint';
import { detectMentionedPairs } from '../../lib/detectMentionedPairs';
import { detectMentionedEconIndicators, isDxyMentioned } from '../../lib/detectMentionedMacro';
import { InfoTooltip } from '../viz';
import { HevaiMarkdown, HevaiInlineMarkdown } from './HevaiMarkdown';
import { HevaiAssetCard } from './HevaiAssetCard';
import { buildHevaiAssetCards } from './hevaiAssetCards';

/** Same breakpoint Tailwind's `lg:` variants use everywhere else in the shell (MoreSheet,
 *  TopNav/BottomNav split) - kept as one source so the slide direction below never disagrees
 *  with the CSS layout it animates. */
const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';

const useIsDesktopViewport = (): boolean => {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_MEDIA_QUERY).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
};

/** Quick-question chips (PR 3, restyled as icon cards in the UI polish pass) - each submits
 *  straight to useAskAi, no typing required. Picked to match data actually surfaced by the
 *  server's own prompt bundle (gatherAskAiExtraContext in server.ts: active signals, XAU/BTC
 *  prices, Fear & Greed, COT, geopolitical risk, VIX, real yield) or the search-grounding path,
 *  not generic chat-assistant filler. Icon + colour token pairs are purely decorative (one of
 *  each of this app's five existing semantic/brand tokens, rotated so every card reads distinct)
 *  - not a claim that e.g. real yield is "bearish-coloured".*/
const QUICK_QUESTIONS: ReadonlyArray<{ key: string; icon: typeof Radar; color: string }> = [
  { key: 'askAi.chip.activeSignals', icon: Radar, color: 'var(--color-brand)' },
  { key: 'askAi.chip.xauCondition', icon: Coins, color: 'var(--accent-gold)' },
  { key: 'askAi.chip.fearGreed', icon: Gauge, color: 'var(--color-warn)' },
  { key: 'askAi.chip.marketNews', icon: Newspaper, color: 'var(--color-up)' },
  { key: 'askAi.chip.realYieldGold', icon: TrendingUp, color: 'var(--color-down)' },
];

// HEVAI consolidated pass (Aug 2026) - direct reference: Binance AI / ChatGPT answer screenshots
// use ZERO boxes for body text. Structure comes entirely from typography (bold headings, bullets,
// flowing paragraphs, "->" causal chains) - a bordered/background card only ever appears for a
// side-by-side scenario comparison (a real table) or a dedicated price lookup. Every "card" this
// panel used to wrap around key points/Consider/sources/DYOR is gone; the ONLY card left is the
// price/chart card below, and even that is capped to one per answer (see `.slice(0, 1)` at the
// call site) so two never stack. Card background is --hevai-card-bg (theme-aware pass, index.css):
// same literal dark value the brief specified in dark theme, an existing light surface token in
// light theme - see that token's comment for the reasoning. The shadow stays a flat black value in
// both themes, matching how every other card's shadow in this app (e.g. .hover-lift) is not
// re-themed either - a drop shadow reads as "cast shadow", not a surface colour.
const HEVAI_PRICE_CARD_CLASS = 'rounded-2xl bg-[var(--hevai-card-bg)] shadow-[0_4px_16px_rgba(0,0,0,0.4)]';

/**
 * HEVAI full-panel surface (Terminal redesign PR 3) - replaces both the old 360px popover body
 * that used to live inline in AiAssistantWidget and the separate full-page AskAiView (now
 * removed): one panel, one useAskAi() call, opened from either the floating launcher button or
 * the "Open HEVAI" trigger in AI Studio, via ShellContext's isHevaiOpen/closeHevai.
 *
 * Mobile (<lg): full-screen sheet, slides up from the bottom - same `fixed inset-0` + body-scroll
 * lock pattern as MoreSheet.tsx. Desktop (>=lg): a fixed-width (680px, visual redesign pass) drawer
 * from the right with a dismissible backdrop over the rest of the terminal, so charts/data stay
 * visible instead of being fully covered - a full 100vw sheet on a wide monitor would read as a
 * generic chat overlay, not part of this terminal.
 *
 * Presentation only: still the exact same POST /api/ai/ask via useAskAi, same rate-limit/budget/
 * concurrency handling from PR 1/2, untouched here.
 */
export const HevaiPanel: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** Same live `prices` state App.tsx already polls (/api/signals) and threads through the shell
   *  to every other module - passed here purely so the inline asset card (chart-redesign pass)
   *  can read current numbers with zero new fetches. */
  prices: Record<PairId, MarketPrice>;
}> = ({ isOpen, onClose, prices }) => {
  const { t } = useTranslation();
  const isDesktop = useIsDesktopViewport();
  const { question, setQuestion, turns, isAsking, notConfigured, retryAfterSeconds, submit } = useAskAi();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Chart-redesign pass: which pairs/macro indicators any VISIBLE answer actually talks about,
  // computed across every turn so a fetch enabled by an earlier turn stays enabled while later
  // turns are added (re-detecting is cheap - a handful of short strings, not a hot loop). Each
  // useEndpoint call below is gated on this (and on `isOpen`, so nothing fetches while the panel is
  // closed) - `url: null` makes useEndpoint skip the fetch entirely, so an indicator never
  // mentioned in this conversation never causes a network call. This is the one place this
  // redesign adds new client-side fetches at all, and only to endpoints this app already serves
  // and already polls from several other modules (/api/market/candles, /api/economic-history,
  // /api/macro/dxy) - no new backend route, no new external provider hit.
  const allAnswerText = turns.map((t) => t.answer || '').join(' \n ');
  const anyPairMentioned = allAnswerText.length > 0 && detectMentionedPairs(allAnswerText).length > 0;
  const mentionedIndicators = new Set(detectMentionedEconIndicators(allAnswerText));
  const dxyMentioned = isDxyMentioned(allAnswerText);

  const candlesRes = useEndpoint<CandlesResponse>(isOpen && anyPairMentioned ? '/api/market/candles' : null, 60_000);
  const vixRes = useEndpoint<EconHistoryResponse>(
    isOpen && mentionedIndicators.has('VIXCLS') ? '/api/economic-history?indicator=VIXCLS&currency=USD&months=90' : null,
    15 * 60_000
  );
  const realYieldRes = useEndpoint<EconHistoryResponse>(
    isOpen && mentionedIndicators.has('DFII10') ? '/api/economic-history?indicator=DFII10&currency=USD&months=90' : null,
    15 * 60_000
  );
  const yield10yRes = useEndpoint<EconHistoryResponse>(
    isOpen && mentionedIndicators.has('DGS10') ? '/api/economic-history?indicator=DGS10&currency=USD&months=90' : null,
    15 * 60_000
  );
  const fedFundsRes = useEndpoint<EconHistoryResponse>(
    isOpen && mentionedIndicators.has('FOMC') ? '/api/economic-history?indicator=FOMC&currency=USD&months=24' : null,
    15 * 60_000
  );
  const dxyRes = useEndpoint<DxyResponse>(isOpen && dxyMentioned ? '/api/macro/dxy' : null, 30_000);

  const econByIndicator: Partial<Record<EconIndicatorId, EconHistoryResponse | null>> = {
    VIXCLS: vixRes.data,
    DFII10: realYieldRes.data,
    DGS10: yield10yRes.data,
    FOMC: fedFundsRes.data,
  };

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [isOpen]);

  const lastTurn = turns[turns.length - 1];
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length, lastTurn?.answer, lastTurn?.error]);

  // Progressive "thinking" indicator (Priority 2 pass) - turn.id is already a Date.now() string
  // (see useAskAi.submit), so elapsed time needs no new server/hook plumbing: `liveNow` ticks once
  // a second only while some turn is still unresolved (so this never runs a background timer with
  // the panel idle), and `thinkingDurations` freezes each turn's elapsed ms the instant it resolves
  // (answer or error), giving the collapsed "Berpikir selama Xd" summary a real, honest duration
  // rather than a fabricated one.
  const [liveNow, setLiveNow] = useState(() => Date.now());
  useEffect(() => {
    const anyThinking = turns.some((t) => t.answer === null && t.error === null);
    if (!anyThinking) return undefined;
    const id = window.setInterval(() => setLiveNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [turns]);

  const [thinkingDurations, setThinkingDurations] = useState<Record<string, number>>({});
  useEffect(() => {
    setThinkingDurations((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const t of turns) {
        if ((t.answer !== null || t.error !== null) && next[t.id] === undefined) {
          next[t.id] = Date.now() - Number(t.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [turns]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={t('aiWidget.panelTitle')}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-[var(--overlay-backdrop)] backdrop-blur-sm"
          />

          <motion.div
            initial={isDesktop ? { x: '100%' } : { y: '100%' }}
            animate={isDesktop ? { x: 0 } : { y: 0 }}
            exit={isDesktop ? { x: '100%' } : { y: '100%' }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            // Theme-aware pass: was a hardcoded bg-[#0A0A0B] ("the brief's literal panel colour",
            // deliberately NOT this app's shared --bg-panel token) so the panel stayed dark no
            // matter the terminal's own theme toggle - now it follows the same --bg-panel token
            // every other panel in the dashboard already uses (dark side is #0E0E0E, visually
            // indistinguishable from the old literal; light side is the app's existing white panel
            // token). font-mono dropped - it was forcing every answer, label and bullet into a
            // monospace "raw code output" look; falls back to the app's normal sans body font
            // (index.css's global font-family, already SF Pro/Inter).
            className="absolute inset-0 lg:inset-y-0 lg:right-0 lg:left-auto lg:w-[680px] lg:max-w-[92vw] flex flex-col bg-[var(--bg-panel)] border-l border-[var(--border-subtle)] shadow-2xl overflow-hidden"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-[var(--border-subtle)] shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {/* Real HEVAI logo file (static/hevai-logo.png) - replaces the old hand-drawn
                    HevaiMark.tsx recreation. Theme-aware pass: now rendered via the
                    .hevai-logo-mask CSS mask (index.css) instead of a plain <img> - the panel
                    background itself is theme-aware now, so a fixed white-on-transparent image
                    would go invisible in light theme; the mask recolors it off --text-primary,
                    which already flips per theme everywhere else. */}
                <span aria-hidden="true" className="hevai-logo-mask h-5 w-5 shrink-0" />
                <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                  {t('aiWidget.panelTitle')}
                </span>
                <InfoTooltip text={t('askAi.methodNote')} />
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('aiWidget.closeLabel')}
                className="shrink-0 p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Disclaimer collapsed (consolidated pass): previously a full-width bordered/
                background banner - now a single thin caption line with no box treatment at all,
                so it reads as a quiet footnote rather than competing with the actual answer. */}
            <p className="px-5 pt-1.5 pb-1 text-[10px] text-[var(--text-muted)] leading-snug shrink-0">
              {t('askAi.disclaimer')}
            </p>

            {notConfigured && (
              <div className="px-5 py-2.5 border-b border-[var(--border-subtle)] shrink-0">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-[var(--color-warn)]/40 text-[var(--color-warn)] bg-[var(--color-warn)]/10 text-[9px] font-bold uppercase tracking-wider">
                  {t('askAi.notConfigured')}
                </span>
              </div>
            )}

            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-6">
              {turns.length === 0 ? (
                <div className="h-full flex flex-col justify-center space-y-7 py-6">
                  <div className="text-center space-y-2.5">
                    {/* Same theme-aware mask as the header mark above. */}
                    <span aria-hidden="true" className="hevai-logo-mask w-9 h-9 mx-auto" />
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('askAi.welcomeTitle')}</h2>
                    <p className="text-[13px] text-[var(--text-muted)] leading-relaxed max-w-[40ch] mx-auto">
                      {t('askAi.empty')}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      {t('askAi.examplesLabel')}
                    </span>
                    {/* Suggestion chips are entry-point UI, not answer-body content - a light
                        border (not the heavy price-card shadow treatment) keeps them looking
                        tappable without reintroducing the "everything is a card" look. */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {QUICK_QUESTIONS.map(({ key, icon: Icon, color }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => submit(t(key))}
                          disabled={isAsking || retryAfterSeconds !== null}
                          className="flex items-start gap-3 p-4 text-left rounded-xl border border-[var(--border-subtle)] hover:bg-[var(--card-hover-bg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                        >
                          <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color }} />
                          <span className="text-[12.5px] text-[var(--text-secondary)] leading-snug">{t(key)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                turns.map((turn) => {
                  // Capped to the first match (consolidated pass): "maksimal 1 card, tidak boleh
                  // numpuk 2 chart sekaligus" - buildHevaiAssetCards can find more than one pair
                  // mentioned across a long answer, but only the single most relevant one renders.
                  // Bug fix: only turn.question is consulted (not turn.answer) - a card now only
                  // shows when THIS TURN'S OWN QUESTION names an asset ("harga XAU berapa?", "kalo
                  // gtu btc gmn?"), never just because the answer's own narrative happens to mention
                  // one (which used to make a price card appear for Fear & Greed sentiment / GDP-
                  // impact questions that never asked about a specific asset's price at all) - see
                  // resolveMentionedPairs in hevaiAssetCards.ts for the full reasoning.
                  const assetCards = turn.answer
                    ? buildHevaiAssetCards(turn.question, prices, candlesRes.data, econByIndicator, dxyRes.data, t).slice(0, 1)
                    : [];
                  return (
                    <div key={turn.id} className="space-y-5">
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-[18px] rounded-br-md bg-[var(--color-brand)]/15 px-4 py-3.5 text-sm text-[var(--text-primary)] font-medium leading-relaxed shadow-[0_4px_12px_-6px_rgba(0,0,0,0.4)]">
                          {turn.question}
                        </div>
                      </div>

                      {turn.error ? (
                        <div className="space-y-2">
                          <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--accent-gold)]">
                            {t('askAi.ai')}
                          </span>
                          <p className="text-sm text-[var(--color-down)] leading-relaxed">{turn.error}</p>
                        </div>
                      ) : turn.offTopic ? (
                        // Plain paragraph with an inline icon (consolidated pass) - previously a
                        // bordered warning card, now consistent with "no boxes in the answer body".
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--color-warn)] mt-0.5" />
                          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{turn.answer}</p>
                        </div>
                      ) : turn.answer ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--accent-gold)]">
                              {t('askAi.ai')}
                            </span>
                            {thinkingDurations[turn.id] !== undefined && (
                              <span className="text-[10px] text-[var(--text-muted)]">
                                · {t('askAi.thinkingDuration').replace(
                                  '{seconds}',
                                  String(Math.max(1, Math.round(thinkingDurations[turn.id] / 1000)))
                                )}
                              </span>
                            )}
                          </div>
                          {/* space-y-6: with no card borders doing the organizing anymore, spacing
                              IS the structure (same principle the Binance AI/ChatGPT reference
                              uses) - generous gaps between heading groups instead of box edges. */}
                          <div className="space-y-6">
                            {turn.keyPoints && turn.keyPoints.length > 0 && (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <ListChecks className="w-4 h-4 shrink-0 text-[var(--color-brand)]" />
                                  <span className="text-[15px] font-semibold text-[var(--text-primary)]">
                                    {t('askAi.keyPointsLabel')}
                                  </span>
                                </div>
                                <ul className="space-y-2 pl-0.5">
                                  {turn.keyPoints.map((point, i) => (
                                    <li key={i} className="text-[14px] text-[var(--text-primary)] leading-snug flex gap-2">
                                      <span className="mt-2 w-1 h-1 rounded-full bg-[var(--color-brand)] shrink-0" aria-hidden="true" />
                                      {/* HevaiInlineMarkdown, not a raw string (bug fix) - the model
                                          isn't told this bullet is plain-text-only, so it may still
                                          reach for emphasis/bold here like anywhere else in an answer. */}
                                      <span><HevaiInlineMarkdown text={point} /></span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            <HevaiMarkdown text={turn.answer} />

                            {assetCards.map((card) => (
                              <HevaiAssetCard key={card.key} data={card} cardClassName={HEVAI_PRICE_CARD_CLASS} />
                            ))}

                            {turn.actionConclusion && (
                              // Heading + paragraph, no card (consolidated pass) - matches
                              // "Consider"/"Tindakan" in the Binance AI reference: bold label,
                              // plain flowing text underneath, no border/background.
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <Target className="w-4 h-4 shrink-0 text-[var(--color-brand)]" />
                                  <span className="text-[14px] font-semibold text-[var(--text-primary)]">
                                    {t('askAi.actionLabel')}
                                  </span>
                                </div>
                                <p className="text-[14px] text-[var(--text-primary)] leading-relaxed">
                                  <HevaiInlineMarkdown text={turn.actionConclusion} />
                                </p>
                              </div>
                            )}

                            {/* turn.sources intentionally unused here (consolidated pass): sources
                                are no longer rendered as a separate list/card - the search-
                                synthesis prompt now instructs the model to cite inline as a
                                markdown link exactly where the fact appears (see
                                ASK_AI_SEARCH_ATTRIBUTION_RULE in server.ts), which HevaiMarkdown's
                                own link renderer already handles. The field stays in the API
                                response/type in case it's needed again later. */}

                            {turn.hasDirectionalBias && (
                              // Single small line (consolidated pass) - was a large bordered "
                              // DIRECTIONAL BIAS - DYOR" card; still mandatory whenever a
                              // directional bias is stated, just sized like a footnote now,
                              // matching the Binance AI reference's one-line disclaimer.
                              <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] italic">
                                <Scale className="w-3 h-3 shrink-0" />
                                {t('askAi.dyorText')}
                              </p>
                            )}

                            {turn.followUpQuestions && turn.followUpQuestions.length > 0 && (
                              <div className="space-y-2.5">
                                <span className="block text-[12.5px] text-[var(--text-secondary)]">
                                  {t('askAi.followUpLabel')}
                                </span>
                                <div className="flex flex-wrap gap-2">
                                  {/* .slice(0, 2): belt-and-suspenders alongside the server's own
                                      hard cap (splitMarkerList(payload, 2) in server.ts) - "maksimal
                                      2" holds even if that ever drifts. */}
                                  {turn.followUpQuestions.slice(0, 2).map((q, i) => (
                                    <button
                                      key={i}
                                      type="button"
                                      onClick={() => submit(q)}
                                      disabled={isAsking || retryAfterSeconds !== null}
                                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/5 text-[12px] text-[var(--text-secondary)] hover:border-[var(--color-brand)]/60 hover:text-[var(--color-brand)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                                    >
                                      <MessageCircleQuestion className="w-3.5 h-3.5 shrink-0 text-[var(--color-brand)]" />
                                      <HevaiInlineMarkdown text={q} />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--accent-gold)]">
                            {t('askAi.ai')}
                          </span>
                          {/* Loading state: a rotating, honest phrase (nothing here claims a step
                              that isn't actually happening - it's genuinely still waiting on the
                              same single request) plus three soft pulsing dots instead of a "· 4s"
                              literal seconds countdown. Phase cycles off the same 1s liveNow tick
                              already running while any turn is unresolved - no new timer. */}
                          <div className="flex items-center gap-2.5 text-[var(--text-muted)]">
                            <span className="hev-thinking-dots flex items-center gap-1 text-[var(--color-brand)]">
                              <span style={{ animationDelay: '0ms' }} />
                              <span style={{ animationDelay: '160ms' }} />
                              <span style={{ animationDelay: '320ms' }} />
                            </span>
                            <span className="text-sm leading-relaxed">
                              {t(
                                ['askAi.thinkingPhase1', 'askAi.thinkingPhase2', 'askAi.thinkingPhase3'][
                                  Math.floor(Math.max(0, liveNow - Number(turn.id)) / 2200) % 3
                                ]
                              )}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={submit} className="flex items-center gap-2.5 px-5 py-4 border-t border-[var(--border-subtle)] shrink-0">
              <input
                ref={inputRef}
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value.slice(0, ASK_AI_MAX_QUESTION_LENGTH))}
                placeholder={t('askAi.placeholder')}
                disabled={isAsking || retryAfterSeconds !== null}
                maxLength={ASK_AI_MAX_QUESTION_LENGTH}
                // text-base (16px), not this panel's smaller body sizes - iOS Safari auto-zooms the
                // whole page on focusing any input under 16px, which is exactly what was happening
                // here. This is the one field in the panel deliberately sized up for that reason,
                // not a general type-scale change.
                className="flex-1 min-w-0 px-4 py-3.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-strong)] disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isAsking || !question.trim() || retryAfterSeconds !== null}
                aria-label={t('askAi.send')}
                className="shrink-0 p-3.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--text-primary)] text-[var(--bg-base)] disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
