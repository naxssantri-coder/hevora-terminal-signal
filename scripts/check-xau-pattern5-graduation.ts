// Fase M (roadmap Bagian 2, PROMPT MASTER): status check only, not new detection logic. Pattern 5
// (BREAKOUT_DISPLACEMENT_CONTINUATION) has been computed in shadow mode since the Fase 4 redesign
// (XAU_PATTERN5_LIVE_PUBLISH = false) - every tick it picks its own MAIN-or-SCALP candidate,
// records it to xauShadowPattern5Records, and resolves it forward the same way
// scripts/backtest-xau-engine.ts's simulateForward does, entirely independent of the live
// currentSignals/autotrade path. This script pulls the real, currently-accumulated shadow-mode
// numbers from production (admin /api/admin/xau-candle-health - this sandbox cannot reach Render
// directly, same GitHub-Actions-run workaround as every other scripts/audit-*.ts in this repo) and
// reports whether they clear the same XAU_PATTERN_ALIGNMENT_MIN_SAMPLE=15 bar Fase 3's adaptive
// weighting already uses, plus the win-rate/avgR. This is a REPORT ONLY - graduating
// XAU_PATTERN5_LIVE_PUBLISH to true changes what signals actually get published (a risk/money
// trade-off per the standing project rule), so this script never flips it; that decision is the
// user's alone.

const BASE_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function basicAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).toString('base64');
}

async function main() {
  console.log('===== Fase M: Pattern 5 (BREAKOUT_DISPLACEMENT_CONTINUATION) graduation status check =====');
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log('');

  try {
    const res = await fetch(`${BASE_URL}/api/admin/xau-candle-health`, { headers: { Authorization: basicAuthHeader() } });
    if (!res.ok) {
      console.log(`FAILED: HTTP ${res.status}`);
      process.exitCode = 1;
      return;
    }
    const data: any = await res.json();
    const shadow = data?.xauShadowPattern5;
    if (!shadow) {
      console.log('FAILED: /api/admin/xau-candle-health response has no xauShadowPattern5 field - endpoint shape may have changed.');
      process.exitCode = 1;
      return;
    }

    console.log('--- Raw xauShadowPattern5 block ---');
    console.log(JSON.stringify(shadow, null, 2));
    console.log('');

    console.log('--- Graduation assessment ---');
    console.log(`Resolved sample count: ${shadow.resolvedSampleCount} (min required: ${shadow.minSampleRequired})`);
    console.log(`readyForReview (sample size alone): ${shadow.readyForReview}`);
    console.log(`Win rate: ${shadow.winRate === null ? 'n/a (no decided samples yet)' : shadow.winRate + '%'}`);
    console.log(`Avg R: ${shadow.avgR === null ? 'n/a' : shadow.avgR + 'R'}`);
    console.log('');

    if (!shadow.readyForReview) {
      console.log(`RECOMMENDATION: NOT ready. Sample size (${shadow.resolvedSampleCount}) is below the ${shadow.minSampleRequired}-sample bar - same threshold Fase 3's adaptive weighting requires before trusting a per-combo stat. Stay in shadow mode; re-check later once more resolves.`);
    } else if (shadow.winRate === null || shadow.avgR === null) {
      console.log('RECOMMENDATION: Sample size clears the bar but winRate/avgR are still null (no decided outcomes) - re-check, do not graduate on sample count alone.');
    } else {
      console.log(`Sample size clears the ${shadow.minSampleRequired}-sample bar. Win rate ${shadow.winRate}% / avgR ${shadow.avgR}R - this script does NOT auto-recommend a graduation threshold beyond reporting these numbers; that judgment (is this good enough vs the other 4 live patterns) is the user's call per the standing risk-trade-off rule. XAU_PATTERN5_LIVE_PUBLISH is left untouched (still false) regardless of this result.`);
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
    process.exitCode = 1;
  }

  console.log('');
  console.log('===== End of Fase M status check =====');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
