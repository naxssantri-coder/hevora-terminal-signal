// One-off investigation (2026-08-31, "audit entry timing & indicators for XAUUSD SCALP" task,
// FASE 1 - audit/report only, no code changes to entry/confirmation logic). Pulls REAL data from
// production (this sandbox cannot reach Render directly, same GitHub-Actions-run pattern as the
// other scripts/audit-*.ts in this repo) to answer, with evidence rather than assumption:
//   [A] Today's real XAUUSD signal outcomes (MAIN vs SCALP tier), from the public /api/history.
//   [B] For Stop-Loss-hit XAUUSD signals whose close time falls inside the ~12.5h window still
//       held in candleStore.XAUUSD (/api/market/candles, 150 x 5-minute bars - this sandbox has no
//       way to see further back than that), whether price afterward reached the signal's ORIGINAL
//       TP1 level in the trade's direction - the concrete, checkable version of "stopped out, then
//       market continued toward TP".
// No fabricated conclusions - every number below is computed directly from these two live
// responses, and any record outside the checkable candle window is reported as "not checkable",
// never silently counted either way.

const BASE_URL = process.env.HEV_PRODUCTION_URL || 'https://hevora-terminal-signal-production-2.onrender.com';

interface HistoryRecord {
  id: string;
  pairId: string;
  type: 'BUY' | 'SELL';
  entryMin: number;
  entryMax: number;
  entryAvg: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfitMax?: number;
  signalTier?: 'MAIN' | 'SCALP';
  outcomeCategory: string;
  finalStatus: string;
  createdAt: string;
  closedAt: string;
  strategyMethod: string;
}

interface Candle { t: number; o: number; h: number; l: number; c: number }

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth() && d.getUTCDate() === now.getUTCDate();
}

