// URGENT one-off investigation (2026-08-31, "XAUUSD signal stuck - user's real MetaTrader account
// already hit SL but HEVORA Terminal status hasn't updated" bug report). Pulls real current
// production state (this sandbox cannot reach Render directly, same GitHub-Actions-run pattern as
// every other scripts/audit-*.ts in this repo) to determine, from evidence:
//   [A] The XAUUSD signal's exact current status/fields (public /api/signals).
//   [B] Real XAUUSD candle history (public /api/market/candles) - whether HEVORA's OWN data shows
//       price crossing the signal's stopLoss since it was created, independent of MetaTrader.
//   [C] currentPrices.XAUUSD freshness (public /api/prices).
//   [D] candle-freshness/price-source diagnostics (admin /api/admin/xau-candle-health) - rules out
//       (or confirms) a regression from today's earlier XAUUSD data-reliability audit.
// No fabricated conclusions - every number below is read directly from these live responses.

const BASE_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function basicAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).toString('base64');
}

async function main() {
  console.log('===== URGENT: XAUUSD stuck-signal investigation =====');
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log('');

  console.log('--- [A] /api/signals (public) - current XAUUSD signal object ---');
  try {
    const res = await fetch(`${BASE_URL}/api/signals`);
    const data: any = await res.json();
    const sig = data?.signals?.XAUUSD;
    if (!sig) {
      console.log('currentSignals.XAUUSD is null/undefined right now - no active signal object to inspect.');
      console.log(`scanStatus.XAUUSD: ${JSON.stringify(data?.scanStatus?.XAUUSD ?? null)}`);
    } else {
      console.log(JSON.stringify(sig, null, 2));
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [B] /api/market/candles (public) - real XAUUSD candle history ---');
  let candles: Array<{ t: number; o: number; h: number; l: number; c: number }> = [];
  try {
    const res = await fetch(`${BASE_URL}/api/market/candles`);
    const data: any = await res.json();
    candles = data?.candles?.XAUUSD || [];
    console.log(`${candles.length} candles, spanning ${candles.length > 0 ? new Date(candles[0].t).toISOString() : 'n/a'} to ${candles.length > 0 ? new Date(candles[candles.length - 1].t).toISOString() : 'n/a'}`);
    if (candles.length > 0) {
      const overallHigh = Math.max(...candles.map((c) => c.h));
      const overallLow = Math.min(...candles.map((c) => c.l));
      console.log(`Overall high/low across all retained candles: high=${overallHigh} low=${overallLow}`);
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [C] /api/prices (public) - currentPrices.XAUUSD ---');
  try {
    const res = await fetch(`${BASE_URL}/api/prices`);
    const data: any = await res.json();
    console.log(JSON.stringify(data?.XAUUSD ?? null, null, 2));
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [D] /api/admin/xau-candle-health (admin) - freshness/regression check ---');
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
  console.log('===== End of stuck-signal investigation =====');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
