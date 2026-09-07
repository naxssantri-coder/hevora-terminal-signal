// One-off audit (Institutional Watchlist full-page task, follow-up): two small open questions
// from the live verification of Part C batch 2-4:
//   1. Deribit answered ranking rows for only 2/7 pairs (BTC/ETH) - was the guessed
//      'SOL-PERPETUAL' instrument name simply wrong, or does Deribit genuinely not list a SOL
//      perpetual (and BNB/XRP/ADA/DOGE)? Queried straight from Deribit's own public
//      get_instruments endpoint rather than guessed again.
//   2. Gemini's BNB-USD price read ~$783 vs ~$751 everywhere else (a ~4% gap) - is this a parsing
//      bug in fetchGeminiRankingRow, or a genuinely thin/stale market on Gemini's own book? Prints
//      Gemini's raw ticker response (including its own volume+timestamp) so this can be judged
//      from the real data rather than assumed either way.
//
// Read-only, no app code touched by this script - a diagnostic run via GitHub Actions (real
// internet), same reason as every other verify-*/audit-*.ts script in this repo.

const DERIBIT_CURRENCIES = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'USDC'] as const;

async function auditDeribitInstruments() {
  console.log('--- [1] Deribit: real perpetual instrument names per currency ---');
  for (const currency of DERIBIT_CURRENCIES) {
    try {
      const res = await fetch(`https://www.deribit.com/api/v2/public/get_instruments?currency=${currency}&kind=future&expired=false`, {
        headers: { 'User-Agent': 'HEVORA-Audit/1.0' },
      });
      if (!res.ok) {
        console.log(`${currency}: HTTP ${res.status}`);
        continue;
      }
      const json: any = await res.json();
      const instruments: any[] = Array.isArray(json?.result) ? json.result : [];
      const perpetuals = instruments.filter((i) => i?.settlement_period === 'perpetual');
      if (perpetuals.length === 0) {
        console.log(`${currency}: no perpetual instruments listed (${instruments.length} non-perpetual future(s) found)`);
      } else {
        console.log(`${currency}: ${perpetuals.map((p) => p.instrument_name).join(', ')}`);
      }
    } catch (err: any) {
      console.log(`${currency}: request failed - ${err?.message || err}`);
    }
  }
  console.log('');
}

async function auditGeminiBnb() {
  console.log('--- [2] Gemini: raw bnbusd ticker (checking for a thin/stale market vs a parsing bug) ---');
  try {
    const res = await fetch('https://api.gemini.com/v1/pubticker/bnbusd', { headers: { 'User-Agent': 'HEVORA-Audit/1.0' } });
    console.log(`HTTP ${res.status}`);
    const json: any = await res.json();
    console.log(JSON.stringify(json, null, 2));
    if (json?.volume?.timestamp) {
      const ageMs = Date.now() - Number(json.volume.timestamp);
      console.log(`Ticker timestamp age: ${(ageMs / 60_000).toFixed(1)} minutes old`);
    }
    // Cross-check: Gemini's own 24h trade book depth for context (a v1 ticker is last-trade-price,
    // not a live quote - a thin book can show a real but old print).
    const bookRes = await fetch('https://api.gemini.com/v1/book/bnbusd?limit_bids=3&limit_asks=3', {
      headers: { 'User-Agent': 'HEVORA-Audit/1.0' },
    });
    if (bookRes.ok) {
      const book: any = await bookRes.json();
      console.log('Top of book:', JSON.stringify({ bids: book?.bids?.slice(0, 3), asks: book?.asks?.slice(0, 3) }, null, 2));
    }
  } catch (err: any) {
    console.log(`Request failed - ${err?.message || err}`);
  }
  console.log('');
}