async function main() {
  console.log('===== XAUUSD SCALP entry-timing audit - FASE 1 (real data only) =====');
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log('');

  console.log('--- [A] /api/history?pairId=XAUUSD (real signal outcomes) ---');
  let records: HistoryRecord[] = [];
  try {
    const res = await fetch(`${BASE_URL}/api/history?pairId=XAUUSD`);
    if (!res.ok) {
      console.log(`FAILED: HTTP ${res.status}`);
    } else {
      const data: any = await res.json();
      records = Array.isArray(data.history) ? data.history : [];
      console.log(`Total XAUUSD records returned: ${records.length}`);
      console.log(`summary.winRate=${data.summary?.winRate}% nonLossRate=${data.summary?.nonLossRate}% fullTpCount=${data.summary?.fullTpCount} tp1SlCount=${data.summary?.tp1SlCount} directSlCount=${data.summary?.directSlCount} invalidatedCount=${data.summary?.invalidatedCount}`);
      console.log(`(That summary is across ALL returned XAUUSD history, not just today - see today-only breakdown below.)`);
    }
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  const todays = records.filter((r) => isToday(r.closedAt || r.createdAt));
  console.log(`--- Today's XAUUSD signals only (UTC calendar day, ${new Date().toISOString().slice(0, 10)}): ${todays.length} closed ---`);
  if (todays.length === 0) {
    console.log('No XAUUSD signals closed today (UTC) yet in the returned history window - nothing to report for "performa hari ini" beyond this.');
  } else {
    const byTier: Record<string, HistoryRecord[]> = { MAIN: [], SCALP: [], untagged: [] };
    for (const r of todays) byTier[r.signalTier || 'untagged'].push(r);
    for (const [tier, list] of Object.entries(byTier)) {
      if (list.length === 0) continue;
      const wins = list.filter((r) => r.outcomeCategory !== 'Direct SL' && r.outcomeCategory !== 'Stop Loss Hit' && r.outcomeCategory !== 'Invalidated');
      console.log(`  [${tier}] ${list.length} signals - outcomes: ${list.map((r) => r.outcomeCategory).join(', ')}`);
      console.log(`  [${tier}] non-loss (TP1/TP2/Full TP, excl. Invalidated): ${wins.length}/${list.filter((r) => r.outcomeCategory !== 'Invalidated').length}`);
    }
  }
  console.log('');

  console.log('--- [B] /api/market/candles (XAUUSD, real 5m OHLC still in candleStore) ---');
  let candles: Candle[] = [];
  try {
    const res = await fetch(`${BASE_URL}/api/market/candles`);
    const data: any = await res.json();
    candles = data?.candles?.XAUUSD || [];
    console.log(`XAUUSD candles available: ${candles.length} (interval=${data.interval}) spanning ${candles.length > 0 ? new Date(candles[0].t).toISOString() : 'n/a'} to ${candles.length > 0 ? new Date(candles[candles.length - 1].t).toISOString() : 'n/a'}`);
  } catch (e: any) {
    console.log(`FAILED: ${e?.message || e}`);
  }
  console.log('');

  console.log('--- "Stopped out then market continued toward TP" check (Direct SL / Stop Loss Hit only) ---');
  const slRecords = records.filter((r) => r.outcomeCategory === 'Direct SL' || r.outcomeCategory === 'Stop Loss Hit' || r.finalStatus === 'Stop Loss Hit');
  console.log(`Total XAUUSD SL-hit records in returned history: ${slRecords.length}`);
  if (candles.length === 0) {
    console.log('No candle data available - cannot check this pattern at all right now.');
  } else {
    const earliestCandleT = candles[0].t;
    let checkable = 0;
    let notCheckable = 0;
    let reversedTowardTp1 = 0;
    const details: string[] = [];
    for (const r of slRecords) {
      const closedMs = new Date(r.closedAt).getTime();
      if (isNaN(closedMs) || closedMs < earliestCandleT) {
        notCheckable++;
        continue;
      }
      const afterCandles = candles.filter((c) => c.t >= closedMs);
      if (afterCandles.length === 0) {
        notCheckable++;
        continue;
      }
      checkable++;
      const reached = r.type === 'BUY'
        ? afterCandles.some((c) => c.h >= r.takeProfit1)
        : afterCandles.some((c) => c.l <= r.takeProfit1);
      if (reached) reversedTowardTp1++;
      details.push(`  ${r.id} | ${r.type} | tier=${r.signalTier ?? 'n/a'} | closedAt=${r.closedAt} | entry=${r.entryAvg} SL=${r.stopLoss} TP1=${r.takeProfit1} | ${afterCandles.length} candles checked after close | reached original TP1 afterward: ${reached}`);
    }
    console.log(`Checkable (closedAt within the ~12.5h candle window): ${checkable}`);
    console.log(`NOT checkable (closedAt older than the candle history retained, or no candles after close): ${notCheckable} - excluded from the ratio below, not counted as either outcome.`);
    if (checkable > 0) {
      console.log(`Of the ${checkable} checkable SL-hit signals: ${reversedTowardTp1} (${((reversedTowardTp1 / checkable) * 100).toFixed(0)}%) had price later reach the signal's original TP1 level in the trade's direction.`);
    } else {
      console.log('Zero checkable SL-hit signals - cannot report a percentage for this pattern from current data. Not fabricating a number.');
    }
    if (details.length > 0) {
      console.log('Per-record detail:');
      details.forEach((d) => console.log(d));
    }

    // Transparency aid: even when 0 are checkable, show how close the MOST RECENT SL-hit records
    // came to the window, so "0 checkable" reads as an honest data-availability limit rather than
    // a silent dead end - e.g. "closed 40min before the window" vs "closed 3 days ago".
    const sortedByRecency = [...slRecords].sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
    console.log('');
    console.log(`Most recent ${Math.min(5, sortedByRecency.length)} SL-hit records (regardless of checkable status), for transparency:`);
    for (const r of sortedByRecency.slice(0, 5)) {
      const closedMs = new Date(r.closedAt).getTime();
      const gapMinutes = isNaN(closedMs) ? null : (earliestCandleT - closedMs) / 60000;
      const status = !isNaN(closedMs) && closedMs >= earliestCandleT ? 'inside window' : gapMinutes !== null ? `closed ~${gapMinutes.toFixed(0)}min before the earliest retained candle` : 'unparseable closedAt';
      console.log(`  ${r.id} | tier=${r.signalTier ?? 'n/a'} | closedAt=${r.closedAt} | ${status}`);
    }
  }

  console.log('');
  console.log('--- [F] Bagian 2 point 3/4 follow-up (2026-08-31): retroactive worst-case-RR1 gate impact ---');
  console.log('Real historical signals only - re-checks each ALREADY-PUBLISHED XAUUSD signal against the');
  console.log('NEW worst-case-RR1 gate (fill at the entry-zone edge CLOSEST to TP1, not entryAvg) using its');
  console.log('own real entryMin/entryMax/stopLoss/takeProfit1/signalTier. Same MIN_RR1_MAIN=0.7/');
  console.log('MIN_RR1_SCALP=1.0 thresholds already enforced from entryAvg - not a new/different number.');
  console.log('backtest-xau-engine.ts is NOT used for this comparison: its own duplicated evaluateXauIctSetups');
  console.log('does not implement MAIN/SCALP tiering at all (a pre-existing drift from server.ts, found');
  console.log('during this audit, not caused by this change) - syncing it just for this check would not');
  console.log('give an honest apples-to-apples baseline. This retroactive real-history check is used instead.');
  const MIN_RR1_MAIN = 0.7;
  const MIN_RR1_SCALP = 1.0;
  let rrCheckable = 0;
  let rrWouldReject = 0;
  let rrWouldRejectAndWasSlLoss = 0;
  let rrWouldRejectAndWasWin = 0;
  for (const r of records) {
    if (typeof r.entryMin !== 'number' || typeof r.entryMax !== 'number' || typeof r.stopLoss !== 'number' || typeof r.takeProfit1 !== 'number') continue;
    rrCheckable++;
    const minRr1 = r.signalTier === 'SCALP' ? MIN_RR1_SCALP : MIN_RR1_MAIN;
    const worstCaseEntry = r.type === 'BUY' ? r.entryMax : r.entryMin;
    const worstCaseRisk = Math.abs(worstCaseEntry - r.stopLoss);
    const worstCaseReward = Math.abs(r.takeProfit1 - worstCaseEntry);
    const worstCaseRr1 = worstCaseReward / (worstCaseRisk || 1);
    if (worstCaseRr1 < minRr1) {
      rrWouldReject++;
      const wasLoss = r.outcomeCategory === 'Direct SL' || r.outcomeCategory === 'Stop Loss Hit';
      if (wasLoss) rrWouldRejectAndWasSlLoss++;
      else rrWouldRejectAndWasWin++;
    }
  }
  console.log(`Checkable real historical signals (had entryMin/entryMax/stopLoss/takeProfit1): ${rrCheckable} of ${records.length}`);
  if (rrCheckable > 0) {
    console.log(`Would have been REJECTED by the new worst-case-RR1 gate: ${rrWouldReject} (${((rrWouldReject / rrCheckable) * 100).toFixed(1)}%)`);
    console.log(`  Of those rejected: ${rrWouldRejectAndWasSlLoss} were actual SL losses (gate would have prevented the loss), ${rrWouldRejectAndWasWin} were actual wins/partial-wins (gate would have cost a real win).`);
    console.log(`Would have PASSED unchanged: ${rrCheckable - rrWouldReject} (${(((rrCheckable - rrWouldReject) / rrCheckable) * 100).toFixed(1)}%) - this is the real frequency-impact estimate for point 3's gate specifically, from actual past signals, not a synthetic backtest.`);
  } else {
    console.log('No checkable records - cannot estimate frequency impact from current data.');
  }

  console.log('');
  console.log('===== End of XAUUSD SCALP entry-timing audit =====');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
