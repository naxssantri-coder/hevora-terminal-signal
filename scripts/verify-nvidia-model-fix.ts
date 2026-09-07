// One-off investigation (2026-08-31, "NVIDIA fallback 410 Gone" bug report from real production
// logs): proves - with a real call to NVIDIA's own API, not an assumption - that the previously
// used model ID (`deepseek-ai/deepseek-v4-pro`, unversioned) is retired (HTTP 410 Gone), and that
// the corrected model ID (`deepseek-ai/deepseek-v4-pro-0813`) actually answers. Runs via GitHub
// Actions (real internet - this sandbox cannot reach integrate.api.nvidia.com directly), same
// pattern as scripts/audit-data-health.ts / scripts/verify-xau-production.ts.
//
// Follow-up (same day): deepseek-v4-pro-0813 was verified live to work, but took 2m42s to answer
// on one run and didn't answer at all within 3 minutes on a second - both far past ASK_AI_TIMEOUT_MS
// (45s default), the deadline the whole /api/ai/ask request (including its NVIDIA fallback) runs
// under. server.ts's HEVAI fallback (callNvidiaAskAiFallback) was switched to the much smaller/
// faster nvidia/nemotron-3-nano-omni-30b-a3b-reasoning instead (deepseek-v4-pro-0813 stays for the
// News Watcher's own fallback, which isn't bound by that same tight deadline). Added a timed check
// for the nemotron model below to confirm it actually answers within a timeframe that fits.
//
// No fabricated results - every line below comes straight from NVIDIA's own HTTP response. Never
// prints the API key.

import OpenAI from 'openai';

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '';

// 2026-08-31: deepseek-v4-pro-0813 was observed to hang past 6 minutes with no response and no
// error on one run (the whole job's timeout-minutes had to kill it) - a per-call timeout is needed
// so one slow/hung model can't block the run from ever reaching the other checks below it.
async function tryModel(client: OpenAI, model: string, timeoutMs: number): Promise<void> {
  console.log(`--- Trying model: "${model}" (timeout ${(timeoutMs / 1000).toFixed(0)}s) ---`);
  const startedAt = Date.now();
  try {
    const completion = await client.chat.completions.create(
      {
        model,
        messages: [{ role: 'user', content: 'Balas HANYA dengan JSON: {"ok": true, "model_confirmed": "<nama model persis seperti kamu tahu>"}' }],
        temperature: 0.2,
        max_tokens: 100,
      },
      { signal: AbortSignal.timeout(timeoutMs) }
    );
    const elapsedMs = Date.now() - startedAt;
    const text = completion.choices[0]?.message?.content?.trim() || '(empty content)';
    console.log(`SUCCESS - HTTP call completed without throwing, in ${elapsedMs}ms (${(elapsedMs / 1000).toFixed(1)}s).`);
    console.log(`Response content: ${text}`);
  } catch (err: any) {
    const elapsedMs = Date.now() - startedAt;
    const status = err?.status ?? err?.response?.status ?? 'unknown';
    const message = err?.message || String(err);
    console.log(`FAILED after ${elapsedMs}ms (${(elapsedMs / 1000).toFixed(1)}s) - status=${status} message=${message}`);
  }
  console.log('');
}

async function main() {
  console.log('===== NVIDIA model-id fix verification (410 Gone bug) =====');
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log(`NVIDIA_API_KEY configured: ${NVIDIA_API_KEY ? 'yes' : 'NO - cannot run this check'}`);
  console.log('');

  if (!NVIDIA_API_KEY) {
    console.log('VERDICT: NVIDIA_API_KEY secret is not set for this GitHub Actions run - cannot verify');
    console.log('against the real NVIDIA API from here. Add it as a repo secret (same value Render');
    console.log('already uses in production) to run this check.');
    process.exitCode = 1;
    return;
  }

  const client = new OpenAI({ apiKey: NVIDIA_API_KEY, baseURL: 'https://integrate.api.nvidia.com/v1' });

  console.log('[1/3] Reproducing the bug: the OLD unversioned model ID this codebase used to call.');
  await tryModel(client, 'deepseek-ai/deepseek-v4-pro', 30_000);

  // Nemotron (the model that actually matters for THIS fix - HEVAI's fallback) runs BEFORE
  // deepseek-v4-pro-0813 below, deliberately: deepseek was observed to sometimes hang for 6+
  // minutes with no response, and this script awaits each call in order - if nemotron ran last, a
  // deepseek hang would prevent this run from ever reaching the check that actually matters here.
  console.log('[2/3] Verifying the HEVAI fallback swap: the smaller/faster model, timed - must fit');
  console.log('      comfortably inside ASK_AI_TIMEOUT_MS (45s default) to actually rescue a request.');
  await tryModel(client, 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 45_000);

  console.log('[3/3] Verifying deepseek-v4-pro-0813 (News Watcher fallback only, no tight deadline) -');
  console.log('      already confirmed working in an earlier run; bounded here so a repeat hang can\'t');
  console.log('      block this script from finishing and reporting the results above.');
  await tryModel(client, 'deepseek-ai/deepseek-v4-pro-0813', 60_000);

  console.log('===== End of NVIDIA model-id fix verification =====');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
