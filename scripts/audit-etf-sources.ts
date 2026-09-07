// Pre-implementation audit for Part H (Crypto ETF Overview) - same "look at the real response
// before writing a parser" discipline this project applied to HTX after the BitMEX incident.
// This sandbox cannot reach farside.co.uk or Yahoo Finance (egress blocked, confirmed repeatedly
// on this project), so this only ever runs on GitHub Actions (real internet).
//
// Checks:
//   1. Farside Investors' Bitcoin ETF flow page (farside.co.uk/btc/) - is it reachable, does it
//      still serve an HTML table (not a paywall/JS-only render), and what does that table's real
//      structure (headers, most recent row) look like.
//   2. Yahoo Finance's chart endpoint (already used elsewhere in this project's server.ts, e.g.
//      fetchCommodityQuote) for a handful of real Bitcoin-ETF tickers - confirms
//      regularMarketPrice/regularMarketVolume/currency are actually present for THESE tickers
//      (equities, not the futures/FX symbols this project's existing Yahoo calls use) before any
//      fetcher code assumes they are.
//   3. Whether AUM/expense ratio appear ANYWHERE in that same Yahoo response, or need a different
//      (likely paid) source entirely - this is the specific thing the user needs a straight answer
//      on before Part H starts writing code that could be forced to guess at these two fields.

import * as cheerio from 'cheerio';

const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HEVORA/1.0';
const ETF_TICKERS = ['IBIT', 'FBTC', 'GBTC', 'BITB', 'ARKB', 'BITO', 'HODL', 'BRRR', 'EZBC', 'BTCO', 'BTCW'] as const;

async function auditFarside() {
  console.log('--- [1] Farside Investors: farside.co.uk/btc/ raw table structure ---');
  try {
    const res = await fetch('https://farside.co.uk/btc/', { headers: { 'User-Agent': YAHOO_UA } });
    console.log(`HTTP ${res.status}, content-type: ${res.headers.get('content-type')}`);
    if (!res.ok) return;
    const html = await res.text();
    console.log(`HTML length: ${html.length} bytes`);
    const $ = cheerio.load(html);
    const tables = $('table');
    console.log(`Found ${tables.length} <table> element(s) on the page.`);
    tables.each((i, table) => {
      const rows = $(table).find('tr');
      console.log(`Table ${i}: ${rows.length} row(s)`);
      if (rows.length === 0) return;
      // Header row (first row) - likely the ETF ticker symbols.
      const headerCells = $(rows[0])
        .find('th, td')
        .map((_, el) => $(el).text().trim())
        .get();
      console.log(`  Header row: ${JSON.stringify(headerCells)}`);
      // Last two data rows - the most recent flow figures.
      for (const rowIdx of [rows.length - 2, rows.length - 1]) {
        if (rowIdx < 1) continue;
        const cells = $(rows[rowIdx])
          .find('th, td')
          .map((_, el) => $(el).text().trim())
          .get();
        console.log(`  Row ${rowIdx}: ${JSON.stringify(cells)}`);
      }
    });
  } catch (err: any) {
    console.log(`Request failed - ${err?.message || err}`);
  }
  console.log('');
}

async function auditYahooEtfQuotes() {
  console.log('--- [2]+[3] Yahoo Finance chart endpoint for real Bitcoin ETF tickers (price/volume/AUM/expense ratio) ---');
  for (const ticker of ETF_TICKERS) {
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`, {
        headers: { 'User-Agent': YAHOO_UA },
      });
      if (!res.ok) {
        console.log(`${ticker}: HTTP ${res.status}`);
        continue;
      }
      const json: any = await res.json();
      const meta = json?.chart?.result?.[0]?.meta;
      if (!meta) {
        console.log(`${ticker}: no meta in response - ${JSON.stringify(json?.chart?.error)}`);
        continue;
      }
      // Print the whole meta object - this is exactly where AUM/expense ratio would show up if
      // Yahoo's chart endpoint carries them at all (it's not documented to, but confirming beats
      // assuming either way).
      console.log(`${ticker}: ${JSON.stringify(meta)}`);
    } catch (err: any) {
      console.log(`${ticker}: request failed - ${err?.message || err}`);
    }
  }
  console.log('');
}

async function main() {
  console.log('===== Part H (Crypto ETF Overview) data-source audit =====');
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log('');
  await auditFarside();
  await auditYahooEtfQuotes();
}

main().catch((err) => {
  console.error('Audit script crashed:', err);
  process.exit(1);
});
