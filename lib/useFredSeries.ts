import { useEffect, useMemo, useState } from 'react';
import type { EconHistoryResponse, EconIndicatorId } from '../types';

/**
 * Reads one or more FRED-backed series through the existing /api/economic-history pipeline.
 *
 * That endpoint is already the app's proven path to FRED - it caches, it degrades to
 * `needsSetup: true` when FRED_API_KEY is missing, and it never fabricates points. The Macro
 * modules go through it rather than adding a second, differently-behaved FRED client.
 */
export interface FredSeriesState {
  series: Partial<Record<EconIndicatorId, EconHistoryResponse>>;
  isLoading: boolean;
  error: string | null;
  /** True when the backend reports FRED is not configured - a setup gap, not an outage. */
  needsSetup: boolean;
  lastUpdated: string | null;
}

export const useFredSeries = (ids: EconIndicatorId[], months = 60): FredSeriesState => {
  const key = ids.join(',');
  const [series, setSeries] = useState<Partial<Record<EconIndicatorId, EconHistoryResponse>>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const list = key.split(',').filter(Boolean) as EconIndicatorId[];

    (async () => {
      try {
        const results = await Promise.all(
          list.map(async (id) => {
            // No currency param: the backend resolves it from the indicator's own `currency`
            // field (the fix made for the Forex Confluence panels). Forcing 'USD' here would
            // silently break every non-USD indicator (ECBDFR, BOEBR, BOJPR, RBACR, BOCCR) - the
            // endpoint would read it as a request for USD data under that indicator's name and
            // answer with an empty, mismatched series.
            const res = await fetch(`/api/economic-history?indicator=${id}&months=${months}`);
            const payload = (await res.json().catch(() => null)) as EconHistoryResponse | null;
            return [id, payload] as const;
          })
        );
        if (cancelled) return;

        const map: Partial<Record<EconIndicatorId, EconHistoryResponse>> = {};
        for (const [id, payload] of results) if (payload) map[id] = payload;
        setSeries(map);
        // Only a total wipeout is an error; a single missing series shows as a dash in its own row.
        setError(results.every(([, payload]) => !payload) ? 'No series could be loaded' : null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Network error');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key, months]);

  const { needsSetup, lastUpdated } = useMemo(() => {
    const values = Object.values(series);
    return {
      needsSetup: values.length > 0 && values.every((entry) => entry?.needsSetup),
      lastUpdated:
        values
          .map((entry) => entry?.lastUpdated)
          .filter((value): value is string => Boolean(value))
          .sort()
          .pop() ?? null,
    };
  }, [series]);

  return { series, isLoading, error, needsSetup, lastUpdated };
};

/** Latest non-null reading of a series, or null when the series has no usable point. */
export const latestPoint = (payload: EconHistoryResponse | undefined) => {
  const points = (payload?.points ?? []).filter((point) => point.actual !== null);
  return points.length === 0 ? null : points[points.length - 1];
};

export const latestValue = (payload: EconHistoryResponse | undefined): number | null =>
  latestPoint(payload)?.actual ?? null;

/** Change between the last two usable readings - null unless both exist. */
export const latestChange = (payload: EconHistoryResponse | undefined): number | null => {
  const points = (payload?.points ?? []).filter((point) => point.actual !== null);
  if (points.length < 2) return null;
  return (points[points.length - 1].actual as number) - (points[points.length - 2].actual as number);
};
