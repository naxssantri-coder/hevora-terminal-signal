// URGENT one-off investigation (2026-09-04 user bug report): a XAUUSD signal (entry
// 4445.10-4447.30, TP1 4430.30) reportedly had price visibly cross TP1 on the TradingView chart
// (~4429.605) while HEVORA Terminal's own status stayed "Berjalan" (Running) - TP1 never recorded
// as hit. The user also reports the header/ticker price looking out of sync with the TradingView
// chart in general.
//
// Goal: find the REAL signal (current or historical) matching those levels straight from
// production - never assume its direction/status from the report, read it from the record itself
// - then check every source that feeds a displayed XAUUSD price against each other:
//   [A] /api/signals - current XAUUSD signal object (if this exact signal is still live).
//   [B] /api/history?pairId=XAUUSD - search recent closed/active records for a level match.
//   [C] /api/market/candles - HEVORA's own self-built XAUUSD candles: did HIGH/LOW ever actually
//       reach the TP1 level since the signal's createdAt, per HEVORA's own tick-built data?
//   [D] /api/prices - currentPrices.XAUUSD right now (what the header/ticker is reading).
//   [E] /api/admin/xau-candle-health - which source (gold-api.com/Yahoo) is currently feeding the
//       price, candle staleness, largest gap.
//   [F] Independent reference quotes fetched directly from this runner (real internet access) -
//       gold-api.com and Yahoo XAUUSD=X/GC=F - to measure genuine source-to-source spread right
//       now, since TradingView itself has no public quote API to compare against directly.
//
// This sandbox cannot reach the production Render URL directly (confirmed, same restriction as
// gold-api.com/Yahoo/Binance - see verify-xau-production.yml's own comment), so this runs on
// GitHub Actions.

const BASE_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// The levels reported by the user - used to SEARCH for the record, never assumed.
const REPORTED_ENTRY_MIN = 4445.10;
const REPORTED_ENTRY_MAX = 4447.30;
const REPORTED_TP1 = 4430.30;
const LEVEL_MATCH_TOLERANCE = 0.5; // dollars - generous enough for float/rounding noise, tight enough to be a real match

function basicAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).toString('base64');
}

function closeEnough(a: number | undefined | null, b: number): boolean {
  if (a === undefined || a === null) return false;
  return Math.abs(a - b) <= LEVEL_MATCH_TOLERANCE;
}

