// Post-deploy verification (2026-09-04) for the validateSignalWithAI() timeout fix: real evidence,
// not a claim. Checks:
//   [A] /api/admin/nvidia-ai-health (NEW endpoint this fix adds) - real attempt/success/failure
//       counts and latency samples per NVIDIA call site, since this server process restarted.
//   [B] /api/signals - current XAUUSD signal's aiNarrative/counterEvidence, and whether it was
//       created AFTER this fix deployed (a pre-fix signal proves nothing about the fix).
//   [C] /api/history?pairId=XAUUSD - the most recent record's aiNarrative, and whether its
//       createdAt/closedAt is after the fix deployed.
// Run repeatedly (workflow_dispatch, no schedule) until [B] or [C] shows a genuine post-fix signal
// with a real aiNarrative - a single run right after deploy is expected to still show the OLD
// signal (created before the fix), which is not evidence either way and this script says so
// explicitly rather than claiming success prematurely.

const BASE_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
// Set this to the fix's deploy processStartedAt (from /api/deploy-info) once known, via env var,
// so this script can tell "a signal from before the fix" apart from "a signal that used the fix
// and still failed" - both would show no aiNarrative, but only the second is real evidence of a
// remaining problem.
const FIX_DEPLOYED_AT = process.env.FIX_DEPLOYED_AT || '';

function basicAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).toString('base64');
}

async function main() {
  console.log('===== NVIDIA timeout fix - post-deploy verification =====');
  console.log(`Run at: ${new Date().toISOString()}`);
  if (FIX_DEPLOYED_AT) console.log(`Fix deployed at (processStartedAt): ${FIX_DEPLOYED_AT}`);
  console.log('');

  console.log('--- [A] /api/admin/nvidia-ai-health (real attempt/success/failure counts + latency) ---');
  try {
    const res = await fetch(`${BASE_URL}/api/admin/nvidia-ai-health`, { headers: { Authorization: basicAuthHeader() } });
    if (!res.ok) {
      console.log(`FAILED: HTTP ${res.status}`);
    } else {
      const data: any = await res.json();
      console.log(`generatedAt: ${data.generatedAt}`);
      console.log(`timeouts: quick=${data.timeouts?.quickTimeoutMs}ms deep=${data.timeouts?.deepTimeoutMs}ms secondOpinion=${data.timeouts?.secondOpinionTimeoutMs}ms`);
      if (!data.rows || data.rows.length === 0) {
        console.log('No NVIDIA calls recorded yet since this process started (either no signal-creation attempt has hit validateSignalWithAI yet, or the process just restarted).');
      }
      for (const row of data.rows || []) {
        console.log(`  ${row.callSite}: ${row.attempts} attempts, ${row.successes} success, ${row.timeoutsOrFailures} failed/timed out (${row.successRatePct}% success rate)`);
        console.log(`    lastSuccessAt=${row.lastSuccessAt ?? '(never)'} lastFailureAt=${row.lastFailureAt ?? '(never)'} lastLatencyMs=${row.lastLatencyMs}`);
        console.log(`    recent latencies (ms, oldest->newest): [${row.recentLatenciesMs.join(', ')}] avg=${row.recentAvgLatencyMs}`);
      }
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [B] /api/signals - current XAUUSD signal ---');
  try {
    const res = await fetch(`${BASE_URL}/api/signals`);
    const data: any = await res.json();
    const sig = data?.signals?.XAUUSD;
    if (!sig) {
      console.log('No active XAUUSD signal right now.');
    } else {
      const isPostFix = FIX_DEPLOYED_AT ? new Date(sig.createdAt).getTime() > new Date(FIX_DEPLOYED_AT).getTime() : null;
      console.log(`id=${sig.id} createdAt=${sig.createdAt} status=${sig.status}`);
      console.log(`Created AFTER the fix deployed? ${isPostFix === null ? 'unknown (FIX_DEPLOYED_AT not set)' : isPostFix}`);
      console.log(`aiNarrative: ${sig.aiNarrative ? `"${sig.aiNarrative}"` : '(none)'}`);
      console.log(`counterEvidence: ${JSON.stringify(sig.counterEvidence)}`);
      if (isPostFix === true && sig.aiNarrative) {
        console.log('>>> REAL EVIDENCE: a post-fix XAUUSD signal has a genuine aiNarrative. The fix produced a real result in production.');
      } else if (isPostFix === true && !sig.aiNarrative) {
        console.log('>>> This signal WAS created after the fix deployed, but still has no aiNarrative - the fix did not fully resolve the failure for this attempt. Check [A] above for the real latency/failure reason.');
      } else if (isPostFix === false) {
        console.log('>>> This signal predates the fix - not evidence either way. Re-run this script after a new XAUUSD signal is created.');
      }
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [C] /api/history?pairId=XAUUSD - most recent record ---');
  try {
    const res = await fetch(`${BASE_URL}/api/history?pairId=XAUUSD`);
    const data: any = await res.json();
    const records: any[] = data.history || [];
    const sorted = [...records].sort((a, b) => new Date(b.closedAt || b.createdAt).getTime() - new Date(a.closedAt || a.createdAt).getTime());
    const mostRecent = sorted[0];
    if (!mostRecent) {
      console.log('No XAUUSD history records at all.');
    } else {
      const isPostFix = FIX_DEPLOYED_AT ? new Date(mostRecent.createdAt).getTime() > new Date(FIX_DEPLOYED_AT).getTime() : null;
      console.log(`Most recent record: createdAt=${mostRecent.createdAt} closedAt=${mostRecent.closedAt}`);
      console.log(`Created AFTER the fix deployed? ${isPostFix === null ? 'unknown (FIX_DEPLOYED_AT not set)' : isPostFix}`);
      console.log(`aiNarrative: ${mostRecent.aiNarrative ? `"${mostRecent.aiNarrative}"` : '(none)'}`);
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }

  console.log('');
  console.log('===== End of verification =====');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
