// Investigation-only script: is GC=F (Yahoo Gold futures) usable as a backup OHLC candle source
// for candleStore.XAUUSD when the primary XAUUSD=X symbol fails (see the "symbol may be
// delisted" 404 documented in scripts/backtest-xau-engine.ts and this session's chat history)?
//
// This does NOT change any live source - it only measures the current basis (futures price minus
// real spot price) so a human can judge whether a fixed/dynamic offset correction would be safe
// enough to show GC=F-derived levels to users as if they were real XAUUSD spot trading levels.
//
// Run: npx tsx scripts/check-xau-gcf-basis.ts
// (Needs real internet access - this sandbox's own egress to these domains is blocked, same
// constraint documented for scripts/backtest-xau-engine.ts. Run via GitHub Actions or locally.)

async function fetchYahooQuote(symbol: string): Promise<{ price: number; time: number } | { error: string }> {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HEVORA/1.0' },
    });
    const bodyText = await res.text();
    if (!res.ok) return { error: `HTTP ${res.status} - ${bodyText.slice(0, 200)}` };
    const json = JSON.parse(bodyText);
    const result = json?.chart?.result?.[0];
    if (!result?.meta?.regularMarketPrice) return { error: 'No regularMarketPrice in response' };
    return { price: result.meta.regularMarketPrice, time: (result.meta.regularMarketTime || 0) * 1000 };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

async function fetchGoldApiSpot(): Promise<{ price: number } | { error: string }> {
  try {
    const res = await fetch('https://api.gold-api.com/price/XAU', {
      headers: { 'User-Agent': 'Mozilla/5.0 (HEVORA Terminal)' },
    });
    const bodyText = await res.text();
    if (!res.ok) return { error: `HTTP ${res.status} - ${bodyText.slice(0, 200)}` };
    const data = JSON.parse(bodyText);
    if (typeof data?.price !== 'number') return { error: `Unexpected shape: ${bodyText.slice(0, 200)}` };
    return { price: data.price };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

async function main() {
  console.log('=== GC=F vs real spot XAUUSD basis check ===\n');

  console.log('Fetching Yahoo XAUUSD=X (primary spot symbol)...');
  const xauusd = await fetchYahooQuote('XAUUSD=X');
  console.log('  ->', xauusd);

  console.log('\nFetching Yahoo GC=F (Gold futures, front month)...');
  const gcf = await fetchYahooQuote('GC=F');
  console.log('  ->', gcf);

  console.log('\nFetching api.gold-api.com (real spot XAU, the live server\'s own fallback #2)...');
  const goldApi = await fetchGoldApiSpot();
  console.log('  ->', goldApi);

  console.log('\n=== Basis analysis ===');

  const realSpot = 'price' in goldApi ? goldApi.price : ('price' in xauusd ? xauusd.price : null);
  const realSpotSource = 'price' in goldApi ? 'gold-api.com' : ('price' in xauusd ? 'XAUUSD=X' : null);

  if (realSpot === null) {
    console.log('Could not get ANY real spot reference (both XAUUSD=X and gold-api.com failed) - cannot compute basis this run.');
    return;
  }
  console.log(`Real spot reference: $${realSpot.toFixed(2)} (from ${realSpotSource})`);

  if (!('price' in gcf)) {
    console.log(`GC=F fetch failed (${gcf.error}) - cannot compute basis this run.`);
    return;
  }

  const basisDollars = gcf.price - realSpot;
  const basisPct = (basisDollars / realSpot) * 100;
  console.log(`GC=F price: $${gcf.price.toFixed(2)}`);
  console.log(`Basis (GC=F - spot): $${basisDollars.toFixed(2)} (${basisPct.toFixed(3)}%)`);

  console.log('\n=== Recommendation inputs (not a decision - see chat report) ===');
  console.log(`- A fixed dollar offset would need to be ${basisDollars >= 0 ? 'subtracted from' : 'added to'} GC=F to approximate spot right now.`);
  console.log('- Gold futures basis (cost-of-carry/contango) moves with time-to-expiry and interest rates, roll dates cause step-changes, and Yahoo GC=F itself is a continuous front-month series - a single offset measured once will drift and needs periodic re-measurement, not a one-time constant.');
  console.log('- This script only captures ONE point in time. Run it a few times across a day/week before trusting the basis is stable enough to correct for.');
}

main();
