// ============================================================================================
// One-off probe: fetches OKX's real contract-value (ctVal) for the 7 USDT-margined SWAP
// instruments this project's liquidation feature tracks, from OKX's public REST
// /api/v5/public/instruments endpoint (no key required).
//
// Why this exists: the multi-exchange liquidation verification run (verify-multiexchange-
// liquidations.ts) confirmed OKX's public `liquidation-orders` channel works and produces real
// events, but each event's `sz` field is a number of CONTRACTS, not base-asset quantity directly
// (unlike Bybit's `v`, which already is base-asset quantity) - computing USD notional needs
// sz * ctVal * price, and ctVal must come from OKX itself, never guessed/assumed, per this
// project's own "never fabricate a number" discipline.
// ============================================================================================

const INST_IDS = [
  'BTC-USDT-SWAP',
  'ETH-USDT-SWAP',
  'SOL-USDT-SWAP',
  'BNB-USDT-SWAP',
  'XRP-USDT-SWAP',
  'ADA-USDT-SWAP',
  'DOGE-USDT-SWAP',
];

async function main(): Promise<void> {
  const upstream = await fetch('https://www.okx.com/api/v5/public/instruments?instType=SWAP', {
    headers: { 'User-Agent': 'HEVORA/1.0', Accept: 'application/json' },
  });
  console.log('HTTP status:', upstream.status);
  if (!upstream.ok) {
    console.error('FAIL: non-200 response.');
    process.exit(1);
  }
  const json: any = await upstream.json();
  const rows: any[] = Array.isArray(json?.data) ? json.data : [];
  console.log(`Total SWAP instruments returned: ${rows.length}`);

  console.log('\n--- RESULT (target instruments only) ---');
  const found: Record<string, any> = {};
  for (const instId of INST_IDS) {
    const row = rows.find((r) => r?.instId === instId);
    if (!row) {
      console.log(`${instId}: NOT FOUND`);
      continue;
    }
    found[instId] = row;
    console.log(
      `${instId}: ctVal=${row.ctVal} ctValCcy=${row.ctValCcy} ctType=${row.ctType} ctMult=${row.ctMult} lotSz=${row.lotSz} state=${row.state}`
    );
  }

  const missing = INST_IDS.filter((id) => !found[id]);
  if (missing.length > 0) {
    console.log(`\nMISSING: ${missing.join(', ')}`);
  }
  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('probe-okx-swap-ctval failed:', err);
  process.exit(1);
});
