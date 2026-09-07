// Institutional Watchlist full-page task - live production verification, requested by the user
// right after merging Parts A/B/C(partial)/D/E/G to main. Same reason as every other
// verify-*-production.ts script in this repo: this sandbox's egress to the production Render URL
// (and to every exchange it talks to) is confirmed blocked, so the only place to check with REAL
// numbers is a GitHub Actions runner (real internet), via
// .github/workflows/verify-institutional-multiexchange.yml.
//
// What this checks, all against PUBLIC endpoints (no admin auth, no secrets):
//   0. Deploy sync - is Render actually running the commit that triggered this workflow run.
//   1. Part B bug fix - /api/crypto/derivatives for BNB/XRP/ADA/DOGE (previously had no
//      derivatives branch at all - confirms OKX's *-USDT-SWAP instruments genuinely exist for
//      these 4 coins, not just BTC/ETH/SOL).
//   2. Part C - /api/crypto/exchange-ranking for all 7 crypto pairs, specifically whether Gate.io
//      and Bitget (the two exchanges just added) are actually answering, or silently absent like
//      Binance already is (documented HTTP 451 from this host).
//   3. Part E - /api/crypto/market-cap-history (CoinGecko, should be the most reliably-populated
//      one - genuinely free data with no rate-limit-sensitive exchange in the loop).
//   4. Part G - /api/crypto/futures-history (derived from #2's own data - only meaningful once #2
//      has real rows).
//
// This is a REPORTING run, not a pass/fail gate - it prints exactly what production returned so
// the user gets real numbers instead of a guess, then a plain-English summary at the end that
// names which specific pair/exchange/endpoint combination needs a follow-up if any came back
// empty/unavailable.

const BASE_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';

const CRYPTO_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'] as const;
const PART_B_SYMBOLS = ['BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'] as const;
const DERIVATIVES_INSTRUMENT: Record<string, string> = {
  BTCUSDT: 'BTC-USDT-SWAP',
  ETHUSDT: 'ETH-USDT-SWAP',
  SOLUSDT: 'SOL-USDT-SWAP',
  BNBUSDT: 'BNB-USDT-SWAP',
  XRPUSDT: 'XRP-USDT-SWAP',
  ADAUSDT: 'ADA-USDT-SWAP',
  DOGEUSDT: 'DOGE-USDT-SWAP',
};

interface ExchangeRankingRow {
  exchange: string;
  price: number | null;
  volume24hUsd: number | null;
  openInterestUsd: number | null;
  fundingRatePercent: number | null;
  longShortRatio: number | null;
}
interface ExchangeRankingResponse {
  symbol: string;
  rows: ExchangeRankingRow[];
  source: string;
  fetchedAt: string | null;
  stale?: boolean;
  unavailable?: boolean;
  error?: string;
}
interface CryptoDerivativesResponse {
  instrument: string;
  fundingRate: number | null;
  openInterestCcy: number | null;
  fetchedAt: string | null;
  unavailable?: boolean;
  error?: string;
}
interface MarketCapHistoryResponse {
  symbol: string;
  points: Array<{ time: string; price: number; marketCapUsd: number }>;
  unavailable?: boolean;
  error?: string;
}
interface FuturesHistoryPoint {
  time: string;
  weightedFundingRatePercent: number | null;
  totalOpenInterestUsd: number | null;
  totalVolume24hUsd: number | null;
  exchangeCount: number;
}
interface FuturesHistoryResponse {
  symbol: string;
  points: FuturesHistoryPoint[];
  unavailable?: boolean;
  error?: string;
}
interface CryptoEtfHolding {
  ticker: string;
  name: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  aumUsd: number | null;
  expenseRatioPercent: number | null;
  error?: string;
}
interface CryptoEtfOverviewResponse {
  etfs: CryptoEtfHolding[];
  totalVolumeUsd: number | null;
  flowNote: string;
  source: string;
  unavailable?: boolean;
  error?: string;
}

async function fetchJson<T>(path: string): Promise<{ status: number; body: T | null; raw: string }> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'HEVORA-InstitutionalWatchlist-Verify/1.0' } });
  const raw = await res.text();
  let body: T | null = null;
  try {
    body = JSON.parse(raw) as T;
  } catch {
    // leave null - printed via `raw` below
  }
  return { status: res.status, body, raw };
}

function fmtUsd(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  return `$${v.toFixed(2)}`;
}

