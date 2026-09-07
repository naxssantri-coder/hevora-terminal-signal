// ============================================================================================
// Live Desk audit (2026-09-06 follow-up) - real verification of every YouTube channel Live Desk
// references, for two completely different reasons that got conflated in an earlier report:
//
//   1. src/data/liveDeskVideoChannels.ts's 7 international 24/7 news channels - the frontend
//      embeds `youtube.com/embed/live_stream?channel=<id>`. A user reported DW News rendering a
//      broken-image icon instead of video. This sandbox cannot reach youtube.com at all (egress
//      proxy returns 403 for the whole domain - confirmed again while writing this script), so an
//      earlier claim that this was "verified working" was wrong: only the iframe's `src` attribute
//      was ever checked, never whether it actually resolves to a playable stream. This script is
//      the fix for that - run it on a machine with real internet (GitHub Actions) and it reports,
//      per channel: is yt-dlp's own live-check positive, AND does the exact embed URL the frontend
//      uses actually come back as a real player (not YouTube's "this live stream recording is not
//      available"/"video unavailable" fallback page).
//   2. scripts/live-intel-watcher.config.ts's 12 institutional 'youtube-channel' entries (Fed,
//      ECB, BOJ...) - these were wired up across earlier sessions from general knowledge/web-search
//      snippets, never opened directly, several explicitly marked LOWER CONFIDENCE. This checks
//      each one actually resolves to a channel, and that the channel's own real title matches the
//      institution it's supposed to be (catches a stale/wrong handle immediately, rather than it
//      silently publishing mislabeled transcripts under the wrong name).
//
// Run: npm run verify:live-desk-video-sources (requires yt-dlp on PATH - installed by the
// matching workflow's own step, same as live-intel-watcher.yml does).
//
// This is a read-only diagnostic - it never publishes anything, never calls the HEV server, and
// never fails the CI run just because a 24/7 channel happens to be between live segments at the
// moment it's checked (that's a real, expected state to report, not a bug in this script). It
// only exits non-zero on its own crash (network fully unreachable, yt-dlp missing, etc), so a
// green run always means "the checks actually ran and produced real answers", never "everything
// was live".
// ============================================================================================

import { execFile } from 'child_process';
import { promisify } from 'util';
import { LIVE_DESK_VIDEO_CHANNELS, liveDeskVideoChannelEmbedUrl } from '../src/data/liveDeskVideoChannels';
import { SOURCES } from './live-intel-watcher.config';

const execFileAsync = promisify(execFile);
const YT_DLP_TIMEOUT_MS = 30_000;
const YT_DLP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
}

async function ytDlpPrint(url: string, fields: string[]): Promise<{ ok: boolean; values: string[]; error: string }> {
  try {
    const args = ['--skip-download', '--no-playlist', '--quiet', '--no-warnings', '--user-agent', YT_DLP_USER_AGENT];
    for (const f of fields) args.push('--print', f);
    args.push(url);
    // killSignal: 'SIGKILL' (not Node's default SIGTERM) - a run of this script hung for 15+
    // minutes past its own YT_DLP_TIMEOUT_MS budget (confirmed live on GitHub Actions,
    // 2026-09-06), which only makes sense if some yt-dlp invocation ignored/outlived a SIGTERM
    // (e.g. blocked in an uninterruptible network read). `timeout` alone only sends a signal - it
    // does not guarantee the process (or something it spawned) actually dies, so execFileAsync's
    // promise can hang indefinitely regardless of the configured timeout. SIGKILL cannot be
    // ignored, so this bounds every single call for real.
    const { stdout } = await execFileAsync('yt-dlp', args, { timeout: YT_DLP_TIMEOUT_MS, killSignal: 'SIGKILL' });
    return { ok: true, values: stdout.trim().split('\n').map((l) => l.trim()), error: '' };
  } catch (err: any) {
    return { ok: false, values: [], error: (err?.stderr || err?.message || String(err)).toString().split('\n')[0].slice(0, 140) };
  }
}

