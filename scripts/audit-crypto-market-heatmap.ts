// One-off investigation (Bagian C2, CoinGlass parity task): the terminal's CryptoMarketHeatmap
// showed a single "USDC $5.0T" box dwarfing the rest of the top-30 volume heatmap. server.ts's
// /api/crypto/market-heatmap mapping (Number(c.total_volume) -> volume24hUsd,
// Number(c.market_cap) -> marketCapUsd) and CryptoMarketHeatmap.tsx's use of volume24hUsd for the
// treemap's `value` both read correct on inspection - no field swap or unit-scaling bug found in
// our own code. This script fetches CoinGecko's raw /coins/markets response directly (this sandbox
// has no egress to api.coingecko.com - confirmed, same block as every other external feed in this
// project) so it has to run on a GitHub Actions runner instead, to settle whether the $5T figure is
// real upstream data or something our own code is doing to it.
async function main() {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=30&page=1&sparkline=false&price_change_percentage=24h',
    { headers: { 'User-Agent': 'HEVORA/1.0', Accept: 'application/json' } }
  );
  console.log(`HTTP ${res.status}`);
  if (!res.ok) {
    console.log(await res.text());
    process.exit(1);
  }
  const json: any[] = await res.json();
  console.log(`rows: ${json.length}`);
  console.log('');
  console.log('rank | id | symbol | total_volume | market_cap | fully_diluted_valuation');
  json.forEach((c, i) => {
    console.log(
      `${i + 1} | ${c.id} | ${String(c.symbol).toUpperCase()} | ${c.total_volume} | ${c.market_cap} | ${c.fully_diluted_valuation}`
    );
  });

  console.log('');
  console.log('--- stablecoin rows (raw JSON) ---');
  for (const c of json) {
    const sym = String(c.symbol).toUpperCase();
    if (sym === 'USDC' || sym === 'USDT' || sym === 'DAI' || sym === 'FDUSD') {
      console.log(JSON.stringify(c, null, 2));
    }
  }
}

main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
