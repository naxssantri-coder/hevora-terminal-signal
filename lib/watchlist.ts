import { useCallback, useEffect, useState } from 'react';
import { listAssets } from './assets/universe';

/**
 * Personal watchlist storage.
 *
 * Local to the browser on purpose: there is no watchlist table on the server, and inventing one
 * would mean touching the backend for a feature that works perfectly well per-device. The stored
 * shape is a plain array of asset ids from the asset universe (§7.1), so when later phases
 * register equities/indices/on-chain assets they become watchlistable with no change here and no
 * change to the UI - which is exactly the "scalable, user can add assets without altering the UI
 * structure" requirement.
 */

const STORAGE_KEY = 'hev_watchlist';
/** Same-tab notification; 'storage' only fires in OTHER tabs, so both are needed to stay in sync. */
const CHANGE_EVENT = 'hev:watchlist-change';

const readStorage = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop ids that no longer exist in the universe (a renamed or retired symbol) rather than
    // rendering a row that can never resolve to a price.
    const known = new Set(listAssets().map((a) => a.id));
    return parsed.filter((id): id is string => typeof id === 'string' && known.has(id));
  } catch {
    return [];
  }
};

const writeStorage = (ids: string[]): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Private mode / quota - the in-memory list still works for this session.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
};

export const useWatchlist = () => {
  const [ids, setIds] = useState<string[]>(() => readStorage());

  useEffect(() => {
    const sync = () => setIds(readStorage());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const add = useCallback((id: string) => {
    const next = readStorage();
    if (next.includes(id)) return;
    writeStorage([...next, id]);
  }, []);

  const remove = useCallback((id: string) => {
    writeStorage(readStorage().filter((existing) => existing !== id));
  }, []);

  const toggle = useCallback((id: string) => {
    const current = readStorage();
    writeStorage(current.includes(id) ? current.filter((e) => e !== id) : [...current, id]);
  }, []);

  const has = useCallback((id: string) => ids.includes(id), [ids]);

  /** Reorder by moving one id to a new index - keeps the user's own priority order. */
  const move = useCallback((id: string, toIndex: number) => {
    const current = readStorage();
    const from = current.indexOf(id);
    if (from === -1) return;
    const next = current.filter((e) => e !== id);
    next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, id);
    writeStorage(next);
  }, []);

  return { ids, add, remove, toggle, has, move, count: ids.length };
};
