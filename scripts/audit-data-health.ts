// One-off investigation (2026-08-31, "news still stuck + broad audit" task): a single real,
// comprehensive snapshot of every data-supplying module's health, run via GitHub Actions (real
// internet - this sandbox cannot reach Render). Combines:
//   - /api/admin/data-health (admin-auth) - the ~18-provider aggregate health board already built
//     into the app (Yahoo FX/gold/commodities/DXY, OKX crypto+order books, Bybit fallback, FRED,
//     CFTC COT, DefiLlama, Fear&Greed, CoinGecko, EIA, WGC gold) - LIVE/DELAYED/STALE/UNAVAILABLE
//     per provider, computed server-side from real lastUpdated timestamps.
//   - /api/calendar (public) - economic calendar freshness (`stale`, `lastFetchedAt`).
//   - /api/live-events?limit=5 (public) - the actual current age of the newest published news
//     item, the real number behind "kenapa masih '1 hari lalu'".
//   - /api/admin/xau-candle-health (admin-auth) + /api/signals scanStatus.XAUUSD (public) -
//     2026-08-31 XAUUSD data-reliability audit: real evidence of whether XAUUSD is currently being
//     held back by the candle-freshness DATA gate specifically (as opposed to a deliberate
//     market-condition gate like the Volatility Regime Gate or a genuine NO VALID SETUP), plus the
//     staleGate trigger counter for how often this has happened since the process last restarted.
// No fabricated numbers - every figure printed here comes straight from a live response.

const BASE_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function basicAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).toString('base64');
}

async function main() {
  console.log('===== Broad data-health audit (2026-08-31) =====');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log('');

  console.log('--- [A] /api/admin/data-health (aggregate provider board, ~18 rows) ---');
  try {
    const res = await fetch(`${BASE_URL}/api/admin/data-health`, { headers: { Authorization: basicAuthHeader() } });
    if (!res.ok) {
      console.log(`FAILED: HTTP ${res.status}`);
    } else {
      const data: any = await res.json();
      console.log(`generatedAt: ${data.generatedAt}`);
      for (const row of data.rows || []) {
        console.log(`  [${row.status}] ${row.provider} - ${row.detail}`);
      }
      const notLive = (data.rows || []).filter((r: any) => r.status !== 'LIVE');
      console.log('');
      console.log(`${notLive.length} / ${(data.rows || []).length} providers NOT in LIVE status right now:`);
      for (const row of notLive) console.log(`  [${row.status}] ${row.provider} - ${row.detail}`);
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [A2] /api/crypto/dominance direct probe (CoinGecko - why "never fetched successfully"?) ---');
  try {
    const res = await fetch(`${BASE_URL}/api/crypto/dominance`);
    const data: any = await res.json().catch(() => null);
    console.log(`HTTP ${res.status} | body: ${JSON.stringify(data)}`);
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [B] /api/calendar (economic calendar freshness) ---');
  try {
    const res = await fetch(`${BASE_URL}/api/calendar`);
    const data: any = await res.json();
    console.log(`HTTP ${res.status} | stale=${data.stale} | lastFetchedAt=${data.lastFetchedAt} | events=${Array.isArray(data.events) ? data.events.length : 'n/a'}`);
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [C] /api/live-events?limit=5 (real news freshness right now) ---');
  try {
    const res = await fetch(`${BASE_URL}/api/live-events?limit=5`);
    const data: any = await res.json();
    const events = Array.isArray(data) ? data : (data?.events ?? []);
    if (events.length === 0) {
      console.log('No events returned.');
    } else {
      const nowMs = Date.now();
      for (const e of events) {
        const ageMin = (nowMs - new Date(e.createdAt).getTime()) / 60000;
        console.log(`  ${e.createdAt} (${ageMin < 60 ? ageMin.toFixed(1) + 'min' : (ageMin / 60).toFixed(2) + 'h'} ago) | impact=${e.impact} | "${e.title}"`);
      }
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }

  console.log('');
  console.log('--- [D] /api/admin/xau-candle-health (XAUUSD data-reliability audit, 2026-08-31) ---');
  try {
    const res = await fetch(`${BASE_URL}/api/admin/xau-candle-health`, { headers: { Authorization: basicAuthHeader() } });
    if (!res.ok) {
      console.log(`FAILED: HTTP ${res.status}`);
    } else {
      const data: any = await res.json();
      console.log(`candleCount=${data.candleCount} | newestCandleAgeMinutes=${data.newestCandleAgeMinutes} | largestGapMinutes=${data.largestGapMinutes}`);
      console.log(`priceFeed: price=${data.priceFeed?.price} ageSeconds=${data.priceFeed?.ageSeconds} isStale=${data.priceFeed?.isStale}`);
      console.log(`yahooGoldFetch: consecutiveFailures=${data.yahooGoldFetch?.consecutiveFailures} cooldownActive=${data.yahooGoldFetch?.cooldownActive}`);
      console.log(`staleGate (real evidence, this process lifetime only - resets on restart): triggerCountSinceProcessStart=${data.staleGate?.triggerCountSinceProcessStart} lastTriggeredAt=${data.staleGate?.lastTriggeredAt ?? '(never)'}`);
      console.log(`warning: ${data.warning ?? '(none - candles are fresh)'}`);
      // 2026-08-31 follow-up: proves which XAUUSD price source (Yahoo/gold-api.com) is CURRENTLY
      // feeding the header/ticker/watchlist price - not assumed, read straight off
      // recordXauPriceSource's real-time tracking.
      // 2026-08-31 (later same day, explicit user decision): the third source this used to also
      // report on, a PAXGUSDT emergency fallback, was removed entirely - see server.ts's fetchGold
      // comment for the trade-off. `bothSourcesFailed` below is its replacement: how often Yahoo
      // AND gold-api.com have both failed on the same tick, now that there's no fallback left.
      const ps = data.priceSource;
      console.log(`priceSource.current (what the header/ticker is reading RIGHT NOW): ${ps?.current ?? '(no successful fetch yet this process lifetime)'} (last updated ${ps?.lastUpdatedAt ?? 'n/a'})`);
      console.log(`Both XAUUSD price sources failed (no fallback remains): countSinceProcessStart=${ps?.bothSourcesFailed?.countSinceProcessStart} | lastAt=${ps?.bothSourcesFailed?.lastAt ?? '(never)'}`);
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [E] /api/signals scanStatus.XAUUSD (public - is XAUUSD blocked right now, and why?) ---');
  try {
    const res = await fetch(`${BASE_URL}/api/signals`);
    const data: any = await res.json();
    const hasActiveSignal = Boolean(data?.signals?.XAUUSD);
    const scanStatus = data?.scanStatus?.XAUUSD;
    console.log(`HTTP ${res.status} | XAUUSD has an active signal right now: ${hasActiveSignal}`);
    if (!hasActiveSignal && scanStatus) {
      console.log(`lastScanAt=${scanStatus.lastScanAt}`);
      console.log(`lastScanReason=${scanStatus.lastScanReason ?? '(none recorded)'}`);
      const reasonIsDataStale = typeof scanStatus.lastScanReason === 'string' && scanStatus.lastScanReason.includes('Data candle XAUUSD basi');
      console.log(`Is the CURRENT reason specifically the data-staleness gate (not a market-condition/NO VALID SETUP gate)? ${reasonIsDataStale}`);
    } else if (!hasActiveSignal) {
      console.log('No active signal and no scanStatus recorded (engine may not have run a scan cycle yet, or a signal was just created/cleared).');
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }

  console.log('');
  console.log('===== End of broad data-health audit =====');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
