// Follow-up correction (2026-09-04): the first audit-ai-integrations.ts run's [C] section had a
// real bug in ITS OWN detection logic - SignalHistoryRecord does NOT carry analysisReasoning at
// all (confirmed by reading recordCompletedSignalToHistory in server.ts: it copies aiNarrative,
// signalTier, xauPattern, etc. but never analysisReasoning), so the regex found "no match" on
// EVERY record and the script's own fallback silently mislabeled all of them "[real AI response]"
// - exactly the kind of false-positive the user explicitly asked NOT to report. This script uses
// only fields that actually exist on the record to get real evidence instead:
//   [A] /api/signals - analysisReasoning DOES exist on the live Signal object (not the history
//       record) - checks the "AI Validation (Nvidia):" line for every CURRENTLY ACTIVE signal,
//       across every pair, real numbers only.
//   [B] /api/history?pairId=XAUUSD - aiNarrative IS persisted onto SignalHistoryRecord (Fase G).
//       Since narrative is only ever populated when the NVIDIA call actually succeeded AND
//       xauNarrativeContext was present (i.e. every XAUUSD signal), the fraction of XAUUSD history
//       records with a non-empty aiNarrative is a real, honest proxy for how often XAUUSD's AI
//       validation call has actually succeeded, across the full stored history - not just a
//       handful of recent records.

const BASE_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';

async function main() {
  console.log('===== AI validation follow-up (correcting the prior audit run bug) =====');
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log('');

  console.log('--- [A] /api/signals - "AI Validation (Nvidia):" line for every currently active signal ---');
  try {
    const res = await fetch(`${BASE_URL}/api/signals`);
    const data: any = await res.json();
    const signals = data?.signals || {};
    for (const [pairId, sig] of Object.entries<any>(signals)) {
      if (!sig) {
        console.log(`  ${pairId}: no active signal right now`);
        continue;
      }
      const reasoning: string = sig.analysisReasoning || '';
      const match = reasoning.match(/AI Validation \(Nvidia\): (.+?)(?:\n|$)/);
      const aiText = match ? match[1] : '(field missing or line not found)';
      const isKeyNotConfigured = aiText.includes('NVIDIA_API_KEY environment variable not configured');
      const isFailedFallback = aiText.startsWith('AI validation unavailable, using engine score only.');
      const verdict = isKeyNotConfigured ? '[KEY NOT CONFIGURED]' : isFailedFallback ? '[CALL FAILED - fail-open]' : match ? '[real AI response]' : '[UNKNOWN - field missing]';
      console.log(`  ${pairId} (created ${sig.createdAt}) ${verdict}: "${aiText.slice(0, 150)}"`);
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- [B] /api/history?pairId=XAUUSD - aiNarrative presence across ALL stored history (real success proxy) ---');
  try {
    const res = await fetch(`${BASE_URL}/api/history?pairId=XAUUSD`);
    const data: any = await res.json();
    const records: any[] = data.history || [];
    const withNarrative = records.filter((r) => typeof r.aiNarrative === 'string' && r.aiNarrative.trim().length > 0);
    const withoutNarrative = records.length - withNarrative.length;
    console.log(`${records.length} total XAUUSD history records.`);
    console.log(`${withNarrative.length} (${records.length > 0 ? ((withNarrative.length / records.length) * 100).toFixed(1) : '0'}%) have a real non-empty aiNarrative - genuine evidence the NVIDIA AI validation call succeeded for that signal.`);
    console.log(`${withoutNarrative} (${records.length > 0 ? ((withoutNarrative / records.length) * 100).toFixed(1) : '0'}%) have NO aiNarrative - either the AI call failed/timed out for that signal (fail-open, per validateSignalWithAI's design), or the record predates Fase G (narrative field didn't exist yet before that phase shipped).`);
    // Break down by recency to separate "predates Fase G" from "actually failing now" - Fase G
    // shipped 2026-09-04 per the roadmap; records closed well before that day cannot have a
    // narrative regardless of AI success, so counting only post-Fase-G records is the honest
    // "is it working NOW" number.
    const sorted = [...records].sort((a, b) => new Date(b.closedAt || b.createdAt).getTime() - new Date(a.closedAt || a.createdAt).getTime());
    const recent20 = sorted.slice(0, 20);
    const recentWithNarrative = recent20.filter((r) => typeof r.aiNarrative === 'string' && r.aiNarrative.trim().length > 0);
    console.log(`Of the 20 MOST RECENT XAUUSD records (closedAt range ${recent20[recent20.length - 1]?.closedAt} to ${recent20[0]?.closedAt}): ${recentWithNarrative.length}/20 have a real aiNarrative.`);
    for (const r of recent20) {
      const has = typeof r.aiNarrative === 'string' && r.aiNarrative.trim().length > 0;
      console.log(`  closedAt=${r.closedAt || r.createdAt} ${has ? '[narrative present]' : '[NO narrative]'}${has ? `: "${r.aiNarrative.slice(0, 100)}"` : ''}`);
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }

  console.log('');
  console.log('--- [C] /api/macro/kalshi-fed-probabilities (Kalshi - public, no key needed) ---');
  try {
    const res = await fetch(`${BASE_URL}/api/macro/kalshi-fed-probabilities`);
    const data: any = await res.json().catch(() => null);
    console.log(`HTTP ${res.status} | body keys: ${data ? Object.keys(data).join(', ') : 'n/a'}`);
    if (data) console.log(JSON.stringify(data).slice(0, 600));
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }

  console.log('');
  console.log('===== End of follow-up =====');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
