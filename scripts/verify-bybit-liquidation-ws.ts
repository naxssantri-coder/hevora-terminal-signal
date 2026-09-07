// ============================================================================================
// Verifies Bybit's public `allLiquidation.{symbol}` WebSocket topic is actually reachable and
// answers a subscribe request, from a real-internet machine.
//
// Why this exists: server.ts already records (see fetchBinanceCryptoData's header comment, and
// verify-sources.ts's 'Crypto derivatives' group) that Bybit's plain REST endpoints return
// HTTP 403 from this hosting region AND from a prior CI-verified run - a broader block than just
// Render specifically. A WebSocket upgrade is a different connection path (and Bybit sometimes
// routes its stream.* hosts through different infrastructure than api.*), so it is not safe to
// assume it fails the same way without actually trying it - this script is that real try, per the
// explicit instruction to report a technical finding before deciding the liquidation feature is
// infeasible, rather than skipping it on assumption.
//
// Exit code 0: the socket opened AND Bybit acknowledged the subscribe request (proof the
// connection path itself works from this network - the strongest signal this script can produce
// without waiting for an actual liquidation event, which is sporadic and not guaranteed inside
// any short window).
// Exit code 1: the socket failed to open, or opened but no subscribe ack arrived in time.
//
// Also reports (non-blocking) whether any real liquidation message arrived during the run - a
// bonus signal, not a requirement, since liquidations do not happen on a fixed schedule.
// ============================================================================================

const WS_URL = 'wss://stream.bybit.com/v5/public/linear';
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const RUN_MS = 25_000;

async function main(): Promise<void> {
  if (typeof WebSocket === 'undefined') {
    console.error('No global WebSocket in this runtime (Node < 21?) - cannot run this check here.');
    process.exit(1);
  }

  console.log(`Connecting to ${WS_URL} ...`);
  const sock = new WebSocket(WS_URL);

  let subscribedOk = false;
  let liquidationMessagesSeen = 0;
  let opened = false;

  const done = new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), RUN_MS);

    sock.addEventListener('open', () => {
      opened = true;
      console.log('Socket opened. Sending subscribe request for:', SYMBOLS.join(', '));
      sock.send(JSON.stringify({ op: 'subscribe', args: SYMBOLS.map((s) => `allLiquidation.${s}`) }));
    });

    sock.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      if (!raw) return;
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (parsed?.op === 'subscribe') {
        subscribedOk = parsed?.success !== false;
        console.log('Subscribe ack:', JSON.stringify(parsed));
        return;
      }
      const topic = typeof parsed?.topic === 'string' ? parsed.topic : '';
      if (topic.startsWith('allLiquidation.')) {
        liquidationMessagesSeen += 1;
        console.log('Liquidation message:', JSON.stringify(parsed));
      }
    });

    sock.addEventListener('error', (event) => {
      console.error('WebSocket error:', (event as any)?.message ?? event);
    });

    sock.addEventListener('close', (event) => {
      console.log(`Socket closed (code=${(event as any)?.code}, reason=${(event as any)?.reason || 'n/a'}).`);
      clearTimeout(timer);
      resolve();
    });
  });

  await done;
  try {
    sock.close();
  } catch {
    // already closed
  }

  console.log('\n--- RESULT ---');
  console.log(`Socket opened:        ${opened}`);
  console.log(`Subscribe acked:      ${subscribedOk}`);
  console.log(`Liquidation messages seen in ${RUN_MS / 1000}s: ${liquidationMessagesSeen}`);

  if (opened && subscribedOk) {
    console.log('\nPASS: Bybit allLiquidation WebSocket is reachable and subscribable from this network.');
    process.exit(0);
  }

  console.log('\nFAIL: could not open+subscribe to Bybit\'s public liquidation WebSocket from this network.');
  process.exit(1);
}

main().catch((err) => {
  console.error('verify-bybit-liquidation-ws failed:', err);
  process.exit(1);
});