async function main() {
  console.log('===== XAUUSD price desync investigation =====');
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log(`Searching for entry ~${REPORTED_ENTRY_MIN}-${REPORTED_ENTRY_MAX}, TP1 ~${REPORTED_TP1}`);
  console.log('');

  let matchedSignal: any = null;
  let matchedFrom: 'current' | 'history' | null = null;

  console.log('--- [A] /api/signals (public) - current XAUUSD signal object ---');
  try {
    const res = await fetch(`${BASE_URL}/api/signals`);
    const data: any = await res.json();
    const sig = data?.signals?.XAUUSD;
    if (!sig) {
      console.log('currentSignals.XAUUSD is null/undefined right now.');
    } else {
      console.log(JSON.stringify(sig, null, 2));
      if (closeEnough(sig.entryMin, REPORTED_ENTRY_MIN) && closeEnough(sig.entryMax, REPORTED_ENTRY_MAX) && closeEnough(sig.takeProfit1, REPORTED_TP1)) {
        matchedSignal = sig;
        matchedFrom = 'current';
        console.log('>>> MATCH: this is the reported signal, still live in currentSignals.XAUUSD.');
      } else {
        console.log('(No level match against the reported signal - it has since resolved/rotated, or the report predates this run.)');
      }
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [B] /api/history?pairId=XAUUSD (public) - search recent records for a level match ---');
  try {
    const res = await fetch(`${BASE_URL}/api/history?pairId=XAUUSD`);
    const data: any = await res.json();
    const records: any[] = data?.history || [];
    console.log(`${records.length} XAUUSD history records total.`);
    const candidates = records.filter(
      (r) => closeEnough(r.entryAvg, (REPORTED_ENTRY_MIN + REPORTED_ENTRY_MAX) / 2) || (closeEnough(r.takeProfit1, REPORTED_TP1))
    );
    console.log(`${candidates.length} candidate record(s) with entryAvg or takeProfit1 near the reported levels:`);
    for (const c of candidates.slice(0, 10)) {
      console.log(JSON.stringify(c, null, 2));
    }
    if (!matchedSignal && candidates.length > 0) {
      matchedSignal = candidates[0];
      matchedFrom = 'history';
      console.log('>>> Using the first candidate above as the matched record (closest to reported levels).');
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  if (matchedSignal) {
    console.log(`--- Matched signal source: ${matchedFrom} ---`);
    console.log(`type=${matchedSignal.type} entryAvg=${matchedSignal.entryAvg} entryMin=${matchedSignal.entryMin} entryMax=${matchedSignal.entryMax}`);
    console.log(`takeProfit1=${matchedSignal.takeProfit1} takeProfit2=${matchedSignal.takeProfit2} stopLoss=${matchedSignal.stopLoss}`);
    console.log(`status=${matchedSignal.status ?? matchedSignal.outcomeCategory} createdAt=${matchedSignal.createdAt}`);
    console.log(`history: ${JSON.stringify(matchedSignal.history || [], null, 2)}`);
  } else {
    console.log('--- No matching signal found in [A] or [B] - proceeding with general source-desync checks only. ---');
  }
  console.log('');

  console.log('--- [C] /api/market/candles (public) - HEVORA own XAUUSD candles vs reported TP1 level ---');
  try {
    const res = await fetch(`${BASE_URL}/api/market/candles`);
    const data: any = await res.json();
    const candles: Array<{ t: number; o: number; h: number; l: number; c: number }> = data?.candles?.XAUUSD || [];
    console.log(`${candles.length} candles, spanning ${candles.length > 0 ? new Date(candles[0].t).toISOString() : 'n/a'} to ${candles.length > 0 ? new Date(candles[candles.length - 1].t).toISOString() : 'n/a'}`);
    if (candles.length > 0) {
      const overallHigh = Math.max(...candles.map((c) => c.h));
      const overallLow = Math.min(...candles.map((c) => c.l));
      console.log(`Overall high/low across all retained candles: high=${overallHigh} low=${overallLow}`);

      const createdAtMs = matchedSignal?.createdAt ? new Date(matchedSignal.createdAt).getTime() : null;
      if (createdAtMs !== null) {
        const sinceCreation = candles.filter((c) => c.t >= createdAtMs);
        console.log(`${sinceCreation.length} candles since matched signal's createdAt (${matchedSignal.createdAt}).`);
        if (sinceCreation.length > 0) {
          const lowSinceCreation = Math.min(...sinceCreation.map((c) => c.l));
          const highSinceCreation = Math.max(...sinceCreation.map((c) => c.h));
          console.log(`Low since creation: ${lowSinceCreation} | High since creation: ${highSinceCreation}`);
          console.log(`Reported TP1: ${REPORTED_TP1}`);
          if (matchedSignal.type === 'SELL') {
            console.log(lowSinceCreation <= REPORTED_TP1
              ? '>>> HEVORA own candle LOW already reached/crossed the reported TP1 level - if status is still not TP1-hit, that is a genuine internal bug (detection logic issue), NOT a data-source gap.'
              : '>>> HEVORA own candle LOW never reached the reported TP1 level. Its own tick-built data genuinely never saw this price - consistent with a source-lag/missed-wick desync vs the real market (e.g. TradingView/broker feed), not a detection-logic bug.');
          } else if (matchedSignal.type === 'BUY') {
            console.log(highSinceCreation >= REPORTED_TP1
              ? '>>> HEVORA own candle HIGH already reached/crossed the reported TP1 level - if status is still not TP1-hit, that is a genuine internal bug (detection logic issue), NOT a data-source gap.'
              : '>>> HEVORA own candle HIGH never reached the reported TP1 level. Its own tick-built data genuinely never saw this price - consistent with a source-lag/missed-wick desync vs the real market, not a detection-logic bug.');
          }
        }
      } else {
        console.log('(No matched signal createdAt available - skipping since-creation high/low check.)');
      }
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [D] /api/prices (public) - currentPrices.XAUUSD right now ---');
  let hevoraPrice: number | null = null;
  try {
    const res = await fetch(`${BASE_URL}/api/prices`);
    const data: any = await res.json();
    console.log(JSON.stringify(data?.XAUUSD ?? null, null, 2));
    hevoraPrice = data?.XAUUSD?.price ?? null;
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [E] /api/admin/xau-candle-health (admin) - source/staleness diagnostics ---');
  try {
    const res = await fetch(`${BASE_URL}/api/admin/xau-candle-health`, { headers: { Authorization: basicAuthHeader() } });
    if (!res.ok) {
      console.log(`FAILED: HTTP ${res.status}`);
    } else {
      const data: any = await res.json();
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [F] Independent reference quotes fetched directly from this runner ---');
  let goldApiPrice: number | null = null;
  let yahooPrice: number | null = null;
  try {
    const res = await fetch('https://api.gold-api.com/price/XAU', { headers: { 'User-Agent': 'Mozilla/5.0 (HEVORA Terminal Audit)' } });
    if (res.ok) {
      const data: any = await res.json();
      goldApiPrice = typeof data?.price === 'number' ? data.price : null;
      console.log(`gold-api.com XAU spot: ${goldApiPrice}`);
    } else {
      console.log(`gold-api.com FAILED: HTTP ${res.status}`);
    }
  } catch (e: any) {
    console.log(`gold-api.com FAILED: ${e?.message || e}`);
  }
  try {
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HEVORA/1.0' },
    });
    if (res.ok) {
      const data: any = await res.json();
      yahooPrice = data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
      console.log(`Yahoo GC=F (gold futures, ~1% cost-of-carry basis above real spot): ${yahooPrice}`);
    } else {
      console.log(`Yahoo GC=F FAILED: HTTP ${res.status}`);
    }
  } catch (e: any) {
    console.log(`Yahoo GC=F FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- Spread summary (this instant only, NOT the moment of the reported incident) ---');
  if (hevoraPrice !== null && goldApiPrice !== null) {
    console.log(`HEVORA (currentPrices.XAUUSD) vs gold-api.com (direct from this runner): ${(hevoraPrice - goldApiPrice).toFixed(3)}`);
  }
  if (hevoraPrice !== null && yahooPrice !== null) {
    console.log(`HEVORA vs Yahoo GC=F (futures, has cost-of-carry basis - not a clean apples-to-apples): ${(hevoraPrice - yahooPrice).toFixed(3)}`);
  }
  console.log('Note: this only proves how much gold-api.com/Yahoo can differ from each other/HEVORA RIGHT NOW, as a sanity reference for plausible spread size - it cannot reconstruct the exact spread at the moment of the reported incident, which already scrolled past HEVORA\'s own rolling candle window and any provider\'s own tick history.');
  console.log('');

  console.log('===== End of investigation =====');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
