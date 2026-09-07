// Bagian J follow-up (2026-09-01): the user asked for the REAL, current candle count in the
// permanent forex archive (EUR/USD, USD/CHF, USD/CAD, GBP/USD) since the real-bars-only fix
// shipped (commit 6a9742c), to decide whether it's safe to migrate those pairs' charts onto
// LightweightChart now. This sandbox cannot reach the production Render URL directly (confirmed
// repeatedly on this project), so this only ever runs via GitHub Actions (real internet access) -
// same established workaround as every other investigation script in this repo. Hits
// /api/market/forex-archive, a PUBLIC unauthenticated GET endpoint - no secrets needed.

const PRODUCTION_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';
const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDCHF', 'USDCAD'] as const;
const CRYPTO_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const;

async function checkPair(pairId: string, endpoint: 'forex-archive' | 'crypto-archive') {
  const url = `${PRODUCTION_URL}/api/market/${endpoint}?pairId=${pairId}&limit=5000`;
  console.log(`\n=== ${pairId} ===`);
  console.log(`GET ${url}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      console.log(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 300)}`);
      return;
    }
    console.log(`HTTP ${res.status}`);
    console.log(`count=${json.count}`);
    console.log(`oldestArchivedTime=${json.oldestArchivedTime}`);
    console.log(`newestArchivedTime=${json.newestArchivedTime}`);
    console.log(`source=${json.source}`);

    // Sanity check (2026-09-01 follow-up): count=5000 (the request limit) spanning a suspiciously
    // short oldest-to-newest window would mean far more than 1 bar/minute is being archived - a
    // real correctness question, not just "is there enough history". Compute the actual median gap
    // between consecutive archived bars from the real candle array itself, not just the two
    // boundary timestamps, so a few outliers don't hide a genuine duplication bug (or mask one).
    const candles: Array<{ t: number }> = json.candles || [];
    if (candles.length >= 3) {
      const deltasSec: number[] = [];
      for (let i = 1; i < candles.length; i++) deltasSec.push((candles[i].t - candles[i - 1].t) / 1000);
      const sorted = [...deltasSec].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const under30s = deltasSec.filter((d) => d < 30).length;
      console.log(`inter-bar gap (seconds), WHOLE archive: median=${median} min=${min} max=${max}, gaps under 30s: ${under30s}/${deltasSec.length}`);

      // A large corrupted history can dominate the aggregate stats above even after the fix
      // deploys and starts appending clean entries - the fix's own effect only shows up at the
      // very TAIL of the list. Print the last 10 raw deltas explicitly so that's visible directly,
      // not inferred from an aggregate that's still 99%+ old data.
      const tailDeltas = deltasSec.slice(-10);
      console.log(`last 10 inter-bar gaps (seconds), TAIL only: [${tailDeltas.join(', ')}]`);
    }
  } catch (e: any) {
    console.log(`FETCH FAILED: ${e?.message || e}`);
  }
}

async function main() {
  console.log('===== Forex + crypto candle archive status check (Bagian J) =====');
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log('\n----- Forex (1m native) -----');
  for (const pairId of FOREX_PAIRS) {
    await checkPair(pairId, 'forex-archive');
  }
  console.log('\n----- Crypto (5m native) - same fire-and-forget archiving pattern, checking for the same race -----');
  for (const pairId of CRYPTO_PAIRS) {
    await checkPair(pairId, 'crypto-archive');
  }
  console.log('\n\n===== Done. See per-pair counts above - real numbers, not estimated. =====');
}

main().catch((err) => {
  console.error('FATAL:', err?.message || err);
  process.exit(1);
});
