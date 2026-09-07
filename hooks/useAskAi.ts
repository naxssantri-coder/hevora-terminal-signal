import { useCallback, useState } from 'react';
import { AskAiResponse, AskAiSource } from '../types';
import { useTranslation } from '../i18n/LanguageContext';
import { useShell } from '../components/shell/ShellContext';

export const ASK_AI_MAX_QUESTION_LENGTH = 400;

/** Kept in sync with the server's own ASK_AI_MAX_HISTORY_TURNS (server.ts) - sending more than the
 *  server will use is harmless (it re-caps independently) but pointless payload bloat. */
const ASK_AI_MAX_HISTORY_TURNS_SENT = 3;

export interface AskAiTurn {
  id: string;
  question: string;
  answer: string | null;
  error: string | null;
  /** Google Search grounding citations, present only when this answer actually used external
   *  search - absent when it was answered from HEVORA's internal data bundle alone. */
  sources?: AskAiSource[];
  /** True when this turn was refused by the server's OFF_TOPIC scope guardrail - `answer` is the
   *  refusal text, meant to render as a distinct "out of scope" card rather than a normal answer. */
  offTopic?: boolean;
  /** True when this turn stated a genuinely directional bias (server's BIAS_DIRECTIONAL marker,
   *  PR 7) - meant to render a separate DYOR disclaimer card alongside the answer. */
  hasDirectionalBias?: boolean;
  /** Short bullet summary (server's POIN_UTAMA marker, HEVAI answer redesign) - rendered as a card
   *  above the full answer. */
  keyPoints?: string[];
  /** Suggested follow-up questions (server's SARAN_LANJUTAN marker) - rendered as submit-on-click
   *  chips below the answer. */
  followUpQuestions?: string[];
  /** One actionable-but-non-executable closing observation (server's optional TINDAKAN marker) -
   *  rendered as a distinct small card, present only for comparison/condition-analysis answers. */
  actionConclusion?: string;
}

export interface UseAskAiResult {
  question: string;
  setQuestion: (value: string) => void;
  turns: AskAiTurn[];
  isAsking: boolean;
  /** True once a response has told us GEMINI_API_KEY isn't set on this deployment. */
  notConfigured: boolean;
  /** Seconds remaining before another question can be asked, read from the 429 response's
   *  Retry-After header (per-IP question limiter or the global Gemini budget, whichever tripped) -
   *  null when not currently rate/budget-limited. */
  retryAfterSeconds: number | null;
  /** Pass a plain string (quick-question chips, PR 3) to submit that text directly without first
   *  routing it through the `question` input state - everything else (history, rate-limit
   *  handling, turn bookkeeping) is identical to a normal form submit. */
  submit: (e?: { preventDefault?: () => void } | string) => Promise<void>;
}

/**
 * Shared "Ask AI" request logic - the single source of truth for POST /api/ai/ask. Historically
 * called from two separately-styled surfaces (AskAiView's full-page tab and AiAssistantWidget's
 * popover); since the Terminal redesign PR 3 there is exactly one caller, HevaiPanel.tsx, opened
 * either from the floating launcher or from AI Studio's "Open HEVAI" button - one panel, one
 * conversation, everywhere in the app. Same 429/rate-limit handling (including reading the
 * server's Retry-After header), same honest "not configured" fallback, same conversation-turn
 * shape either way.
 *
 * Conversation history (HEVAI overhaul PR 2): the last few successful turns ARE sent back to the
 * server as chat context, so the user can ask natural-language follow-ups that build on a prior
 * answer. Only turns that resolved with a real answer (no error) are included - a failed turn has
 * nothing useful to add as context. The server independently re-validates and re-caps whatever is
 * sent (see server.ts's sanitizeAskAiHistory) - this client-side cap just keeps the request
 * payload itself small.
 */
export const useAskAi = (): UseAskAiResult => {
  const { t } = useTranslation();
  // Live Desk fix round: when the Live Desk page is open (and only then - null everywhere else,
  // see ShellContext), relay its current snapshot so this SAME global panel can answer
  // Live-Desk-scoped questions without a second, duplicate chat panel living in that page's grid.
  const { liveDeskChatContext } = useShell();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<AskAiTurn[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);

  const submit = useCallback(
    async (eOrText?: { preventDefault?: () => void } | string) => {
      const chipText = typeof eOrText === 'string' ? eOrText : undefined;
      if (typeof eOrText !== 'string') eOrText?.preventDefault?.();
      const trimmed = (chipText ?? question).trim();
      if (!trimmed || isAsking) return;

      setIsAsking(true);
      setQuestion('');
      setRetryAfterSeconds(null);
      const turnId = `${Date.now()}`;
      setTurns((prev) => [...prev, { id: turnId, question: trimmed, answer: null, error: null }]);

      try {
        const history = turns
          .filter((t) => t.answer && !t.error)
          .slice(-ASK_AI_MAX_HISTORY_TURNS_SENT)
          .map((t) => ({ question: t.question, answer: t.answer as string }));
        const res = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: trimmed, history, ...(liveDeskChatContext ? { liveDeskContext: liveDeskChatContext } : {}) }),
        });
        const payload = (await res.json().catch(() => null)) as AskAiResponse | null;

        if (res.status === 429) {
          const rawRetryAfter = Number(res.headers.get('Retry-After'));
          const seconds = Number.isFinite(rawRetryAfter) && rawRetryAfter > 0 ? rawRetryAfter : 60;
          setRetryAfterSeconds(seconds);
          const message = t('askAi.rateLimited').replace('{seconds}', String(seconds));
          setTurns((prev) => prev.map((turn) => (turn.id === turnId ? { ...turn, error: payload?.error || message } : turn)));
        } else if (!res.ok || !payload) {
          setTurns((prev) => prev.map((turn) => (turn.id === turnId ? { ...turn, error: payload?.error || t('askAi.genericError') } : turn)));
        } else if (!payload.success || !payload.answer) {
          if (payload.error && /GEMINI_API_KEY/.test(payload.error)) setNotConfigured(true);
          setTurns((prev) => prev.map((turn) => (turn.id === turnId ? { ...turn, error: payload.error || t('askAi.genericError') } : turn)));
        } else {
          setTurns((prev) =>
            prev.map((turn) =>
              turn.id === turnId
                ? {
                    ...turn,
                    answer: payload.answer,
                    sources: payload.sources,
                    offTopic: payload.offTopic,
                    hasDirectionalBias: payload.hasDirectionalBias,
                    keyPoints: payload.keyPoints,
                    followUpQuestions: payload.followUpQuestions,
                    actionConclusion: payload.actionConclusion,
                  }
                : turn
            )
          );
        }
      } catch (err) {
        setTurns((prev) =>
          prev.map((turn) => (turn.id === turnId ? { ...turn, error: err instanceof Error ? err.message : t('askAi.genericError') } : turn))
        );
      } finally {
        setIsAsking(false);
      }
    },
    [question, isAsking, t, turns, liveDeskChatContext]
  );

  return { question, setQuestion, turns, isAsking, notConfigured, retryAfterSeconds, submit };
};