// Fetches the exact embed URL the frontend puts in an <iframe src>, and inspects the returned
// HTML for YouTube's own known failure markers - a request that "succeeds" with HTTP 200 but is
// actually YouTube's error page is the precise bug shape the DW News report described (the
// browser sees a same-origin-policy-protected iframe that loaded FINE at the network level but
// shows nothing playable inside), so status code alone is not enough here.
async function checkEmbedUrl(embedUrl: string): Promise<{ httpStatus: number | null; looksPlayable: boolean; note: string }> {
  try {
    const res = await fetch(embedUrl, {
      headers: { 'User-Agent': YT_DLP_USER_AGENT },
      signal: AbortSignal.timeout(YT_DLP_TIMEOUT_MS),
    });
    const body = await res.text();
    const failureMarkers = [
      'This live event has ended',
      'This live stream recording is not available',
      'Video unavailable',
      'is unavailable',
      '"status":"ERROR"',
      '"status":"LOGIN_REQUIRED"',
      '"reason":"Video unavailable"',
    ];
    const hit = failureMarkers.find((m) => body.includes(m));
    if (!res.ok) return { httpStatus: res.status, looksPlayable: false, note: `HTTP ${res.status}` };
    if (hit) return { httpStatus: res.status, looksPlayable: false, note: `page contains failure marker: "${hit}"` };
    // A genuinely playable embed page contains YouTube's player config with a real videoId.
    const looksPlayable = /"videoId":"[A-Za-z0-9_-]{6,}"/.test(body) || /ytInitialPlayerResponse/.test(body);
    return { httpStatus: res.status, looksPlayable, note: looksPlayable ? 'player config found' : 'no player config / videoId found in response body' };
  } catch (err) {
    return { httpStatus: null, looksPlayable: false, note: err instanceof Error ? err.message : String(err) };
  }
}

async function checkInternationalChannel(ch: (typeof LIVE_DESK_VIDEO_CHANNELS)[number]) {
  const liveCheck = await ytDlpPrint(`${ch.channelUrl.replace(/\/+$/, '')}/live`, ['is_live', 'webpage_url', 'title']);
  const embedUrl = liveDeskVideoChannelEmbedUrl(ch);
  const embedCheck = await checkEmbedUrl(embedUrl);
  return {
    id: ch.id,
    label: ch.label,
    channelId: ch.channelId,
    confidence: ch.confidence,
    ytDlpIsLive: liveCheck.ok ? liveCheck.values[0] === 'True' || liveCheck.values[0] === 'true' : null,
    ytDlpTitle: liveCheck.ok ? liveCheck.values[2] || '' : '',
    ytDlpError: liveCheck.error,
    embedHttpStatus: embedCheck.httpStatus,
    embedLooksPlayable: embedCheck.looksPlayable,
    embedNote: embedCheck.note,
  };
}

async function checkInstitutionalChannel(source: Extract<(typeof SOURCES)[number], { kind: 'youtube-channel' }>) {
  const identity = await ytDlpPrint(source.channelUrl, ['channel', 'channel_id', 'uploader']);
  const liveCheck = await ytDlpPrint(`${source.channelUrl.replace(/\/+$/, '')}/live`, ['is_live']);
  return {
    id: source.id,
    label: source.label,
    channelUrl: source.channelUrl,
    resolvedOk: identity.ok,
    resolvedChannelTitle: identity.ok ? identity.values[0] || identity.values[2] || '' : '',
    resolvedChannelId: identity.ok ? identity.values[1] || '' : '',
    error: identity.error,
    currentlyLive: liveCheck.ok ? liveCheck.values[0] === 'True' || liveCheck.values[0] === 'true' : null,
  };
}

