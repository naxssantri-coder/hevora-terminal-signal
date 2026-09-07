// ============================================================================================
// Data source verifier for Fase 8 (docs/FASE-8-AUDIT.md).
//
// Why this exists: the coverage audit in that document is knowledge-based, not measured. The
// sandbox this project is developed in cannot reach any external data provider (its egress proxy
// returns 403/blocked for all of them), exactly as scripts/verify-feeds.ts already documents for
// the RSS sources. An audit that says "Yahoo probably serves CL=F" is a guess, and building
// seventeen Commodities metrics on a guess is how the Macro PR ended up reverted three times.
//
// Run this from any machine with normal internet access, or from CI:
//     bun run verify:sources          (or: npm run verify:sources)
//
// For every candidate source it performs the real request the app would make, then validates the
// SHAPE of the response - not just the HTTP status - and prints a sample value, so a provider
// that returns 200 with an error page, an empty array, or a renamed field is immediately obvious.
//
// Read-only: nothing here writes to the repo, the server, or any store.
//
// Exit code: non-zero if any probe marked `critical` fails, so this is usable as a pre-build gate.
// The critical set is deliberately small - it is the set of answers that decide what gets built
// next, not everything that would merely be nice to have.
// ============================================================================================

import 'dotenv/config';

const TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HEVORA/1.0',
  Accept: 'application/json, text/plain, text/html;q=0.9, */*;q=0.8',
};

type Verdict = 'OK' | 'FAIL' | 'SKIP';

interface Probe {
  id: string;
  group: string;
  /** What the app would use this for - printed on failure so the impact is obvious. */
  purpose: string;
  url: string;
  /** How often the upstream data actually updates. Never label everything "realtime" (§3). */
  frequency: 'Realtime' | 'Near-realtime' | 'Delayed' | 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Event';
  /**
   * Validates the response body and returns a short sample string proving the shape parsed.
   * Throwing (or returning null) marks the probe FAIL even on HTTP 200 - which is the point:
   * providers routinely answer 200 with an error page or an empty result set.
   */
  validate: (body: string, res: Response) => string;
  /** Blocks the next build step if it fails. Kept small on purpose. */
  critical?: boolean;
  /** Returns a reason to skip (e.g. a missing free API key) instead of reporting a false failure. */
  skipIf?: () => string | null;
  headers?: Record<string, string>;
  /** Defaults to GET. Some official stats APIs (e.g. StatCan's WDS) are POST-only. */
  method?: 'GET' | 'POST';
  /** JSON body for a POST probe - stringified automatically, Content-Type set automatically. */
  body?: unknown;
}

// --- validators ------------------------------------------------------------------------------

const json = (body: string): any => {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`not JSON (first 80 chars: ${body.slice(0, 80).replace(/\s+/g, ' ')})`);
  }
};

/** Yahoo chart: the single most consequential question in the whole audit. */
const yahooQuote = (body: string): string => {
  const data = json(body);
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) {
    const err = data?.chart?.error?.description || data?.finance?.error?.description;
    throw new Error(err ? `provider error: ${err}` : 'no chart.result[0].meta in response');
  }
  if (typeof meta.regularMarketPrice !== 'number') throw new Error('meta present but regularMarketPrice is not a number');
  return `${meta.symbol ?? '?'} = ${meta.regularMarketPrice} ${meta.currency ?? ''}`.trim();
};

const nonEmptyArray = (label: string, sample: (row: any) => string) => (body: string): string => {
  const data = json(body);
  const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.result?.list) ? data.result.list : null;
  if (!rows) throw new Error(`no ${label} array in response`);
  if (rows.length === 0) throw new Error(`${label} array is empty`);
  return `${rows.length} ${label}; e.g. ${sample(rows[0])}`;
};

/**
 * Reusable density check for daily-close historical series - pattern established after a real
 * production bug: the original Gold Seasonality probe (and the endpoint it verified) only
 * checked "how many distinct calendar years appear in the response". 267 points across 27 years
 * passed that check while actually averaging ~10 points/year - roughly ONE close per month for
 * 2000-2025, not daily, with only the current in-progress month sampled densely (confirmed with
 * real per-year-month counts via a GitHub Actions run, not assumed). A distinct-year count says
 * nothing about whether the data is DENSE ENOUGH for what it's actually used for downstream.
 *
 * `computeCalendarMonthDensity` mirrors the exact adjacency rule server.ts's own
 * computeGoldSeasonality() uses (month-over-month, calendar-adjacent months only - a gap month
 * is never silently bridged), so the number this probe reports is the same number the real
 * endpoint will compute, not an approximation of it. Any future probe for a historical
 * daily/monthly-close series that feeds a month-over-month or similar per-period calculation
 * should reuse this instead of a raw distinct-year check.
 */
const computeCalendarMonthDensity = (
  points: Array<{ date: string; close: number }>
): { yearMonthsPresent: number; monthOverMonthComputable: number; yearsWithComputableReturn: number } => {
  const lastDateByYearMonth = new Map<string, string>(); // "YYYY-MM" -> latest date seen that month
  for (const p of points) {
    const key = p.date.slice(0, 7);
    const existing = lastDateByYearMonth.get(key);
    if (!existing || p.date > existing) lastDateByYearMonth.set(key, p.date);
  }

  let monthOverMonthComputable = 0;
  const yearsWithComputableReturn = new Set<number>();
  for (const key of lastDateByYearMonth.keys()) {
    const [yearStr, monthStr] = key.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevKey = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
    if (lastDateByYearMonth.has(prevKey)) {
      monthOverMonthComputable += 1;
      yearsWithComputableReturn.add(year);
    }
  }

  return {
    yearMonthsPresent: lastDateByYearMonth.size,
    monthOverMonthComputable,
    yearsWithComputableReturn: yearsWithComputableReturn.size,
  };
};

/** HTML pages have no schema, so we assert on the marker the scraper would actually key off. */
const htmlContains = (needle: RegExp, label: string) => (body: string): string => {
  if (!needle.test(body)) throw new Error(`page loaded (${body.length} bytes) but no ${label} found - scraper would break`);
  const m = body.match(needle);
  return `${label} present: ${String(m?.[0]).slice(0, 60).replace(/\s+/g, ' ')}`;
};

const FRED_KEY = process.env.FRED_API_KEY || '';
const needsFredKey = () => (FRED_KEY ? null : 'FRED_API_KEY not set in this environment');

// A FRED series ID that answers with data is not enough on its own - a wrong-but-valid ID returns
// REAL data under the WRONG name, the same risk the CFTC commodity codes had. This checks the
// series' own metadata title against what the app assumes it is, before anything gets wired.
const fredMetaUrl = (series: string) =>
  `https://api.stlouisfed.org/fred/series?series_id=${series}&api_key=${FRED_KEY}&file_type=json`;
const fredTitleCheck = (expectedSubstrings: string[]) => (body: string): string => {
  const data = json(body);
  const meta = data?.seriess?.[0];
  if (!meta) throw new Error(data?.error_message || 'no series metadata in response');
  const title: string = meta.title || '';
  const missing = expectedSubstrings.filter((sub) => !title.toLowerCase().includes(sub.toLowerCase()));
  if (missing.length) throw new Error(`title "${title}" does not contain expected term(s): ${missing.join(', ')}`);
  return `title="${title}" freq=${meta.frequency} units=${meta.units}`;
};

// --- probe list ------------------------------------------------------------------------------

