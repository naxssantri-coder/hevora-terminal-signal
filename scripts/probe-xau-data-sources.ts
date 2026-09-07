// One-off investigation probe (NOT committed to the repo, NOT run in the app) - checks, with real
// network access via GitHub Actions, whether public demo/free-tier endpoints for candidate XAUUSD
// OHLC data providers are reachable and what they actually return, so the audit report is based on
// real responses instead of possibly-stale docs. Every provider below ultimately requires the user
// to sign up for their own free API key for real use - these "demo"/keyless calls are only to
// confirm the provider serves XAU/USD intraday data at all and to see the real shape/limits of a
// free-tier response.
async function probe(name: string, url: string) {
  console.log(`\n=== ${name} ===`);
  console.log(`GET ${url}`);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (HEVORA investigation probe)' } });
    const text = await res.text();
    console.log(`HTTP ${res.status}`);
    console.log(text.slice(0, 800));
  } catch (e: any) {
    console.log(`ERROR: ${e?.message || e}`);
  }
}

async function main() {
  // Twelve Data: public "demo" API key, time_series endpoint, XAU/USD 5min bars
  await probe('Twelve Data (demo key)', 'https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=5min&outputsize=5&apikey=demo');

  // Alpha Vantage: public "demo" API key, FX_INTRADAY (documented to support XAU as a physical currency code)
  await probe('Alpha Vantage (demo key)', 'https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=XAU&to_symbol=USD&interval=5min&apikey=demo');

  // FCS API: free tier sample/demo call for XAUUSD
  await probe('FCS API (no key, expect auth error shape)', 'https://fcsapi.com/api-v3/forex/candle?symbol=XAU/USD&period=5m');

  // Metals.dev: check base reachability/shape (real endpoints need a key)
  await probe('Metals.dev (no key, expect auth error shape)', 'https://api.metals.dev/v1/latest?api_key=demo&currency=USD&unit=toz');

  // Finnhub: commodities/forex candle endpoint, no key (expect auth error, confirms reachability + error shape)
  await probe('Finnhub (no key, expect auth error shape)', 'https://finnhub.io/api/v1/forex/candle?symbol=OANDA:XAU_USD&resolution=5&from=0&to=9999999999');

  console.log('\nDone. Remember: every provider above needs the user to sign up for their own free API key for real production use - these calls only confirm reachability/shape, not a working production integration.');
}

main();
