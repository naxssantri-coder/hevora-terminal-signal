// Comprehensive AI-integration audit (2026-09-04, explicit user request): for every AI feature and
// data source this project uses, determine from REAL production evidence (never code assumption)
// whether it is genuinely being called and succeeding right now - not just present in the code.
// Specifically checks for: (1) real last-success timestamps, (2) silent fallback text masquerading
// as a real result, (3) API keys that read as unconfigured from the server's own error messages.
// Runs via GitHub Actions since this sandbox cannot reach the production Render URL directly.
//
// No fabricated verdicts: every claim below traces to a specific HTTP response field printed in
// this log. Where evidence is genuinely unavailable (no admin endpoint exposes it), this says so
// explicitly rather than guessing.

const BASE_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function basicAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).toString('base64');
}

// The EXACT default template generatePairSelfEvaluationInsight falls back to when nvidiaClient is
// null OR the DeepSeek call throws/returns empty - a real AI response would essentially never
// reproduce this exact sentence shape verbatim.
function looksLikeSelfEvalDefaultTemplate(text: string): boolean {
  return /^Performa \d+ sinyal terakhir .+: Win Rate [\d.]+%, Avg R [\d.-]+R\. Setup confluence threshold beroperasi stabil\.$/.test(text.trim());
}

async function main() {
  console.log('===== Comprehensive AI-integration + data-source audit =====');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log('');

  // --- [A] Gemini: AI Macro Narrative -----------------------------------------------------------
  console.log('--- [A] /api/economic-history/macro-narrative (Gemini) ---');
  try {
    const res = await fetch(`${BASE_URL}/api/economic-history/macro-narrative`);
    const data: any = await res.json();
    console.log(`HTTP ${res.status} | success=${data.success} | generatedAt=${data.generatedAt ?? 'null'}`);
    if (data.generatedAt) {
      const ageMin = (Date.now() - new Date(data.generatedAt).getTime()) / 60000;
      console.log(`Age of cached narrative: ${ageMin < 60 ? ageMin.toFixed(1) + 'min' : (ageMin / 60).toFixed(2) + 'h'} ago`);
      console.log(`narrative present: ${Boolean(data.narrative)} | narrative keys: ${data.narrative ? Object.keys(data.narrative).join(', ') : 'n/a'}`);
    } else {
      console.log('No generatedAt at all - either GEMINI_API_KEY unset, gatherMacroNarrativeInputs() returned empty, or every Gemini candidate has failed with zero prior successful cache.');
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  // --- [B] NVIDIA (DeepSeek): AI Self-Evaluation / Quant Advisor insight log ---------------------
  console.log('--- [B] /api/admin/ai-insights (NVIDIA DeepSeek, "AI Quant & Risk Advisor") ---');
  try {
    const res = await fetch(`${BASE_URL}/api/admin/ai-insights`, { headers: { Authorization: basicAuthHeader() } });
    if (!res.ok) {
      console.log(`FAILED: HTTP ${res.status}`);
    } else {
      const data: any = await res.json();
      const insights: any[] = data.insights || [];
      console.log(`${insights.length} total insight log entries stored.`);
      if (insights.length === 0) {
        console.log('ZERO entries ever - this feature only fires every 10 closed signals per pair, so either no pair has reached a multiple of 10 closed signals yet, or it has never run.');
      } else {
        const sorted = [...insights].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const mostRecent = sorted[0];
        const ageH = (Date.now() - new Date(mostRecent.timestamp).getTime()) / 3600000;
        console.log(`Most recent entry: ${mostRecent.timestamp} (${ageH.toFixed(1)}h ago), pair=${mostRecent.pairId}`);
        let fallbackCount = 0;
        for (const ins of sorted.slice(0, 10)) {
          const isFallback = looksLikeSelfEvalDefaultTemplate(ins.aiAnalysis || '');
          if (isFallback) fallbackCount++;
          console.log(`  ${ins.timestamp} pair=${ins.pairId} ${isFallback ? '[FALLBACK TEMPLATE - NVIDIA call did NOT produce real text]' : '[real AI text]'}: "${(ins.aiAnalysis || '').slice(0, 160)}${(ins.aiAnalysis || '').length > 160 ? '...' : ''}"`);
        }
        console.log(`Of the ${Math.min(10, sorted.length)} most recent entries checked: ${fallbackCount} are the exact fallback template (NVIDIA unavailable/failed at generation time), ${Math.min(10, sorted.length) - fallbackCount} look like real generated text.`);
      }
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  // --- [C] NVIDIA (Nemotron/DeepSeek): per-signal AI validation, across pairs ---------------------
  console.log('--- [C] /api/history - AI Validation (Nvidia) text across recent signals, multiple pairs ---');
  const pairsToCheck = ['XAUUSD', 'BTCUSDT', 'EURUSD'];
  for (const pairId of pairsToCheck) {
    try {
      const res = await fetch(`${BASE_URL}/api/history?pairId=${pairId}`);
      const data: any = await res.json();
      const records: any[] = data.history || [];
      const sorted = [...records].sort((a, b) => new Date(b.closedAt || b.createdAt).getTime() - new Date(a.closedAt || a.createdAt).getTime());
      const recent = sorted.slice(0, 8);
      console.log(`${pairId}: ${records.length} total history records, checking ${recent.length} most recent.`);
      let unavailableCount = 0;
      let keyNotConfiguredCount = 0;
      for (const r of recent) {
        const reasoning: string = r.analysisReasoning || '';
        const match = reasoning.match(/AI Validation \(Nvidia\): (.+?)(?:\\n|\n|$)/);
        const aiText = match ? match[1] : '(no "AI Validation (Nvidia):" line found in analysisReasoning)';
        const isUnavailableFallback = aiText.startsWith('AI validation unavailable, using engine score only.');
        const isKeyNotConfigured = aiText.includes('NVIDIA_API_KEY environment variable not configured');
        if (isUnavailableFallback) unavailableCount++;
        if (isKeyNotConfigured) keyNotConfiguredCount++;
        console.log(`  closedAt=${r.closedAt || r.createdAt} ${isKeyNotConfigured ? '[KEY NOT CONFIGURED]' : isUnavailableFallback ? '[CALL FAILED/TIMED OUT - fail-open fallback]' : '[real AI response]'}: "${aiText.slice(0, 140)}"`);
      }
      console.log(`  => ${pairId}: ${keyNotConfiguredCount}/${recent.length} show NVIDIA_API_KEY not configured, ${unavailableCount}/${recent.length} show a failed/timed-out call (fail-open), ${recent.length - unavailableCount - keyNotConfiguredCount}/${recent.length} show a real AI response.`);
    } catch (e: any) {
      console.log(`  ${pairId} FAILED: ${e?.message || e}`);
    }
  }
  console.log('');

  // --- [C2] Current live signals - AI narrative (Fase G) + ensemble counterEvidence (2026-09-04) --
  console.log('--- [C2] /api/signals - current live signals: aiNarrative + counterEvidence (ensemble) ---');
  try {
    const res = await fetch(`${BASE_URL}/api/signals`);
    const data: any = await res.json();
    const signals = data?.signals || {};
    for (const [pairId, sig] of Object.entries<any>(signals)) {
      if (!sig) continue;
      console.log(`  ${pairId}: status=${sig.status} createdAt=${sig.createdAt}`);
      if (pairId === 'XAUUSD') {
        console.log(`    aiNarrative: ${sig.aiNarrative ? `"${sig.aiNarrative}"` : '(none)'}`);
        console.log(`    counterEvidence: ${JSON.stringify(sig.counterEvidence)}`);
      }
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  // --- [D] Live events (News Watcher pipeline, Gemini + NVIDIA fallback) -------------------------
  console.log('--- [D] /api/live-events?limit=10 (News Watcher pipeline output) ---');
  try {
    const res = await fetch(`${BASE_URL}/api/live-events?limit=10`);
    const data: any = await res.json();
    const events = Array.isArray(data) ? data : (data?.events ?? []);
    if (events.length === 0) {
      console.log('No events returned at all.');
    } else {
      const nowMs = Date.now();
      for (const e of events) {
        const ageMin = (nowMs - new Date(e.createdAt).getTime()) / 60000;
        console.log(`  ${e.createdAt} (${ageMin < 60 ? ageMin.toFixed(1) + 'min' : (ageMin / 60).toFixed(2) + 'h'} ago) | impact=${e.impact} | tone=${e.tone ?? 'n/a'} | "${(e.title || '').slice(0, 100)}"`);
      }
      const newestAgeMin = (nowMs - new Date(events[0].createdAt).getTime()) / 60000;
      console.log(`Newest item age: ${newestAgeMin < 60 ? newestAgeMin.toFixed(1) + 'min' : (newestAgeMin / 60).toFixed(2) + 'h'} - live-intel-watcher.ts is supposed to run every ~15min via its own GitHub Actions cron.`);
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  // --- [E] HEVAI (Ask AI) - real test call, Gemini primary + NVIDIA fallback ----------------------
  console.log('--- [E] POST /api/ai/ask - real test question (Gemini primary, NVIDIA fallback, Tavily search) ---');
  try {
    const res = await fetch(`${BASE_URL}/api/ai/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Ringkas dalam satu kalimat: apa itu XAUUSD?' }),
    });
    const data: any = await res.json();
    console.log(`HTTP ${res.status} | success=${data.success} | error=${data.error ?? 'null'}`);
    if (data.answer) {
      console.log(`answer (${data.answer.length} chars): "${data.answer.slice(0, 200)}${data.answer.length > 200 ? '...' : ''}"`);
    } else {
      console.log('answer: null');
    }
    if (data.error && data.error.includes('GEMINI_API_KEY belum dikonfigurasi')) {
      console.log('=> GEMINI_API_KEY is NOT configured on production (server said so explicitly).');
    } else if (data.success && data.answer) {
      console.log('=> Endpoint produced a real answer just now (which underlying model answered is only visible in server-side console.log, not in this HTTP response - see report caveat).');
    } else if (!data.success) {
      console.log('=> Call did NOT succeed just now (rate-limited, budget-exhausted, or both Gemini and NVIDIA failed) - see error above.');
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('===== End of AI-integration audit =====');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
