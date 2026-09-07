// ============================================================================================
// ROUND 4 (Bagian C) - "add liquidation data from as many exchanges as possible, verified".
//
// Attempts a real WebSocket connection + subscribe against EVERY candidate exchange's public
// liquidation feed, from a real-internet machine (this sandbox has no egress to any of these
// hosts - see CLAUDE.md). One exchange's failure must never be assumed for another - every
// candidate below is tried independently, in parallel, and the raw first few messages from each
// are logged verbatim so a human (or a later Claude session) can eyeball side/unit conventions
// before any relay built from this is trusted.
//
// PASS bar (matches verify-bybit-liquidation-ws.ts's precedent, extended for exchanges without
// an explicit subscribe-ack): socket opens AND either (a) an explicit subscribe ack is received,
// or (b) the socket stays open with no error/close for the full run window after a subscribe
// frame was sent (weaker, logged as such). A count of REAL liquidation messages actually seen is
// reported separately and is what actually gates production inclusion per this round's own
// verification-gate requirement - a bare "opened+subscribed" is necessary but not sufficient to
// enable an exchange in /api/crypto/liquidations.
//
// Channel names/payload shapes below come from training-data knowledge of each exchange's public
// API docs, NOT from a live check before this script existed - that is exactly what this script
// verifies. Where confidence is low (Bitget, HTX, CoinEx), the comment says so explicitly and a
// failure there should be read as "no public liquidation endpoint found" rather than "network
// blocked", unless the socket itself never opens.
// ============================================================================================

const RUN_MS = 4 * 60_000; // 4 minutes per exchange, run concurrently - long enough to have a
// realistic (not guaranteed) chance of a real liquidation on BTC/ETH during normal volatility.

interface ExchangeResult {
  name: string;
  opened: boolean;
  subscribeAck: 'yes' | 'no-explicit-ack-but-stayed-open' | 'error' | 'never-opened';
  ackDetail?: string;
  liquidationEventsSeen: number;
  sampleRawMessages: string[];
  closedEarly: boolean;
  closeInfo?: string;
  errorInfo?: string;
}

function makeResult(name: string): ExchangeResult {
  return {
    name,
    opened: false,
    subscribeAck: 'never-opened',
    liquidationEventsSeen: 0,
    sampleRawMessages: [],
    closedEarly: false,
  };
}

function pushSample(result: ExchangeResult, raw: string): void {
  if (result.sampleRawMessages.length < 5) result.sampleRawMessages.push(raw.slice(0, 800));
}

async function runOne(
  name: string,
  wsUrl: string,
  onOpenSend: (sock: WebSocket) => void,
  onMessage: (raw: string, result: ExchangeResult) => void
): Promise<ExchangeResult> {
  const result = makeResult(name);
  if (typeof WebSocket === 'undefined') {
    result.errorInfo = 'No global WebSocket in this runtime.';
    return result;
  }

  console.log(`[${name}] Connecting to ${wsUrl} ...`);
  let sock: WebSocket;
  try {
    sock = new WebSocket(wsUrl);
  } catch (err: any) {
    result.errorInfo = `Failed to construct WebSocket: ${err?.message ?? err}`;
    return result;
  }

  let sentSubscribe = false;
  const startedAt = Date.now();

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), RUN_MS);

    sock.addEventListener('open', () => {
      result.opened = true;
      console.log(`[${name}] Socket opened.`);
      try {
        onOpenSend(sock);
        sentSubscribe = true;
      } catch (err: any) {
        result.errorInfo = `onOpenSend threw: ${err?.message ?? err}`;
      }
    });

    sock.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      if (!raw) return;
      pushSample(result, raw);
      try {
        onMessage(raw, result);
      } catch (err: any) {
        console.error(`[${name}] onMessage handler threw:`, err?.message ?? err);
      }
    });

    sock.addEventListener('error', (event) => {
      result.errorInfo = (event as any)?.message ?? String(event);
      console.error(`[${name}] WebSocket error:`, result.errorInfo);
    });

    sock.addEventListener('close', (event) => {
      const code = (event as any)?.code;
      const reason = (event as any)?.reason || 'n/a';
      result.closeInfo = `code=${code} reason=${reason}`;
      console.log(`[${name}] Socket closed (${result.closeInfo}).`);
      if (Date.now() < startedAt + RUN_MS - 2000) result.closedEarly = true;
      clearTimeout(timer);
      resolve();
    });
  });

  try {
    sock.close();
  } catch {
    // already closed
  }

  if (!result.opened) {
    result.subscribeAck = 'never-opened';
  } else if (result.subscribeAck === 'never-opened') {
    // No handler updated it to 'yes'/'error' - infer from whether we stayed connected.
    result.subscribeAck = result.closedEarly || !sentSubscribe ? 'error' : 'no-explicit-ack-but-stayed-open';
  }

  return result;
}