async function main() {
  console.log('===== Institutional Watchlist full-page - live production verification =====');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log('');

  // --- 0. Deploy sync ---------------------------------------------------------------------
  console.log("--- [0] Deploy sync: production /api/deploy-info commit vs this runner's checked-out commit ---");
  try {
    const { execSync } = await import('node:child_process');
    const localCommit = execSync('git rev-parse HEAD').toString().trim();
    console.log(`This runner is checked out at commit: ${localCommit}`);
    const { status, body } = await fetchJson<{ commit: string | null; branch: string | null }>('/api/deploy-info');
    if (status === 200 && body) {
      console.log(`Production /api/deploy-info: commit=${body.commit ?? '(null)'} branch=${body.branch ?? 'null'}`);
      if (body.commit) {
        console.log(
          body.commit === localCommit
            ? 'VERDICT: MATCH - production is running the exact commit that triggered this workflow run.'
            : `VERDICT: MISMATCH - production is running ${body.commit}, not ${localCommit}. Render has not finished deploying yet - re-run this workflow in a minute or two.`
        );
      }
    } else {
      console.log(`/api/deploy-info returned HTTP ${status} - skipping deploy-sync check.`);
    }
  } catch (err: any) {
    console.log(`Deploy sync check failed: ${err?.message || err}`);
  }
  console.log('');

  // --- 1. Part B: derivatives branch for BNB/XRP/ADA/DOGE ---------------------------------
  console.log('--- [1] Part B fix: /api/crypto/derivatives for BNB/XRP/ADA/DOGE (OKX *-USDT-SWAP) ---');
  const part1Failures: string[] = [];
  for (const symbol of PART_B_SYMBOLS) {
    const instId = DERIVATIVES_INSTRUMENT[symbol];
    const { status, body } = await fetchJson<CryptoDerivativesResponse>(`/api/crypto/derivatives?instId=${instId}`);
    if (status !== 200 || !body) {
      console.log(`${symbol} (${instId}): HTTP ${status} - unexpected, this instrument should always return 200`);
      part1Failures.push(`${symbol}: HTTP ${status}`);
      continue;
    }
    if (body.unavailable) {
      console.log(`${symbol} (${instId}): UNAVAILABLE - ${body.error ?? 'no error message'}`);
      part1Failures.push(`${symbol}: unavailable (${body.error ?? 'no error message'})`);
    } else {
      const fundingBps = body.fundingRate !== null ? (body.fundingRate * 10_000).toFixed(2) : '—';
      console.log(`${symbol} (${instId}): OK - funding=${fundingBps} bps, openInterestCcy=${body.openInterestCcy ?? '—'}`);
    }
  }
  console.log('');

  // --- 2. Part C: exchange ranking, all 7 pairs, with Gate.io/Bitget contribution tally ---
  console.log('--- [2] Part C: /api/crypto/exchange-ranking for all 7 crypto pairs ---');
  const exchangeContribution: Record<string, number> = {};
  const part2EmptySymbols: string[] = [];
  for (const symbol of CRYPTO_SYMBOLS) {
    const { status, body } = await fetchJson<ExchangeRankingResponse>(`/api/crypto/exchange-ranking?symbol=${symbol}`);
    if (status !== 200 || !body) {
      console.log(`${symbol}: HTTP ${status} - unexpected`);
      part2EmptySymbols.push(symbol);
      continue;
    }
    if (body.rows.length === 0) {
      console.log(`${symbol}: 0 rows - ${body.error ?? 'every exchange failed this cycle'}`);
      part2EmptySymbols.push(symbol);
      continue;
    }
    console.log(`${symbol}: ${body.rows.length} row(s)`);
    for (const row of body.rows) {
      exchangeContribution[row.exchange] = (exchangeContribution[row.exchange] ?? 0) + 1;
      console.log(
        `  - ${row.exchange}: price=${row.price ?? '—'} vol24h=${fmtUsd(row.volume24hUsd)} oi=${fmtUsd(row.openInterestUsd)} funding=${
          row.fundingRatePercent !== null ? row.fundingRatePercent.toFixed(4) + '%' : '—'
        } longShort=${row.longShortRatio ?? '—'}`
      );
    }
  }
  console.log('');
  console.log('Exchange contribution tally across all 7 symbols (how many symbols each exchange answered for):');
  for (const [exchange, count] of Object.entries(exchangeContribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${exchange}: ${count}/${CRYPTO_SYMBOLS.length}`);
  }
  for (const exchange of ['Gate.io', 'Bitget']) {
    if (!(exchange in exchangeContribution)) {
      console.log(`  ${exchange}: 0/${CRYPTO_SYMBOLS.length} - NEVER answered this run (geo-blocked, endpoint schema drift, or a genuine outage - needs its own follow-up audit).`);
    }
  }
  console.log('');

  // --- 3. Part E: market cap history --------------------------------------------------------
  console.log('--- [3] Part E: /api/crypto/market-cap-history?symbol=BTCUSDT ---');
  {
    const { status, body } = await fetchJson<MarketCapHistoryResponse>('/api/crypto/market-cap-history?symbol=BTCUSDT');
    if (status === 200 && body && !body.unavailable && body.points.length > 1) {
      const latest = body.points[body.points.length - 1];
      console.log(`OK - ${body.points.length} points, latest: ${latest.time} price=$${latest.price.toFixed(2)} marketCap=${fmtUsd(latest.marketCapUsd)}`);
    } else {
      console.log(`UNAVAILABLE - HTTP ${status}, error=${body?.error ?? 'n/a'}`);
    }
  }
  console.log('');

  // --- 4. Part G: futures history (derived from #2, needs #2 to have real rows) -------------
  console.log('--- [4] Part G: /api/crypto/futures-history?symbol=BTCUSDT ---');
  {
    const { status, body } = await fetchJson<FuturesHistoryResponse>('/api/crypto/futures-history?symbol=BTCUSDT');
    if (status === 200 && body && !body.unavailable) {
      console.log(`OK - ${body.points.length} snapshot(s) recorded so far this deploy (grows one point per ~2min cache cycle this endpoint is polled).`);
      const latest = body.points[body.points.length - 1];
      if (latest) {
        console.log(
          `  latest: weightedFunding=${latest.weightedFundingRatePercent?.toFixed(4) ?? '—'}% totalOi=${fmtUsd(latest.totalOpenInterestUsd)} totalVol24h=${fmtUsd(
            latest.totalVolume24hUsd
          )} exchangeCount=${latest.exchangeCount}`
        );
      }
    } else {
      console.log(`UNAVAILABLE - HTTP ${status}, error=${body?.error ?? 'n/a'}`);
    }
  }
  console.log('');

  // --- 5. Part H: crypto ETF overview (BTCUSDT only) ----------------------------------------
  console.log('--- [5] Part H: /api/crypto/etf-overview (spot Bitcoin ETFs) ---');
  let part5AnsweredCount = 0;
  let part5AumOrExpenseLeaked = false;
  {
    const { status, body } = await fetchJson<CryptoEtfOverviewResponse>('/api/crypto/etf-overview');
    if (status === 200 && body && !body.unavailable) {
      part5AnsweredCount = body.etfs.filter((e) => e.price !== null).length;
      console.log(`OK - ${part5AnsweredCount}/${body.etfs.length} ticker(s) answered, source=${body.source}`);
      for (const e of body.etfs) {
        console.log(
          `  - ${e.ticker}: price=${e.price ?? '—'} change=${e.changePercent !== null ? e.changePercent.toFixed(2) + '%' : '—'} volume=${fmtUsd(e.volume)} aum=${
            e.aumUsd ?? '—'
          } expenseRatio=${e.expenseRatioPercent ?? '—'}${e.error ? ` (error: ${e.error})` : ''}`
        );
        // AUM/expense ratio must NEVER be anything but null - the whole point of Part H's honest-
        // unavailable design is that these two fields are never fabricated/estimated. A non-null
        // value here would mean someone accidentally wired in a guess.
        if (e.aumUsd !== null || e.expenseRatioPercent !== null) part5AumOrExpenseLeaked = true;
      }
      console.log(`  totalVolumeUsd=${fmtUsd(body.totalVolumeUsd)}`);
      console.log(`  flowNote: ${body.flowNote}`);
    } else {
      console.log(`UNAVAILABLE - HTTP ${status}, error=${body?.error ?? 'n/a'}`);
    }
  }
  console.log('');

  // --- Summary -------------------------------------------------------------------------------
  console.log('===== SUMMARY =====');
  console.log(
    part1Failures.length === 0
      ? 'Part B (BNB/XRP/ADA/DOGE derivatives): ALL 4 pairs returned real funding/OI data. OKX genuinely lists all 4 as USDT-margined swaps.'
      : `Part B (BNB/XRP/ADA/DOGE derivatives): ${part1Failures.length}/4 pair(s) came back unavailable - ${part1Failures.join('; ')}.`
  );
  console.log(
    part2EmptySymbols.length === 0
      ? 'Part C (exchange ranking): every one of the 7 pairs got at least 1 exchange row.'
      : `Part C (exchange ranking): ${part2EmptySymbols.length}/7 pair(s) got ZERO rows from any exchange - ${part2EmptySymbols.join(', ')}.`
  );
  console.log(
    ('Gate.io' in exchangeContribution ? `Gate.io answered for ${exchangeContribution['Gate.io']}/7 pairs.` : 'Gate.io answered for 0/7 pairs - investigate (schema drift or blocked).') +
      ' ' +
      ('Bitget' in exchangeContribution ? `Bitget answered for ${exchangeContribution['Bitget']}/7 pairs.` : 'Bitget answered for 0/7 pairs - investigate (schema drift or blocked).')
  );
  console.log(
    part5AumOrExpenseLeaked
      ? 'Part H (ETF overview): BUG - aumUsd/expenseRatioPercent returned non-null for at least one ticker (should always be null - see script comment).'
      : `Part H (ETF overview): ${part5AnsweredCount} ticker(s) answered with real price/volume; AUM/expense ratio correctly null (honest-unavailable) for all.`
  );
}

main().catch((err) => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});
