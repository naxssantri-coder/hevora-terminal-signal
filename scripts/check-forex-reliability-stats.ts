// Reads GET /api/admin/forex-reliability-stats (server.ts) - see recordForexReliabilityOutcome's
// own header comment for exactly what this measures. Needs ADMIN_USERNAME/ADMIN_PASSWORD (same
// secrets audit-data-health.yml/live-intel-watcher.yml already use), since the endpoint is
// requireAdminAuth-gated. This sandbox cannot reach the production Render URL directly, so this
// only ever runs via GitHub Actions - same established workaround as every other investigation
// script in this repo.

const PRODUCTION_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function main() {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.error('FATAL: ADMIN_USERNAME/ADMIN_PASSWORD not set.');
    process.exit(1);
  }
  const url = `${PRODUCTION_URL}/api/admin/forex-reliability-stats`;
  console.log('===== Forex Yahoo-fetch reliability stats =====');
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log(`GET ${url}`);
  const auth = Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).toString('base64');
  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(45_000) });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      console.log(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 300)}`);
      return;
    }
    console.log(`HTTP ${res.status}`);
    console.log(`startedAt=${json.startedAt}`);
    console.log(`elapsedHours=${json.elapsedHours}`);
    for (const [pairId, stat] of Object.entries<any>(json.pairs || {})) {
      console.log(`${pairId}: success=${stat.success} failure=${stat.failure} totalCycles=${stat.totalCycles} failureRatePct=${stat.failureRatePct}`);
    }
  } catch (e: any) {
    console.log(`FETCH FAILED: ${e?.message || e}`);
  }
}

main().catch((err) => {
  console.error('FATAL:', err?.message || err);
  process.exit(1);
});
