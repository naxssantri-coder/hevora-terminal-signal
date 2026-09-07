// ============================================================================================
// Live Desk audit (2026-09-06) - one-off canary controller for the real OpenRouter audio-to-text
// pipeline, run via .github/workflows/live-desk-audio-canary.yml against the REAL production
// server (this sandbox cannot reach it directly - see verify-live-intel-target.ts). Never invoked
// automatically; workflow_dispatch only, with an explicit `action` input so a single accidental
// run can't silently flip production state.
//
// action=status  (default, read-only): GET /api/admin/live-desk-audio-health and print it. Safe
//   to run any time, changes nothing.
// action=enable: read health first; only if OPENROUTER_API_KEY is confirmed configured on the
//   server AND the kill switch is currently off does it POST settings {enabled: true}. Then
//   re-reads health to confirm. Never flips anything if the pre-conditions aren't already true -
//   this script does not configure OPENROUTER_API_KEY itself, only toggles the existing setting.
// action=disable: POST settings {enabled: false} - the safe-default direction, always allowed.
//
// Requires the same ADMIN_USERNAME/ADMIN_PASSWORD/HEV_SERVER_BASE_URL secrets live-intel-
// watcher.yml already uses. Never prints the secret values themselves.
// ============================================================================================

const BASE = (process.env.HEV_SERVER_BASE_URL || '').replace(/\/+$/, '');
const ACTION = process.env.CANARY_ACTION || 'status';

function basicAuthHeader(): string {
  const user = process.env.ADMIN_USERNAME;
  const pass = process.env.ADMIN_PASSWORD;
  if (!user || !pass) throw new Error('ADMIN_USERNAME/ADMIN_PASSWORD not configured.');
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function getHealth(): Promise<any> {
  const res = await fetch(`${BASE}/api/admin/live-desk-audio-health`, {
    headers: { Authorization: basicAuthHeader() },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* report raw below */ }
  return { status: res.status, ok: res.ok, parsed, raw: parsed ? null : text.slice(0, 500) };
}

async function postSettings(enabled: boolean): Promise<any> {
  const res = await fetch(`${BASE}/api/admin/live-desk-audio/settings`, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* report raw below */ }
  return { status: res.status, ok: res.ok, parsed, raw: parsed ? null : text.slice(0, 500) };
}

async function main(): Promise<void> {
  if (!BASE) {
    console.error('HEV_SERVER_BASE_URL is not set - cannot proceed.');
    process.exit(1);
  }
  console.log(`===== Live Desk audio canary - action=${ACTION} =====`);
  console.log(`Run at: ${new Date().toISOString()}`);

  console.log('\n--- Current health (before any change) ---');
  const before = await getHealth();
  console.log(`HTTP ${before.status}`);
  console.log(JSON.stringify(before.parsed ?? before.raw, null, 2));

  if (ACTION === 'status') {
    console.log('\naction=status: read-only, nothing changed.');
    return;
  }

  if (ACTION === 'enable') {
    const settings = before.parsed?.settings;
    const openRouterConfigured = before.parsed?.openRouterConfigured;
    console.log(`\nPre-flight: settings=${JSON.stringify(settings)}, openRouterConfigured=${openRouterConfigured}`);
    if (!openRouterConfigured) {
      console.log('\nABORTING: OPENROUTER_API_KEY is not configured on the server - enabling settings.enabled would do nothing useful (the worker itself refuses to start without it) and would leave a misleading "enabled" state persisted. Not proceeding.');
      process.exit(1);
    }
    if (settings?.killSwitchEnabled) {
      console.log('\nABORTING: kill switch is currently ON - refusing to enable over an active kill switch. Someone deliberately stopped this; flipping it back on here would override that decision without a human actually clearing the kill switch first.');
      process.exit(1);
    }
    console.log('\n--- Enabling (POST settings {enabled: true}) ---');
    const postResult = await postSettings(true);
    console.log(`HTTP ${postResult.status}`);
    console.log(JSON.stringify(postResult.parsed ?? postResult.raw, null, 2));

    // Give the watchdog (LIVE_DESK_AUDIO_WATCHDOG_INTERVAL_MS=5s in server.ts) a real chance to
    // spawn the worker before reading "after" health - reading immediately (as this script used to)
    // caught the settings flip but not whether the worker actually started or crashed.
    console.log('\nWaiting 12s for the watchdog to spawn the worker before re-checking health...');
    await new Promise((resolve) => setTimeout(resolve, 12_000));

    console.log('\n--- Health after enabling ---');
    const after = await getHealth();
    console.log(`HTTP ${after.status}`);
    console.log(JSON.stringify(after.parsed ?? after.raw, null, 2));
    return;
  }

  if (ACTION === 'disable') {
    console.log('\n--- Disabling (POST settings {enabled: false}) ---');
    const postResult = await postSettings(false);
    console.log(`HTTP ${postResult.status}`);
    console.log(JSON.stringify(postResult.parsed ?? postResult.raw, null, 2));

    console.log('\n--- Health after disabling ---');
    const after = await getHealth();
    console.log(`HTTP ${after.status}`);
    console.log(JSON.stringify(after.parsed ?? after.raw, null, 2));
    return;
  }

  console.error(`Unknown action "${ACTION}" - expected status|enable|disable.`);
  process.exit(1);
}

main().catch((err) => {
  console.error('live-desk-audio-canary failed:', err);
  process.exit(1);
});
