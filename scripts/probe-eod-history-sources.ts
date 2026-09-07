// Bagian H, "History jangka panjang" (2026-09-01): investigate free Daily/Weekly/Monthly data
// sources before building anything - per this project's standing rule, never fabricate/backfill
// from a source that isn't actually confirmed free-forever and working. This sandbox's egress to
// every domain probed here is blocked (confirmed repeatedly on this project), so this only ever
// runs via GitHub Actions (real internet access) - same established workaround as every other
// investigation script in this repo.
//
// Two independent questions:
//   1. Crypto (BTC/ETH/SOL): do the exchange kline APIs this app ALREADY calls for live prices
//      (Bybit, Binance) support daily/weekly/monthly interval directly? If so, this needs no new
//      provider at all - just a different `interval` param on a call this app already makes.
//   2. XAU/forex: Yahoo Finance's intraday XAUUSD=X endpoint is confirmed permanently delisted
//      (404, verified repeatedly this project) - but does Yahoo's DAILY-granularity chart endpoint
//      (interval=1d) still work for XAUUSD=X or a forex pair like EURUSD=X, even though intraday
//      doesn't? Daily bars are a much smaller ask of a provider than 5-minute intraday, so it's
//      worth checking independently rather than assuming the same 404 applies.

async function probeBybitKline(symbol: string, interval: string, label: string) {
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${interval}&limit=5`;
  console.log(`\n=== Bybit ${label} (${symbol}, interval=${interval}) ===`);
  console.log(`GET ${url}`);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (HEVORA EOD probe)' } });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      console.log(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 400)}`);
      return;
    }
    const list = json?.result?.list;
    console.log(`HTTP ${res.status}, retCode=${json?.retCode}, retMsg=${json?.retMsg}, bars returned=${Array.isArray(list) ? list.length : 'n/a'}`);
    if (Array.isArray(list) && list.length > 0) {
      console.log(`Sample bar (newest-first per Bybit convention): ${JSON.stringify(list[0])}`);
    }
  } catch (e: any) {
    console.log(`FETCH FAILED: ${e?.message || e}`);
  }
}

async function probeKucoinKline(symbol: string, type: string, label: string) {
  const url = `https://api.kucoin.com/api/v1/market/candles?type=${type}&symbol=${symbol}`;
  console.log(`\n=== KuCoin ${label} (${symbol}, type=${type}) ===`);
  console.log(`GET ${url}`);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (HEVORA EOD probe)' } });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      console.log(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 400)}`);
      return;
    }
    const list = json?.data;
    console.log(`HTTP ${res.status}, code=${json?.code}, bars returned=${Array.isArray(list) ? list.length : 'n/a (msg: ' + JSON.stringify(json).slice(0, 200) + ')'}`);
    if (Array.isArray(list) && list.length > 0) {
      console.log(`Sample bar (newest-first per KuCoin convention): ${JSON.stringify(list[0])}`);
    }
  } catch (e: any) {
    console.log(`FETCH FAILED: ${e?.message || e}`);
  }
}

async function probeOkxKline(instId: string, bar: string, label: string) {
  const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=5`;
  console.log(`\n=== OKX ${label} (${instId}, bar=${bar}) ===`);
  console.log(`GET ${url}`);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (HEVORA EOD probe)' } });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      console.log(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 400)}`);
      return;
    }
    const list = json?.data;
    console.log(`HTTP ${res.status}, code=${json?.code}, msg=${json?.msg}, bars returned=${Array.isArray(list) ? list.length : 'n/a'}`);
    if (Array.isArray(list) && list.length > 0) {
      console.log(`Sample bar (newest-first per OKX convention): ${JSON.stringify(list[0])}`);
    }
  } catch (e: any) {
    console.log(`FETCH FAILED: ${e?.message || e}`);
  }
}

