import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Fetches one of this app's own JSON endpoints and exposes it with the full state set every
 * module is required to be able to render (§7.10): loading, error, and data.
 *
 * A failed refresh deliberately keeps the previously loaded value in `data` and reports the
 * failure through `error` - so a panel that already had real numbers does not blank out on one
 * bad poll, but is still able to tell the reader that what they are looking at stopped updating.
 */
export interface EndpointState<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  reload: () => void;
}

/**
 * `url` may be null, which means "this caller has nothing to fetch right now" - a panel whose
 * asset has no such source wired, for instance. That case must not fall through to fetch(''),
 * which the browser resolves to the current page and would hand the caller an HTML document
 * where it expected JSON.
 */
export const useEndpoint = <T,>(url: string | null, refreshMs?: number): EndpointState<T> => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(url));
  const mounted = useRef(true);
  // 2026-08-31 (XAU chart crash audit): a poll tick, a `url`/`refreshMs` change, or an explicit
  // reload() can all start a NEW fetch while a PREVIOUS one for this same hook instance is still
  // in flight - and network responses do not have to arrive in the order they were sent (confirmed
  // via a real repro: an earlier-sent request resolving after a later one is normal, unremarkable
  // network jitter, not an edge case). Previously, whichever response happened to resolve LAST
  // simply overwrote `data`, even if it was answering an OLDER request than one that had already
  // landed - handing a consumer data that is chronologically BEHIND what it was already showing.
  // Most consumers only ever notice this as a value flickering backward for one tick, but for a
  // consumer with its own ordering invariant (e.g. a live chart series that requires strictly
  // non-decreasing timestamps) this isn't cosmetic - it's exactly what threw
  // "Cannot update oldest data" in XauLightweightChart. Fixed at the root, for every useEndpoint
  // consumer at once: each load() call is tagged with a monotonically increasing id; a response is
  // only applied if no newer load() has been started since - a strictly-newer request in flight (or
  // already resolved) makes an older one's answer moot, regardless of arrival order.
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!url) {
      if (mounted.current) setIsLoading(false);
      return;
    }
    const myRequestId = ++requestIdRef.current;
    try {
      const res = await fetch(url);
      const payload = await res.json().catch(() => null);
      if (!mounted.current) return;
      if (myRequestId !== requestIdRef.current) return; // superseded by a newer load() - discard

      if (!payload) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setData(payload as T);
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      if (myRequestId !== requestIdRef.current) return; // superseded - a stale failure isn't worth surfacing either
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      if (mounted.current && myRequestId === requestIdRef.current) setIsLoading(false);
    }
  }, [url]);

  useEffect(() => {
    mounted.current = true;
    load();
    if (!refreshMs) return () => { mounted.current = false; };

    const interval = setInterval(load, refreshMs);

    // 2026-08-31 audit (point 4): a background/minimized tab has its setInterval throttled by the
    // browser (sometimes to once a minute or slower, occasionally paused outright) - not a bug in
    // this code, but it means a reader who leaves a tab in the background for a while and comes
    // back can be looking at data that is much older than `refreshMs` for a moment, with no catch-up
    // fetch until the throttled timer next fires. Refetching immediately on the tab becoming visible
    // again closes that gap without touching refreshMs (every existing interval stays exactly as
    // fast/slow as it already was for a foregrounded tab).
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      mounted.current = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, refreshMs]);

  return { data, error, isLoading, reload: load };
};
