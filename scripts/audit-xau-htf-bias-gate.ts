// 2026-09-03 HTF bias & directional gate redesign - audit script confirming hypothesis 1 with real
// production data: exactly how many real days does XAU_CANDLE_ARCHIVE_KEY
// (hevora:candlearchive:XAUUSD:5m) actually hold right now, via the PUBLIC (no admin auth)
// /api/market/xau-archive endpoint (see server.ts's own comment on that route). This sandbox's
// egress to the production Render URL is blocked (confirmed repeatedly on this project - same
// "CONNECT tunnel failed, 403" restriction documented in verify-xau-production.ts/
// audit-xau-history-summary.ts), so this only ever runs on GitHub Actions' own runners via
// .github/workflows/audit-xau-htf-bias-gate.yml.
//
// This directly answers: is the production archive mature enough yet for the new D1 bias tier
// (XAU_D1_MIN_REAL_DAYS = 7 in server.ts) to actually activate, or is it still honestly reporting
// "insufficient data" as designed? No numbers here are invented - whatever the endpoint returns is
// reported as-is, including an honest "not enough yet" if that's what it is.

const BASE_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';
const XAU_D1_MIN_REAL_DAYS = 7; // must match server.ts's constant of the same name exactly

interface XauArchiveResponse {
  pairId: string;
  candles: { t: number; o: number; h: number; l: number; c: number }[];
  count: number;
  source: string;
  oldestArchivedTime: string | null;
  newestArchivedTime: string | null;
  fetchedAt: string;
}

async function fetchArchive(limit: number): Promise<XauArchiveResponse> {
  const url = `${BASE_URL}/api/market/xau-archive?limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'HEVORA-XAU-HTF-Bias-Gate-Audit/1.0' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status} - body: ${text.slice(0, 300)}`);
  let json: XauArchiveResponse;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${url} -> response was not valid JSON: ${text.slice(0, 300)}`);
  }
  return json;
}

function countRealDistinctUtcDays(candles: { t: number }[]): number {
  const days = new Set<string>();
  for (const c of candles) days.add(new Date(c.t).toISOString().slice(0, 10));
  return days.size;
}

async function main() {
  console.log('===== XAUUSD candle archive depth audit (hypothesis 1 confirmation) =====');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Run at: ${new Date().toISOString()}`);

  // Max limit the endpoint accepts (5000 bars = ~17.4 real days at one bar every 5 minutes,
  // 24/7 - gold trades close to 24/5, so real coverage will be a bit less than that ceiling even
  // once the archive is old enough to hit it).
  const resp = await fetchArchive(5000);
  console.log(`\nreported count: ${resp.count} archived 5-minute bars`);
  console.log(`source: ${resp.source}`);
  console.log(`oldestArchivedTime: ${resp.oldestArchivedTime}`);
  console.log(`newestArchivedTime: ${resp.newestArchivedTime}`);

  if (resp.count === 0) {
    console.log('\nArchive is currently EMPTY. D1 bias tier is honestly reporting insufficient data (0 real days available; needs >= 7).');
    return;
  }

  const realDays = countRealDistinctUtcDays(resp.candles);
  console.log(`\nReal distinct UTC calendar days represented in the archive: ${realDays}`);
  console.log(`XAU_D1_MIN_REAL_DAYS threshold (server.ts): ${XAU_D1_MIN_REAL_DAYS}`);
  if (realDays >= XAU_D1_MIN_REAL_DAYS) {
    console.log(`=> D1 bias tier SHOULD be active in production right now (${realDays} >= ${XAU_D1_MIN_REAL_DAYS} real days). Cross-check against /api/admin/xau-candle-health or server logs if it still reports unavailable.`);
  } else {
    console.log(`=> D1 bias tier correctly reports INSUFFICIENT DATA right now (${realDays} < ${XAU_D1_MIN_REAL_DAYS} real days) - this is the honest, expected state this soon after the archive feature shipped (2026-09-01). It will activate automatically once the archive accumulates ${XAU_D1_MIN_REAL_DAYS - realDays} more real day(s), with zero further code changes needed.`);
  }

  if (resp.oldestArchivedTime && resp.newestArchivedTime) {
    const spanMs = new Date(resp.newestArchivedTime).getTime() - new Date(resp.oldestArchivedTime).getTime();
    const spanHours = spanMs / 3_600_000;
    console.log(`\nWall-clock span oldest->newest: ${spanHours.toFixed(1)} hours (${(spanHours / 24).toFixed(2)} days).`);
    console.log('Compare this to the OLD H1 bias window this task audited (xauTrendFromAggregatedBars\' own 8-bar slice = 8 HOURS for the h1 tier, ~2 hours for m15) and the NEW H4 tier (~24h, bounded by candleStore.XAUUSD\'s own 300-bar/~25h retention) - see the PR/commit description for the full before/after reasoning.');
  }

  console.log('\n===== Done =====');
  console.log('These are the real, current production archive numbers as of this run - not assumed, not backfilled. If the archive is still thin, that confirms (rather than contradicts) this task\'s design decision to keep the D1 tier honestly gated on real day-count rather than fabricating a daily trend read from insufficient history.');
}

main().catch((err) => {
  console.error('FATAL:', err?.message || err);
  process.exit(1);
});