async function probeBinanceKline(symbol: string, interval: string, label: string) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=5`;
  console.log(`\n=== Binance ${label} (${symbol}, interval=${interval}) ===`);
  console.log(`GET ${url}`);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (HEVORA EOD probe)' } });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { console.log(`Non-JSON response: ${text.slice(0, 200)}`); return; }
    console.log(`HTTP ${res.status}, bars returned=${Array.isArray(json) ? json.length : 'n/a (error: ' + JSON.stringify(json).slice(0, 200) + ')'}`);
    if (Array.isArray(json) && json.length > 0) {
      console.log(`Sample bar: ${JSON.stringify(json[0])}`);
    }
  } catch (e: any) {
    console.log(`FETCH FAILED: ${e?.message || e}`);
  }
}

async function probeYahooDaily(symbol: string, label: string, interval = '1d', range = '2y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
  console.log(`\n=== Yahoo Finance ${interval.toUpperCase()} (${label}: ${symbol}) ===`);
  console.log(`GET ${url}`);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HEVORA EOD probe' } });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { console.log(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 300)}`); return; }
    const result = json?.chart?.result?.[0];
    const error = json?.chart?.error;
    if (error) {
      console.log(`HTTP ${res.status}, chart.error=${JSON.stringify(error)}`);
      return;
    }
    const timestamps = result?.timestamp || [];
    console.log(`HTTP ${res.status}, daily bars returned=${timestamps.length}`);
    if (timestamps.length > 0) {
      const quote = result.indicators?.quote?.[0];
      const first = { t: new Date(timestamps[0] * 1000).toISOString(), o: quote?.open?.[0], c: quote?.close?.[0] };
      const last = { t: new Date(timestamps[timestamps.length - 1] * 1000).toISOString(), o: quote?.open?.[timestamps.length - 1], c: quote?.close?.[timestamps.length - 1] };
      console.log(`Oldest bar: ${JSON.stringify(first)}`);
      console.log(`Newest bar: ${JSON.stringify(last)}`);
      console.log(`Real date range spanned: ~${((timestamps[timestamps.length - 1] - timestamps[0]) / 86400).toFixed(0)} days`);
    }
  } catch (e: any) {
    console.log(`FETCH FAILED: ${e?.message || e}`);
  }
}

async function main() {
  console.log('===== EOD/long-history data source investigation (Bagian H) =====');
  console.log(`Run at: ${new Date().toISOString()}`);

  console.log('\n\n----- PART 1: Crypto D/W/M via exchanges already used for live prices -----');
  await probeBybitKline('BTCUSDT', 'D', 'Daily');
  await probeBybitKline('BTCUSDT', 'W', 'Weekly');
  await probeBybitKline('BTCUSDT', 'M', 'Monthly');
  await probeBinanceKline('BTCUSDT', '1d', 'Daily');
  await probeBinanceKline('BTCUSDT', '1w', 'Weekly');
  await probeBinanceKline('BTCUSDT', '1M', 'Monthly');
  await probeKucoinKline('BTC-USDT', '1day', 'Daily');
  await probeKucoinKline('BTC-USDT', '1week', 'Weekly');
  await probeKucoinKline('BTC-USDT', '1month', 'Monthly (Bagian J follow-up - not tested in the first pass)');
  await probeOkxKline('BTC-USDT', '1D', 'Daily');
  await probeOkxKline('BTC-USDT', '1W', 'Weekly');
  await probeOkxKline('BTC-USDT', '1M', 'Monthly');

  console.log('\n\n----- PART 2: XAU/forex DAILY granularity (intraday XAUUSD=X confirmed delisted separately) -----');
  await probeYahooDaily('XAUUSD=X', 'XAUUSD spot');
  await probeYahooDaily('GC=F', 'Gold futures (front month) - fallback if XAUUSD=X daily also fails');
  await probeYahooDaily('EURUSD=X', 'EURUSD spot');

  console.log('\n\n----- PART 3 (Bagian J Tugas 1 follow-up): every forex pair individually, not assumed from EURUSD -----');
  await probeYahooDaily('GBPUSD=X', 'GBPUSD spot');
  await probeYahooDaily('USDCHF=X', 'USDCHF spot');
  await probeYahooDaily('USDCAD=X', 'USDCAD spot');

  console.log('\n\n----- PART 4 (Bagian J Tugas 1 follow-up): does Yahoo support native weekly/monthly interval directly, or must we aggregate daily bars ourselves? -----');
  await probeYahooDaily('GC=F', 'Gold futures - WEEKLY interval', '1wk', '5y');
  await probeYahooDaily('GC=F', 'Gold futures - MONTHLY interval', '1mo', 'max');
  await probeYahooDaily('EURUSD=X', 'EURUSD - WEEKLY interval', '1wk', '5y');
  await probeYahooDaily('EURUSD=X', 'EURUSD - MONTHLY interval', '1mo', 'max');

  console.log('\n\n===== Done. See PART 1-4 results above for real, verified answers - no assumption. =====');
}

main().catch((err) => {
  console.error('FATAL:', err?.message || err);
  process.exit(1);
});
