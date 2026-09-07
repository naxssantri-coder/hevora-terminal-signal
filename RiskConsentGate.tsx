import React, { useCallback, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { ShieldAlert, Check, Lock, Loader2, AlertCircle } from 'lucide-react';
import { RISK_CONSENT_ITEM_IDS, type RiskConsentItemId } from '../types';
import { useTranslation } from '../i18n/LanguageContext';

interface RiskConsentGateProps {
  /** Called after the server has recorded the acknowledgment, so the parent can drop the gate and
   * reveal signals immediately - no reload. */
  onAcknowledged: () => void;
}

// ---------------------------------------------------------------------------------------------
// Audio - Web Audio API only, no asset files.
//
// Everything here is synthesised from oscillators at call time. That is deliberate: no external
// audio file means no licensing question, nothing extra to download, and nothing to 404 on a
// cache-busted deploy. The palette is short square/triangle blips with a fast exponential decay -
// the clipped, synthetic character of terminal/sci-fi UI rather than a soft "notification" chime.
//
// The AudioContext is created lazily on the first real user gesture (a checkbox click). Browsers
// block audio started before any interaction, and constructing the context up-front would leave a
// suspended context sitting around on every page view for a sound that may never play.
// ---------------------------------------------------------------------------------------------
type AudioCtor = typeof AudioContext;

function getAudioContext(ref: React.MutableRefObject<AudioContext | null>): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor: AudioCtor | undefined = window.AudioContext || (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctor) return null; // No Web Audio support - the gate still works, just silently.
  if (!ref.current) {
    try {
      ref.current = new Ctor();
    } catch {
      return null;
    }
  }
  // Autoplay policies suspend a context created outside a gesture; resuming inside one is allowed.
  if (ref.current.state === 'suspended') void ref.current.resume();
  return ref.current;
}

/** One short synthesised blip. Gain is kept low (0.05-0.08) - this is UI feedback sitting under a
 * reading task, not an alert. */
