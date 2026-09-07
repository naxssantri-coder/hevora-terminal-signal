/**
 * Provider abstraction (§7.3).
 *
 *   UI -> Domain Service -> Provider Adapter -> API
 *
 * A module never fetches a URL directly. It asks a domain service, the service asks a chain of
 * adapters in order, and the chain falls back:
 *
 *   Primary -> Fallback(s) -> Cache (only while still within its TTL) -> UNAVAILABLE
 *
 * There is deliberately no "return a plausible number" branch: when every adapter fails and the
 * cache has expired, the caller gets an UNAVAILABLE envelope and the UI says so.
 */

import { DataEnvelope, DataMeta, DataStatus, unavailable } from '../dataState';

export interface ProviderAdapter<T> {
  /** Provider name as shown to the user in data-quality badges. */
  id: string;
  fetch: (signal?: AbortSignal) => Promise<T>;
  /** Optional per-adapter status override; defaults to LIVE on success. */
  status?: DataStatus;
}

interface CacheEntry<T> {
  value: T;
  meta: DataMeta;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/** TTLs by data character (§7.10) - prices are short-lived, macro/history are not. */
export const CACHE_TTL = {
  price: 5_000,
  signal: 5_000,
  news: 60_000,
  calendar: 5 * 60_000,
  macro: 30 * 60_000,
  historical: 12 * 60 * 60_000,
} as const;

export const readCache = <T,>(key: string): CacheEntry<T> | null => {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (!hit) return null;
  return hit;
};

export const writeCache = <T,>(key: string, value: T, meta: DataMeta, ttlMs: number): void => {
  cache.set(key, { value, meta, expiresAt: Date.now() + ttlMs });
};

export const invalidateCache = (keyPrefix?: string): void => {
  if (!keyPrefix) {
    cache.clear();
    return;
  }
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(keyPrefix)) cache.delete(key);
  }
};

export interface ResolveOptions {
  cacheKey: string;
  ttlMs: number;
  signal?: AbortSignal;
}

/**
 * Runs the adapter chain and returns a provenance-carrying envelope. An expired cache entry is
 * still preferable to nothing, but it is downgraded to STALE so the UI can flag it rather than
 * passing it off as current.
 */
export const resolveWithFallback = async <T,>(
  adapters: Array<ProviderAdapter<T>>,
  { cacheKey, ttlMs, signal }: ResolveOptions
): Promise<DataEnvelope<T>> => {
  const cached = readCache<T>(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { value: cached.value, meta: cached.meta };
  }

  const failures: string[] = [];

  for (const adapter of adapters) {
    try {
      const value = await adapter.fetch(signal);
      const now = new Date().toISOString();
      const meta: DataMeta = {
        source: adapter.id,
        status: adapter.status ?? 'LIVE',
        timestamp: now,
        lastUpdated: now,
      };
      writeCache(cacheKey, value, meta, ttlMs);
      return { value, meta };
    } catch (err) {
      failures.push(`${adapter.id}: ${err instanceof Error ? err.message : 'failed'}`);
    }
  }

  if (cached) {
    return {
      value: cached.value,
      meta: { ...cached.meta, status: 'STALE', message: failures.join(' | ') },
    };
  }

  return { value: null, meta: unavailable(adapters[0]?.id ?? 'unknown', failures.join(' | ')) };
};

/** Thin JSON adapter factory over this app's own Express API (the default provider). */
export const httpAdapter = <T,>(id: string, url: string, init?: RequestInit): ProviderAdapter<T> => ({
  id,
  fetch: async (signal) => {
    const res = await fetch(url, { ...init, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  },
});
