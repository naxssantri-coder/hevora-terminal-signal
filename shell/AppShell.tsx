import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { MarketPrice, PairId } from '../../types';
import { Navbar } from '../Navbar';
import { Footer } from '../Footer';
import { ErrorBoundary } from '../ErrorBoundary';
import { useRouter } from '../../lib/router';
import { BottomNav } from './BottomNav';
import { CommandPalette } from './CommandPalette';
import { HevSvgDefs } from './HevSvgDefs';
import { MoreSheet } from './MoreSheet';
import { SubNav } from './SubNav';
import { TopNav } from './TopNav';
import { TickerTape } from './TickerTape';
import { useShell } from './ShellContext';
import { AiAssistantWidget } from '../ai/AiAssistantWidget';

/**
 * Responsive application shell (Fase 1, §2; nav architecture revised round 3).
 *
 *   ticker tape (persistent, both platforms)
 *   top bar (brand + controls)
 *   desktop: horizontal TopNav, category tabs with dropdowns, inside this same sticky header
 *   mobile: 5-slot bottom nav + "More" navigator (unchanged)
 *   mobile-only section sub-nav (desktop's TopNav covers this already) + the active module
 *
 * Desktop navigation used to be a persistent left Sidebar column (Sidebar.tsx, removed) -
 * replaced with TopNav so the main content area is full-width with no reserved left column.
 *
 * Every piece of navigation reads the module registry, so a module added in a later phase shows
 * up in all of them at once without this file changing.
 */

interface AppShellProps {
  children: React.ReactNode;
  prices: Record<PairId, MarketPrice>;
  selectedPairId: PairId;
  onSelectPair: (pairId: PairId) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenAuthModal: (route?: string) => void;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  prices,
  selectedPairId,
  onSelectPair,
  theme,
  onToggleTheme,
  onOpenAuthModal,
}) => {
  const { path } = useRouter();
  const { navigateToRoute } = useShell();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);

  // The sidebar sticks below the (ticker + top bar) header, whose height varies with the safe
  // area inset and the admin-configurable logo. Measuring it into a CSS variable keeps the two
  // in sync without hardcoding a pixel value that would drift.
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () => {
      document.documentElement.style.setProperty('--hev-header-offset', `${Math.round(el.offsetHeight)}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ⌘K / Ctrl+K opens the command palette anywhere; Escape closes whatever overlay is open.
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setIsSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, []);

  // Any route change closes the mobile navigator - it is a navigation surface, not a mode.
  useEffect(() => {
    setIsMoreOpen(false);
  }, [path]);

  return (
    // reducedMotion="user" makes every motion/react-driven animation in the tree (this page
    // transition, GaugeRadial's needle, FlowParticles) defer to the OS-level "reduce motion"
    // setting automatically - one place to opt the whole shell in, rather than each component
    // re-implementing the same media-query check the plain-CSS animations already do in index.css.
    <MotionConfig reducedMotion="user">
      <HevSvgDefs />
      <div
        ref={headerRef}
        className="sticky top-0 z-50 bg-[var(--bg-header)] backdrop-blur-2xl"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <TickerTape prices={prices} selectedPairId={selectedPairId} onSelectPair={onSelectPair} />
        <Navbar
          theme={theme}
          onToggleTheme={onToggleTheme}
          onOpenAuthModal={onOpenAuthModal}
          onOpenSearch={() => setIsSearchOpen(true)}
          onNavigateHome={() => navigateToRoute('/')}
        />
        {/* Desktop-only horizontal nav (round 3 - replaces the old persistent left Sidebar).
            Lives inside this same headerRef-measured wrapper so --hev-header-offset keeps
            accounting for its height automatically; renders nothing below `lg` (TopNav's own
            `hidden lg:flex`), so mobile's bottom nav + "More" sheet are completely untouched. */}
        <TopNav />
      </div>

      <div className="w-full min-h-0 flex flex-col">
        {/* pb-24 clears the fixed mobile bottom nav (~56px + safe area) so the last bit of page
            content is never hidden behind it; lg:pb-6 restores normal footer spacing on
            desktop, where the bottom nav does not render at all.

            2026-09-02 (desktop width audit): max-w-[1400px] used to be a flat cap regardless of
            viewport - fine on a 1366px laptop (barely binds) but on anything from a 1536px
            laptop through a 1920px monitor it left a large, uneven empty margin on both sides
            while the header above (TickerTape/Navbar/TopNav, none of which have a max-w of
            their own) stayed genuinely full-width - exactly the "not full-width, kinda unfinished"
            look reported from production. Tiered instead of removed outright: 1400px stays the
            floor through `lg` (matches where the design was originally tuned, still true at
            1366px since 1366 < 1600 leaves it unconstrained there anyway), steps up to 1600px at
            `xl` (1280px+) and 1880px at `2xl` (1536px+) - `2xl` has no upper bound in Tailwind, so
            this is also the ceiling for ultrawide (2560px+): centered with real margin rather than
            stretching every grid/card layout in the app to an unreadable width. Footer.tsx's own
            max-w-7xl updated to the same scale so the footer band lines up with the content above
            it instead of reading as a second, narrower footer at wide viewports. */}
        <main className="flex-1 w-full max-w-[1400px] xl:max-w-[1600px] 2xl:max-w-[1880px] mx-auto px-4 sm:px-6 py-5 pb-24 lg:pb-6">
          <SubNav />
          {/* Premium redesign: a hard cut between modules is the single most "unfinished
              template" tell in the whole terminal. mode="wait" (rather than a true simultaneous
              crossfade) is deliberate here - modules vary wildly in height, and letting the
              outgoing and incoming module overlap in normal flow would jump the footer/scroll
              position mid-transition. A brief sequential fade+slide (~180ms out, ~220ms in)
              still reads as smooth motion, never a snap, without that layout risk. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={path}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <ErrorBoundary resetKey={path}>{children}</ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
        <Footer />
      </div>

      <BottomNav onOpenMore={() => setIsMoreOpen(true)} isMoreOpen={isMoreOpen} />
      <MoreSheet isOpen={isMoreOpen} onClose={() => setIsMoreOpen(false)} />
      <CommandPalette
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        prices={prices}
        onSelectAsset={onSelectPair}
      />
      {/* Global "Ask AI" floating widget (Terminal redesign) - mounted once here, outside the
          per-route AnimatePresence above, so it persists identically across every tab/page
          instead of only existing on the Intelligence > Ask AI page. */}
      <AiAssistantWidget prices={prices} />
    </MotionConfig>
  );
};