function blip(
  ctx: AudioContext,
  opts: { freq: number; endFreq?: number; startAt?: number; duration?: number; type?: OscillatorType; gain?: number }
): void {
  const { freq, endFreq, startAt = 0, duration = 0.08, type = 'square', gain = 0.06 } = opts;
  const t0 = ctx.currentTime + startAt;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq !== undefined) {
    // Linear ramp rather than exponential: the audible "pitch drop" of a lock engaging.
    osc.frequency.linearRampToValueAtTime(endFreq, t0 + duration);
  }

  // Tiny attack avoids the click a hard 0->gain step produces; exponential release keeps the tail
  // short and dry so rapid checkbox ticks don't smear into each other.
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export const RiskConsentGate: React.FC<RiskConsentGateProps> = ({ onAcknowledged }) => {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const audioRef = useRef<AudioContext | null>(null);

  const [checked, setChecked] = useState<Record<RiskConsentItemId, boolean>>({
    capitalLoss: false,
    notAdvice: false,
    ownResponsibility: false,
    noLiability: false,
  });
  const [signatureName, setSignatureName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Ascending two-note tick when a box goes from unchecked to checked. Unchecking is silent -
   * the sound marks progress, and replaying it on undo would be misleading feedback. */
  const playCheckSound = useCallback(() => {
    const ctx = getAudioContext(audioRef);
    if (!ctx) return;
    blip(ctx, { freq: 880, duration: 0.045, type: 'square', gain: 0.05 });
    blip(ctx, { freq: 1320, startAt: 0.045, duration: 0.05, type: 'square', gain: 0.045 });
  }, []);

  /** Submit confirmation: a short descending three-note figure ending on a low sustained tone -
   * deliberately different in shape from the ticks (falling, not rising; longer; triangle rather
   * than square) so "recorded" never sounds like "one more box ticked". */
  const playLockedInSound = useCallback(() => {
    const ctx = getAudioContext(audioRef);
    if (!ctx) return;
    blip(ctx, { freq: 784, duration: 0.07, type: 'triangle', gain: 0.06 });
    blip(ctx, { freq: 588, startAt: 0.07, duration: 0.07, type: 'triangle', gain: 0.06 });
    blip(ctx, { freq: 392, startAt: 0.14, duration: 0.16, type: 'triangle', gain: 0.07 });
    // Low square underneath the final note - the "clunk" of the bolt landing.
    blip(ctx, { freq: 196, endFreq: 130, startAt: 0.14, duration: 0.22, type: 'square', gain: 0.05 });
  }, []);

  const toggleItem = (id: RiskConsentItemId) => {
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (next[id]) playCheckSound();
      return next;
    });
    setError(null);
  };

  const allChecked = RISK_CONSENT_ITEM_IDS.every((id) => checked[id]);
  const nameFilled = signatureName.trim().length > 0;
  const canSubmit = allChecked && nameFilled && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/user/risk-acknowledgment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          checkedItems: RISK_CONSENT_ITEM_IDS.filter((id) => checked[id]),
          signatureName: signatureName.trim(),
        }),
      });

      if (res.ok) {
        playLockedInSound();
        // Small delay so the confirmation tone is actually audible before the gate unmounts -
        // without it the sound is cut off mid-figure by the re-render.
        setTimeout(() => onAcknowledged(), 320);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t('riskGate.errorGeneric'));
        setSubmitting(false);
      }
    } catch (err) {
      setError(t('riskGate.errorNetwork'));
      setSubmitting(false);
    }
  };

  return (
    <div className="animate-fadeIn font-mono">
      <div className="max-w-3xl mx-auto bg-[var(--bg-panel)] border border-[var(--border-strong)] rounded-2xl overflow-hidden shadow-lg">
        {/* Header */}
        <div className="px-5 sm:px-7 py-5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-10 h-10 rounded-xl bg-[#FF4D4F]/10 border border-[#FF4D4F]/30 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-[#FF4D4F]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-[var(--text-primary)] leading-tight">
                {t('riskGate.title')}
              </h1>
              <p className="text-[10px] sm:text-[11px] text-[var(--text-muted)] mt-1 uppercase tracking-widest">
                {t('riskGate.subtitle')}
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-5 sm:px-7 py-5 space-y-5">
          {/* Opening statement - the liability position, stated plainly and up front. */}
          <div className="bg-[#FF4D4F]/5 border-l-2 border-[#FF4D4F] rounded-r-lg p-4">
            <p className="text-[11px] sm:text-xs text-[var(--text-secondary)] leading-relaxed">
              {t('riskGate.intro')}
            </p>
          </div>

          {/* The four statements - ticked one at a time on purpose. A single "agree to all" box
              would make the record weaker: it could not show which statements were actually read. */}
          <div className="space-y-2.5">
            <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              {t('riskGate.checklistLabel')}
            </p>

            {RISK_CONSENT_ITEM_IDS.map((id, idx) => {
              const isChecked = checked[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleItem(id)}
                  aria-pressed={isChecked}
                  className={`w-full text-left flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                    isChecked
                      ? 'bg-[#2ECC71]/5 border-[#2ECC71]/40'
                      : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <span
                    className={`shrink-0 mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-all ${
                      isChecked ? 'bg-[#2ECC71] border-[#2ECC71]' : 'border-[var(--border-strong)] bg-transparent'
                    }`}
                  >
                    {isChecked && <Check className="w-3 h-3 text-black" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-[9px] text-[var(--text-muted)] tabular-nums mr-1.5">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[11px] sm:text-xs text-[var(--text-secondary)] leading-relaxed">
                      {t(`riskGate.item.${id}`)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Digital signature */}
          <div className="space-y-2">
            <label htmlFor="risk-signature" className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              {t('riskGate.signatureLabel')}
            </label>
            <input
              id="risk-signature"
              type="text"
              value={signatureName}
              onChange={(e) => {
                setSignatureName(e.target.value);
                setError(null);
              }}
              placeholder={t('riskGate.signaturePlaceholder')}
              autoComplete="name"
              maxLength={120}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-strong)]"
            />
            <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">{t('riskGate.signatureHint')}</p>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-[#FF4D4F]/10 border border-[#FF4D4F]/30">
              <AlertCircle className="w-4 h-4 text-[#FF4D4F] shrink-0 mt-0.5" />
              <span className="text-[11px] text-[#FF4D4F]">{error}</span>
            </div>
          )}

          {/* Submit. Disabled until every box is ticked AND a name is typed - and the server
              enforces the same rule independently, so this is convenience, not the control. */}
          <div className="pt-1 space-y-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${
                canSubmit
                  ? 'bg-[var(--text-primary)] text-[var(--bg-base)] hover:opacity-90 cursor-pointer active:scale-[0.99]'
                  : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-subtle)] cursor-not-allowed'
              }`}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t('riskGate.submitting')}
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  {t('riskGate.submit')}
                </>
              )}
            </button>

            {/* Says exactly what is still missing, rather than leaving a dead button unexplained. */}
            {!canSubmit && !submitting && (
              <p className="text-[10px] text-[var(--text-muted)] text-center">
                {!allChecked
                  ? t('riskGate.hintNeedAllChecks').replace(
                      '{n}',
                      String(RISK_CONSENT_ITEM_IDS.filter((id) => !checked[id]).length)
                    )
                  : t('riskGate.hintNeedName')}
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
