// Investigation-only probe (not used by the live server) for the "Yahoo Finance XAUUSD=X returns
// HTTP 404 'symbol may be delisted'" report from production logs. Confirms, with real network
// access (run via GitHub Actions - this repo's dev sandbox has no egress to Yahoo Finance):
//   1. Whether XAUUSD=X is consistently 404 (repeated calls, a few seconds apart) - consistent
//      failure across several calls in a row is evidence of a persistent/permanent problem
//      (delisted/renamed symbol), not a one-off rate-limit blip.
//   2. Whether any alternative Yahoo symbol for spot gold (XAU=X, the older ticker some Yahoo
//      endpoints still recognize) responds where XAUUSD=X doesn't.
//   3. GC=F (Gold futures) as the known-working fallback already used by backtest-xau-engine.ts,
//      for comparison.
//
// Does NOT change any live source-selection logic - purely diagnostic.

async function fetchChart(symbol: string): Promise<{ ok: boolean; status: number; bodySnippet: string; price: number | null }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HEVORA/1.0' } });
    const bodyText = await res.text();
    let price: number | null = null;
    if (res.ok) {
      try {
        const json = JSON.parse(bodyText);
        price = json?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
      } catch {
        // fall through - bodySnippet below still shows the raw response
      }
    }
    return { ok: res.ok, status: res.status, bodySnippet: bodyText.slice(0, 250), price };
  } catch (e: any) {
    return { ok: false, status: -1, bodySnippet: `EXCEPTION: ${e?.message || e}`, price: null };
  }
}

async function main() {
  const symbols = ['XAUUSD=X', 'XAU=X', 'GC=F'];
  const ROUNDS = 3;
  const results: Record<string, Array<{ ok: boolean; status: number; price: number | null }>> = {};

  for (const symbol of symbols) results[symbol] = [];

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`\n=== Round ${round}/${ROUNDS} ===`);
    for (const symbol of symbols) {
      const r = await fetchChart(symbol);
      results[symbol].push({ ok: r.ok, status: r.status, price: r.price });
      console.log(`${symbol}: HTTP ${r.status}${r.ok ? ` price=${r.price}` : ''} - ${r.bodySnippet}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  console.log('\n=== Summary (consistent failure across all rounds = likely permanent, not rate-limit flapping) ===');
  for (const symbol of symbols) {
    const attempts = results[symbol];
    const successCount = attempts.filter((a) => a.ok).length;
    console.log(`${symbol}: ${successCount}/${attempts.length} succeeded - statuses [${attempts.map((a) => a.status).join(', ')}]`);
  }

  console.log('\nDone. If XAUUSD=X failed all rounds while GC=F succeeded all rounds, that is strong evidence the spot XAUUSD=X symbol itself is broken/delisted on Yahoo\'s side (not a transient rate-limit, which would typically show intermittent success even within a few seconds).');
}

main();