const BITMEX_COINS = ['XBT', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE'] as const;

async function auditBitmexInstruments() {
  // Follow-up (this session): the guessed '{COIN}USDT' symbols shipped for BitMEX in Part C batch
  // 5 came back with prices 6-21% off every other exchange for SOL/XRP/ADA/DOGE and $0 or
  // implausible ($95B) 24h volume for several coins - a live-data anomaly, not a guess this time.
  // Querying BitMEX's own /api/v1/instrument/active (every currently tradable instrument) to see
  // what the REAL, currently-live symbol is per coin instead of guessing again.
  console.log('--- [3] BitMEX: real active instrument symbols per coin (fixing wrong Part C batch 5 data) ---');
  try {
    const res = await fetch('https://www.bitmex.com/api/v1/instrument/active', { headers: { 'User-Agent': 'HEVORA-Audit/1.0' } });
    if (!res.ok) {
      console.log(`HTTP ${res.status}`);
      return;
    }
    const instruments: any[] = await res.json();
    for (const coin of BITMEX_COINS) {
      // Every active instrument whose root or symbol mentions this coin - printed with enough
      // fields (lastPrice, turnover24h, volume24h, state) to tell a real liquid contract apart
      // from a stale/expired/quoted-but-dead one.
      const matches = instruments.filter(
        (i) => i?.rootSymbol === coin || (typeof i?.symbol === 'string' && i.symbol.startsWith(coin))
      );
      if (matches.length === 0) {
        console.log(`${coin}: no active instrument found`);
        continue;
      }
      for (const m of matches) {
        console.log(
          `${coin}: symbol=${m.symbol} state=${m.state} quoteCurrency=${m.quoteCurrency} lastPrice=${m.lastPrice} markPrice=${m.markPrice} turnover24h=${m.turnover24h} volume24h=${m.volume24h} fundingRate=${m.fundingRate} openInterest=${m.openInterest} multiplier=${m.multiplier}`
        );
      }
    }
  } catch (err: any) {
    console.log(`Request failed - ${err?.message || err}`);
  }
  console.log('');
}

const HTX_CONTRACTS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT', 'XRP-USDT', 'ADA-USDT', 'DOGE-USDT'] as const;

async function auditHtxContracts() {
  // Pre-emptive audit (learned from the BitMEX incident this session - never guess a schema and
  // ship it without seeing the real response first). Prints the raw HTX linear-swap
  // market/detail/merged response per contract so price/volume/funding field names and
  // real-vs-implausible values can be judged before any fetcher code is written.
  console.log('--- [4] HTX linear swap: raw market/detail/merged per contract (pre-implementation audit) ---');
  for (const contract of HTX_CONTRACTS) {
    try {
      const res = await fetch(`https://api.hbdm.com/linear-swap-ex/market/detail/merged?contract_code=${contract}`, {
        headers: { 'User-Agent': 'HEVORA-Audit/1.0' },
      });
      const json: any = await res.json().catch(() => null);
      console.log(`${contract}: HTTP ${res.status} - ${JSON.stringify(json?.tick ?? json)}`);
    } catch (err: any) {
      console.log(`${contract}: request failed - ${err?.message || err}`);
    }
  }
  console.log('');
  console.log('--- [5] HTX funding rate endpoint (separate call, per HTX docs) ---');
  try {
    const res = await fetch('https://api.hbdm.com/linear-swap-api/v1/swap_batch_funding_rate', {
      headers: { 'User-Agent': 'HEVORA-Audit/1.0' },
    });
    const json: any = await res.json().catch(() => null);
    const rows: any[] = Array.isArray(json?.data) ? json.data : [];
    const wanted = new Set(HTX_CONTRACTS as readonly string[]);
    for (const row of rows) {
      if (wanted.has(row?.contract_code)) console.log(JSON.stringify(row));
    }
  } catch (err: any) {
    console.log(`Request failed - ${err?.message || err}`);
  }
  console.log('');
}

const LBANK_SYMBOLS = ['btc_usdt', 'eth_usdt', 'sol_usdt', 'bnb_usdt', 'xrp_usdt', 'ada_usdt', 'doge_usdt'] as const;

async function auditLbank() {
  // Follow-up (Part C batch 6-8 live verification): LBank was completely absent from the
  // exchange-contribution tally (0/7) even though fetchLbankRankingRow looks correct against
  // LBank's documented v2 ticker.do schema. Printing the raw HTTP status + body per symbol,
  // and the exact headers/URL used by fetchLbankRankingRow, to see whether this is a wrong
  // symbol/schema guess (the HTX/BitMEX pattern) or something else (block, rate limit, etc).
  console.log('--- [6] LBank: raw v2 ticker.do response per symbol (0/7 in live verification - why) ---');
  for (const symbol of LBANK_SYMBOLS) {
    try {
      const res = await fetch(`https://api.lbkex.com/v2/ticker.do?symbol=${symbol}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HEVORA/1.0' },
      });
      const text = await res.text();
      console.log(`${symbol}: HTTP ${res.status} - ${text.slice(0, 500)}`);
    } catch (err: any) {
      console.log(`${symbol}: request failed - ${err?.message || err}`);
    }
  }
  console.log('');
}

async function main() {
  console.log('===== Deribit/Gemini/BitMEX/HTX/LBank audit =====');
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log('');
  await auditDeribitInstruments();
  await auditGeminiBnb();
  await auditBitmexInstruments();
  await auditHtxContracts();
  await auditLbank();
}

main().catch((err) => {
  console.error('Audit script crashed:', err);
  process.exit(1);
});
