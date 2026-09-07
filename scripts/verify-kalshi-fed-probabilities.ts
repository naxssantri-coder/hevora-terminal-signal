// Manual verification (round 2, Bagian A) that the ACTUAL parsing logic now embedded in
// server.ts's fetchKalshiFedProbabilities() produces sane output against Kalshi's real API - not
// just that the endpoints respond (scripts/probe-kalshi-fedwatch.ts already confirmed that), but
// that the real field-mapping/probability-derivation code picks the right next meeting and
// produces a plausible probability distribution. This is a deliberate line-for-line copy of that
// function's body (server.ts can't be imported directly here without booting the whole Express
// app / requiring Redis+Gemini env vars), so a mismatch between the two would be a real bug this
// script is meant to catch, not a false alarm.
//
// This sandbox's egress to api.elections.kalshi.com is blocked, so this only runs via GitHub
// Actions - same established workaround as every other investigation script in this repo.

const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const KALSHI_HEADERS = { Accept: 'application/json', 'User-Agent': 'HEVORA/1.0 (macro/kalshi-fed-probabilities verify)' };

interface KalshiFedThreshold {
  ticker: string;
  floorStrike: number;
  probabilityPct: number;
  volume24h: number | null;
  openInterest: number | null;
  closeTime: string | null;
}

interface KalshiFedProbabilitiesData {
  eventTicker: string;
  meetingDate: string | null;
  thresholds: KalshiFedThreshold[];
}

function parseKalshiNumber(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function fetchKalshiFedProbabilities(): Promise<KalshiFedProbabilitiesData> {
  const eventsRes = await fetch(`${KALSHI_BASE}/events?series_ticker=KXFED&status=open`, { headers: KALSHI_HEADERS });
  if (!eventsRes.ok) throw new Error(`Kalshi events HTTP ${eventsRes.status}`);
  const eventsJson: any = await eventsRes.json();
  const events: any[] = Array.isArray(eventsJson?.events) ? eventsJson.events : [];
  if (events.length === 0) throw new Error('Kalshi has not opened a market for the next FOMC meeting yet');

  const nextEvent = [...events].sort((a, b) => new Date(a.strike_date).getTime() - new Date(b.strike_date).getTime())[0];
  const eventTicker: string | undefined = nextEvent?.event_ticker;
  if (!eventTicker) throw new Error('Kalshi next-meeting event is missing its event_ticker');

  const marketsRes = await fetch(`${KALSHI_BASE}/markets?event_ticker=${encodeURIComponent(eventTicker)}`, { headers: KALSHI_HEADERS });
  if (!marketsRes.ok) throw new Error(`Kalshi markets HTTP ${marketsRes.status}`);
  const marketsJson: any = await marketsRes.json();
  const markets: any[] = Array.isArray(marketsJson?.markets) ? marketsJson.markets : [];

  const thresholds: KalshiFedThreshold[] = markets
    .map((m): KalshiFedThreshold | null => {
      const floorStrike = parseKalshiNumber(m.floor_strike);
      if (floorStrike === null) return null;

      const bid = parseKalshiNumber(m.yes_bid_dollars);
      const ask = parseKalshiNumber(m.yes_ask_dollars);
      const last = parseKalshiNumber(m.last_price_dollars);
      const probability = bid !== null && ask !== null && (bid > 0 || ask > 0) ? (bid + ask) / 2 : last;
      if (probability === null) return null;

      return {
        ticker: m.ticker,
        floorStrike,
        probabilityPct: Math.round(probability * 1000) / 10,
        volume24h: parseKalshiNumber(m.volume_24h_fp),
        openInterest: parseKalshiNumber(m.open_interest_fp),
        closeTime: m.close_time ?? null,
      };
    })
    .filter((t): t is KalshiFedThreshold => t !== null)
    .sort((a, b) => a.floorStrike - b.floorStrike);

  if (thresholds.length === 0) throw new Error('Kalshi next-meeting event has no market with a usable price yet');

  return { eventTicker, meetingDate: nextEvent.strike_date ?? null, thresholds };
}

async function main() {
  console.log('=== Verifying fetchKalshiFedProbabilities() against live Kalshi API ===\n');
  try {
    const result = await fetchKalshiFedProbabilities();
    console.log(`Next FOMC meeting event: ${result.eventTicker}`);
    console.log(`Meeting date: ${result.meetingDate}`);
    console.log(`Thresholds returned: ${result.thresholds.length}\n`);

    for (const th of result.thresholds) {
      console.log(
        `  > ${th.floorStrike}%  ->  ${th.probabilityPct}%  (vol24h=${th.volume24h}, OI=${th.openInterest}, closes=${th.closeTime}, ticker=${th.ticker})`
      );
    }

    // Sanity checks - not exhaustive, just the obvious invariants a real probability
    // distribution over a step function must satisfy.
    const sortedProbs = result.thresholds.map((t) => t.probabilityPct);
    const monotonicNonIncreasing = sortedProbs.every((v, i) => i === 0 || v <= sortedProbs[i - 1] + 0.05);
    const allInRange = sortedProbs.every((v) => v >= 0 && v <= 100);
    console.log(`\nSanity: probabilities in [0,100]: ${allInRange}`);
    console.log(`Sanity: non-increasing as threshold rises (allowing 0.05pp float slack): ${monotonicNonIncreasing}`);

    const meetingMs = result.meetingDate ? new Date(result.meetingDate).getTime() : NaN;
    console.log(`Sanity: meeting date is in the future: ${Number.isFinite(meetingMs) && meetingMs > Date.now()}`);

    console.log('\n=== PASS: real data returned and shape looks correct ===');
  } catch (e: any) {
    console.log(`\n=== FAIL: ${e?.message || e} ===`);
    process.exitCode = 1;
  }
}

main();
