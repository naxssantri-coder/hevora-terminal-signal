// Bagian E, Task 2 (2026-09-01 chart+RR engine audit): pull REAL production XAUUSD signal history
// and report win-rate/SL-hit numbers honestly - not assumed from the user's own recollection, not
// asserted from a backtest. This sandbox's egress to the production Render URL is blocked
// (confirmed: `curl` gets "CONNECT tunnel failed, response 403", same as every other external
// domain on this project), so this only ever runs on GitHub Actions' own runners via
// .github/workflows/audit-xau-history-summary.yml - same established workaround as
// scripts/verify-xau-production.ts.
//
// Hits the PUBLIC /api/history/summary endpoint (see buildHistorySummaryResponse in server.ts) -
// no admin auth, no secrets needed. Reports exactly what that endpoint computes, nothing invented:
// totalSignals, fullTpCount (TP2/Full TP), tp1SlCount (TP1 hit then scratched/SL), directSlCount
// (SL hit with no TP touched at all), invalidatedCount, winRate, nonLossRate - for range=week and
// range=month, pairId=XAUUSD only.
//
// One honest limitation stated up front: buildHistorySummaryResponse's directSlCount bucket means
// "closed via Stop Loss Hit / Direct SL category" - it does NOT by itself distinguish "SL hit
// before ever touching TP1" from "SL hit after a partial TP1" (that second case already has its
// own bucket, tp1SlCount, so directSlCount IS effectively the "SL hit before any TP" number the
// task asks for) - but it doesn't reveal, for example, whether price came within pips of TP1 before
// reversing. That finer-grained "how close were the near-misses" question is out of scope for this
// endpoint and is not answered here - only the categorical counts this endpoint actually reports.

const BASE_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';

interface HistorySummary {
  totalSignals: number;
  winRate: number;
  nonLossRate: number;
  fullTpCount: number;
  tp1SlCount: number;
  directSlCount: number;
  invalidatedCount: number;
  avgRiskReward: number;
  totalRMultiple: number;
  pairBreakdown: Record<string, { count: number; winRate: number; nonLossRate: number; totalRMultiple: number; avgRMultiple: number }>;
}

interface HistorySummaryResponse {
  success: boolean;
  range: string;
  summary: HistorySummary;
}

async function fetchSummary(range: string): Promise<HistorySummaryResponse> {
  const url = `${BASE_URL}/api/history/summary?pairId=XAUUSD&range=${range}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'HEVORA-XAU-History-Audit/1.0' } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${url} -> HTTP ${res.status} - body: ${text.slice(0, 300)}`);
  }
  let json: HistorySummaryResponse;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${url} -> response was not valid JSON: ${text.slice(0, 300)}`);
  }
  if (!json.success) {
    throw new Error(`${url} -> success:false in response body: ${text.slice(0, 300)}`);
  }
  return json;
}

function report(label: string, resp: HistorySummaryResponse) {
  const s = resp.summary;
  const xau = s.pairBreakdown?.XAUUSD;
  console.log(`\n=== ${label} (range=${resp.range}) ===`);
  console.log(`Total XAUUSD signals evaluated: ${s.totalSignals}`);
  console.log(`  Full TP (TP2 Hit / Full TP):        ${s.fullTpCount}`);
  console.log(`  TP1 then SL/scratch:                ${s.tp1SlCount}`);
  console.log(`  Direct SL (SL hit before any TP):   ${s.directSlCount}`);
  console.log(`  Invalidated:                        ${s.invalidatedCount}`);
  if (s.totalSignals > 0) {
    const directSlPct = ((s.directSlCount / s.totalSignals) * 100).toFixed(1);
    const fullTpPct = ((s.fullTpCount / s.totalSignals) * 100).toFixed(1);
    const tp1SlPct = ((s.tp1SlCount / s.totalSignals) * 100).toFixed(1);
    console.log(`  -> Direct SL rate (SL first, no TP touched): ${directSlPct}%`);
    console.log(`  -> Full TP rate (reached TP2/Full TP):        ${fullTpPct}%`);
    console.log(`  -> TP1-then-SL rate (partial win, then SL):   ${tp1SlPct}%`);
  } else {
    console.log('  (no XAUUSD signals closed in this range yet)');
  }
  console.log(`Win rate (endpoint's own definition, excl. Invalidated): ${s.winRate}%`);
  console.log(`Non-loss rate (excl. Direct SL, excl. Invalidated):      ${s.nonLossRate}%`);
  console.log(`Avg R-multiple: ${s.avgRiskReward}`);
  if (xau) {
    console.log(`pairBreakdown.XAUUSD cross-check: count=${xau.count} winRate=${xau.winRate}% nonLossRate=${xau.nonLossRate}% avgRMultiple=${xau.avgRMultiple}`);
  }
}

async function main() {
  console.log('===== XAUUSD production /api/history/summary audit =====');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Run at: ${new Date().toISOString()}`);

  const week = await fetchSummary('week');
  report('Last 7 days', week);

  const month = await fetchSummary('month');
  report('Current month', month);

  console.log('\n===== Done =====');
  console.log('These are the real, current production numbers as of this run - not a backtest, not');
  console.log('an assumption from either side of the conversation. If a spike in Direct SL rate lines');
  console.log('up with the SL-tightening change the user described from an earlier session, that is');
  console.log('real evidence worth acting on in Bagian C/D. If it does not look as bad as the user');
  console.log('perceived, that is also worth reporting honestly rather than assuming their memory was');
  console.log('wrong OR assuming the engine must be broken.');
}

main().catch((err) => {
  console.error('FATAL:', err?.message || err);
  process.exit(1);
});
