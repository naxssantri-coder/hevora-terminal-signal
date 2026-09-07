import { useEffect, useRef, useState } from 'react';
import { OrderBookSnapshot } from '../types';

/**
 * Subscribes to the order book SSE relay (server.ts's /stream endpoint). Deliberately not built
 * on useEndpoint: that hook re-fetches on a timer, which is the wrong model for a push stream -
 * this instead holds one open EventSource and updates state as frames arrive.
 *
 * `streamConnected` is the BROWSER's link to HEVORA's own server (did the SSE connection open).
 * `data.connection` (see OrderBookSnapshot) is a separate thing: HEVORA's server's link to OKX.
 * A panel can be streamConnected=true while data.connection='disconnected' - that means "you are
 * hearing from the server just fine, and the server is telling you honestly that it currently
 * has no live upstream" - which is exactly the state that must never be mistaken for LIVE data.
 */
export interface OrderBookStreamState {
  data: OrderBookSnapshot | null;
  streamConnected: boolean;
  error: string | null;
}

export const useOrderBookStream = (url: string | null): OrderBookStreamState => {
  const [data, setData] = useState<OrderBookSnapshot | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (!url) {
      setStreamConnected(false);
      return;
    }

    const source = new EventSource(url);

    source.onopen = () => {
      if (!mounted.current) return;
      setStreamConnected(true);
      setError(null);
    };

    source.onmessage = (event) => {
      if (!mounted.current) return;
      try {
        setData(JSON.parse(event.data) as OrderBookSnapshot);
      } catch {
        // Malformed frame - keep the last good snapshot rather than clearing the panel over it.
      }
    };

    // EventSource retries on its own (built-in backoff); this only reflects that reality in the
    // UI so a dropped browser<->server link reads as disconnected rather than silently stale.
    source.onerror = () => {
      if (!mounted.current) return;
      setStreamConnected(false);
      setError('Stream connection lost - browser is retrying automatically');
    };

    return () => {
      mounted.current = false;
      source.close();
    };
  }, [url]);

  return { data, streamConnected, error };
};