async function main(): Promise<void> {
  console.log('\n=== Part 1: International 24/7 video-embed channels (src/data/liveDeskVideoChannels.ts) ===\n');
  console.log(`${pad('CHANNEL', 26)}${pad('CONF.', 9)}${pad('YT-DLP LIVE?', 14)}${pad('EMBED HTTP', 12)}${pad('PLAYABLE?', 11)}NOTE`);
  console.log('-'.repeat(140));
  const intlResults = [];
  for (const ch of LIVE_DESK_VIDEO_CHANNELS) {
    process.stderr.write(`  checking ${ch.id}...\n`);
    const r = await checkInternationalChannel(ch);
    intlResults.push(r);
    console.log(
      `${pad(r.label, 26)}${pad(r.confidence, 9)}${pad(r.ytDlpIsLive === null ? `ERR: ${r.ytDlpError}` : String(r.ytDlpIsLive), 14)}${pad(String(r.embedHttpStatus ?? '-'), 12)}${pad(String(r.embedLooksPlayable), 11)}${r.embedNote}`
    );
    if (r.ytDlpTitle) console.log(`${' '.repeat(26)}yt-dlp resolved title: "${r.ytDlpTitle}"`);
  }

  console.log('\n=== Part 2: Institutional youtube-channel sources (scripts/live-intel-watcher.config.ts) ===\n');
  const institutional = SOURCES.filter((s): s is Extract<typeof s, { kind: 'youtube-channel' }> => s.kind === 'youtube-channel');
  console.log(`${pad('SOURCE ID', 32)}${pad('RESOLVED?', 11)}${pad('LIVE NOW?', 11)}${pad('RESOLVED CHANNEL TITLE', 40)}NOTE`);
  console.log('-'.repeat(140));
  const instResults = [];
  for (const s of institutional) {
    process.stderr.write(`  checking ${s.id}...\n`);
    const r = await checkInstitutionalChannel(s);
    instResults.push(r);
    console.log(
      `${pad(s.id, 32)}${pad(r.resolvedOk ? 'yes' : 'NO', 11)}${pad(r.currentlyLive === null ? '?' : String(r.currentlyLive), 11)}${pad(r.resolvedChannelTitle || '-', 40)}${r.resolvedOk ? '' : r.error}`
    );
  }

  console.log('\n=== SUMMARY ===');
  const playableCount = intlResults.filter((r) => r.embedLooksPlayable).length;
  console.log(`International channels: ${playableCount}/${intlResults.length} embed URLs currently resolve to a real playable player.`);
  console.log(
    intlResults
      .filter((r) => !r.embedLooksPlayable)
      .map((r) => `  - NOT playable right now: ${r.label} (${r.embedNote})`)
      .join('\n')
  );
  const unresolvedInst = instResults.filter((r) => !r.resolvedOk);
  console.log(`\nInstitutional channels: ${instResults.length - unresolvedInst.length}/${instResults.length} resolved successfully.`);
  if (unresolvedInst.length > 0) {
    console.log('  FAILED TO RESOLVE (fix these URLs):');
    unresolvedInst.forEach((r) => console.log(`  - ${r.id}: ${r.error}`));
  }
  console.log('\nDone. This script never fails the CI run on its own (a channel being off-air right now is real information, not a bug) - read the table above.');
  process.exit(0);
}

main().catch((err) => {
  console.error('verify-live-desk-video-sources crashed:', err);
  process.exit(1);
});

// Belt-and-suspenders hard deadline (2026-09-06, after a real hang on GitHub Actions outlived
// this script's own per-call yt-dlp timeouts - see ytDlpPrint's killSignal comment for the likely
// cause). 19 channels x 30s worst-case per check is ~10 minutes; this gives real headroom above
// that and still comfortably fits the workflow's own 15-minute timeout-minutes, so a genuine hang
// is reported as a script failure (exit 1) with a clear message instead of the job just going
// silent until GitHub's own timeout eventually kills it with no diagnostic output at all.
setTimeout(() => {
  console.error('\nHARD DEADLINE HIT (12 minutes) - something outlived its own timeout (see ytDlpPrint). Exiting non-zero rather than hanging further.');
  process.exit(1);
}, 12 * 60_000).unref?.();
