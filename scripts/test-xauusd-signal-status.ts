// Standalone sanity test for the XAUUSD "SL hit but status stuck at Running" investigation.
//
// WHY THIS EXISTS: server.ts is a monolith that starts polling external APIs and listening on a
// port the moment it's imported, so its real evaluateSignalStatus() cannot be unit-tested by
// importing it directly (same constraint documented in scripts/backtest-xau-engine.ts's own
// honesty note for the signal-construction logic). This copies the exact decision logic verbatim
// from server.ts's evaluateSignalStatus (the C1 staleness gate + C2 candle high/low scan + the SL
// hit check) - not reimplemented from memory - so these scenarios test the real shipped behavior,
// not an approximation of it. Re-copy this block if evaluateSignalStatus's staleness/hit-detection
// logic changes.
//
// ROOT CAUSE this proves fixed: price freshness (market.isStale, driven by gold-api.com/Yahoo
// ticks) and candle freshness (candleStore.XAUUSD, accumulated by the same ticks via
// buildXauCandleFromTicks - see that function's own comment) update via independent code paths,
// so a momentary point-price hiccup doesn't by itself prove the candle data is stale too (this was
// originally found and fixed while Twelve Data was briefly the live candle source, decoupling the
// two sources outright - Twelve Data has since been removed entirely, but the underlying
// independent-update-path gap this test guards against is real regardless of source). The OLD code
// skipped ALL evaluation whenever market.isStale was true, regardless of whether candleStore.XAUUSD
// - a real, independently-fresh data source - had already proven an SL was hit. Scenario 2 below
// reproduces exactly that: a stale point price with fresh candle data showing a real SL breach.

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
interface MarketPriceLike { price: number; isStale: boolean }
interface SignalLike { type: 'BUY' | 'SELL'; stopLoss: number; takeProfit1: number; takeProfit2: number; createdAt: string }

const XAU_CANDLE_STALE_THRESHOLD_MS = 15 * 60 * 1000;

type HitResult = { evaluated: boolean; slHit: boolean; tp1Hit: boolean; tp2Hit: boolean };

// Verbatim copy of server.ts evaluateSignalStatus's per-pair core (C1 gate + C2 scan + hit checks),
// generalized to accept candleStore/currentPrices as parameters instead of reading module globals.
function evaluatePairHit(
  pairId: string,
  signal: SignalLike,
  market: MarketPriceLike,
  candleStoreForPair: Candle[],
  candleStoreXauForFreshnessCheck: Candle[]
): HitResult {
  // --- exact copy of the new XAUUSD-only decoupled-freshness check ---
  let xauCandlesFreshEnough = false;
  if (pairId === 'XAUUSD' && market.isStale) {
    const xauCandles = candleStoreXauForFreshnessCheck;
    const newestXauCandleTime = xauCandles.length > 0 ? xauCandles[xauCandles.length - 1].time : null;
    xauCandlesFreshEnough = newestXauCandleTime !== null && (Date.now() - newestXauCandleTime) <= XAU_CANDLE_STALE_THRESHOLD_MS;
  }

  // --- exact copy of C1 ---
  if (market.isStale && !xauCandlesFreshEnough) {
    return { evaluated: false, slHit: false, tp1Hit: false, tp2Hit: false };
  }

  const price = market.price;
  const isBuy = signal.type === 'BUY';

  // --- exact copy of C2 ---
  const allCandles = candleStoreForPair;
  const signalCreatedMs = new Date(signal.createdAt).getTime();
  let highSample = xauCandlesFreshEnough ? -Infinity : price;
  let lowSample = xauCandlesFreshEnough ? Infinity : price;
  for (const c of allCandles) {
    if (c.time < signalCreatedMs) continue;
    if (c.high > highSample) highSample = c.high;
    if (c.low < lowSample) lowSample = c.low;
  }

  // --- exact copy of the SL/TP1/TP2 hit checks ---
  const slHit = isBuy ? lowSample <= signal.stopLoss : highSample >= signal.stopLoss;
  const tp1Hit = isBuy ? highSample >= signal.takeProfit1 : lowSample <= signal.takeProfit1;
  const tp2Hit = isBuy ? highSample >= signal.takeProfit2 : lowSample <= signal.takeProfit2;

  return { evaluated: true, slHit, tp1Hit, tp2Hit };
}

// Same core logic but with the OLD (pre-fix) gate: skip unconditionally on market.isStale, no
// candle-freshness exception for XAUUSD. Used to demonstrate what the bug actually did.
function evaluatePairHitOldBehavior(
  signal: SignalLike,
  market: MarketPriceLike,
  candleStoreForPair: Candle[]
): HitResult {
  if (market.isStale) {
    return { evaluated: false, slHit: false, tp1Hit: false, tp2Hit: false };
  }
  const price = market.price;
  const isBuy = signal.type === 'BUY';
  const allCandles = candleStoreForPair;
  const signalCreatedMs = new Date(signal.createdAt).getTime();
  let highSample = price;
  let lowSample = price;
  for (const c of allCandles) {
    if (c.time < signalCreatedMs) continue;
    if (c.high > highSample) highSample = c.high;
    if (c.low < lowSample) lowSample = c.low;
  }
  const slHit = isBuy ? lowSample <= signal.stopLoss : highSample >= signal.stopLoss;
  const tp1Hit = isBuy ? highSample >= signal.takeProfit1 : lowSample <= signal.takeProfit1;
  const tp2Hit = isBuy ? highSample >= signal.takeProfit2 : lowSample <= signal.takeProfit2;
  return { evaluated: true, slHit, tp1Hit, tp2Hit };
}

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    console.log(`  OK   ${label}`);
    passed++;
  } else {
    console.log(`  FAIL ${label}`);
    failed++;
  }
}

