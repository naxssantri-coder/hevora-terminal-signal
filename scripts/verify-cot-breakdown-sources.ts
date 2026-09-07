// ============================================================================================
// One-off discovery/verification for the COT Heat Scan redesign (2026-09-02).
//
// The user asked for a Commercial/Non-Commercial/Leveraged Funds/Dealer breakdown. server.ts's
// existing /api/positioning/cot only ever fetches Non-Commercial long/short from the CFTC
// "Legacy" Socrata dataset (resource 6dca-aqww) - Commercial is probably in that same dataset
// (standard CFTC Legacy report column), but "Leveraged Funds" and "Dealer" are TERMINOLOGY FROM A
// DIFFERENT REPORT ENTIRELY (CFTC's "Traders in Financial Futures", TFF) - not columns that could
// exist on the Legacy dataset under any name. Never assumed here: this script fetches real sample
// rows and prints real field names, so nothing downstream gets built on a guessed schema.
//
// Same reason as every other verify:* script in this repo: this sandbox cannot reach CFTC's
// Socrata endpoint at all (egress blocked) - run via GitHub Actions, which has real internet.
//     bun run verify:cot-breakdown-sources
// ============================================================================================

import 'dotenv/config';

const TIMEOUT_MS = 20_000;
const HEADERS = { 'User-Agent': 'HEVORA/1.0', Accept: 'application/json' };

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`not JSON (first 200 chars): ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function printRow(label: string, row: any) {
  console.log(`\n--- ${label} ---`);
  if (!row) {
    console.log('  (no row)');
    return;
  }
  for (const [k, v] of Object.entries(row)) {
    console.log(`  ${k}: ${v}`);
  }
}

async function main() {
  console.log('='.repeat(90));
  console.log('1) COMMERCIAL FIELDS ON THE EXISTING LEGACY DATASET (resource 6dca-aqww)');
  console.log('   Server.ts already fetches this dataset for Non-Commercial long/short.');
  console.log('   Checking whether comm_positions_long_all / comm_positions_short_all exist and');
  console.log('   are populated for a real market (Gold, code 088691).');
  console.log('='.repeat(90));
  try {
    const legacyUrl =
      'https://publicreporting.cftc.gov/resource/6dca-aqww.json' +
      "?$where=cftc_contract_market_code='088691'" +
      '&$order=report_date_as_yyyy_mm_dd DESC&$limit=1';
    const rows = await fetchJson(legacyUrl);
    printRow('Legacy dataset, Gold (088691), most recent row - ALL fields', rows?.[0]);
    const row = rows?.[0];
    const commLong = row?.comm_positions_long_all;
    const commShort = row?.comm_positions_short_all;
    console.log(`\n  => comm_positions_long_all present: ${commLong !== undefined} (value: ${commLong})`);
    console.log(`  => comm_positions_short_all present: ${commShort !== undefined} (value: ${commShort})`);
  } catch (e: any) {
    console.log(`  FAILED: ${e?.message ?? e}`);
  }

  console.log('\n' + '='.repeat(90));
  console.log('2) DISCOVER THE TFF (Traders in Financial Futures) SOCRATA RESOURCE');
  console.log('   "Leveraged Funds" and "Dealer" are TFF-report category names - searching');
  console.log("   CFTC's own Socrata catalog rather than guessing a resource id.");
  console.log('='.repeat(90));
  // Collect EVERY "Futures Only" candidate id (the catalog returned two under the identical name
  // "TFF - Futures Only" - 98ig-3k9y and gpe5-46if - and one of them turned out to 403 as
  // "non-tabular", so trying only the first candidate isn't enough; each gets tried below until
  // one actually returns rows.
  let tffResourceId: string | null = null;
  const tffCandidates: string[] = [];
  try {
    const catalogUrl =
      'http://api.us.socrata.com/api/catalog/v1?domains=publicreporting.cftc.gov&search_context=publicreporting.cftc.gov&q=financial%20futures&limit=40';
    const catalog = await fetchJson(catalogUrl);
    const results = catalog?.results ?? [];
    console.log(`  Socrata catalog API: ${results.length} results for "financial futures"`);
    for (const r of results) {
      const id = r?.resource?.id;
      const name = r?.resource?.name;
      console.log(`    id=${id}  name="${name}"`);
      if (id && /futures only/i.test(String(name)) && /tff|financial/i.test(String(name))) {
        tffCandidates.push(id);
      }
    }
    tffResourceId = tffCandidates[0] ?? null;
  } catch (e: any) {
    console.log(`  Socrata catalog API FAILED: ${e?.message ?? e}`);
  }

  if (tffCandidates.length === 0) {
    // Fallback: Socrata's standard DCAT/data.json catalog (present on every Socrata portal at a
    // fixed path, no search-index quirks) and the classic /api/views.json listing - whichever
    // responds, filtered client-side for "financial futures" in the title.
    for (const listUrl of [
      'https://publicreporting.cftc.gov/api/views.json?count=2000',
      'https://publicreporting.cftc.gov/data.json',
    ]) {
      try {
        const data = await fetchJson(listUrl);
        const views: any[] = Array.isArray(data) ? data : Array.isArray(data?.dataset) ? data.dataset : [];
        console.log(`  Fallback listing ${listUrl}: ${views.length} entries`);
        // Dump every COT-related title regardless of the regex match below, so a naming mismatch
        // (e.g. "Traders in Financial Futures" without the literal words "futures only") is still
        // visible to read by hand instead of silently returning null.
        const cotRelated = views.filter((v) => /traders|commitment|futures/i.test(String(v?.name ?? v?.title ?? '')));
        console.log(`  ${cotRelated.length} COT-related titles in this listing:`);
        for (const v of cotRelated.slice(0, 60)) {
          const id = v?.id ?? (typeof v?.identifier === 'string' ? v.identifier.split('/').pop() : null);
          console.log(`    id=${id}  name="${v?.name ?? v?.title}"`);
        }
        const matches = views.filter((v) => {
          const name = String(v?.name ?? v?.title ?? '');
          return /tff|financial futures/i.test(name) && /futures only/i.test(name) && !/combined/i.test(name);
        });
        for (const v of matches) {
          const id = v?.id ?? (typeof v?.identifier === 'string' ? v.identifier.split('/').pop() : null);
          console.log(`    MATCH: id=${id}  name="${v?.name ?? v?.title}"`);
          if (id && !tffCandidates.includes(id)) tffCandidates.push(id);
        }
        if (tffCandidates.length > 0) break;
      } catch (e: any) {
        console.log(`  Fallback listing ${listUrl} FAILED: ${e?.message ?? e}`);
      }
    }
    tffResourceId = tffCandidates[0] ?? null;
  }
  console.log(`\n  => TFF candidate resource ids to try, in order: ${tffCandidates.join(', ') || '(none)'}`);

  // The catalog returned two resources both literally named "TFF - Futures Only" (98ig-3k9y and
  // gpe5-46if) - one of those 403'd as "non-tabular" when queried, so every candidate gets tried
  // in turn rather than trusting the first one found.
  let workingTffId: string | null = null;
  for (const candidate of tffCandidates) {
    console.log('\n' + '-'.repeat(90));
    console.log(`   Fetching 1 sample row from resource ${candidate} for EUR FX (code 099741)`);
    console.log('   to see real field names for Dealer / Asset Manager / Leveraged Funds / Other.');
    console.log('-'.repeat(90));
    try {
      const tffUrl =
        `https://publicreporting.cftc.gov/resource/${candidate}.json` +
        "?$where=cftc_contract_market_code='099741'" +
        '&$order=report_date_as_yyyy_mm_dd DESC&$limit=1';
      const rows = await fetchJson(tffUrl);
      printRow(`TFF dataset (${candidate}), EUR FX (099741), most recent row - ALL fields`, rows?.[0]);
      if (Array.isArray(rows) && rows.length > 0) {
        workingTffId = candidate;
        break;
      }
    } catch (e: any) {
      console.log(`  FAILED: ${e?.message ?? e}`);
    }
  }
  tffResourceId = workingTffId;
  console.log(`\n  => working TFF resource id: ${tffResourceId ?? '(none of the candidates returned data)'}`);

  if (tffResourceId) {
    console.log('\n' + '-'.repeat(90));
    console.log('   Checking whether Bitcoin (code 133741, currently tracked as CRYPTO) appears');
    console.log('   in the TFF dataset at all.');
    console.log('-'.repeat(90));
    try {
      const btcUrl =
        `https://publicreporting.cftc.gov/resource/${tffResourceId}.json` +
        "?$where=cftc_contract_market_code='133741'" +
        '&$order=report_date_as_yyyy_mm_dd DESC&$limit=1';
      const rows = await fetchJson(btcUrl);
      if (Array.isArray(rows) && rows.length > 0) {
        printRow('TFF dataset, Bitcoin (133741), most recent row', rows[0]);
      } else {
        console.log('  => no rows for 133741 in the TFF dataset (Bitcoin not covered by TFF)');
      }
    } catch (e: any) {
      console.log(`  FAILED: ${e?.message ?? e}`);
    }
  }

  console.log('\n' + '='.repeat(90));
  console.log('3) DISCOVER THE DISAGGREGATED SOCRATA RESOURCE (for physical commodities - Gold,');
  console.log('   Silver, Oil, Ags. TFF does NOT cover these; Disaggregated uses different');
  console.log('   category names: Producer/Merchant, Swap Dealers, Managed Money, Other Reportables.)');
  console.log('='.repeat(90));
  let disaggResourceId: string | null = null;
  try {
    const catalogUrl =
      'http://api.us.socrata.com/api/catalog/v1?domains=publicreporting.cftc.gov&search_context=publicreporting.cftc.gov&q=disaggregated&limit=40';
    const catalog = await fetchJson(catalogUrl);
    const results = catalog?.results ?? [];
    console.log(`  Socrata catalog API: ${results.length} results for "disaggregated"`);
    for (const r of results) {
      const id = r?.resource?.id;
      const name = r?.resource?.name;
      console.log(`    id=${id}  name="${name}"`);
      if (!disaggResourceId && /futures only/i.test(String(name))) disaggResourceId = id;
    }
  } catch (e: any) {
    console.log(`  Socrata catalog API FAILED: ${e?.message ?? e}`);
  }

  if (!disaggResourceId) {
    for (const listUrl of [
      'https://publicreporting.cftc.gov/api/views.json?count=2000',
      'https://publicreporting.cftc.gov/data.json',
    ]) {
      try {
        const data = await fetchJson(listUrl);
        const views: any[] = Array.isArray(data) ? data : Array.isArray(data?.dataset) ? data.dataset : [];
        console.log(`  Fallback listing ${listUrl}: ${views.length} entries`);
        const cotRelated = views.filter((v) => /traders|commitment|futures|disaggregated/i.test(String(v?.name ?? v?.title ?? '')));
        console.log(`  ${cotRelated.length} COT-related titles in this listing:`);
        for (const v of cotRelated.slice(0, 60)) {
          const id = v?.id ?? (typeof v?.identifier === 'string' ? v.identifier.split('/').pop() : null);
          console.log(`    id=${id}  name="${v?.name ?? v?.title}"`);
        }
        const matches = views.filter((v) => {
          const name = String(v?.name ?? v?.title ?? '');
          return /disaggregated/i.test(name) && /futures only/i.test(name) && !/combined/i.test(name);
        });
        for (const v of matches) {
          const id = v?.id ?? (typeof v?.identifier === 'string' ? v.identifier.split('/').pop() : null);
          console.log(`    MATCH: id=${id}  name="${v?.name ?? v?.title}"`);
          if (!disaggResourceId && id) disaggResourceId = id;
        }
        if (disaggResourceId) break;
      } catch (e: any) {
        console.log(`  Fallback listing ${listUrl} FAILED: ${e?.message ?? e}`);
      }
    }
  }
  console.log(`\n  => picked candidate Disaggregated resource id: ${disaggResourceId}`);

  if (disaggResourceId) {
    console.log('\n' + '-'.repeat(90));
    console.log(`   Fetching 1 sample row from resource ${disaggResourceId} for Gold (code 088691).`);
    console.log('-'.repeat(90));
    try {
      const url =
        `https://publicreporting.cftc.gov/resource/${disaggResourceId}.json` +
        "?$where=cftc_contract_market_code='088691'" +
        '&$order=report_date_as_yyyy_mm_dd DESC&$limit=1';
      const rows = await fetchJson(url);
      printRow(`Disaggregated dataset (${disaggResourceId}), Gold (088691), most recent row - ALL fields`, rows?.[0]);
    } catch (e: any) {
      console.log(`  FAILED: ${e?.message ?? e}`);
    }
  }

  console.log('\n' + '='.repeat(90));
  console.log('DONE - read the field names above before wiring anything into server.ts.');
  console.log('='.repeat(90));
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
