// One-time cleanup (2026-09-01, Bagian J follow-up): the forex candle archive (EUR/USD, GBP/USD,
// USD/CHF, USD/CAD) was corrupted by a fire-and-forget race in archiveForexClosedBarsIfNew (see
// server.ts's own comment on the fix, commit 6d80d76) - confirmed via check-forex-archive-status.ts
// against real production data (median inter-bar gap of 0s, thousands of duplicate/out-of-order
// entries). Now that the race is fixed, this clears the 4 corrupted archive keys via the admin
// endpoint (POST /api/admin/clear-candle-archive, requireAdminAuth-gated) so each rebuilds clean
// from empty on the next successful Yahoo fetch cycle. Needs ADMIN_USERNAME/ADMIN_PASSWORD (same
// secrets live-intel-watcher.yml/audit-data-health.yml already use). This sandbox cannot reach the
// production Render URL directly, so this only ever runs via GitHub Actions.

const PRODUCTION_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDCHF', 'USDCAD'] as const;

async function clearPair(pairId: string) {
  const url = `${PRODUCTION_URL}/api/admin/clear-candle-archive?pairId=${pairId}&interval=1m`;
  console.log(`\n=== ${pairId} ===`);
  console.log(`POST ${url}`);
  const auth = Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).toString('base64');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    console.log(`HTTP ${res.status}: ${text}`);
  } catch (e: any) {
    console.log(`REQUEST FAILED: ${e?.message || e}`);
  }
}

async function main() {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.error('FATAL: ADMIN_USERNAME/ADMIN_PASSWORD not set.');
    process.exit(1);
  }
  console.log('===== Clearing corrupted forex candle archives (Bagian J follow-up) =====');
  console.log(`Run at: ${new Date().toISOString()}`);
  for (const pairId of FOREX_PAIRS) {
    await clearPair(pairId);
  }
  console.log('\n\n===== Done. Each archive rebuilds from empty on the next successful Yahoo fetch. =====');
}

main().catch((err) => {
  console.error('FATAL:', err?.message || err);
  process.exit(1);
});