const now = Date.now();
const signalCreated = new Date(now - 10 * 60 * 1000).toISOString(); // signal created 10 min ago

console.log('[Scenario 1] Baseline: price feed fresh, price itself crosses SL directly (no candle needed)');
{
  const signal: SignalLike = { type: 'BUY', stopLoss: 4592.20, takeProfit1: 4598.34, takeProfit2: 4599.18, createdAt: signalCreated };
  const market: MarketPriceLike = { price: 4591.50, isStale: false }; // price below SL
  const result = evaluatePairHit('XAUUSD', signal, market, [], []);
  check('evaluated (not skipped)', result.evaluated);
  check('SL hit detected', result.slHit);
}

console.log('\n[Scenario 2] THE BUG CASE: point price feed stale, but XAUUSD candle data (independent source) is fresh and shows a real SL breach');
{
  const signal: SignalLike = { type: 'BUY', stopLoss: 4592.20, takeProfit1: 4598.34, takeProfit2: 4599.18, createdAt: signalCreated };
  const market: MarketPriceLike = { price: 4596.00, isStale: true }; // stale point price, still above SL (this is what a UI reading only currentPrices would show)
  const freshXauCandles: Candle[] = [
    // A real candle, 2 minutes old (well within freshness threshold), whose LOW genuinely
    // breached the SL - this is the real-world case: gold-api.com's point price feed hiccups
    // (isStale flips true) while Twelve Data's independently-polled candles already captured a
    // real wick through SL.
    { time: now - 2 * 60 * 1000, open: 4596.50, high: 4596.80, low: 4591.90, close: 4596.10, volume: 0 },
  ];

  const oldResult = evaluatePairHitOldBehavior(signal, market, freshXauCandles);
  check('OLD behavior: evaluation was skipped entirely (this was the bug)', oldResult.evaluated === false);

  const newResult = evaluatePairHit('XAUUSD', signal, market, freshXauCandles, freshXauCandles);
  check('NEW behavior: evaluation proceeds despite stale point price', newResult.evaluated === true);
  check('NEW behavior: SL hit correctly detected from fresh candle data', newResult.slHit === true);
}

console.log('\n[Scenario 3] Negative control: point price stale AND candle data also genuinely stale (>15min old) - must still skip, no false evaluation from ancient data');
{
  const signal: SignalLike = { type: 'BUY', stopLoss: 4592.20, takeProfit1: 4598.34, takeProfit2: 4599.18, createdAt: signalCreated };
  const market: MarketPriceLike = { price: 4596.00, isStale: true };
  const staleXauCandles: Candle[] = [
    { time: now - 20 * 60 * 1000, open: 4596.50, high: 4596.80, low: 4591.90, close: 4596.10, volume: 0 }, // 20 min old - past XAU_CANDLE_STALE_THRESHOLD_MS
  ];
  const result = evaluatePairHit('XAUUSD', signal, market, staleXauCandles, staleXauCandles);
  check('correctly skipped - candle data itself is too old to trust', result.evaluated === false);
}

console.log('\n[Scenario 4] Non-XAUUSD pairs are unaffected: stale price + a fabricated "fresh candle" must still skip (fix is XAUUSD-only, other pairs share one fetch source so this scenario cannot occur for them anyway)');
{
  const signal: SignalLike = { type: 'BUY', stopLoss: 1.0800, takeProfit1: 1.0850, takeProfit2: 1.0870, createdAt: signalCreated };
  const market: MarketPriceLike = { price: 1.0820, isStale: true };
  const freshCandles: Candle[] = [
    { time: now - 2 * 60 * 1000, open: 1.0820, high: 1.0825, low: 1.0790, close: 1.0820, volume: 0 },
  ];
  const result = evaluatePairHit('EURUSD', signal, market, freshCandles, []); // pairId !== 'XAUUSD'
  check('EURUSD still skipped on stale price regardless of candle freshness', result.evaluated === false);
}

console.log('\n[Scenario 5] No regression: XAUUSD with fresh price behaves exactly as before (candle scan still catches a spike the tick loop might have missed)');
{
  const signal: SignalLike = { type: 'SELL', stopLoss: 4599.00, takeProfit1: 4593.00, takeProfit2: 4591.00, createdAt: signalCreated };
  const market: MarketPriceLike = { price: 4596.00, isStale: false }; // current tick price hasn't crossed SL
  const candlesWithSpike: Candle[] = [
    { time: now - 3 * 60 * 1000, open: 4596.00, high: 4599.50, low: 4595.80, close: 4596.10, volume: 0 }, // a spike above SL that already reverted
  ];
  const result = evaluatePairHit('XAUUSD', signal, market, candlesWithSpike, candlesWithSpike);
  check('evaluated normally (price fresh)', result.evaluated === true);
  check('SL hit still detected via the candle-scan spike, not just the current price', result.slHit === true);
}

console.log(`\n===== XAUUSD signal-status staleness tests: ${passed} passed, ${failed} failed =====`);
process.exit(failed === 0 ? 0 : 1);
