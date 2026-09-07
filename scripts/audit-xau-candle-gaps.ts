// Bagian G (2026-09-01 chart+RR follow-up): verify the user's own screenshot-based hypothesis
// BEFORE fixing anything - candle 5-minute bars in candleStore.XAUUSD are only ever created when a
// real tick lands in that time slot (see buildXauCandleFromTicks in server.ts). If the gold-api.com/
// Yahoo tick feed goes quiet for a few minutes (a hiccup, not necessarily a full outage), that slot
// never gets a candle object at all - the array jumps straight from the bar before the gap to the
// bar after it, with nothing marking the skipped time in between.
//
// This script fetches the REAL, currently-live /api/market/xau-intraday response (public, no admin
// auth) from production and scans consecutive candle timestamps for gaps wider than one bar
// duration, for every interval (5m/15m/1h/4h). This sandbox's egress to the production Render URL
// is blocked (confirmed repeatedly on this project), so this runs via GitHub Actions - same
// established workaround as every other production-audit script here.
//
// This is real-time evidence (whatever candleStore.XAUUSD currently holds), not a historical replay
// of the exact 3 points the user circled in their screenshot - production doesn't expose a raw tick
// log this script could query for a specific past window. If gaps are still found in the CURRENT
// live data, that is direct, real confirmation the underlying mechanism the user's hypothesis
// describes is still active today, which is the evidence needed to justify (or not) the whitespace-
// data fix - not proof about that exact specific screenshot moment.

const BASE_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';

interface XauIntradayCandle { t: number; o: number; h: number; l: number; c: number; forming?: boolean }
interface XauIntradayResponse {
  pairId: string;
  interval: string;
  candles: XauIntradayCandle[];
  source: string;
  oldestUnderlyingCandleTime: string | null;
  newestUnderlyingCandleTime: string | null;
  fetchedAt: string;
}

const BAR_MS: Record<string, number> = { '5m': 5 * 60 * 1000, '15m': 15 * 60 * 1000, '1h': 60 * 60 * 1000, '4h': 4 * 60 * 60 * 1000 };

async function fetchIntraday(interval: string): Promise<XauIntradayResponse> {
  const url = `${BASE_URL}/api/market/xau-intraday?interval=${interval}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'HEVORA-XAU-Gap-Audit/1.0' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status} - body: ${text.slice(0, 300)}`);
  return JSON.parse(text) as XauIntradayResponse;
}

async function main() {
  console.log('===== XAUUSD candle gap audit (Bagian G) =====');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Run at: ${new Date().toISOString()}`);

  let totalGapsFound = 0;

  for (const interval of ['5m', '15m', '1h', '4h']) {
    const expectedMs = BAR_MS[interval];
    let resp: XauIntradayResponse;
    try {
      resp = await fetchIntraday(interval);
    } catch (e: any) {
      console.log(`\n[${interval}] FETCH FAILED: ${e?.message || e}`);
      continue;
    }
    // Exclude the trailing forming bar from gap analysis - it's expected to be "close" to the prior
    // closed bar in a way that's not a real gap, and its own timestamp is still moving.
    const closed = resp.candles.filter((c) => !c.forming);
    console.log(`\n[${interval}] ${closed.length} closed candles (excl. forming bar), expected spacing ${expectedMs / 60000}min`);
    if (closed.length < 2) {
      console.log('  Not enough closed candles to check for gaps.');
      continue;
    }
    const gaps: Array<{ fromT: number; toT: number; missingSlots: number }> = [];
    for (let i = 1; i < closed.length; i++) {
      const dt = closed[i].t - closed[i - 1].t;
      if (dt > expectedMs) {
        const missingSlots = Math.round(dt / expectedMs) - 1;
        gaps.push({ fromT: closed[i - 1].t, toT: closed[i].t, missingSlots });
      }
    }
    if (gaps.length === 0) {
      console.log('  No gaps found in the currently-held window (spacing is consistently one bar duration).');
    } else {
      totalGapsFound += gaps.length;
      console.log(`  FOUND ${gaps.length} gap(s):`);
      for (const g of gaps) {
        console.log(`    ${new Date(g.fromT).toISOString()} -> ${new Date(g.toT).toISOString()} (${g.missingSlots} missing ${expectedMs / 60000}min slot(s))`);
      }
    }
  }

  console.log(`\n===== Done: ${totalGapsFound} total gap(s) found across all intervals in the current live window =====`);
  console.log('If totalGapsFound > 0: confirms the hypothesis is real and currently active - the');
  console.log('whitespace-data rendering fix is justified by real evidence, not just theory.');
  console.log('If totalGapsFound === 0 in this particular run: does not disprove the hypothesis (feed');
  console.log('hiccups are intermittent) - the code-level proof (buildXauCandleFromTicks only creates a');
  console.log('slot when a tick lands in it, confirmed by reading the function) still holds regardless,');
  console.log('and the whitespace fix is a correct, harmless rendering improvement either way (it only');
  console.log('ever draws MORE honestly, never fabricates data) - not conditional on catching a gap live.');
}

main().catch((err) => {
  console.error('FATAL:', err?.message || err);
  process.exit(1);
});
