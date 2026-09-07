import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { MarketPrice, PairId } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useShell } from '../shell/ShellContext';
import { HevaiPanel } from './HevaiPanel';

/**
 * Global floating "Ask AI" launcher (Terminal redesign) - mounted once in AppShell.tsx, reachable
 * from every tab. Stays in its original position/size; only the panel it opens changed (PR 3):
 * pressing it now opens the full HEVAI panel (HevaiPanel.tsx - full-screen sheet on mobile, a
 * right-side drawer on desktop) instead of the old inline 360px popover. Open state lives in
 * ShellContext (isHevaiOpen/toggleHevai/closeHevai) so the "Open HEVAI" trigger inside AI Studio's
 * Ask AI tab (AiStudioHub.tsx - AskAiView itself was removed, it duplicated this exact feature in
 * a different visual style) opens the very same panel instance.
 */
export const AiAssistantWidget: React.FC<{ prices: Record<PairId, MarketPrice> }> = ({ prices }) => {
  const { t } = useTranslation();
  const { isHevaiOpen, toggleHevai, closeHevai } = useShell();

  // Theme-aware logo (bug fix): this button sits directly on the terminal's own background, which
  // follows the app's light/dark toggle (unlike HevaiPanel, which is always hardcoded dark) - a
  // white-only logo would be invisible against a light-theme background. App.tsx owns the theme
  // state but doesn't thread it this deep as a prop, so this reads document.documentElement's
  // data-theme attribute directly and watches it for changes - the same pattern
  // TradingViewChart.tsx already uses for the same "no prop access, needs to react to theme
  // toggles happening elsewhere" situation.
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
  );
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const logoSrc = theme === 'light' ? '/hevai-logo-dark.png' : '/hevai-logo.png';

  return (
    <>
      {/* bottom-20 clears BottomNav (fixed, full-width, ~56px row + safe-area) on mobile with
          margin to spare; lg:bottom-6 sits closer to the true viewport edge on desktop, where
          BottomNav does not render at all (lg:hidden). z-40 - below the header/BottomNav's z-50 -
          is intentional and safe: this button never spatially overlaps either of them.
          Logo swap: the circular bg/border badge (a plain white circle in light theme, since it
          used --bg-panel) is gone - the real HEVAI logo now floats directly on the terminal
          background with no wrapper shape, just a soft drop-shadow (follows the logo's own
          silhouette, not a box) for depth and a generous transparent hit area for tapping. */}
      <button
        type="button"
        onClick={toggleHevai}
        aria-label={isHevaiOpen ? t('aiWidget.closeLabel') : t('aiWidget.openLabel')}
        aria-expanded={isHevaiOpen}
        className="fixed right-4 bottom-20 lg:bottom-6 z-40 w-12 h-12 flex items-center justify-center text-[var(--text-primary)] drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)] hover:opacity-80 transition-opacity cursor-pointer"
      >
        {isHevaiOpen ? <X className="w-6 h-6" /> : <img src={logoSrc} alt="HEVAI" className="w-8 h-8 object-contain" />}
      </button>

      <HevaiPanel isOpen={isHevaiOpen} onClose={closeHevai} prices={prices} />
    </>
  );
};
