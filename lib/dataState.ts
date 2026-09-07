/**
 * Data quality states (§7.4).
 *
 * Every piece of market/macro data rendered anywhere in the terminal carries where it came from,
 * when it was produced, and how trustworthy that makes it right now. The absolute rule for this
 * product is that a number is never shown as if it were live when it isn't, and nothing is ever
 * substituted with a placeholder value when a provider fails - the UI degrades to an explicit
 * UNAVAILABLE state instead.
 */

export type DataStatus = 'LIVE' | 'DELAYED' | 'STALE' | 'UNAVAILABLE' | 'ERROR' | 'LOADING';

export interface DataMeta {
  /** Human-readable provider name shown to the user, e.g. 'Binance', 'FRED', 'CFTC'. */
  source: string;
  /** ISO timestamp of the datapoint itself (when the market produced it). */
  timestamp?: string | null;
  /** ISO timestamp of when we last successfully fetched it. */
  lastUpdated?: string | null;
  status: DataStatus;
  /** Populated for ERROR/UNAVAILABLE so the UI can tell the user what actually failed. */
  message?: string;
}

/** A value plus its provenance. Domain services return this, never a bare number. */
export interface DataEnvelope<T> {
  value: T | null;
  meta: DataMeta;
}

export const UNAVAILABLE_TEXT = 'Live data temporarily unavailable';

export const isUsable = (meta: DataMeta): boolean =>
  meta.status === 'LIVE' || meta.status === 'DELAYED' || meta.status === 'STALE';

/**
 * Derives a status from age. `liveWithinMs` is how fresh counts as real-time for this kind of
 * data (a price is live for seconds, a CPI print for weeks), `staleAfterMs` is the point past
 * which we stop calling it current at all.
 */
export const statusFromAge = (
  lastUpdated: string | number | Date | null | undefined,
  liveWithinMs: number,
  staleAfterMs: number
): DataStatus => {
  if (!lastUpdated) return 'UNAVAILABLE';
  const ts = new Date(lastUpdated).getTime();
  if (Number.isNaN(ts)) return 'UNAVAILABLE';
  const age = Date.now() - ts;
  if (age <= liveWithinMs) return 'LIVE';
  if (age <= staleAfterMs) return 'DELAYED';
  return 'STALE';
};

export const unavailable = (source: string, message?: string): DataMeta => ({
  source,
  status: 'UNAVAILABLE',
  message: message || UNAVAILABLE_TEXT,
  timestamp: null,
  lastUpdated: null,
});

/** Short relative age string for badges: '3s', '4m', '2h', '6d'. */
export const formatAge = (input: string | number | Date | null | undefined): string => {
  if (!input) return '—';
  const ts = new Date(input).getTime();
  if (Number.isNaN(ts)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

/**
 * One status for a panel that renders many quotes at once.
 *
 * Deliberately reports the WORST case across the rows, not the first row's: a table whose badge
 * says LIVE because its top row happens to be fresh, while another row is two minutes old, is
 * exactly the "shown as real-time when it is actually stale" failure §7.4 exists to prevent. The
 * age reported is the oldest quote on display.
 */
export const aggregateFeedMeta = (
  source: string,
  quotes: Array<{ lastUpdated?: string | null; isStale?: boolean } | undefined | null>,
  liveWithinMs: number,
  staleAfterMs: number
): DataMeta => {
  const present = quotes.filter(Boolean) as Array<{ lastUpdated?: string | null; isStale?: boolean }>;
  if (present.length === 0) return unavailable(source);

  const oldest = present.reduce<string | null>((acc, quote) => {
    if (!quote.lastUpdated) return acc;
    if (!acc) return quote.lastUpdated;
    return new Date(quote.lastUpdated).getTime() < new Date(acc).getTime() ? quote.lastUpdated : acc;
  }, null);

  const anyStale = present.some((quote) => quote.isStale);
  const derived = statusFromAge(oldest, liveWithinMs, staleAfterMs);

  return {
    source,
    lastUpdated: oldest,
    timestamp: oldest,
    status: anyStale && derived === 'LIVE' ? 'DELAYED' : anyStale ? 'STALE' : derived,
  };
};
