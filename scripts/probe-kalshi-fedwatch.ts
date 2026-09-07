// Makro > Kebijakan & Suku Bunga, "Probabilitas Rapat Berikutnya" (Kalshi replacement for the
// unavailable CME FedWatch slot): investigate the free, public, no-auth Kalshi market-data API
// before wiring anything into server.ts - per this project's standing rule, never build against an
// endpoint whose shape hasn't actually been confirmed. This sandbox's egress to
// api.elections.kalshi.com is blocked (confirmed via the agent proxy status: connect_rejected,
// gateway 403), so this only ever runs via GitHub Actions (real internet access) - same established
// workaround as every other investigation script in this repo.
//
// Three questions:
//   1. Does GET /events?series_ticker=KXFED&status=open return an event for the NEXT FOMC meeting
//      (ticker not hardcoded anywhere - the whole point is finding it dynamically each run)?
//   2. Does GET /markets?series_ticker=KXFED&status=open return per-threshold markets with
//      yes_bid/yes_ask (cents = 0-100 probability) for that event?
//   3. What do the actual field names/shapes look like, so server.ts's fetcher matches the real
//      API instead of a guessed schema?

const BASE = 'https://api.elections.kalshi.com/trade-api/v2';

async function probeEvents() {
  const url = `${BASE}/events?series_ticker=KXFED&status=open`;
  console.log(`\n=== Kalshi events (series_ticker=KXFED, status=open) ===`);
  console.log(`GET ${url}`);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (HEVORA Kalshi probe)' } });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      console.log(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 500)}`);
      return null;
    }
    const events = json?.events;
    console.log(`HTTP ${res.status}, events returned=${Array.isArray(events) ? events.length : 'n/a'}`);
    if (Array.isArray(events)) {
      for (const ev of events) {
        console.log(
          `  event_ticker=${ev.event_ticker} title=${JSON.stringify(ev.title)} sub_title=${JSON.stringify(ev.sub_title)} strike_date=${ev.strike_date} status=${ev.status}`
        );
      }
      if (events.length > 0) console.log(`Full sample event: ${JSON.stringify(events[0])}`);
    } else {
      console.log(`Full body: ${JSON.stringify(json).slice(0, 1000)}`);
    }
    return events?.[0]?.event_ticker ?? null;
  } catch (e: any) {
    console.log(`FETCH FAILED: ${e?.message || e}`);
    return null;
  }
}

async function probeMarketsForSeries() {
  const url = `${BASE}/markets?series_ticker=KXFED&status=open`;
  console.log(`\n=== Kalshi markets (series_ticker=KXFED, status=open) ===`);
  console.log(`GET ${url}`);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (HEVORA Kalshi probe)' } });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      console.log(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 500)}`);
      return;
    }
    const markets = json?.markets;
    console.log(`HTTP ${res.status}, markets returned=${Array.isArray(markets) ? markets.length : 'n/a'}`);
    if (Array.isArray(markets)) {
      for (const m of markets.slice(0, 12)) {
        console.log(
          `  ticker=${m.ticker} event_ticker=${m.event_ticker} title=${JSON.stringify(m.title)} yes_bid=${m.yes_bid} yes_ask=${m.yes_ask} status=${m.status} close_time=${m.close_time}`
        );
      }
      if (markets.length > 0) console.log(`Full sample market: ${JSON.stringify(markets[0])}`);
    } else {
      console.log(`Full body: ${JSON.stringify(json).slice(0, 1000)}`);
    }
  } catch (e: any) {
    console.log(`FETCH FAILED: ${e?.message || e}`);
  }
}

async function probeMarketsForEvent(eventTicker: string) {
  const url = `${BASE}/markets?event_ticker=${encodeURIComponent(eventTicker)}`;
  console.log(`\n=== Kalshi markets for event_ticker=${eventTicker} ===`);
  console.log(`GET ${url}`);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (HEVORA Kalshi probe)' } });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      console.log(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 500)}`);
      return;
    }
    const markets = json?.markets;
    console.log(`HTTP ${res.status}, markets returned=${Array.isArray(markets) ? markets.length : 'n/a'}`);
    if (Array.isArray(markets)) {
      for (const m of markets) {
        console.log(
          `  ticker=${m.ticker} title=${JSON.stringify(m.title)} yes_sub_title=${JSON.stringify(m.yes_sub_title)} yes_bid=${m.yes_bid} yes_ask=${m.yes_ask} last_price=${m.last_price} volume=${m.volume} status=${m.status}`
        );
      }
    }
  } catch (e: any) {
    console.log(`FETCH FAILED: ${e?.message || e}`);
  }
}

async function main() {
  const eventTicker = await probeEvents();
  await probeMarketsForSeries();
  if (eventTicker) await probeMarketsForEvent(eventTicker);
  console.log('\n=== Done ===');
}

main();
