import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Minimal History-API router.
 *
 * Deliberately NOT react-router: this project already routes /admin and /intel/live/:id with
 * raw pushState + popstate, the server already serves an SPA fallback for every non-/api path
 * (see startServer() in server.ts), and Fase 1 only needs path matching + navigation. Keeping
 * it in-repo avoids adding a dependency to a build that ships a single esbuild'd server bundle.
 *
 * Everything the shell needs (sidebar, bottom nav, sub-nav, command palette, deep links) reads
 * from this one place, so there is still exactly ONE navigation implementation - the thing the
 * old activeTab state got wrong was only that it had no URL, not that it was duplicated.
 */

interface RouterContextValue {
  /** Current pathname, always normalised without a trailing slash (except the root '/'). */
  path: string;
  /** Current query string params (read-only snapshot). */
  query: URLSearchParams;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterContextValue | undefined>(undefined);

export const normalizePath = (raw: string): string => {
  if (!raw) return '/';
  const withoutHash = raw.split('#')[0].split('?')[0];
  if (withoutHash === '/' || withoutHash === '') return '/';
  return withoutHash.replace(/\/+$/, '') || '/';
};

export const RouterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [location, setLocation] = useState<{ path: string; search: string }>(() => ({
    path: typeof window === 'undefined' ? '/' : normalizePath(window.location.pathname),
    search: typeof window === 'undefined' ? '' : window.location.search,
  }));

  useEffect(() => {
    const sync = () => {
      setLocation({ path: normalizePath(window.location.pathname), search: window.location.search });
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const target = to.startsWith('/') ? to : `/${to}`;
    const [pathPart, searchPart = ''] = target.split('?');
    const nextPath = normalizePath(pathPart);
    const nextSearch = searchPart ? `?${searchPart}` : '';
    const nextUrl = `${nextPath}${nextSearch}`;

    if (`${window.location.pathname}${window.location.search}` === nextUrl) return;

    if (options?.replace) window.history.replaceState({}, '', nextUrl);
    else window.history.pushState({}, '', nextUrl);

    setLocation({ path: nextPath, search: nextSearch });
    // A route change is a new page as far as the reader is concerned - land them at the top of
    // it rather than at whatever scroll offset the previous module happened to be at.
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const value = useMemo<RouterContextValue>(
    () => ({ path: location.path, query: new URLSearchParams(location.search), navigate }),
    [location.path, location.search, navigate]
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
};

export const useRouter = (): RouterContextValue => {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used within a RouterProvider');
  return ctx;
};

/**
 * Matches '/intel/live/:id'-style patterns. Returns null when the path does not match, or a
 * params object (possibly empty) when it does.
 */
export const matchRoute = (pattern: string, path: string): Record<string, string> | null => {
  const patternParts = normalizePath(pattern).split('/').filter(Boolean);
  const pathParts = normalizePath(path).split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const p = patternParts[i];
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (p.toLowerCase() !== pathParts[i].toLowerCase()) {
      return null;
    }
  }
  return params;
};

/** True when `path` is the route itself or one of its children (for sidebar section highlight). */
export const isRouteActive = (route: string, path: string): boolean => {
  const r = normalizePath(route);
  const p = normalizePath(path);
  if (r === '/') return p === '/';
  return p === r || p.startsWith(`${r}/`);
};
