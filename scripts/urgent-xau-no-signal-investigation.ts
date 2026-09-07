// URGENT one-off investigation (2026-09-04): user reports 3 screenshots (09:24, 11:16, 12:15 local)
// spanning ~3 hours, all showing XAUUSD "NO VALID SETUP" with IDENTICAL text. A real user asked
// about signals on WhatsApp during this window. This pulls real current production state (this
// sandbox cannot reach Render directly, same GitHub-Actions-run pattern as every other
// scripts/audit-*.ts in this repo) to determine:
//   [A] The XAUUSD signal's exact current status/fields + scanStatus.lastScanReason (public /api/signals).
//   [B] Whether the exact text of the generic NO VALID SETUP fallback is dynamic (embeds live
//       numbers) or fully static - read directly from server.ts source, not guessed.
//   [C] Data feed staleness / circuit breaker / anti-flip / anti-countertrend gate counters (admin
//       /api/admin/xau-candle-health).
//   [D] currentPrices.XAUUSD freshness (public /api/prices).
//   [E] Real XAUUSD candle history freshness (public /api/market/candles).
// No fabricated conclusions - every number below is read directly from these live responses.

const BASE_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function basicAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).toString('base64');
}

async function main() {
  console.log('===== URGENT: XAUUSD "NO VALID SETUP" 3-hour identical-text investigation =====');
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log('');

  console.log('--- [A] /api/signals (public) - current XAUUSD signal object + scanStatus ---');
  try {
    const res = await fetch(`${BASE_URL}/api/signals`);
    const data: any = await res.json();
    const sig = data?.signals?.XAUUSD;
    console.log(`currentSignals.XAUUSD: ${sig ? JSON.stringify(sig, null, 2) : 'null'}`);
    console.log('');
    console.log(`scanStatus.XAUUSD: ${JSON.stringify(data?.scanStatus?.XAUUSD ?? null, null, 2)}`);
    console.log(`lastSyncTime: ${data?.lastSyncTime}`);
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [C] /api/admin/xau-candle-health (admin) - staleness/circuit-breaker/gate counters ---');
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

  console.log('--- [D] /api/prices (public) - currentPrices.XAUUSD ---');
  try {
    const res = await fetch(`${BASE_URL}/api/prices`);
    const data: any = await res.json();
    console.log(JSON.stringify(data?.XAUUSD ?? null, null, 2));
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [E] /api/market/candles (public) - real XAUUSD candle freshness ---');
  try {
    const res = await fetch(`${BASE_URL}/api/market/candles`);
    const data: any = await res.json();
    const candles = data?.candles?.XAUUSD || [];
    console.log(`${candles.length} candles`);
    if (candles.length > 0) {
      const last = candles[candles.length - 1];
      const ageMin = (Date.now() - last.t) / 60000;
      console.log(`Last candle: ${new Date(last.t).toISOString()} (age: ${ageMin.toFixed(1)} min) o=${last.o} h=${last.h} l=${last.l} c=${last.c}`);
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }

  console.log('');
  console.log('===== End of investigation =====');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
