// One-off investigation (2026-08-31 Render deploy-sync / news-pipeline audit): checks whether the
// HEV_SERVER_BASE_URL secret that live-intel-watcher.yml and delete-live-event.yml both publish to
// still points at a reachable, correct server - the leading hypothesis for "news stopped updating"
// is that this secret was never updated after the (dropped) home-server migration attempt and still
// points at a dead Cloudflare Quick Tunnel URL from that experiment, instead of the Render URL the
// project now exclusively uses.
//
// Deliberately never prints the secret's actual value or full URL - only a redacted hostname (GitHub
// Actions also auto-masks any literal secret-value match in logs, but this script doesn't rely on
// that alone). Hits only the public /api/prices endpoint (no admin auth needed) so this can run with
// just the one secret, read-only, no side effects.

const RAW_URL = process.env.HEV_SERVER_BASE_URL || '';

// The same production URL verify-xau-production.ts defaults to - known-good, confirmed serving
// real live data. Comparing HOSTNAMES (never printing either full URL) tells us whether
// HEV_SERVER_BASE_URL is pointed at this exact same Render service or a different one entirely,
// without exposing either secret/URL value.
const KNOWN_GOOD_HOST = 'hevora-terminal-signal-production-2.onrender.com';

function redactedHost(raw: string): string {
  if (!raw) return '(empty)';
  try {
    const u = new URL(raw);
    // Show enough to identify "which kind of host is this" (onrender.com vs a tunnel domain vs
    // something else) without printing the full subdomain/path, which could itself be sensitive.
    const host = u.hostname;
    const parts = host.split('.');
    const suffix = parts.length > 2 ? parts.slice(-2).join('.') : host;
    return `${'*'.repeat(Math.max(3, parts[0]?.length ?? 3))}.${suffix} (protocol=${u.protocol})`;
  } catch {
    return '(unparseable as a URL)';
  }
}

async function main() {
  console.log('===== HEV_SERVER_BASE_URL reachability check (news-pipeline audit) =====');
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log(`Secret configured: ${RAW_URL ? 'yes' : 'NO - HEV_SERVER_BASE_URL is empty/unset'}`);
  console.log(`Redacted target host: ${redactedHost(RAW_URL)}`);
  try {
    const hostname = new URL(RAW_URL).hostname;
    console.log(`Same host as the known-good verify-xau-production.ts default (${KNOWN_GOOD_HOST})? ${hostname === KNOWN_GOOD_HOST ? 'YES - same Render service' : 'NO - this is a DIFFERENT host'}`);
  } catch { /* already reported as unparseable above */ }
  console.log('');

  if (!RAW_URL) {
    console.log('VERDICT: secret is not set at all - live-intel-watcher.yml and delete-live-event.yml');
    console.log('would both fail immediately (basicAuthHeader/fetch would have nothing to call).');
    process.exitCode = 1;
    return;
  }

  const target = `${RAW_URL.replace(/\/$/, '')}/api/prices`;
  const startedAt = Date.now();
  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': 'HEVORA-live-intel-target-check/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    const elapsedMs = Date.now() - startedAt;
    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON, report raw length instead */ }

    console.log(`HTTP status: ${res.status} (in ${elapsedMs}ms)`);
    if (parsed && typeof parsed === 'object') {
      const keys = Object.keys(parsed);
      console.log(`Response parses as JSON with ${keys.length} top-level keys (expected: pair symbols like XAUUSD, BTCUSDT, ...).`);
      console.log(`Has XAUUSD entry: ${Boolean(parsed.XAUUSD)}${parsed.XAUUSD?.price ? ` (price=${parsed.XAUUSD.price})` : ''}`);
    } else {
      console.log(`Response body did NOT parse as JSON (length=${text.length}). First 200 chars: ${text.slice(0, 200)}`);
    }

    if (res.ok && parsed?.XAUUSD?.price) {
      console.log('VERDICT: HEV_SERVER_BASE_URL is reachable and serving real HEVORA price data - this secret is correctly pointed at the live server. If news is still stalled, look elsewhere (ADMIN_USERNAME/PASSWORD, the workflow schedule itself, or the watcher\'s own source config).');

      // Second probe: recent watcher runs show ai-autofill (POST /api/admin/live-events/ai-autofill)
      // failing with an HTML "This service has been suspended" page, then Cloudflare's "Just a
      // moment..." challenge page - neither of which this app's own Express server would ever
      // generate (a failed admin-auth check on THIS server returns a plain JSON 401, verified in
      // server.ts's requireAdminAuth). Hitting a DIFFERENT admin-gated GET endpoint with NO
      // credentials tells us whether requests are reaching the app at all: a JSON 401 back proves
      // they are (so whatever the watcher hit was a transient/different issue); an HTML page proves
      // something in front of the app (Render's own edge, or Cloudflare if this host is proxied
      // through it) is intercepting requests before they ever reach server.ts.
      console.log('');
      console.log('--- Second probe: does a request even reach this app, or get intercepted upstream? ---');
      try {
        const adminTarget = `${RAW_URL.replace(/\/$/, '')}/api/admin/verify`;
        const adminRes = await fetch(adminTarget, { headers: { 'User-Agent': 'HEVORA-live-intel-target-check/1.0' }, signal: AbortSignal.timeout(15000) });
        const adminText = await adminRes.text();
        console.log(`GET /api/admin/verify (no credentials) -> HTTP ${adminRes.status}`);
        if (adminText.trim().startsWith('{')) {
          console.log(`Response is JSON (reached this app's own requireAdminAuth): ${adminText.slice(0, 200)}`);
          console.log('VERDICT: requests DO reach this Express app normally - the watcher\'s ai-autofill failures are a separate/transient issue (e.g. a cold-start window), not systematic blocking.');
        } else {
          console.log(`Response is NOT JSON (first 300 chars): ${adminText.slice(0, 300)}`);
          console.log('VERDICT: this request did NOT reach the app\'s own auth check - something upstream (Render\'s edge during a cold/suspended state, or a Cloudflare proxy in front of this host) is intercepting requests before server.ts ever sees them. This is consistent with the "Service Suspended" / Cloudflare "Just a moment..." pages seen in recent live-intel-watcher.yml runs, and would explain 0-published runs even though this secret itself points at the right server.');
        }
      } catch (e: any) {
        console.log(`Second probe fetch failed: ${e?.name || 'Error'}: ${e?.message || e}`);
      }
    } else if (res.ok) {
      console.log('VERDICT: URL responds with HTTP 200 but the body does not look like this app\'s /api/prices - likely pointed at the WRONG server (e.g. a generic landing page, a different app, or a Cloudflare tunnel error page that still returns 200).');
    } else {
      console.log(`VERDICT: URL is reachable but returned HTTP ${res.status} (not ok) - the target may be up but this specific path/app is not what is expected.`);
    }
  } catch (e: any) {
    const elapsedMs = Date.now() - startedAt;
    console.log(`FETCH FAILED after ${elapsedMs}ms: ${e?.name || 'Error'}: ${e?.message || e}`);
    console.log('VERDICT: HEV_SERVER_BASE_URL is NOT reachable - this is consistent with the secret still');
    console.log('pointing at a dead/rotated Cloudflare Quick Tunnel URL from the dropped home-server');
    console.log('migration attempt. live-intel-watcher.yml and delete-live-event.yml would fail the same');
    console.log('way every time they run (their own basicAuthHeader() check happens after this same fetch');
    console.log('target, so this reachability failure is the root cause, not a credentials problem).');
    process.exitCode = 1;
  }
}

main();
