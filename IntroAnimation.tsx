import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n/LanguageContext';

interface IntroAnimationProps {
  onComplete: () => void;
}

/**
 * Brief (~1s) boot-sequence overlay shown once per browser session (gated by sessionStorage in
 * App.tsx), before the terminal itself appears. Logo-mark reveal + wordmark, institutional-
 * terminal style, not a bouncy/playful splash.
 *
 * IMPORTANT - timer stability: the completion timers are set up in an effect with an EMPTY
 * dependency array (`[]`), and the latest `onComplete` is read from a ref rather than being a
 * direct effect dependency. This is not a style preference - a previous version depended on
 * `[onComplete]` directly, and because App.tsx passed a fresh inline arrow function on every
 * render (and App.tsx re-renders roughly once per second from the live signal-polling loop), the
 * effect's cleanup fired and the timers were rescheduled from zero on almost every poll tick -
 * the intro could hang far longer than intended (observed hanging 5s+ in testing) instead of
 * completing after ~1s. Do not add `onComplete` back into this effect's dependency array.
 */
export const IntroAnimation: React.FC<IntroAnimationProps> = ({ onComplete }) => {
  const { t } = useTranslation();
  const [isExiting, setIsExiting] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const exitTimer = setTimeout(() => setIsExiting(true), 700);
    const completeTimer = setTimeout(() => onCompleteRef.current(), 950);
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(completeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`fixed inset-0 z-[999] flex items-center justify-center bg-[#050505] transition-opacity duration-250 ease-out ${
        isExiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      role="presentation"
      aria-hidden="true"
    >
      <div className="flex flex-col items-center gap-3 font-mono">
        <span
          className="intro-mark hev-logo-mark w-24 h-24 sm:w-28 sm:h-28"
          role="img"
          aria-label="HEVTERMINAL"
        />
        <div className="flex flex-col items-center gap-2 mt-1">
          <span className="intro-wordmark text-xl sm:text-2xl font-black tracking-[0.18em] text-white uppercase">
            HEVTERMINAL
          </span>
          <span className="intro-underline h-[2px] bg-[#2ECC71]" />
          <span className="intro-subtitle text-[9px] sm:text-[10px] tracking-[0.32em] text-[#6F6F6F] uppercase">
            {t('intro.subtitle')}
          </span>
        </div>
      </div>
    </div>
  );
};