const yahooFutures = (symbol: string, purpose: string, critical = false): Probe => ({
  id: `yahoo:${symbol}`,
  group: 'Yahoo futures',
  purpose,
  url: `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
  frequency: 'Delayed',
  validate: yahooQuote,
  critical,
  headers: BROWSER_HEADERS,
});

const PROBES: Probe[] = [
  // ---- Control: a Yahoo symbol the app ALREADY uses in production. If this fails while the
  // futures tickers also fail, the problem is Yahoo access from this machine, not the tickers.
  {
    id: 'yahoo:DX-Y.NYB (control)',
    group: 'Yahoo control',
    purpose: 'DXY - already wired and working in production; proves Yahoo reachability',
    url: 'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=5d',
    frequency: 'Near-realtime',
    validate: yahooQuote,
    critical: true,
    headers: BROWSER_HEADERS,
  },

  // ---- THE question that gates all of Commodities (§2.2 / Bagian C3 of the audit) ----
  yahooFutures('CL=F', 'WTI crude - gates Energy', true),
  yahooFutures('BZ=F', 'Brent crude'),
  yahooFutures('NG=F', 'Natural gas'),
  yahooFutures('GC=F', 'Gold futures - futures curve for XAU'),
  yahooFutures('SI=F', 'Silver - Gold/Silver ratio'),
  yahooFutures('HG=F', 'Copper'),
  yahooFutures('PL=F', 'Platinum'),
  yahooFutures('PA=F', 'Palladium'),
  yahooFutures('ZW=F', 'Wheat - gates Agriculture', true),
  yahooFutures('ZC=F', 'Corn'),
  yahooFutures('ZS=F', 'Soybeans'),
  yahooFutures('KC=F', 'Coffee'),
  yahooFutures('SB=F', 'Sugar'),
  yahooFutures('CC=F', 'Cocoa'),
  yahooFutures('CT=F', 'Cotton'),

  // ---- FRED series the audit lists as one-line additions (§C2), now wired into ECON_INDICATORS
  // and title-checked - these eight answered as reachable in an earlier run but were never
  // actually connected to the app until §2.5's audit pass caught the gap.
  ...([
    ['T10YIE', ['breakeven inflation'], 'Daily' as const, '10Y breakeven inflation'],
    ['SOFR', ['secured overnight financing'], 'Daily' as const, 'USD funding rate'],
    ['RRPONTSYD', ['reverse repurchase'], 'Daily' as const, 'Reverse repo - liquidity drain'],
    ['WRESBAL', ['reserve balances'], 'Weekly' as const, 'Bank reserves'],
    ['WTREGEN', ['treasury, general account'], 'Weekly' as const, 'Treasury General Account'],
    ['PCEPI', ['personal consumption', 'price index'], 'Monthly' as const, 'PCE price index'],
    ['T5YIE', ['breakeven inflation'], 'Daily' as const, '5Y inflation expectations'],
    ['GFDEBTN', ['federal debt'], 'Quarterly' as const, 'Federal debt - fiscal module'],
  ] as const).map(([series, expect, frequency, purpose]): Probe => ({
    id: `fred:${series}`,
    group: 'FRED (new series)',
    purpose,
    url: fredMetaUrl(series),
    frequency,
    critical: false,
    validate: fredTitleCheck([...expect]),
    skipIf: needsFredKey,
  })),

  // ---- Foreign policy rates for FX rate differentials (§C5) and two more for §2.5's RBA/BOC. ----
  ...([
    ['ECBDFR', ['ecb', 'deposit facility'], 'ECB deposit facility rate - EUR differential'],
    ['IRSTCI01JPM156N', ['japan'], 'BOJ policy rate - JPY differential'],
    ['IRSTCI01GBM156N', ['united kingdom'], 'BOE policy rate - GBP differential'],
    ['IRSTCI01AUM156N', ['australia'], 'RBA policy rate proxy - §2.5 Global Macro'],
    ['IRSTCI01CAM156N', ['canada'], 'BOC policy rate proxy - §2.5 Global Macro'],
  ] as const).map(([series, expect, purpose]): Probe => ({
    id: `fred:${series}`,
    group: 'FRED (foreign rates)',
    purpose,
    url: fredMetaUrl(series),
    frequency: 'Monthly',
    critical: false,
    validate: fredTitleCheck([...expect]),
    skipIf: needsFredKey,
  })),

  // ---- §2.5 Global Macro: fiscal flows and activity prints, title-verified before wiring. ----
  ...([
    ['MTSDS133FMS', ['surplus or deficit'], 'Monthly' as const, 'Federal deficit/surplus - §2.5 fiscal'],
    ['FGRECPT', ['receipts'], 'Quarterly' as const, 'Federal government receipts - §2.5 fiscal'],
    ['FGEXPND', ['expenditures'], 'Quarterly' as const, 'Federal government expenditures - §2.5 fiscal'],
    ['HOUST', ['housing units started'], 'Monthly' as const, 'Housing starts - §2.5 activity'],
    ['UMCSENT', ['consumer sentiment'], 'Monthly' as const, 'Consumer sentiment - §2.5 activity'],
    ['BOPGSTB', ['trade balance'], 'Monthly' as const, 'Trade balance - §2.5 activity'],
    ['IPMAN', ['industrial production', 'manufacturing'], 'Monthly' as const, 'Manufacturing output (NOT ISM PMI) - §2.5 activity'],
  ] as const).map(([series, expect, frequency, purpose]): Probe => ({
    id: `fred:${series}`,
    group: 'FRED (Global Macro §2.5)',
    purpose,
    url: fredMetaUrl(series),
    frequency,
    critical: false,
    validate: fredTitleCheck([...expect]),
    skipIf: needsFredKey,
  })),

  // ---- CFTC: discover real contract codes rather than guessing them ----
  {
    id: 'cftc:market-list',
    group: 'CFTC',
    purpose: 'Discover contract codes for oil/copper/agri COT instead of hardcoding guesses',
    url:
      'https://publicreporting.cftc.gov/resource/6dca-aqww.json?$select=cftc_contract_market_code,market_and_exchange_names' +
      '&$where=report_date_as_yyyy_mm_dd%20%3E%20%272025-01-01%27&$group=cftc_contract_market_code,market_and_exchange_names&$limit=400',
    frequency: 'Weekly',
    validate: nonEmptyArray('markets', (r) => `${r.cftc_contract_market_code} ${String(r.market_and_exchange_names).slice(0, 40)}`),
    headers: BROWSER_HEADERS,
  },

  // ---- The commodity COT codes server.ts now maps to Yahoo futures symbols. A wrong code does
  // not fail loudly - it attaches one market's positioning to another market's name, which is the
  // quietest possible way to publish a fabricated number. So the pairing is asserted, not assumed:
  // this probe prints the market name the CFTC returns for each code we wired.
  {
    id: 'cftc:commodity-codes',
    group: 'CFTC',
    purpose: 'Confirm each wired commodity contract code resolves to the market it is labelled as',
    url:
      'https://publicreporting.cftc.gov/resource/6dca-aqww.json?$select=cftc_contract_market_code,market_and_exchange_names' +
      '&$where=cftc_contract_market_code%20in(%27067651%27,%27023651%27,%27084691%27,%27085692%27,%27076651%27,%27075651%27,%27001602%27,%27002602%27,%27005602%27,%27083731%27,%27080732%27,%27073732%27,%27033661%27)' +
      '&$group=cftc_contract_market_code,market_and_exchange_names&$limit=100',
    frequency: 'Weekly',
    critical: true,
    validate: (body: string) => {
      const rows = JSON.parse(body);
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('no rows for the wired commodity codes');
      // The expected market NAME per code, as measured - not as guessed. server.ts carries the
      // same strings; if the CFTC ever renames a contract this probe is where it surfaces.
      const wired: Record<string, string> = {
        '067651': 'CL=F WTI crude', '023651': 'NG=F natural gas', '084691': 'SI=F silver',
        '085692': 'HG=F copper', '076651': 'PL=F platinum', '075651': 'PA=F palladium',
        '001602': 'ZW=F wheat', '002602': 'ZC=F corn', '005602': 'ZS=F soybeans',
        '083731': 'KC=F coffee', '080732': 'SB=F sugar', '073732': 'CC=F cocoa', '033661': 'CT=F cotton',
      };
      const seen = new Map<string, string>();
      for (const row of rows) seen.set(String(row.cftc_contract_market_code), String(row.market_and_exchange_names));
      const missing = Object.keys(wired).filter((code) => !seen.has(code));
      const pairs = Object.entries(wired)
        .map(([code, label]) => `${label} -> ${seen.get(code) ?? 'NOT FOUND'}`)
        .join(' | ');
      if (missing.length) throw new Error(`codes with no market in the dataset: ${missing.join(', ')} :: ${pairs}`);
      return pairs;
    },
    headers: BROWSER_HEADERS,
  },

  // ---- Spot FX daily closes, behind the Forex trend factor and its analog. The '=X' suffix is
  // Yahoo's own convention for spot pairs and is not interchangeable with the futures symbols
  // above, so it gets its own probes rather than being assumed to work because CL=F does.
  ...['EURUSD=X', 'GBPUSD=X', 'USDCHF=X', 'USDCAD=X'].map(
    (symbol): Probe => ({
      id: `yahoo:${symbol} 1y daily`,
      group: 'Yahoo FX',
      purpose: 'Daily closes for the FX MA50 factor and historical analog',
      url: `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`,
      frequency: 'Daily',
      critical: symbol === 'EURUSD=X',
      validate: (body: string) => {
        const json = JSON.parse(body);
        const block = json?.chart?.result?.[0];
        const closes: Array<number | null> = block?.indicators?.quote?.[0]?.close ?? [];
        const usable = closes.filter((c) => typeof c === 'number' && Number.isFinite(c));
        if (usable.length === 0) throw new Error('no daily candles in response');
        if (usable.length < 60) throw new Error(`only ${usable.length} usable closes - MA50 would never populate`);
        return `${usable.length} usable daily closes, latest ${usable[usable.length - 1]}`;
      },
      headers: BROWSER_HEADERS,
    })
  ),

  // ---- Asset universe expansion candidates (Tahap C) - Forex. Two checks per symbol, not one:
  // the 1y-daily check alone is exactly what shipped the Gold Seasonality bug (proves years EXIST,
  // says nothing about whether the LIVE engine's actual feed is dense enough to trade on). The 1m
  // intraday check probes the same endpoint/shape fetchForexAndGoldData() polls every ~5s in
  // production - if that comes back thin, the pair can go on the watchlist but the signal engine
  // must not touch it, no matter how many years the 1y-daily check reports.
  ...['USDJPY=X', 'AUDUSD=X', 'NZDUSD=X'].map(
    (symbol): Probe => ({
      id: `yahoo:${symbol} 1m intraday (live engine feed)`,
      group: 'Asset universe - Forex',
      purpose: 'Same interval=1m&range=1d shape fetchForexAndGoldData() polls for the live signal engine - density, not just reachability',
      url: `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`,
      frequency: 'Realtime',
      critical: true,
      validate: (body: string) => {
        const data = json(body);
        const block = data?.chart?.result?.[0];
        const closes: Array<number | null> = block?.indicators?.quote?.[0]?.close ?? [];
        const usable = closes.filter((c) => typeof c === 'number' && Number.isFinite(c));
        // The engine slices to the last 30 candles and needs 14+ for ATR/RSI/ADX to mean anything -
        // 20 is a safety margin above that floor, not an arbitrary round number.
        if (usable.length < 20) {
          throw new Error(`only ${usable.length} 1m bars today - too thin for the live candle store (need 20+, ATR/RSI/ADX need 14+)`);
        }
        return `${usable.length} 1m bars today, latest close ${usable[usable.length - 1]}`;
      },
      headers: BROWSER_HEADERS,
    })
  ),
  ...['USDJPY=X', 'AUDUSD=X', 'NZDUSD=X'].map(
    (symbol): Probe => ({
      id: `yahoo:${symbol} 1y daily`,
      group: 'Asset universe - Forex',
      purpose: 'Daily closes for the FX MA50/historical-analog factor, same shape as the wired majors',
      url: `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`,
      frequency: 'Daily',
      critical: false, // data-only tier does not need this factor yet - see server report
      validate: (body: string) => {
        const data = json(body);
        const block = data?.chart?.result?.[0];
        const closes: Array<number | null> = block?.indicators?.quote?.[0]?.close ?? [];
        const usable = closes.filter((c) => typeof c === 'number' && Number.isFinite(c));
        if (usable.length === 0) throw new Error('no daily candles in response');
        if (usable.length < 60) throw new Error(`only ${usable.length} usable closes - MA50 would never populate`);
        return `${usable.length} usable daily closes, latest ${usable[usable.length - 1]}`;
      },
      headers: BROWSER_HEADERS,
    })
  ),

  // ---- The daily-close series behind the commodity trend factor and its historical analog.
  {
    id: 'yahoo:CL=F 1y daily',
    group: 'Yahoo futures',
    purpose: 'One year of daily closes - feeds the MA50 factor and the analog sample',
    url: 'https://query1.finance.yahoo.com/v8/finance/chart/CL%3DF?interval=1d&range=1y',
    frequency: 'Daily',
    critical: true,
    validate: (body: string) => {
      const json = JSON.parse(body);
      const block = json?.chart?.result?.[0];
      const stamps: number[] = block?.timestamp ?? [];
      const closes: Array<number | null> = block?.indicators?.quote?.[0]?.close ?? [];
      const usable = closes.filter((c) => typeof c === 'number' && Number.isFinite(c));
      if (stamps.length === 0 || usable.length === 0) throw new Error('no daily candles in response');
      if (usable.length < 60) throw new Error(`only ${usable.length} usable closes - MA50 would never populate`);
      return `${usable.length} usable daily closes, latest ${usable[usable.length - 1]}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'yahoo:GC=F max daily (seasonality span)',
    group: 'Yahoo futures',
    purpose: 'GC=F closes for seasonality - must be dense enough for month-over-month returns, not just multi-year',
    url: 'https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=max',
    frequency: 'Daily',
    critical: true,
    // A raw distinct-calendar-year count is NOT sufficient here - see computeCalendarMonthDensity's
    // doc comment for the production bug that taught this. The real gate is
    // yearsWithComputableReturn (mirrors server.ts's own computeGoldSeasonality adjacency rule),
    // not how many years merely appear somewhere in the response.
    validate: (body: string) => {
      const data = json(body);
      const block = data?.chart?.result?.[0];
      const stamps: number[] = Array.isArray(block?.timestamp) ? block.timestamp : [];
      const closes: Array<number | null> = block?.indicators?.quote?.[0]?.close ?? [];
      const usable = stamps
        .map((ts, i) => ({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: closes[i] }))
        .filter((p): p is { date: string; close: number } => typeof p.close === 'number' && Number.isFinite(p.close));
      if (usable.length === 0) throw new Error('no daily candles in response');

      const density = computeCalendarMonthDensity(usable);
      if (density.yearsWithComputableReturn < 3) {
        throw new Error(
          `only ${density.yearsWithComputableReturn} year(s) with a computable month-over-month return ` +
            `(${density.monthOverMonthComputable}/${density.yearMonthsPresent} year-months) - too thin for a monthly seasonality read`
        );
      }
      const years = new Set(usable.map((p) => parseInt(p.date.slice(0, 4), 10)));
      const firstYear = Math.min(...years);
      const lastYear = Math.max(...years);
      return (
        `${usable.length} usable closes, ${years.size} calendar years present (${firstYear}-${lastYear}); ` +
        `${density.monthOverMonthComputable}/${density.yearMonthsPresent} year-months have a computable ` +
        `month-over-month return, spanning ${density.yearsWithComputableReturn} years`
      );
    },
    headers: BROWSER_HEADERS,
  },

  // ---- Crypto derivatives. Binance is deliberately absent: server.ts records HTTP 451 from
  // Render for api.binance.com/fapi.binance.com, so it cannot be the basis for anything. ----
  // Bybit answered 403 on the first verified run, so it is no longer the primary path - kept as a
  // non-critical probe because a regional block can lift, and knowing that is free.
  {
    id: 'bybit:funding',
    group: 'Crypto derivatives',
    purpose: 'BTC funding rate - secondary path (403 on first verified run)',
    url: 'https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=5',
    frequency: 'Near-realtime',
    validate: nonEmptyArray('funding rows', (r) => `${r.symbol} ${r.fundingRate}`),
    headers: BROWSER_HEADERS,
  },
  {
    id: 'bybit:open-interest',
    group: 'Crypto derivatives',
    purpose: 'BTC open interest - secondary path (Bybit 403 on first verified run)',
    url: 'https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=1h&limit=5',
    frequency: 'Near-realtime',
    validate: nonEmptyArray('OI rows', (r) => `OI ${r.openInterest} @ ${r.timestamp}`),
    headers: BROWSER_HEADERS,
  },
  {
    id: 'okx:funding',
    group: 'Crypto derivatives',
    purpose: 'BTC funding rate - PRIMARY path after Bybit returned 403',
    url: 'https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP',
    frequency: 'Near-realtime',
    validate: nonEmptyArray('funding rows', (r) => `${r.instId} ${r.fundingRate}`),
    critical: true,
    headers: BROWSER_HEADERS,
  },
  {
    // The first run only proved OKX funding. Open interest is a separate endpoint and has to be
    // proven separately before the crypto-derivatives plan can rest on OKX alone.
    id: 'okx:open-interest',
    group: 'Crypto derivatives',
    purpose: 'BTC open interest - PRIMARY path, untested until now',
    url: 'https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP',
    frequency: 'Near-realtime',
    validate: nonEmptyArray('OI rows', (r) => `${r.instId} OI ${r.oi} (${r.oiCcy} ccy)`),
    critical: true,
    headers: BROWSER_HEADERS,
  },
  {
    id: 'okx:open-interest-history',
    group: 'Crypto derivatives',
    purpose: 'OI change over time - needed for the flow read, not just a point value',
    url: 'https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=BTC&period=1H',
    frequency: 'Near-realtime',
    validate: nonEmptyArray('OI history rows', (r) => `ts ${r[0]} oi ${r[1]}`),
    headers: BROWSER_HEADERS,
  },

  // ---- Institutional Watchlist detail panel, follow-up pass: multi-exchange ranking table
  // (server.ts /api/crypto/exchange-ranking) + market heatmap (/api/crypto/market-heatmap). ----
  {
    id: 'okx:ticker',
    group: 'Crypto derivatives',
    purpose: 'Ranking table price + 24h volume (volCcy24h) - PRIMARY path',
    url: 'https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP',
    frequency: 'Realtime',
    validate: nonEmptyArray('ticker rows', (r) => `${r.instId} last=${r.last} volCcy24h=${r.volCcy24h}`),
    critical: true,
    headers: BROWSER_HEADERS,
  },
  {
    id: 'bybit:account-ratio',
    group: 'Crypto derivatives',
    purpose: 'Ranking table long/short ratio for the Bybit row - secondary path (Bybit REST already 403 on prior runs)',
    url: 'https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1',
    frequency: 'Near-realtime',
    validate: nonEmptyArray('account-ratio rows', (r) => `buy=${r.buyRatio} sell=${r.sellRatio}`),
    headers: BROWSER_HEADERS,
  },
  {
    id: 'kucoin:futures-contract',
    group: 'Crypto derivatives',
    purpose: 'Ranking table KuCoin row (price, volume, OI in lots, funding) - one endpoint covers all four fields',
    url: 'https://api-futures.kucoin.com/api/v1/contracts/XBTUSDTM',
    frequency: 'Near-realtime',
    validate: (body) => {
      const d = json(body)?.data;
      if (!d) throw new Error('no data object');
      const fields = ['lastTradePrice', 'turnoverOf24h', 'openInterest', 'multiplier', 'fundingFeeRate'];
      const missing = fields.filter((f) => d[f] === undefined || d[f] === null);
      if (missing.length) throw new Error(`missing fields: ${missing.join(', ')}`);
      return `price=${d.lastTradePrice} turnover24h=${d.turnoverOf24h} oiLots=${d.openInterest} multiplier=${d.multiplier} funding=${d.fundingFeeRate}`;
    },
    critical: true,
    headers: BROWSER_HEADERS,
  },
  {
    id: 'coingecko:markets',
    group: 'Crypto derivatives',
    purpose: 'Volume heatmap - top coins by 24h volume',
    url: 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=30&page=1&sparkline=false&price_change_percentage=24h',
    frequency: 'Near-realtime',
    validate: (body) => {
      const rows = json(body);
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('empty/non-array response');
      const withFields = rows.filter((r: any) => typeof r?.total_volume === 'number' && typeof r?.current_price === 'number');
      if (withFields.length === 0) throw new Error(`${rows.length} rows but none carry total_volume/current_price`);
      return `${rows.length} coins; e.g. ${withFields[0].symbol} vol=${withFields[0].total_volume} chg24h=${withFields[0].price_change_percentage_24h}`;
    },
    critical: true,
    headers: BROWSER_HEADERS,
  },
  {
    id: 'deribit:options',
    group: 'Crypto derivatives',
    purpose: 'Options IV / skew / put-call - the audit assumed this was wired, it never was',
    url: 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option',
    frequency: 'Near-realtime',
    validate: (body) => {
      const data = json(body);
      const rows = data?.result;
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('no result array');
      const withIv = rows.filter((r: any) => typeof r.mark_iv === 'number');
      if (withIv.length === 0) throw new Error(`${rows.length} instruments but none carry mark_iv`);
      return `${rows.length} options, ${withIv.length} with IV; e.g. ${withIv[0].instrument_name} IV ${withIv[0].mark_iv}`;
    },
    headers: BROWSER_HEADERS,
  },

  // ---- Order book depth for the BTC-USDT DOM pilot (blueprint §7). Validates structure, not just
  // HTTP 200: both sides must be non-empty, every level must parse as a finite price/size, and the
  // book must not be crossed (best ask > best bid) - a provider answering 200 with a malformed or
  // stale snapshot would otherwise look identical to a healthy one until it hit the UI. ----
  {
    id: 'okx:orderbook',
    group: 'Crypto order book',
    purpose: 'BTC-USDT depth - PRIMARY path for the order book relay (blueprint §7 pilot)',
    url: 'https://www.okx.com/api/v5/market/books?instId=BTC-USDT&sz=20',
    frequency: 'Realtime',
    validate: (body) => {
      const data = json(body);
      const book = data?.data?.[0];
      const asks: any[] = Array.isArray(book?.asks) ? book.asks : [];
      const bids: any[] = Array.isArray(book?.bids) ? book.bids : [];
      if (asks.length === 0 || bids.length === 0) throw new Error(`empty side (asks=${asks.length} bids=${bids.length})`);
      const parseLevel = (row: any): { price: number; size: number } => {
        const price = Number(row?.[0]);
        const size = Number(row?.[1]);
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size < 0) {
          throw new Error(`unparseable level: ${JSON.stringify(row)}`);
        }
        return { price, size };
      };
      const bestAsk = parseLevel(asks[0]);
      const bestBid = parseLevel(bids[0]);
      if (bestAsk.price <= bestBid.price) throw new Error(`crossed book: bid ${bestBid.price} >= ask ${bestAsk.price}`);
      const spread = bestAsk.price - bestBid.price;
      return `${bids.length} bid / ${asks.length} ask levels; best ${bestBid.price}/${bestAsk.price} spread ${spread.toFixed(2)}`;
    },
    critical: true,
    headers: BROWSER_HEADERS,
  },
  {
    id: 'okx:orderbook-eth',
    group: 'Crypto order book',
    purpose: 'ETH-USDT depth - PRIMARY path for the order book relay (blueprint §7, pair #2)',
    url: 'https://www.okx.com/api/v5/market/books?instId=ETH-USDT&sz=20',
    frequency: 'Realtime',
    validate: (body) => {
      const data = json(body);
      const book = data?.data?.[0];
      const asks: any[] = Array.isArray(book?.asks) ? book.asks : [];
      const bids: any[] = Array.isArray(book?.bids) ? book.bids : [];
      if (asks.length === 0 || bids.length === 0) throw new Error(`empty side (asks=${asks.length} bids=${bids.length})`);
      const parseLevel = (row: any): { price: number; size: number } => {
        const price = Number(row?.[0]);
        const size = Number(row?.[1]);
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size < 0) {
          throw new Error(`unparseable level: ${JSON.stringify(row)}`);
        }
        return { price, size };
      };
      const bestAsk = parseLevel(asks[0]);
      const bestBid = parseLevel(bids[0]);
      if (bestAsk.price <= bestBid.price) throw new Error(`crossed book: bid ${bestBid.price} >= ask ${bestAsk.price}`);
      const spread = bestAsk.price - bestBid.price;
      return `${bids.length} bid / ${asks.length} ask levels; best ${bestBid.price}/${bestAsk.price} spread ${spread.toFixed(2)}`;
    },
    critical: true,
    headers: BROWSER_HEADERS,
  },
  {
    id: 'bybit:orderbook',
    group: 'Crypto order book',
    purpose: 'BTC-USDT depth - fallback path if the OKX relay connection drops',
    url: 'https://api.bybit.com/v5/market/orderbook?category=spot&symbol=BTCUSDT&limit=25',
    frequency: 'Realtime',
    validate: (body) => {
      const data = json(body);
      const book = data?.result;
      const asks: any[] = Array.isArray(book?.a) ? book.a : [];
      const bids: any[] = Array.isArray(book?.b) ? book.b : [];
      if (asks.length === 0 || bids.length === 0) throw new Error(`empty side (asks=${asks.length} bids=${bids.length})`);
      const parseLevel = (row: any): { price: number; size: number } => {
        const price = Number(row?.[0]);
        const size = Number(row?.[1]);
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size < 0) {
          throw new Error(`unparseable level: ${JSON.stringify(row)}`);
        }
        return { price, size };
      };
      const bestAsk = parseLevel(asks[0]);
      const bestBid = parseLevel(bids[0]);
      if (bestAsk.price <= bestBid.price) throw new Error(`crossed book: bid ${bestBid.price} >= ask ${bestAsk.price}`);
      const spread = bestAsk.price - bestBid.price;
      return `${bids.length} bid / ${asks.length} ask levels; best ${bestBid.price}/${bestAsk.price} spread ${spread.toFixed(2)}`;
    },
    headers: BROWSER_HEADERS,
  },

  // ---- Asset universe expansion candidates (Tahap C) - Crypto. OKX is the primary check here,
  // not Bybit: every Bybit endpoint this project has ever probed from a cloud/CI IP has come back
  // 403 (funding, OI, orderbook - see the groups above), so a Bybit-only pass/fail on these new
  // symbols would prove nothing new. Bybit is still probed (best-effort, non-critical) because it
  // occasionally answers from Render's production IP even when blocked here. Ticker AND kline are
  // checked separately per symbol - a symbol can have a live price with an empty or thin kline
  // history, which would populate currentPrices but leave candleStore empty (ATR/RSI/ADX all
  // require real candles - see server.ts's calculateATR/calculateRSI usage).
  ...(['BNB-USDT', 'XRP-USDT', 'ADA-USDT', 'DOGE-USDT'] as const).map(
    (instId): Probe => ({
      id: `okx:ticker ${instId}`,
      group: 'Asset universe - Crypto',
      purpose: `${instId} spot ticker - primary path (OKX proven reachable from cloud/CI in this project)`,
      url: `https://www.okx.com/api/v5/market/ticker?instId=${instId}`,
      frequency: 'Realtime',
      critical: true,
      validate: (body) => {
        const item = json(body)?.data?.[0];
        if (!item || !item.last) throw new Error('no data[0].last in response');
        return `${instId} last=${item.last} high24h=${item.high24h} low24h=${item.low24h}`;
      },
      headers: BROWSER_HEADERS,
    })
  ),
  ...(['BNB-USDT', 'XRP-USDT', 'ADA-USDT', 'DOGE-USDT'] as const).map(
    (instId): Probe => ({
      id: `okx:candles ${instId}`,
      group: 'Asset universe - Crypto',
      purpose: `${instId} 5m candles, same bar=5m&limit=30 shape server.ts's OKX kline tier fetches`,
      url: `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=5m&limit=30`,
      frequency: 'Realtime',
      critical: true,
      validate: (body) => {
        const rows = json(body)?.data;
        if (!Array.isArray(rows) || rows.length === 0) throw new Error('no data array in response');
        if (rows.length < 20) throw new Error(`only ${rows.length} 5m candles - too thin for the live candle store (need 20+)`);
        return `${rows.length} 5m candles, newest close ${rows[0]?.[4]}`;
      },
      headers: BROWSER_HEADERS,
    })
  ),
  ...(['BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'] as const).map(
    (sym): Probe => ({
      id: `bybit:ticker ${sym}`,
      group: 'Asset universe - Crypto',
      purpose: `${sym} spot ticker - secondary path (matches this project's established Bybit-from-cloud-IP pattern)`,
      url: `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${sym}`,
      frequency: 'Realtime',
      validate: nonEmptyArray('ticker rows', (r) => `${r.symbol} last=${r.lastPrice}`),
      headers: BROWSER_HEADERS,
    })
  ),
  // KuCoin is server.ts's Tier 2 (tried when Bybit fails, before OKX) but had never been probed
  // directly here - added while investigating a production report of Bybit 403ing on every crypto
  // pair, to confirm whether Tier 2 is actually picking up the slack or whether OKX (Tier 3) is
  // doing all the real work. One representative symbol (BTC-USDT) is enough to answer that; the
  // exact same endpoint/shape is used for all 7 pairs in server.ts (dashSymbolMap).
  {
    id: 'kucoin:ticker BTC-USDT',
    group: 'Asset universe - Crypto',
    purpose: 'BTC-USDT spot ticker - Tier 2 fallback path (server.ts tries this before OKX when Bybit fails)',
    url: 'https://api.kucoin.com/api/v1/market/stats?symbol=BTC-USDT',
    frequency: 'Realtime',
    validate: (body) => {
      const data = json(body)?.data;
      if (!data || !data.last) throw new Error('no data.last in response');
      return `BTC-USDT last=${data.last} high=${data.high} low=${data.low}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'kucoin:candles BTC-USDT',
    group: 'Asset universe - Crypto',
    purpose: 'BTC-USDT 5min candles - same type=5min&symbol=... shape server.ts\'s KuCoin kline tier fetches',
    url: 'https://api.kucoin.com/api/v1/market/candles?type=5min&symbol=BTC-USDT',
    frequency: 'Realtime',
    validate: (body) => {
      const rows = json(body)?.data;
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('no data array in response');
      return `${rows.length} 5min candles, newest close ${rows[0]?.[2]}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'coingecko:ids for BNB/XRP/ADA/DOGE',
    group: 'Asset universe - Crypto',
    purpose: 'Tier-4 fallback mapping (cgMapping) for the new crypto pairs - confirms the coin ids server.ts would add are correct, not guessed',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=binancecoin,ripple,cardano,dogecoin&vs_currencies=usd&include_24hr_change=true',
    frequency: 'Near-realtime',
    validate: (body) => {
      const data = json(body);
      const expected = ['binancecoin', 'ripple', 'cardano', 'dogecoin'];
      const missing = expected.filter((id) => typeof data?.[id]?.usd !== 'number');
      if (missing.length) throw new Error(`missing/invalid usd price for: ${missing.join(', ')}`);
      return expected.map((id) => `${id}=$${data[id].usd}`).join(' ');
    },
    headers: BROWSER_HEADERS,
  },

  // ---- Crypto market structure / on-chain (free tier) ----
  {
    id: 'coingecko:global',
    group: 'Crypto market',
    purpose: 'Total market cap + BTC dominance',
    url: 'https://api.coingecko.com/api/v3/global',
    frequency: 'Near-realtime',
    validate: (body) => {
      const d = json(body)?.data;
      if (!d?.market_cap_percentage?.btc) throw new Error('no data.market_cap_percentage.btc');
      return `BTC dominance ${Number(d.market_cap_percentage.btc).toFixed(2)}%`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'blockchain.info:hashrate',
    group: 'Crypto on-chain',
    purpose: 'Hash rate / difficulty / active addresses',
    url: 'https://blockchain.info/q/hashrate',
    frequency: 'Daily',
    validate: (body) => {
      const n = Number(body.trim());
      if (!Number.isFinite(n) || n <= 0) throw new Error(`expected a number, got "${body.slice(0, 40)}"`);
      return `hashrate ${n}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'mempool.space:fees',
    group: 'Crypto on-chain',
    purpose: 'Network fees',
    url: 'https://mempool.space/api/v1/fees/recommended',
    frequency: 'Realtime',
    validate: (body) => {
      const d = json(body);
      if (typeof d?.fastestFee !== 'number') throw new Error('no fastestFee');
      return `fastest ${d.fastestFee} sat/vB`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'defillama:dex-volume',
    group: 'Crypto DeFi',
    purpose: 'DEX volume (TVL + stablecoins already wired)',
    url: 'https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true',
    frequency: 'Daily',
    validate: (body) => {
      const d = json(body);
      if (typeof d?.total24h !== 'number') throw new Error('no total24h in response');
      return `24h DEX volume $${Math.round(d.total24h).toLocaleString('en-US')}`;
    },
    headers: BROWSER_HEADERS,
  },

  // ---- Treasury (§C2) ----
  {
    id: 'treasurydirect:auctions',
    group: 'Treasury',
    purpose: 'Issuance + auction demand (bid-to-cover)',
    url: 'https://www.treasurydirect.gov/TA_WS/securities/auctioned?format=json&days=30',
    frequency: 'Event',
    validate: nonEmptyArray('auctions', (r) => `${r.securityType ?? '?'} ${r.auctionDate ?? ''} btc=${r.bidToCoverRatio ?? 'n/a'}`),
    headers: BROWSER_HEADERS,
  },

  // ---- The scrape-based rows. These are the fragile ones the audit flagged, and the whole
  // reason to probe: an HTML layout change is invisible until the scraper silently returns null.
  {
    id: 'farside:btc-etf-flow',
    group: 'Flow (scrape)',
    purpose: 'BTC ETF flow - §10. Returned 403 on the first verified run; re-probed to confirm',
    url: 'https://farside.co.uk/bitcoin-etf-flow-all-data/',
    frequency: 'Daily',
    validate: htmlContains(/<table[\s\S]{0,4000}?(IBIT|FBTC|Total)/i, 'flow table with fund columns'),
    headers: BROWSER_HEADERS,
  },
  // --- ETF flow alternatives, probed because Farside is blocked -------------------------------
  //
  // Net creations/redemptions are not published as a free feed by anyone reliable. The one honest
  // derivation is Δ(shares outstanding) × NAV, both of which the funds themselves publish. These
  // probes test whether those two numbers are actually reachable; if they are not, §10's rule
  // applies and ETF flow ships as "Provider not wired" rather than as an inferred number.
  {
    id: 'yahoo:IBIT-shares',
    group: 'ETF flow alternatives',
    purpose: 'BTC ETF shares outstanding + NAV - the only honest free flow derivation',
    url: 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/IBIT?modules=defaultKeyStatistics,price',
    frequency: 'Daily',
    validate: (body) => {
      const r = json(body)?.quoteSummary?.result?.[0];
      const shares = r?.defaultKeyStatistics?.sharesOutstanding?.raw;
      const price = r?.price?.regularMarketPrice?.raw;
      if (typeof shares !== 'number') throw new Error('no defaultKeyStatistics.sharesOutstanding (Yahoo v10 often needs a crumb)');
      return `shares ${shares.toLocaleString('en-US')}, px ${price ?? '?'}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'yahoo:GLD-shares',
    group: 'ETF flow alternatives',
    purpose: 'Gold ETF flow via the same Δshares × NAV derivation',
    url: 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/GLD?modules=defaultKeyStatistics,price',
    frequency: 'Daily',
    validate: (body) => {
      const r = json(body)?.quoteSummary?.result?.[0];
      const shares = r?.defaultKeyStatistics?.sharesOutstanding?.raw;
      if (typeof shares !== 'number') throw new Error('no sharesOutstanding');
      return `shares ${shares.toLocaleString('en-US')}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'coingecko:btc-etf-proxy',
    group: 'ETF flow alternatives',
    purpose: 'Fallback: does CoinGecko expose any ETF/treasury holdings series at all',
    url: 'https://api.coingecko.com/api/v3/companies/public_treasury/bitcoin',
    frequency: 'Daily',
    validate: (body) => {
      const d = json(body);
      if (!Array.isArray(d?.companies)) throw new Error('no companies array');
      return `${d.companies.length} holders, total ${d.total_holdings ?? '?'} BTC (treasuries, NOT ETF flow)`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'spdr:gld-holdings',
    group: 'Flow (scrape)',
    purpose: 'GLD tonnes in trust - gold ETF holdings',
    url: 'https://www.spdrgoldshares.com/usa/historical-data/',
    frequency: 'Daily',
    validate: htmlContains(/tonnes|ounces in trust|Total Net Asset/i, 'holdings wording'),
    headers: BROWSER_HEADERS,
  },
  {
    id: 'wgc:gold-demand',
    group: 'Flow (scrape)',
    purpose: 'Central bank gold purchases - monthly, NOT realtime',
    url: 'https://www.gold.org/goldhub/data/gold-demand-by-country',
    frequency: 'Monthly',
    validate: htmlContains(/central bank|tonnes|demand/i, 'demand wording'),
    headers: BROWSER_HEADERS,
  },

  // ---- EIA needs its own free key; skip cleanly rather than reporting a false failure ----
  {
    id: 'eia:crude-stocks',
    group: 'Energy',
    purpose: 'Weekly US crude inventory',
    url: `https://api.eia.gov/v2/petroleum/stoc/wstk/data/?api_key=${process.env.EIA_API_KEY || ''}&frequency=weekly&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=5`,
    frequency: 'Weekly',
    validate: (body) => {
      const rows = json(body)?.response?.data;
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('no response.data rows');
      return `${rows.length} rows, latest ${rows[0].period} = ${rows[0].value}`;
    },
    skipIf: () => (process.env.EIA_API_KEY ? null : 'EIA_API_KEY not set (free key: https://www.eia.gov/opendata/register.php)'),
  },

  // ---- Controls for sources already wired, so a red row here means "provider changed",
  // not "we never had it". ----
  {
    id: 'alternative.me:fng (control)',
    group: 'Control (already wired)',
    purpose: 'Fear & Greed - wired in Fase 3',
    url: 'https://api.alternative.me/fng/?limit=5',
    frequency: 'Daily',
    validate: nonEmptyArray('readings', (r) => `${r.value} (${r.value_classification})`),
    headers: BROWSER_HEADERS,
  },
  {
    id: 'defillama:stablecoins (control)',
    group: 'Control (already wired)',
    purpose: 'Stablecoin supply - wired in Fase 3',
    url: 'https://stablecoins.llama.fi/stablecoincharts/all',
    frequency: 'Daily',
    validate: nonEmptyArray('points', (r) => `date ${r.date}`),
    headers: BROWSER_HEADERS,
  },

  // ---- Tahap D: XAU Futures Curve (§13-15) - individual COMEX gold futures contracts, wired
  // into /api/market/xau-futures-curve. Confirmed via a real GitHub Actions run (not this
  // sandbox, zero network access) before being built: the bare symbol (e.g. "GCZ26") 404s, the
  // ".CMX" exchange suffix is required, and 5 different contract months across two calendar
  // years all resolved with distinct, curve-consistent prices (increasing from the near month
  // outward - real contango, not the same quote repeated under 5 names). Critical because the
  // Futures Curve panel now depends on this shape. ----
  yahooFutures('GCV26.CMX', 'XAU Futures Curve - Oct 2026 contract', true),
  yahooFutures('GCZ26.CMX', 'XAU Futures Curve - Dec 2026 contract', true),
  yahooFutures('GCG27.CMX', 'XAU Futures Curve - Feb 2027 contract', true),
  yahooFutures('GCJ27.CMX', 'XAU Futures Curve - Apr 2027 contract', true),
  yahooFutures('GCM27.CMX', 'XAU Futures Curve - Jun 2027 contract', true),

  // ---- Tahap D/F: format tripwires for two free-but-binary sources that were deliberately NOT
  // wired (docs/TAHAP-D-E-F-G-POLISH-SUMMARY.md). Same treatment as the WGC/GLD probes above -
  // kept as permanent non-critical watchers so a future format change (e.g. CME or the GPR
  // maintainers finally publishing JSON/CSV) shows up here instead of requiring a fresh audit. ----
  {
    id: 'cme:gold-stocks-report',
    group: 'Tahap D - confirmed not wired',
    purpose: 'D2: COMEX registered/eligible gold inventory - free, but XLS-only (confirmed)',
    url: 'https://www.cmegroup.com/delivery_reports/Gold_Stocks.xls',
    frequency: 'Daily',
    validate: (body, res) => {
      const contentType = res.headers.get('content-type') ?? 'unknown';
      if (contentType.includes('json') || body.trimStart().startsWith('{') || body.trimStart().startsWith('[')) {
        return `content-type is now ${contentType} - JSON may be available, re-audit D2`;
      }
      throw new Error(`still binary (content-type=${contentType}, ${body.length} bytes) - not JSON, as last confirmed`);
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'gpr:index-export',
    group: 'Tahap F - confirmed not wired',
    purpose: 'Geopolitical Risk Index (Caldara & Iacoviello) - free, but XLS-only, monthly (confirmed)',
    url: 'https://www.matteoiacoviello.com/gpr_files/data_gpr_export.xls',
    frequency: 'Monthly',
    validate: (body, res) => {
      const contentType = res.headers.get('content-type') ?? 'unknown';
      if (contentType.includes('json') || contentType.includes('csv')) {
        return `content-type is now ${contentType} - JSON/CSV may be available, re-audit Tahap F`;
      }
      throw new Error(`still binary (content-type=${contentType}, ${body.length} bytes) - not JSON/CSV, as last confirmed`);
    },
    headers: BROWSER_HEADERS,
  },

  // ---- Analysis tab upgrade (2026-08-26): USD Index + major US equity index COT codes, and a
  // daily BTC series for the Cross-Asset Correlation module. The codes below were NOT guessed - an
  // initial "%DOLLAR INDEX%"/"%DOW JONES%" search returned zero USD Index rows and only DJIA's
  // REAL ESTATE sub-index, so a live discovery pass (GitHub Actions run #32, 2026-08-26) was run
  // first to find the real names/codes before anything was wired into COT_MARKET_CODES. This probe
  // is the permanent confirmation half (same pattern as 'cftc:commodity-codes' above) - it asserts
  // the wired codes still resolve to the market they are labelled as, not a fresh discovery.
  {
    id: 'cftc:index-codes',
    group: 'CFTC',
    purpose: 'Confirm each wired USD Index / equity index CFTC contract code resolves to the market it is labelled as',
    url:
      'https://publicreporting.cftc.gov/resource/6dca-aqww.json?$select=cftc_contract_market_code,market_and_exchange_names' +
      "&$where=cftc_contract_market_code%20in(%27098662%27,%2713874A%27,%27124603%27,%27209742%27)" +
      '&$group=cftc_contract_market_code,market_and_exchange_names&$limit=100',
    frequency: 'Weekly',
    critical: true,
    validate: (body: string) => {
      const rows = JSON.parse(body);
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('no rows for the wired USD Index / equity index codes');
      const wired: Record<string, string> = {
        '098662': 'DX-Y.NYB USD Index', '13874A': '^GSPC E-mini S&P 500',
        '124603': '^DJI DJIA x $5', '209742': '^NDX Nasdaq mini',
      };
      const seen = new Map<string, string>();
      for (const row of rows) seen.set(String(row.cftc_contract_market_code), String(row.market_and_exchange_names));
      const missing = Object.keys(wired).filter((code) => !seen.has(code));
      const pairs = Object.entries(wired)
        .map(([code, label]) => `${label} -> ${seen.get(code) ?? 'NOT FOUND'}`)
        .join(' | ');
      if (missing.length) throw new Error(`codes with no market in the dataset: ${missing.join(', ')} :: ${pairs}`);
      return pairs;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'yahoo:BTC-USD 1y daily',
    group: 'Yahoo control',
    purpose: 'Daily BTC closes at the same frequency as GC=F/DX-Y.NYB/equity indices, for the Cross-Asset Correlation module',
    url: 'https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?interval=1d&range=1y',
    frequency: 'Daily',
    critical: false,
    validate: (body: string) => {
      const data = json(body);
      const block = data?.chart?.result?.[0];
      const stamps: number[] = Array.isArray(block?.timestamp) ? block.timestamp : [];
      const closes: Array<number | null> = block?.indicators?.quote?.[0]?.close ?? [];
      const usable = stamps
        .map((ts, i) => ({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: closes[i] }))
        .filter((p): p is { date: string; close: number } => typeof p.close === 'number' && Number.isFinite(p.close));
      if (usable.length === 0) throw new Error('no daily candles in response');
      if (usable.length < 200) throw new Error(`only ${usable.length} usable daily closes - too thin for a 1y daily-return correlation`);
      return `${usable.length} usable daily closes, latest ${usable[usable.length - 1].date} = ${usable[usable.length - 1].close}`;
    },
    headers: BROWSER_HEADERS,
  },

  // ---- Tahap D3 Tier 1: World Gold Council's free "Gold Focus" monthly blog (central bank gold
  // buying/selling by country) - GET /api/macro/central-bank-gold depends on this being reachable
  // AND containing a "central bank" post link, so critical: true. Confirmed via 5 rounds of
  // GitHub Actions audit (scripts/audit-wgc-imf-structure.ts, removed after use) that the post
  // itself has no <table>/JSON, only prose - server.ts's extraction is a text-pattern scrape,
  // genuinely fragile to a WGC wording change, which is exactly why this probe exists: a failure
  // here is the first signal that extraction needs a fresh audit, not a silent break. ----
  {
    id: 'wgc:gold-focus-index',
    group: 'Tahap D3 Tier 1',
    purpose: 'Central bank gold buying/selling by country - finds the latest monthly post link',
    url: 'https://www.gold.org/goldhub/gold-focus',
    frequency: 'Monthly',
    critical: true,
    validate: (body) => {
      const links = [...body.matchAll(/href="(\/goldhub\/gold-focus\/\d{4}\/\d{2}\/[^"]*central-bank[^"]*)"/gi)].map(
        (m) => m[1]
      );
      if (links.length === 0) throw new Error('No "central bank" post link found on the Gold Focus index page');
      return `${links.length} "central bank" post link(s); latest: ${links[0]}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    // Same file the original D3 audit found blocked (2 rounds, even with a Referer header
    // simulating a visit from the listing page) - kept as a non-critical tripwire in case WGC
    // ever opens it up, which would be a genuinely better source than the prose scrape above.
    // The filename is month-stamped ("Aug2026") and will 404 in later months rather than 403 -
    // a future 404 here means "check the current filename on the listing page", not "still
    // blocked"; non-critical either way, so this is a low-cost limitation to accept.
    id: 'wgc:gold-reserves-changes-xlsx-blocked',
    group: 'Tahap D3 Tier 1',
    purpose: 'Central bank gold changes XLSX - confirmed blocked (HTTP 403), Tier 1 uses the free blog instead',
    url: 'https://www.gold.org/download/file/7741/Changes_latest_as_of_Aug2026_IFS.xlsx',
    frequency: 'Monthly',
    validate: (body, res) => {
      if (res.status === 200) return `now reachable (was 403) - re-audit whether this beats the blog scrape, ${body.length} bytes`;
      throw new Error(`still blocked (HTTP ${res.status}), as last confirmed`);
    },
    headers: { ...BROWSER_HEADERS, Referer: 'https://www.gold.org/goldhub/data/gold-reserves-by-country' },
  },

  // ---- Data-freshness upgrade (2026-08-26 audit), PRIORITY 2: does either US government stats
  // agency (BLS for CPI/NFP, BEA for GDP/PCE) offer a genuinely free path to fill in Actual faster
  // than ForexFactory's mirror sometimes does? Both probed UNAUTHENTICATED (no key configured
  // anywhere in this project yet) specifically to prove reachability + real shape first - a key
  // request is only worth submitting if the API is actually usable. ----
  {
    id: 'bls:cpi-unregistered',
    group: 'PRIORITY 2 - BLS/BEA fallback investigation',
    purpose: 'CPI-U All Items (CUUR0000SA0) via BLS public API v2, no registration key - proves reachability/shape before requesting a key',
    url: 'https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SA0',
    frequency: 'Monthly',
    validate: (body) => {
      const data = json(body);
      const series = data?.Results?.series?.[0];
      const points = series?.data;
      if (data?.status && data.status !== 'REQUEST_SUCCEEDED') {
        throw new Error(`BLS status=${data.status} message=${JSON.stringify(data.message ?? [])}`);
      }
      if (!Array.isArray(points) || points.length === 0) throw new Error('no Results.series[0].data rows');
      const latest = points[0];
      return `unregistered v2 OK - latest ${latest.year}-${latest.period} = ${latest.value} (footnotes: ${JSON.stringify(latest.footnotes ?? [])})`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'bls:nfp-unregistered',
    group: 'PRIORITY 2 - BLS/BEA fallback investigation',
    purpose: 'Total Nonfarm Employment (CES0000000001) via BLS public API v2, no registration key',
    url: 'https://api.bls.gov/publicAPI/v2/timeseries/data/CES0000000001',
    frequency: 'Monthly',
    validate: (body) => {
      const data = json(body);
      const series = data?.Results?.series?.[0];
      const points = series?.data;
      if (data?.status && data.status !== 'REQUEST_SUCCEEDED') {
        throw new Error(`BLS status=${data.status} message=${JSON.stringify(data.message ?? [])}`);
      }
      if (!Array.isArray(points) || points.length === 0) throw new Error('no Results.series[0].data rows');
      const latest = points[0];
      return `unregistered v2 OK - latest ${latest.year}-${latest.period} = ${latest.value}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'bea:gdp-no-key',
    group: 'PRIORITY 2 - BLS/BEA fallback investigation',
    purpose: 'BEA NIPA GDP table - BEA requires a UserID on every request (no unauthenticated mode), so this only proves the endpoint is reachable and answers with a well-formed error rather than being blocked/dead',
    url: 'https://apps.bea.gov/api/data/?UserID=INVALID&method=GetData&datasetname=NIPA&TableName=T10101&Frequency=Q&Year=2026&ResultFormat=JSON',
    frequency: 'Quarterly',
    validate: (body) => {
      const data = json(body);
      const err = data?.BEAAPI?.Results?.Error ?? data?.BEAAPI?.Error;
      if (err) return `reachable, well-formed error as expected with an invalid key: ${JSON.stringify(err).slice(0, 200)}`;
      const hasResults = Boolean(data?.BEAAPI?.Results);
      if (hasResults) return `reachable and returned Results with an invalid key (unexpected - re-check) :: ${JSON.stringify(data).slice(0, 200)}`;
      throw new Error(`unexpected shape: ${JSON.stringify(data).slice(0, 200)}`);
    },
    headers: BROWSER_HEADERS,
  },

  // ---- PRIORITY 3A: TreasuryDirect / Fiscal Data auction calendar - free, no key, per the prompt.
  {
    id: 'fiscaldata:treasury-auctions',
    group: 'PRIORITY 3A - Treasury Auction Calendar',
    purpose: 'US Treasury auction schedule/results (api.fiscaldata.treasury.gov) - candidate for a new Treasury Auction Calendar card',
    url: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query?sort=-auction_date&page%5Bsize%5D=5',
    frequency: 'Daily',
    critical: true,
    validate: (body) => {
      const data = json(body);
      const rows = data?.data;
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('no data rows');
      const r0 = rows[0];
      return `${rows.length} rows; e.g. ${r0.security_type} ${r0.security_term} auction_date=${r0.auction_date} high_yield=${r0.high_yield ?? 'n/a'}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    // Field-discovery pass, not a second reachability check - dumps the full raw row (all fields
    // the API actually returns) so the endpoint this project builds against real field names, not
    // assumed ones from memory of the public docs. A past-dated auction (highest security_term
    // sort excluded on purpose) is more likely to have every result field already populated
    // (bid_to_cover_ratio etc.), unlike a future-dated one where those are still null.
    id: 'fiscaldata:treasury-auctions-field-dump',
    group: 'PRIORITY 3A - Treasury Auction Calendar',
    purpose: 'Full raw field list for one completed (past) auction, so the new endpoint is built against real field names, not guessed ones',
    url: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query?filter=auction_date:lte:2026-08-20&sort=-auction_date&page%5Bsize%5D=1',
    frequency: 'Daily',
    validate: (body) => {
      const data = json(body);
      const rows = data?.data;
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('no data rows for a past auction');
      return JSON.stringify(rows[0]);
    },
    headers: BROWSER_HEADERS,
  },

  // ---- PRIORITY 3B: ETF Gold Flow (GLD/IAU) - checking for an official, legal, machine-readable
  // holdings feed rather than trusting the old "no source" note. GLD's own historical-data page
  // (existing spdr:gld-holdings probe above) is HTML-only; this probes the conventional SPDR CSV
  // export URL directly. IAU (iShares/BlackRock) publishes a documented CSV-export endpoint on
  // every fund product page - probed with its real product-page fileName/params. ----
  {
    id: 'spdr:gld-holdings-csv',
    group: 'PRIORITY 3B - ETF Gold Flow investigation',
    purpose: 'SPDR GLD daily holdings (tonnes in trust) as a real CSV, not the HTML wording match the existing probe only confirms',
    url: 'https://www.spdrgoldshares.com/assets/dynamic/GLD/GLD_US_archive_EN.csv',
    frequency: 'Daily',
    validate: (body, res) => {
      const contentType = res.headers.get('content-type') ?? 'unknown';
      const firstLines = body.split('\n').slice(0, 3).join(' | ');
      if (body.trimStart().startsWith('<')) throw new Error(`HTML, not CSV (content-type=${contentType})`);
      return `content-type=${contentType}, ${body.length} bytes; first lines: ${firstLines.slice(0, 200)}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'ishares:iau-holdings-csv',
    group: 'PRIORITY 3B - ETF Gold Flow investigation',
    purpose: 'iShares IAU daily fund holdings via the documented per-fund CSV export endpoint',
    url: 'https://www.ishares.com/us/products/239561/ishares-gold-trust-fund/1467271812596.ajax?fileType=csv&fileName=IAU_holdings&dataType=fund',
    frequency: 'Daily',
    validate: (body, res) => {
      const contentType = res.headers.get('content-type') ?? 'unknown';
      const firstLines = body.split('\n').slice(0, 5).join(' | ');
      if (body.trimStart().startsWith('<')) throw new Error(`HTML, not CSV (content-type=${contentType})`);
      return `content-type=${contentType}, ${body.length} bytes; first lines: ${firstLines.slice(0, 300)}`;
    },
    headers: BROWSER_HEADERS,
  },

  // ---- PRIORITY 3B: Baltic Dry Index - the Baltic Exchange itself licenses this data; checking
  // whether its own public site exposes any genuinely free, non-paywalled current value (rather
  // than assuming "no free source" without looking). Non-critical: expected to fail or show a
  // paywall, which is itself the answer this probe exists to confirm. ----
  {
    id: 'balticexchange:public-site',
    group: 'PRIORITY 3B - Baltic Dry Index investigation',
    purpose: 'Baltic Exchange own site - checking for any free/public BDI value vs a licensed-data paywall',
    url: 'https://www.balticexchange.com/en/data-services/market-information0/dry-services.html',
    frequency: 'Daily',
    validate: (body) => {
      const match = body.match(/baltic dry index[\s\S]{0,200}\b\d{3,5}\b/i);
      const hasPaywallWording = /subscri|licens|contact us for|request access/i.test(body);
      if (match) return `snippet near a candidate BDI value: ${JSON.stringify(match[0].replace(/\s+/g, ' ').slice(0, 250))}`;
      if (hasPaywallWording) throw new Error('page reachable but reads as subscription/licensed access - no free value found');
      throw new Error('page reachable, no free BDI value and no clear paywall wording either - inconclusive, re-audit manually');
    },
    headers: BROWSER_HEADERS,
  },

  // ---- Follow-up round (same day): the first-pass guessed URLs for GLD/IAU didn't pan out
  // (GLD's returned a PDF, IAU's returned an HTML error page under a text/csv content-type) - these
  // don't repeat the same guesses, they scrape the actual product pages for whatever real
  // download link each fund publishes, rather than assuming a URL pattern. ----
  {
    id: 'spdr:historical-data-page-links',
    group: 'PRIORITY 3B - ETF Gold Flow investigation (follow-up)',
    purpose: 'Find the REAL csv/xml/download link SPDR publishes on its own historical-data page, instead of guessing a URL pattern',
    url: 'https://www.spdrgoldshares.com/usa/historical-data/',
    frequency: 'Daily',
    validate: (body) => {
      const links = [...body.matchAll(/href="([^"]*\.(?:csv|xml)[^"]*)"/gi)].map((m) => m[1]);
      const downloadish = [...body.matchAll(/href="([^"]*(?:download|export|archive)[^"]*)"/gi)].map((m) => m[1]);
      if (links.length === 0 && downloadish.length === 0) throw new Error('no .csv/.xml or download-ish href found on the page - likely no machine-readable export exists here');
      return `csv/xml links: ${JSON.stringify(links)}; download-ish links: ${JSON.stringify(downloadish.slice(0, 5))}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    // Found via the sibling probe above (spdr:historical-data-page-links), which scraped this real
    // URL out of the page's own "download-ish" links instead of guessing a static CSV filename -
    // this is a genuine API endpoint (api.spdrgoldshares.com), not the static-file guess that
    // returned a PDF. Confirming its actual shape before this gets built on.
    id: 'spdr:historical-archive-api',
    group: 'PRIORITY 3B - ETF Gold Flow investigation (follow-up)',
    purpose: 'SPDR GLD historical holdings via the real API endpoint scraped from the historical-data page (not a guessed static CSV filename)',
    url: 'https://api.spdrgoldshares.com/api/v1/historical-archive?product=gld&exchange=NYSE&lang=en',
    frequency: 'Daily',
    validate: (body, res) => {
      const contentType = res.headers.get('content-type') ?? 'unknown';
      if (body.trimStart().startsWith('<')) throw new Error(`still HTML, not data (content-type=${contentType})`);
      try {
        const data = json(body);
        return `JSON OK, content-type=${contentType}; top-level keys: ${JSON.stringify(Object.keys(data ?? {})).slice(0, 300)}`;
      } catch {
        // Not JSON - could be a real CSV/XML body, which is still a usable win, so report the shape
        // instead of failing outright.
        return `not JSON (content-type=${contentType}) - first 200 chars: ${JSON.stringify(body.slice(0, 200))}`;
      }
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'ishares:iau-product-page-links',
    group: 'PRIORITY 3B - ETF Gold Flow investigation (follow-up)',
    purpose: 'Find the REAL holdings-csv download link on the IAU product page - the guessed .ajax URL/product ID was wrong',
    url: 'https://www.ishares.com/us/products/239561/ishares-gold-trust-fund',
    frequency: 'Daily',
    validate: (body) => {
      const ajaxLinks = [...body.matchAll(/href="([^"]*\.ajax\?[^"]*fileType=csv[^"]*)"/gi)].map((m) => m[1]);
      const anyCsv = [...body.matchAll(/href="([^"]*fileType=csv[^"]*)"/gi)].map((m) => m[1]);
      if (ajaxLinks.length === 0 && anyCsv.length === 0) throw new Error('no fileType=csv download link found on the product page - product ID 239561 may itself be wrong for IAU, or iShares changed its export pattern');
      return `ajax csv links: ${JSON.stringify(ajaxLinks.slice(0, 5))}; any csv links: ${JSON.stringify(anyCsv.slice(0, 5))}`;
    },
    headers: BROWSER_HEADERS,
  },

  // ---- PRODUCTION BUG INVESTIGATION (2026-08-26): "Actual" column reported never filling in on
  // the live calendar, even for events 3+ days old (e.g. NZD Retail Sales, Mon 24 Aug, still empty
  // Thu 27 Aug). This probe hits the EXACT URL fetchRealEconomicCalendar() in server.ts calls, with
  // the same header, and reports the raw shape for PAST events broken down by currency - the
  // question is whether ForexFactory's own mirror ever populates `actual` for non-USD events at
  // all, independent of anything this app's own BLS fallback or caching does. ----
  {
    id: 'ff:calendar-actual-fill-audit',
    group: 'BUG INVESTIGATION - calendar Actual never fills',
    purpose:
      'Exact URL/headers used by fetchRealEconomicCalendar() in server.ts - reports how many PAST events have a non-empty `actual` field, broken down by currency, to test whether the FF mirror itself ever fills Actual for non-USD releases',
    url: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    frequency: 'Near-realtime',
    validate: (body) => {
      const data = json(body);
      if (!Array.isArray(data)) throw new Error(`response is not an array (typeof ${typeof data})`);
      const now = Date.now();
      const allowed = new Set(['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'JPY', 'AUD', 'NZD']);
      const byCurrency: Record<string, { pastTotal: number; pastFilled: number }> = {};
      let totalRows = 0;
      let pastTotal = 0;
      let pastFilled = 0;
      const nzdSamples: string[] = [];
      const staleSamples: string[] = [];
      for (const item of data) {
        totalRows++;
        const currency = String(item?.country || item?.currency || '').toUpperCase();
        if (!allowed.has(currency)) continue;
        const d = new Date(item?.date);
        if (isNaN(d.getTime())) continue;
        const isPast = d.getTime() < now;
        const hasActual = item?.actual !== undefined && item?.actual !== null && String(item.actual).trim() !== '';
        if (!byCurrency[currency]) byCurrency[currency] = { pastTotal: 0, pastFilled: 0 };
        if (isPast) {
          pastTotal++;
          byCurrency[currency].pastTotal++;
          if (hasActual) {
            pastFilled++;
            byCurrency[currency].pastFilled++;
          } else if (currency !== 'USD' && staleSamples.length < 6) {
            const ageHrs = ((now - d.getTime()) / 3_600_000).toFixed(0);
            staleSamples.push(`${currency} "${item.title}" (${ageHrs}h old, date=${item.date}) actual=${JSON.stringify(item.actual)}`);
          }
        }
        if (currency === 'NZD' && nzdSamples.length < 8) {
          nzdSamples.push(
            `"${item.title}" date=${item.date} past=${isPast} actual=${JSON.stringify(item.actual)} forecast=${JSON.stringify(item.forecast)} previous=${JSON.stringify(item.previous)}`
          );
        }
      }
      const breakdown = Object.entries(byCurrency)
        .map(([cur, v]) => `${cur}=${v.pastFilled}/${v.pastTotal}`)
        .join(' ');
      if (nzdSamples.length === 0) {
        return `no NZD rows in this week's file at all (total rows=${totalRows}); past-event actual fill by currency: ${breakdown}`;
      }
      return [
        `past-event actual fill by currency: ${breakdown}`,
        `NZD rows raw: ${nzdSamples.join(' | ')}`,
        staleSamples.length > 0 ? `non-USD past events still empty: ${staleSamples.join(' | ')}` : 'no non-USD past events found empty',
      ].join('\n    ');
    },
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HEVORA/1.0' },
  },

  // ---- Calendar Actual coverage expansion (2026-08-26+): official free stats-agency APIs for the
  // 7 non-USD currencies this app tracks. Same discipline as the BLS fallback investigation - only
  // wire what a live probe actually confirms free + unauthenticated + correctly shaped, never
  // guess from documentation alone. ----
  {
    // Round 1 (api.ons.gov.uk/timeseries/...): 404. Round 2 (api.ons.gov.uk/search, and
    // www.ons.gov.uk/timeseries/... without a topic path): still 404. Round 3: WebSearch found the
    // real pattern - the legacy timeseries JSON lives under www.ons.gov.uk WITH a topic/subtopic
    // path segment before "timeseries" (e.g. .../economy/inflationandpriceindices/timeseries/czbh/
    // mm23/data, confirmed via a live ONS page found in search results) - my round-2 URL was
    // missing that path segment entirely, not using a wrong host or series id.
    id: 'ons:cpi-12m-rate-topic-path',
    group: 'Calendar Actual coverage - official stats agencies',
    purpose: 'UK CPI 12-month rate (series D7G7, dataset mm23) via www.ons.gov.uk WITH the topic path segment - EXACT URL wired into server.ts applyOfficialStatsFallback for GBP CPI y/y, no key',
    url: 'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23/data',
    frequency: 'Monthly',
    validate: (body) => {
      const data = json(body);
      const months = data?.months;
      if (!Array.isArray(months) || months.length === 0) throw new Error(`no months[] array in response; top-level keys: ${JSON.stringify(Object.keys(data ?? {}))}`);
      const latest = months[months.length - 1];
      return `latest ${latest.date} = ${latest.value}${data.unit ? ' ' + data.unit : ''} (title: ${data.description?.title ?? '?'})`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'ons:unemployment-rate-topic-path',
    group: 'Calendar Actual coverage - official stats agencies',
    purpose: 'UK unemployment rate (series MGSX, dataset lms) via www.ons.gov.uk WITH the topic path segment - EXACT URL wired into server.ts applyOfficialStatsFallback for GBP Unemployment Rate',
    url: 'https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms/data',
    frequency: 'Monthly',
    validate: (body) => {
      const data = json(body);
      const months = data?.months;
      if (!Array.isArray(months) || months.length === 0) throw new Error(`no months[] array; top-level keys: ${JSON.stringify(Object.keys(data ?? {}))}`);
      const latest = months[months.length - 1];
      return `latest ${latest.date} = ${latest.value}${data.unit ? ' ' + data.unit : ''} (title: ${data.description?.title ?? '?'})`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'ons:gdp-qoq-topic-path',
    group: 'Calendar Actual coverage - official stats agencies',
    purpose: 'UK GDP q/q growth (series IHYQ, dataset qna) via www.ons.gov.uk WITH the topic path segment - EXACT URL wired into server.ts applyOfficialStatsFallback for GBP GDP q/q',
    url: 'https://www.ons.gov.uk/economy/grossdomesticproductgdp/timeseries/ihyq/qna/data',
    frequency: 'Quarterly',
    validate: (body) => {
      const data = json(body);
      const quarters = data?.quarters;
      if (!Array.isArray(quarters) || quarters.length === 0) throw new Error(`no quarters[] array; top-level keys: ${JSON.stringify(Object.keys(data ?? {}))}`);
      const latest = quarters[quarters.length - 1];
      return `latest ${latest.date} = ${latest.value}${data.unit ? ' ' + data.unit : ''} (title: ${data.description?.title ?? '?'})`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    // Exact URL server.ts's EUROSTAT_HICP_YOY_URL now uses (geo=EA confirmed working; EA20 was
    // tried first and returned an empty value{} - see eurostat:unemployment-rate below, same trap).
    id: 'eurostat:hicp-annual-rate',
    group: 'Calendar Actual coverage - official stats agencies',
    purpose: 'Euro area HICP (CPI) annual rate of change via Eurostat API - EXACT URL wired into server.ts applyOfficialStatsFallback for EUR CPI y/y, no key',
    url: 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr?format=JSON&geo=EA&unit=RCH_A&coicop=CP00&lastTimePeriod=6',
    frequency: 'Monthly',
    validate: (body) => {
      const data = json(body);
      const values: Record<string, unknown> = data?.value ?? {};
      if (Object.keys(values).length === 0) throw new Error(`no value{} in response; top-level keys: ${JSON.stringify(Object.keys(data ?? {}))}`);
      // Decode the same way server.ts's fetchEurostatHicpYoYPoints does: value{} keys are a JSON-
      // stat positional index, NOT the period itself - map via dimension.time.category.index.
      const timeIndex: Record<string, number> = data?.dimension?.time?.category?.index ?? {};
      const indexToPeriod = new Map<number, string>();
      for (const [period, idx] of Object.entries(timeIndex)) indexToPeriod.set(Number(idx), period);
      const decoded = Object.entries(values)
        .map(([key, val]) => `${indexToPeriod.get(Number(key)) ?? `idx${key}`}=${val}%`)
        .sort();
      if (decoded.length === 0) throw new Error(`value{} had entries but none decoded to a real period - index map: ${JSON.stringify(Object.fromEntries(indexToPeriod))}`);
      return `decoded ${decoded.length} period(s): ${decoded.join(', ')}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    // Round 1 (2026-08-26): geo=EA20+age=Y15-74 - empty value{}. Round 2: same codes but geo=EA
    // (which is what actually worked for HICP above) - if still empty, this probe now dumps the
    // dataset's OWN dimension.<dim>.category.index for every dimension, so the next attempt reads
    // real valid codes instead of guessing a third time.
    // Round 1-3 all guessed an invalid age code (Y15-74 does not exist in this dataset). WebSearch
    // found the real codes: age is TOTAL/Y25-74/Y_LT25, not Y15-74 - retrying with TOTAL (my very
    // first round-1 guess, abandoned for the wrong reason - geo=EA20 was also wrong that round).
    id: 'eurostat:unemployment-rate',
    group: 'Calendar Actual coverage - official stats agencies',
    purpose: 'Euro area unemployment rate via Eurostat API (age=TOTAL, the real code per WebSearch) - candidate free fallback for EUR Unemployment Rate',
    url: 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m?format=JSON&geo=EA&s_adj=SA&age=TOTAL&sex=T&unit=PC_ACT&lastTimePeriod=6',
    frequency: 'Monthly',
    validate: (body) => {
      const data = json(body);
      const values: Record<string, unknown> = data?.value ?? {};
      if (Object.keys(values).length === 0) {
        const dims = data?.dimension ?? {};
        const dump = Object.entries(dims)
          .map(([dimName, dimObj]: [string, any]) => `${dimName}=[${Object.keys(dimObj?.category?.index ?? {}).slice(0, 8).join(',')}]`)
          .join(' | ');
        throw new Error(`still empty value{} - real valid codes per dimension: ${dump}`);
      }
      // Decode the same way server.ts would: value{} keys are a JSON-stat positional index, not
      // the period itself - map via dimension.time.category.index (same as the HICP probe above).
      const timeIndex: Record<string, number> = data?.dimension?.time?.category?.index ?? {};
      const indexToPeriod = new Map<number, string>();
      for (const [period, idx] of Object.entries(timeIndex)) indexToPeriod.set(Number(idx), period);
      const decoded = Object.entries(values)
        .map(([key, val]) => `${indexToPeriod.get(Number(key)) ?? `idx${key}`}=${val}%`)
        .sort();
      return `decoded ${decoded.length} period(s): ${decoded.join(', ')}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    // Confirmed live (2026-08-26): latest value 6.4, a plausible % rate - now wired into server.ts
    // (getStatCanUnemploymentPoints, STATCAN_UNEMPLOYMENT_RATE_VECTOR), same WDS POST endpoint
    // already confirmed working for CPI.
    id: 'statcan:unemployment-rate-vector-guess',
    group: 'Calendar Actual coverage - official stats agencies',
    purpose: 'Canada unemployment rate (vector v2062815) via StatCan WDS - EXACT vector wired into server.ts applyOfficialStatsFallback for CAD Unemployment Rate',
    url: 'https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods',
    method: 'POST',
    body: [{ vectorId: 2062815, latestN: 3 }],
    frequency: 'Monthly',
    validate: (body) => {
      const data = json(body);
      const row = Array.isArray(data) ? data[0] : data;
      const points = row?.object?.vectorDataPoint;
      if (!Array.isArray(points) || points.length === 0) throw new Error(`no object.vectorDataPoint[]; shape: ${JSON.stringify(data).slice(0, 300)}`);
      const latest = points[points.length - 1];
      const v = Number(latest?.value);
      const plausibleRate = Number.isFinite(v) && v > 0 && v < 30;
      return `latest refPer=${latest.refPer} value=${latest.value} title=${JSON.stringify(row?.object?.SeriesTitleEn ?? row?.object?.productId ?? '?')} plausibleAsRate=${plausibleRate}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    // Round 1 (2026-08-26): GET returned HTTP 405 - StatCan's Web Data Service is POST-only for
    // this call. Retrying as POST with a JSON body per StatCan's documented WDS contract.
    // Exact URL/body server.ts's fetchStatCanCpiPoints now uses (latestN=14 - enough to cover
    // both the m/m prior-month and y/y year-ago lookups the fallback needs).
    id: 'statcan:cpi-vector-latest',
    group: 'Calendar Actual coverage - official stats agencies',
    purpose: 'Canada CPI all-items (vector v41690973) via StatCan WDS POST endpoint - EXACT request wired into server.ts applyOfficialStatsFallback for CAD CPI, no key',
    url: 'https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods',
    method: 'POST',
    body: [{ vectorId: 41690973, latestN: 14 }],
    frequency: 'Monthly',
    validate: (body) => {
      const data = json(body);
      const row = Array.isArray(data) ? data[0] : data;
      const points = row?.object?.vectorDataPoint;
      if (!Array.isArray(points) || points.length === 0) throw new Error(`no object.vectorDataPoint[]; shape: ${JSON.stringify(data).slice(0, 300)}`);
      // Full sequence, not just the latest point - proves the m/m and y/y lookups in
      // server.ts's applyOfficialStatsFallback will actually find a prior-month/year-ago match.
      const sorted = [...points].sort((a: any, b: any) => String(a.refPer).localeCompare(String(b.refPer)));
      return `${sorted.length} point(s), refPer=index level: ${sorted.map((p: any) => `${p.refPer}=${p.value}`).join(', ')} (status=${row?.status})`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    // Round 1 (2026-08-26): "fetch failed" (not even an HTTP response) on a guessed dataflow key -
    // falling back to the SDMX dataflow discovery endpoint first to confirm the host/API itself is
    // reachable before guessing another key.
    // Round 1-2 (api.data.abs.gov.au): "fetch failed" both times - not a wrong key, the host
    // itself is dead. WebSearch found why: ABS migrated the whole Data API from
    // api.data.abs.gov.au to data.api.abs.gov.au (host segments swapped) with a new /rest/ prefix
    // - retrying against the documented example CPI dataflow on the new host.
    id: 'abs:sdmx-cpi-new-host',
    group: 'Calendar Actual coverage - official stats agencies',
    purpose: 'ABS Data API CPI dataflow via the current host (data.api.abs.gov.au, migrated from api.data.abs.gov.au) - candidate free fallback for AUD CPI',
    url: 'https://data.api.abs.gov.au/rest/data/ABS,CPI,2.0.0/1.10001.10.50.Q?format=jsondata',
    frequency: 'Quarterly',
    validate: (body, res) => {
      const contentType = res.headers.get('content-type') ?? 'unknown';
      if (body.trimStart().startsWith('<')) throw new Error(`HTML not data (content-type=${contentType}) - first 150 chars: ${body.slice(0, 150)}`);
      const data = json(body);
      const obsCount = data?.data?.dataSets?.[0]?.observations ? Object.keys(data.data.dataSets[0].observations).length : 0;
      return `JSON OK, content-type=${contentType}; observations=${obsCount}; top-level keys: ${JSON.stringify(Object.keys(data ?? {})).slice(0, 200)}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    // The example dataKey above returned 0 observations - fetching the CPI dataflow's own
    // structure (with related codelists attached via references=all) to read the REAL valid codes
    // for each dimension instead of guessing a second key blind.
    id: 'abs:sdmx-cpi-structure',
    group: 'Calendar Actual coverage - official stats agencies',
    purpose: 'ABS Data API CPI dataflow structure/codelists - discover the real dimension order and valid codes for the CPI dataKey',
    url: 'https://data.api.abs.gov.au/rest/dataflow/ABS/CPI/2.0.0?references=all&format=jsondata',
    frequency: 'Quarterly',
    validate: (body, res) => {
      const contentType = res.headers.get('content-type') ?? 'unknown';
      if (body.trimStart().startsWith('<')) throw new Error(`HTML not data (content-type=${contentType}) - first 150 chars: ${body.slice(0, 150)}`);
      const data = json(body);
      const dsds = data?.data?.dataStructures ?? [];
      const dims = dsds[0]?.dataStructureComponents?.dimensionList?.dimensions ?? [];
      const dimOrder = dims.map((d: any) => `${d.position}:${d.id}`).join(', ');
      const codelists = data?.data?.codelists ?? [];
      const sample = codelists
        .slice(0, 6)
        .map((cl: any) => `${cl.id}=[${(cl.codes ?? []).slice(0, 5).map((c: any) => c.id).join(',')}${(cl.codes ?? []).length > 5 ? ',...' : ''}]`)
        .join(' | ');
      return `dimension order: ${dimOrder || '(none found)'}; codelists: ${sample || '(none found)'}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    // No auth required per WebSearch (STAT-TAB PxWeb API, 682 datasets) - exact CPI table id
    // (px-x-...) not yet found, so this probe lists the top-level folder structure to discover it
    // rather than guessing a table id blind.
    // Round 1: got 650 entries back but the assumed `id`/`text` field names were wrong (`id` came
    // back undefined) - dumping the raw object keys/values of the first few entries this time
    // instead of assuming a field name, so the next round reads real field names, not guesses.
    id: 'swiss-bfs:pxweb-folder-discovery',
    group: 'Calendar Actual coverage - official stats agencies',
    purpose: 'Swiss BFS PxWeb API top-level folder listing - discover the real CPI (Landesindex der Konsumentenpreise) table id before guessing one',
    url: 'https://www.pxweb.bfs.admin.ch/api/v1/en/',
    frequency: 'Monthly',
    validate: (body) => {
      const data = json(body);
      if (!Array.isArray(data) || data.length === 0) throw new Error(`not a non-empty array; top-level: ${JSON.stringify(data).slice(0, 200)}`);
      return `${data.length} entries; raw shape of first 3: ${JSON.stringify(data.slice(0, 3))}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    // WebSearch confirms why this 502'd twice: Stats NZ's open data API (this exact opendata/v1
    // path) closed permanently on 2024-08-30. Its replacement (portal.apis.stats.govt.nz) requires
    // signing up for an API key - same category as BEA/e-Stat, not "no free source" but "needs a
    // self-serve key", so NZD stays honest-unavailable until that key is registered, same as BEA.
    id: 'statsnz:api-key-requirement-check',
    group: 'Calendar Actual coverage - official stats agencies',
    purpose: 'Stats NZ open data API - CONFIRMED closed 2024-08-30 (WebSearch); kept as a live check in case it ever comes back, not because reachability is in doubt anymore',
    url: 'https://api.stats.govt.nz/opendata/v1/Consumers%20Price%20Index',
    frequency: 'Quarterly',
    validate: (body, res) => {
      if (res.status === 401 || res.status === 403) throw new Error(`requires auth (HTTP ${res.status}) - key registration needed, not usable unauthenticated`);
      const contentType = res.headers.get('content-type') ?? 'unknown';
      return `HTTP ${res.status}, content-type=${contentType}; first 200 chars: ${JSON.stringify(body.slice(0, 200))}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'estat-japan:api-key-requirement-check',
    group: 'Calendar Actual coverage - official stats agencies',
    purpose: 'e-Stat Japan API - checking appId requirement (free self-serve registration if required, not usable unauthenticated otherwise)',
    url: 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList?statsCode=00200521',
    frequency: 'Monthly',
    validate: (body) => {
      const data = json(body);
      const result = data?.GET_STATS_LIST?.RESULT;
      if (result?.STATUS !== undefined && result.STATUS !== 0) {
        throw new Error(`API responded but requires appId (STATUS=${result.STATUS} ERROR_MSG=${result.ERROR_MSG})`);
      }
      return `reachable, shape: ${JSON.stringify(Object.keys(data?.GET_STATS_LIST ?? {}))}`;
    },
    headers: BROWSER_HEADERS,
  },
  {
    id: 'opendata-swiss:fso-cpi-search',
    group: 'Calendar Actual coverage - official stats agencies',
    purpose: 'Swiss FSO / opendata.swiss CKAN search for a CPI dataset - exploratory, exact machine-readable endpoint TBD',
    url: 'https://opendata.swiss/api/3/action/package_search?q=Landesindex%20der%20Konsumentenpreise&rows=3',
    frequency: 'Monthly',
    validate: (body) => {
      const data = json(body);
      const results = data?.result?.results;
      if (!Array.isArray(results) || results.length === 0) throw new Error(`no result.results[]; top-level keys: ${JSON.stringify(Object.keys(data ?? {}))}`);
      return `${results.length} dataset(s); e.g. "${results[0]?.title?.en ?? results[0]?.name}" resources=${(results[0]?.resources ?? []).length}`;
    },
    headers: BROWSER_HEADERS,
  },
];

// --- runner ----------------------------------------------------------------------------------

interface Result {
  probe: Probe;
  verdict: Verdict;
  http: string;
  ms: number;
  sample: string;
  error: string;
}

async function runProbe(probe: Probe): Promise<Result> {
  const skip = probe.skipIf?.();
  if (skip) return { probe, verdict: 'SKIP', http: '-', ms: 0, sample: skip, error: '' };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(probe.url, {
      method: probe.method ?? 'GET',
      headers: probe.body !== undefined ? { ...(probe.headers ?? BROWSER_HEADERS), 'Content-Type': 'application/json' } : probe.headers ?? BROWSER_HEADERS,
      body: probe.body !== undefined ? JSON.stringify(probe.body) : undefined,
      signal: controller.signal,
    });
    const body = await res.text();
    const ms = Date.now() - started;

    if (!res.ok) {
      return { probe, verdict: 'FAIL', http: String(res.status), ms, sample: '', error: `HTTP ${res.status} ${res.statusText}` };
    }
    // A 200 is not success - the shape has to parse, or the app would ship a broken panel.
    const sample = probe.validate(body, res);
    return { probe, verdict: 'OK', http: String(res.status), ms, sample, error: '' };
  } catch (err) {
    const ms = Date.now() - started;
    const message = err instanceof Error ? (err.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : err.message) : String(err);
    return { probe, verdict: 'FAIL', http: '-', ms, sample: '', error: message };
  } finally {
    clearTimeout(timer);
  }
}

const pad = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));

async function main(): Promise<void> {
  console.log(`\nProbing ${PROBES.length} candidate data sources (concurrency ${CONCURRENCY}, timeout ${TIMEOUT_MS / 1000}s)...\n`);

  const results: Result[] = [];
  for (let i = 0; i < PROBES.length; i += CONCURRENCY) {
    const batch = PROBES.slice(i, i + CONCURRENCY);
    process.stdout.write(`  ... ${i + 1}-${Math.min(i + CONCURRENCY, PROBES.length)} of ${PROBES.length}\r`);
    results.push(...(await Promise.all(batch.map(runProbe))));
  }

  console.log(`${pad('STATUS', 7)}${pad('HTTP', 6)}${pad('MS', 7)}${pad('FREQ', 15)}${pad('SOURCE', 30)}DETAIL`);
  console.log('-'.repeat(140));

  let lastGroup = '';
  for (const r of results) {
    if (r.probe.group !== lastGroup) {
      console.log(`\n  ── ${r.probe.group} ──`);
      lastGroup = r.probe.group;
    }
    const detail = r.verdict === 'OK' ? r.sample : r.verdict === 'SKIP' ? r.sample : r.error;
    console.log(
      `${pad(r.verdict, 7)}${pad(r.http, 6)}${pad(String(r.ms), 7)}${pad(r.probe.frequency, 15)}${pad(r.probe.id, 30)}${detail}`
    );
    if (r.verdict === 'FAIL') console.log(`${' '.repeat(7)}└─ needed for: ${r.probe.purpose}`);
  }

  const ok = results.filter((r) => r.verdict === 'OK');
  const failed = results.filter((r) => r.verdict === 'FAIL');
  const skipped = results.filter((r) => r.verdict === 'SKIP');
  const criticalFailed = failed.filter((r) => r.probe.critical);

  // Per-group coverage, which is what the Fase 8 audit's percentages actually rest on.
  console.log('\n\n  COVERAGE BY GROUP');
  console.log('  ' + '-'.repeat(60));
  const groups = Array.from(new Set(results.map((r) => r.probe.group)));
  for (const group of groups) {
    const rows = results.filter((r) => r.probe.group === group);
    const good = rows.filter((r) => r.verdict === 'OK').length;
    const skip = rows.filter((r) => r.verdict === 'SKIP').length;
    const pct = rows.length === skip ? '-' : `${Math.round((good / (rows.length - skip)) * 100)}%`;
    console.log(`  ${pad(group, 26)} ${good}/${rows.length - skip} reachable  ${pad(pct, 6)}${skip ? `(${skip} skipped)` : ''}`);
  }

  console.log(`\n  ${ok.length} OK · ${failed.length} FAIL · ${skipped.length} SKIP`);

  if (criticalFailed.length > 0) {
    console.log(`\n  ${criticalFailed.length} CRITICAL probe(s) failed - do not build on these yet:`);
    criticalFailed.forEach((r) => console.log(`    - ${r.probe.id}: ${r.error}\n      (${r.probe.purpose})`));
    process.exit(1);
  }

  console.log('\n  All critical probes passed.\n');
  // Explicit exit for the same reason verify-feeds.ts does it: a slow socket left open reads as a
  // hung CI job rather than a passing one.
  process.exit(0);
}

main().catch((err) => {
  console.error('verify-sources failed:', err);
  process.exit(1);
});
