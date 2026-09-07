import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isRouteActive, useRouter } from '../../lib/router';
import {
  ModuleCategory,
  ModuleDefinition,
  getCategoryLandingRoute,
  getModuleByRoute,
  listModules,
  resolveLegacyRoute,
} from '../../modules/registry';
import type { LiveDeskChatContext } from '../../types';

/**
 * One navigation implementation for the whole shell.
 *
 * Sidebar, bottom nav, "More" sheet, sub-nav, command palette and in-page drill-downs all go
 * through navigateToModule() so the auth gate (premium modules open the sign-in modal, with the
 * click's intent replayed afterwards) can never be bypassed by adding a new entry point.
 */

interface ShellContextValue {
  activeModule: ModuleDefinition | null;
  activeCategory: ModuleCategory | null;
  isSignedIn: boolean;
  navigateToModule: (mod: ModuleDefinition) => void;
  navigateToRoute: (route: string) => void;
  navigateToCategory: (category: ModuleCategory) => void;
  canAccess: (mod: ModuleDefinition) => boolean;
  /** HEVAI panel open state (Terminal redesign, PR 3) - lifted here so the floating launcher
   *  (AiAssistantWidget) and the "open HEVAI" trigger inside AI Studio's Ask AI tab drive the
   *  exact same panel instance instead of two independently-open surfaces. */
  isHevaiOpen: boolean;
  openHevai: () => void;
  closeHevai: () => void;
  toggleHevai: () => void;
  /** Live Desk fix round: the live snapshot LiveDeskView.tsx keeps pushed here while it's mounted
   *  (null on every other page) - see LiveDeskChatContext's own doc comment. useAskAi reads this
   *  so the ONE global HEVAI widget answers Live-Desk-aware questions without a second chat panel
   *  living inside the Live Desk grid. */
  liveDeskChatContext: LiveDeskChatContext | null;
  setLiveDeskChatContext: (ctx: LiveDeskChatContext | null) => void;
}

const ShellContext = createContext<ShellContextValue | undefined>(undefined);

interface ShellProviderProps {
  children: React.ReactNode;
  isSignedIn: boolean;
  /** Opens the Clerk modal, carrying the route the user was actually trying to reach. */
  onRequireAuth: (route: string) => void;
}

export const ShellProvider: React.FC<ShellProviderProps> = ({ children, isSignedIn, onRequireAuth }) => {
  const { path, navigate } = useRouter();
  const [isHevaiOpen, setIsHevaiOpen] = useState(false);
  const openHevai = useCallback(() => setIsHevaiOpen(true), []);
  const closeHevai = useCallback(() => setIsHevaiOpen(false), []);
  const toggleHevai = useCallback(() => setIsHevaiOpen((v) => !v), []);
  const [liveDeskChatContext, setLiveDeskChatContext] = useState<LiveDeskChatContext | null>(null);

  // Safety net (belt-and-suspenders alongside LiveDeskView's own unmount cleanup): whichever page
  // is active, a route change AWAY from Live Desk always clears its chat context - never leaves a
  // stale snapshot answering questions from a page the user isn't looking at anymore.
  useEffect(() => {
    if (path !== '/intelligence/live-desk') setLiveDeskChatContext(null);
  }, [path]);

  // An address whose module was merged into another one still points at a page that exists.
  // Rewrite it in place (replace, not push, so Back does not bounce between the two) before the
  // shell resolves the active module, otherwise the reader gets a not-found for live content.
  useEffect(() => {
    const target = resolveLegacyRoute(path);
    if (target) navigate(`${target}${window.location.search}`, { replace: true });
  }, [path, navigate]);

  const activeModule = useMemo(() => {
    const exact = getModuleByRoute(path);
    if (exact) return exact;
    // Deep routes (a future /market/forex/EURUSD asset workspace) still highlight their parent
    // module, so the shell chrome never goes blank on a drill-down.
    const parent = listModules()
      .filter((mod) => mod.route !== '/' && isRouteActive(mod.route, path))
      .sort((a, b) => b.route.length - a.route.length)[0];
    return parent ?? null;
  }, [path]);

  const canAccess = useCallback(
    // A module that isn't built yet exposes no data, so gating it behind sign-in would only be a
    // dead end - the placeholder is what a signed-out visitor sees either way.
    (mod: ModuleDefinition) => mod.status === 'planned' || mod.permissions === 'public' || isSignedIn,
    [isSignedIn]
  );

  const navigateToRoute = useCallback(
    (route: string) => {
      const resolved = resolveLegacyRoute(route) ?? route;
      const mod = getModuleByRoute(resolved);
      if (mod && !canAccess(mod)) {
        onRequireAuth(resolved);
        return;
      }
      navigate(resolved);
    },
    [canAccess, navigate, onRequireAuth]
  );

  const navigateToModule = useCallback(
    (mod: ModuleDefinition) => {
      if (!canAccess(mod)) {
        onRequireAuth(mod.route);
        return;
      }
      navigate(mod.route);
    },
    [canAccess, navigate, onRequireAuth]
  );

  const navigateToCategory = useCallback(
    (category: ModuleCategory) => navigateToRoute(getCategoryLandingRoute(category)),
    [navigateToRoute]
  );

  const value = useMemo<ShellContextValue>(
    () => ({
      activeModule,
      activeCategory: activeModule?.category ?? null,
      isSignedIn,
      navigateToModule,
      navigateToRoute,
      navigateToCategory,
      canAccess,
      isHevaiOpen,
      openHevai,
      closeHevai,
      toggleHevai,
      liveDeskChatContext,
      setLiveDeskChatContext,
    }),
    [activeModule, isSignedIn, navigateToModule, navigateToRoute, navigateToCategory, canAccess, isHevaiOpen, openHevai, closeHevai, toggleHevai, liveDeskChatContext]
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
};

export const useShell = (): ShellContextValue => {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used within a ShellProvider');
  return ctx;
};