async function main(): Promise<void> {
  const results: Promise<ExchangeResult>[] = [];

  // --- OKX: liquidation-orders channel, instType-wide (SWAP), one subscribe covers every OKX
  // USDT-margined perpetual. Confidence: HIGH (documented public channel, no auth required). ---
  results.push(
    runOne(
      'OKX',
      'wss://ws.okx.com:8443/ws/v5/public',
      (sock) => sock.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'liquidation-orders', instType: 'SWAP' }] })),
      (raw, result) => {
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        if (parsed?.event === 'subscribe') {
          result.subscribeAck = 'yes';
          result.ackDetail = raw.slice(0, 300);
          return;
        }
        if (parsed?.event === 'error') {
          result.subscribeAck = 'error';
          result.ackDetail = raw.slice(0, 300);
          return;
        }
        if (parsed?.arg?.channel === 'liquidation-orders' && Array.isArray(parsed?.data)) {
          for (const d of parsed.data) {
            const details = Array.isArray(d?.details) ? d.details : [];
            result.liquidationEventsSeen += details.length || 1;
          }
          console.log('[OKX] Liquidation push:', raw.slice(0, 500));
        }
      }
    )
  );

  // --- Bitget: guessing channel name by analogy to OKX ("liquidation-orders") since public docs
  // recall is uncertain. Confidence: LOW - a subscribe error here means "no public liquidation
  // endpoint found (or wrong channel name)", not necessarily "network blocked". ---
  results.push(
    runOne(
      'Bitget',
      'wss://ws.bitget.com/v2/ws/public',
      (sock) =>
        sock.send(
          JSON.stringify({
            op: 'subscribe',
            args: [{ instType: 'USDT-FUTURES', channel: 'liquidation-orders', instId: 'default' }],
          })
        ),
      (raw, result) => {
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        if (parsed?.event === 'subscribe') {
          result.subscribeAck = 'yes';
          result.ackDetail = raw.slice(0, 300);
          return;
        }
        if (parsed?.event === 'error') {
          result.subscribeAck = 'error';
          result.ackDetail = raw.slice(0, 300);
          console.log('[Bitget] Subscribe error:', raw.slice(0, 300));
          return;
        }
        if (parsed?.action && parsed?.arg?.channel === 'liquidation-orders' && Array.isArray(parsed?.data)) {
          result.liquidationEventsSeen += parsed.data.length;
          console.log('[Bitget] Liquidation push:', raw.slice(0, 500));
        }
      }
    )
  );

  // --- Gate.io: futures.liquidates channel, USDT-margined contracts. Confidence: HIGH
  // (documented public futures WS channel). Subscribed per-symbol (payload is a list of
  // contracts), unlike OKX/Bitmex's instType-wide push. ---
  const GATE_SYMBOLS = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT'];
  results.push(
    runOne(
      'Gate.io',
      'wss://fx-ws.gateio.ws/v4/ws/usdt',
      (sock) =>
        sock.send(
          JSON.stringify({
            time: Math.floor(Date.now() / 1000),
            channel: 'futures.liquidates',
            event: 'subscribe',
            payload: GATE_SYMBOLS,
          })
        ),
      (raw, result) => {
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        if (parsed?.event === 'subscribe') {
          result.subscribeAck = parsed?.error ? 'error' : 'yes';
          result.ackDetail = raw.slice(0, 300);
          return;
        }
        if (parsed?.channel === 'futures.liquidates' && parsed?.event === 'update' && Array.isArray(parsed?.result)) {
          result.liquidationEventsSeen += parsed.result.length;
          console.log('[Gate.io] Liquidation push:', raw.slice(0, 500));
        }
      }
    )
  );

  // --- Deribit: no dedicated liquidation channel recalled - liquidations surface as trades with
  // a "liquidation" field set (M/T/MT). Subscribing to raw trades for BTC/ETH perpetuals and
  // filtering client-side. IMPORTANT CAVEAT (independent of whether this connects): Deribit's
  // PERPETUAL instruments are USD-denominated INVERSE contracts, a genuinely different product
  // from every other USDT-margined symbol this feature already tracks - even a clean connection
  // here should NOT be assumed poolable into the same BTCUSDT/ETHUSDT keys without deciding that
  // deliberately, not by default. Confidence on the channel/field existing: MEDIUM-HIGH. ---
  results.push(
    runOne(
      'Deribit',
      'wss://www.deribit.com/ws/api/v2',
      (sock) =>
        sock.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'public/subscribe',
            params: { channels: ['trades.BTC-PERPETUAL.raw', 'trades.ETH-PERPETUAL.raw'] },
          })
        ),
      (raw, result) => {
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        if (parsed?.id === 1 && parsed?.result) {
          result.subscribeAck = 'yes';
          result.ackDetail = raw.slice(0, 300);
          return;
        }
        if (parsed?.error) {
          result.subscribeAck = 'error';
          result.ackDetail = raw.slice(0, 300);
          return;
        }
        if (parsed?.method === 'subscription' && Array.isArray(parsed?.params?.data)) {
          const liqs = parsed.params.data.filter((t: any) => t?.liquidation);
          if (liqs.length > 0) {
            result.liquidationEventsSeen += liqs.length;
            console.log('[Deribit] Liquidation trade(s):', JSON.stringify(liqs).slice(0, 500));
          }
        }
      }
    )
  );

  // --- BitMEX: documented public "liquidation" topic, instrument-wide (not per-symbol scoped in
  // the subscribe itself - filtered client-side by the `symbol` field on each row). Confidence:
  // HIGH. Contracts of interest: XBTUSD (inverse) plus whatever USDT-margined symbols (XBTUSDT
  // etc.) actually appear - unit conversion (contracts -> USD) differs between the two and is
  // decided from real observed rows, not assumed upfront. ---
  results.push(
    runOne(
      'BitMEX',
      'wss://www.bitmex.com/realtime',
      (sock) => sock.send(JSON.stringify({ op: 'subscribe', args: ['liquidation'] })),
      (raw, result) => {
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        if (typeof parsed?.success === 'boolean') {
          result.subscribeAck = parsed.success ? 'yes' : 'error';
          result.ackDetail = raw.slice(0, 300);
          return;
        }
        if (parsed?.table === 'liquidation' && Array.isArray(parsed?.data)) {
          result.liquidationEventsSeen += parsed.data.length;
          console.log('[BitMEX] Liquidation push:', raw.slice(0, 500));
        }
      }
    )
  );

  // --- HTX (Huobi) linear swap public liquidation-orders channel. Confidence: LOW-MEDIUM (channel
  // name/format recalled, not verified) - a subscribe error or malformed response here should read
  // as "no public liquidation endpoint confirmed", not "blocked". ---
  results.push(
    runOne(
      'HTX',
      'wss://api.hbdm.com/linear-swap-ws',
      (sock) => sock.send(JSON.stringify({ sub: 'public.BTC-USDT.liquidation_orders', id: 'hevora1' })),
      (raw, result) => {
        // HTX's futures WS gzips frames by default in the browser client, but Node's ws/WebSocket
        // delivers the raw (possibly binary) frame - if `raw` isn't valid JSON text this exchange's
        // transport needs binary/gzip handling this script does not implement, which itself is a
        // real, reportable finding (not a silent pass).
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          result.ackDetail = `Non-JSON text frame (len=${raw.length}) - likely gzip-binary transport not handled by this script.`;
          return;
        }
        if (parsed?.status === 'ok' && parsed?.subbed) {
          result.subscribeAck = 'yes';
          result.ackDetail = raw.slice(0, 300);
          return;
        }
        if (parsed?.status === 'error') {
          result.subscribeAck = 'error';
          result.ackDetail = raw.slice(0, 300);
          return;
        }
        if (parsed?.ch === 'public.BTC-USDT.liquidation_orders' && Array.isArray(parsed?.data)) {
          result.liquidationEventsSeen += parsed.data.length;
          console.log('[HTX] Liquidation push:', raw.slice(0, 500));
        }
      }
    )
  );

  // --- CoinEx: no confirmed public liquidation channel recalled from training data at all (unlike
  // the others above, this isn't "channel name might be slightly off" - there may be no public
  // liquidation feed on CoinEx futures). Attempting a best-guess RPC-style subscribe just to see
  // what actually comes back; a clean error/rejection here should be read as "no public liquidation
  // endpoint" rather than partial credit. Confidence: VERY LOW. ---
  results.push(
    runOne(
      'CoinEx',
      'wss://socket.coinex.com/',
      (sock) => sock.send(JSON.stringify({ method: 'liquidate.subscribe', params: ['BTCUSDT'], id: 1 })),
      (raw, result) => {
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        if (parsed?.id === 1) {
          result.subscribeAck = parsed?.error ? 'error' : 'yes';
          result.ackDetail = raw.slice(0, 300);
          return;
        }
        if (parsed?.method === 'liquidate.update') {
          result.liquidationEventsSeen += 1;
          console.log('[CoinEx] Liquidation push:', raw.slice(0, 500));
        }
      }
    )
  );

  // --- Binance: REST already confirmed HTTP 451 from this hosting region (see
  // fetchBinanceCryptoData's own header comment in server.ts). Attempting the WS anyway per this
  // round's explicit instruction to not assume WS fails the same way without trying -
  // !forceOrder@arr is Binance USDⓈ-M Futures' documented public all-symbols liquidation stream,
  // no subscribe message needed (the stream is selected by the URL path itself). ---
  results.push(
    runOne(
      'Binance',
      'wss://fstream.binance.com/ws/!forceOrder@arr',
      () => {
        // No subscribe frame needed - the stream name is in the URL path.
      },
      (raw, result) => {
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        if (parsed?.e === 'forceOrder' && parsed?.o) {
          result.subscribeAck = 'yes';
          result.liquidationEventsSeen += 1;
          console.log('[Binance] Liquidation push:', raw.slice(0, 500));
        }
      }
    )
  );

  const all = await Promise.all(results);

  console.log('\n\n================ SUMMARY ================\n');
  for (const r of all) {
    console.log(`--- ${r.name} ---`);
    console.log(`  opened:                ${r.opened}`);
    console.log(`  subscribeAck:          ${r.subscribeAck}${r.ackDetail ? ` (${r.ackDetail})` : ''}`);
    console.log(`  closedEarly:           ${r.closedEarly}${r.closeInfo ? ` (${r.closeInfo})` : ''}`);
    console.log(`  errorInfo:             ${r.errorInfo ?? 'none'}`);
    console.log(`  liquidationEventsSeen: ${r.liquidationEventsSeen}`);
    if (r.sampleRawMessages.length > 0) {
      console.log(`  sample messages (first ${r.sampleRawMessages.length}):`);
      for (const m of r.sampleRawMessages) console.log(`    ${m}`);
    }
    console.log('');
  }

  console.log('=========================================\n');
  console.log(
    'NOTE: liquidationEventsSeen=0 for an exchange that opened+subscribed cleanly is NOT a fail - it means',
    'no real liquidation happened on the watched symbols during this run window (sporadic event), and per',
    'this round\'s own verification-gate requirement that exchange should NOT be counted in production yet',
    'until a run actually observes real events to sanity-check side/unit conventions against.'
  );

  process.exit(0);
}

main().catch((err) => {
  console.error('verify-multiexchange-liquidations failed:', err);
  process.exit(1);
});
