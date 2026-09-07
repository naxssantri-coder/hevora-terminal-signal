// ============================================================================================
// HEV Live Desk - real audio-to-text worker (Live Desk brief, Part 2).
//
// Standalone child process. Spawned and monitored EXCLUSIVELY by server.ts (see "Live Desk audio
// worker lifecycle" there) - never part of the main server's own event loop, and never started
// unless server.ts has already confirmed the persisted settings + OPENROUTER_API_KEY +
// LIVE_DESK_AUDIO_ENABLED all allow it. This script re-checks those same conditions itself on
// startup too (defensively, in case it's ever invoked by hand), and never assumes them.
//
// WHAT IT DOES: picks AT MOST ONE currently-live, audio-eligible official broadcast (a
// 'youtube-channel'/'youtube-live-captions' source in live-intel-watcher.config.ts that has
// `audioPriority` set), captures its audio in ~30s chunks via ffmpeg, sends each chunk to
// OpenRouter's speech-to-text endpoint, translates the result to Indonesian via a light/free
// OpenRouter chat model (falling back to a configured cheap paid model if the free one is
// unavailable/rate-limited), and publishes the result into the EXACT SAME LiveEvent pipeline the
// caption-based watcher (scripts/live-intel-watcher.ts) already uses - the same
// ai-autofill/publish/live-segment/finalize HTTP endpoints, so Live Desk's UI needs no changes to
// render an audio-sourced transcript vs a caption-sourced one. Some request/response plumbing
// below is intentionally duplicated (not imported) from live-intel-watcher.ts - these are two
// separately deployed/toggled processes with different lifecycles and different feature flags,
// so a shared import would couple them for no real benefit; the duplication is small and
// deliberate, same convention this codebase already uses elsewhere (see IntelView/
// LiveEventDetailPage's own YouTube-URL-helper duplication).
//
// ===== SAFETY - read this before touching any threshold below =====
// This project's absolute priority is the XAUUSD signal engine running on server.ts's own event
// loop (see CLAUDE.md). This script:
//   - runs entirely as its own OS process, spawned via child_process.spawn by server.ts - it can
//     never block a signal-engine tick by hogging Node's single JS thread, because it never
//     shares that thread.
//   - still competes for real CPU/memory on the SAME small Render instance. server.ts's own
//     circuit breaker (see getEngineTickHealthSnapshot/the audio worker lifecycle section there)
//     kills this process immediately if /api/admin/engine-tick-health shows the signal engine's
//     tick timing or event-loop lag degrading - this script does not (and cannot) decide that for
//     itself, since it can't see the main process's own timing from the outside.
//   - additionally self-limits: aborts this session (falls back to caption-only, via simply
//     exiting the audio loop and NOT touching the caption watcher's own independent process) after
//     repeated OpenRouter failures, and exits cleanly the instant its OWN memory footprint exceeds
//     a safety ceiling (LIVE_DESK_AUDIO_SELF_MEMORY_CEILING_MB) - never waits to be OOM-killed.
//   - processes exactly ONE broadcast at a time, chosen by audioPriority + the Economic
//     Calendar's currently-active High-impact currency as a tie-break (selectAudioSession below).
//
// A real load test (see the commit that introduced this file) measured this exact pipeline (a
// real-time-paced ffmpeg capture+encode, pinned to a single shared CPU core alongside a real
// running instance of this project's signal engine) and found NO measurable degradation in engine
// tick timing or event-loop lag. That test ran on different hardware than Render's actual 0.5
// CPU/512MB instance and used a synthetic audio source (no real network HLS stream, no real
// OpenRouter round trip) - treat it as encouraging evidence, not proof of production safety.
// Watch /api/admin/live-desk-audio-health closely the first few times this runs for a real
// broadcast in production, and trust the circuit breaker to do its job if something's wrong.
//
// Requires on PATH: ffmpeg (audio capture/transcode), yt-dlp (live-status + stream-URL
// resolution - https://github.com/yt-dlp/yt-dlp, same binary the caption watcher already needs).
// Requires in env: OPENROUTER_API_KEY, LIVE_DESK_AUDIO_ENABLED=true, ADMIN_USERNAME +
// (ADMIN_PASSWORD or ADMIN_PASSWORD_HASH) - same admin credentials server.ts's own admin auth
// already uses, so this worker authenticates to the API exactly like an admin would.
// ============================================================================================

import 'dotenv/config';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { SOURCES, RETRY_ATTEMPTS, RETRY_BASE_DELAY_MS, LIVE_LOOP_MAX_MS, HEV_SERVER_BASE_URL, type WatcherSourceConfig } from './live-intel-watcher.config';

const execFileAsync = promisify(execFile);
const SERVER_BASE_URL = HEV_SERVER_BASE_URL.replace(/\/+$/, '');

// ---------------------------------------------------------------------------------------------
// Configuration - every threshold that matters is a documented, overridable env var, not a magic
// number buried in logic. Defaults are deliberately conservative for a 0.5 CPU/512MB instance.
// ---------------------------------------------------------------------------------------------
const CHUNK_SECONDS = Number(process.env.LIVE_DESK_AUDIO_CHUNK_SECONDS) || 30;
// Whisper model via OpenRouter's OpenAI-compatible /api/v1/audio/transcriptions endpoint. Check
// https://openrouter.ai/models for the current recommended STT model before deploying - model
// availability/pricing on OpenRouter changes over time and this codebase has no live way to
// verify it (egress to openrouter.ai is not available from the environment this was written in).
const STT_MODEL = process.env.OPENROUTER_STT_MODEL || 'openai/whisper-large-v3';
// Light/free chat model for the Indonesian translation step - deliberately a SEPARATE call from
// STT (OpenRouter's transcription endpoint does not translate). VERIFY this model id is still
// live and still free at https://openrouter.ai/models before enabling - free-tier catalogs change.
const TRANSLATE_MODEL_PRIMARY = process.env.OPENROUTER_TRANSLATE_MODEL || 'meta-llama/llama-3.1-8b-instruct:free';
// Cheap PAID fallback if the free model above is rate-limited/unavailable (brief §3.3: "jangan
// sampai fitur mati total"). A real cost, unlike the primary model - this is why it's a distinct,
// explicitly-named env var rather than a silent default.
const TRANSLATE_MODEL_FALLBACK = process.env.OPENROUTER_TRANSLATE_FALLBACK_MODEL || 'openai/gpt-4o-mini';
// Approximate USD per minute of audio sent to the STT model - THIS IS AN ESTIMATE, not scraped
// live from OpenRouter's billing (no network access to do so from this codebase's environment).
// Override with your own observed rate from the OpenRouter dashboard once real usage exists - see
// GET /api/admin/live-desk-audio-health's costDisclaimer, which repeats this same caveat to the UI.
const COST_PER_AUDIO_MINUTE_USD = Number(process.env.LIVE_DESK_AUDIO_COST_PER_MINUTE_USD) || 0.006;
// Self circuit breaker: this worker exits cleanly (server.ts will see the exit and log it, not
// treat it as a crash needing alarm) the instant its OWN RSS crosses this ceiling - real headroom
// left for the main server process on the same 512MB box. server.ts's restart-with-backoff picks
// this worker back up on its own schedule; nothing is lost (in-progress chunk is simply retried
// as a fresh session next time this source is live).
const SELF_MEMORY_CEILING_MB = Number(process.env.LIVE_DESK_AUDIO_SELF_MEMORY_CEILING_MB) || 150;
const MAX_CONSECUTIVE_FAILURES = 3;
const POLL_INTERVAL_MS = 45_000; // how often to check "is anything audio-eligible live?" when idle
const CHUNK_TIMEOUT_MS = (CHUNK_SECONDS + 25) * 1000; // network stall protection per chunk capture
const HTTP_TIMEOUT_MS = 30_000;
// execFile has no default timeout - a slow/blocked network can otherwise leave a single yt-dlp
// live-check hanging far longer than makes sense for a "is this live right now?" poll, which then
// delays checking every OTHER candidate source behind it too (see selectAudioSession's sequential
// loop). Real-world finding (sandbox smoke test, documented in this feature's commit): without
// this, one slow/unreachable source silently consumed 40+ seconds before failing.
const YT_DLP_TIMEOUT_MS = 20_000;

const YT_DLP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Live Desk audit (2026-09-06), real-production canary bug found: this file used to call bare
// `execFileAsync('yt-dlp', ...)` everywhere, which only works if yt-dlp is on the OS PATH. It
// never is on Render - scripts/install-yt-dlp.sh downloads it to a LOCAL <project root>/bin/yt-dlp
// instead (see that script's own header comment for why: Render's build image has neither
// pip/python reliably nor a writable global bin dir). server.ts's resolveYtDlpBinary() and
// live-intel-watcher.ts's own copy of the same function already handle this correctly; THIS file
// never did - so the very first real-production canary run (enabled=true against the real
// server) crash-looped every ~5s with exit code 1, `checkYtDlpAvailable()` returning false every
// time. Duplicated here (not imported) for the same reason the rest of this file's yt-dlp helpers
// are duplicated - see the file header.
const YT_DLP_LOCAL_PATH = path.join(process.cwd(), 'bin', 'yt-dlp');
let resolvedYtDlpBinary: string | null = null;
function resolveYtDlpBinary(): string {
  if (resolvedYtDlpBinary) return resolvedYtDlpBinary;
  resolvedYtDlpBinary = fs.existsSync(YT_DLP_LOCAL_PATH) ? YT_DLP_LOCAL_PATH : 'yt-dlp';
  return resolvedYtDlpBinary;
}

function ts(): string {
  return new Date().toISOString();
}
const log = {
  info: (msg: string) => console.log(`[${ts()}] [INFO] [audio-worker] ${msg}`),
  warn: (msg: string) => console.warn(`[${ts()}] [WARN] [audio-worker] ${msg}`),
  error: (msg: string, err?: unknown) =>
    console.error(`[${ts()}] [ERROR] [audio-worker] ${msg}${err ? ' - ' + (err instanceof Error ? err.message : String(err)) : ''}`),
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = attempt === RETRY_ATTEMPTS - 1;
      log.warn(`${label} failed (attempt ${attempt + 1}/${RETRY_ATTEMPTS})${isLast ? '' : ', retrying...'}: ${err instanceof Error ? err.message : String(err)}`);
      if (!isLast) await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

function basicAuthHeader(): string {
  const user = process.env.ADMIN_USERNAME || '';
  const pass = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD_HASH || '';
  if (!user || !pass) throw new Error('ADMIN_USERNAME and (ADMIN_PASSWORD or ADMIN_PASSWORD_HASH) must be set in the environment.');
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

// ---------------------------------------------------------------------------------------------
// Local state - which source currently owns an in-progress LiveEvent session, so a worker
// restart (e.g. after the circuit breaker kills it, or a crash) resumes appending to the SAME
// event instead of publishing a duplicate. Same file/Redis-free convention as
// live-intel-watcher.ts's own state file (this worker deliberately does not touch that file - two
// independent processes, two independent state files).
// ---------------------------------------------------------------------------------------------
const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'live_desk_audio_worker_state.json');
interface AudioWorkerState {
  sessions: Record<string, { eventId: string; videoId: string }>;
}
let state: AudioWorkerState = { sessions: {} };
async function loadState(): Promise<void> {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(await fsp.readFile(STATE_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') state = { sessions: parsed.sessions || {} };
    }
  } catch {
    // Corrupt/missing state file - start fresh rather than crash.
  }
}
async function saveState(): Promise<void> {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    log.error('Failed to persist worker state', err);
  }
}

// ---------------------------------------------------------------------------------------------
// yt-dlp helpers - minimal subset of live-intel-watcher.ts's own resolution logic (that file's
// versions are not exported; see the file header for why a small duplication here is fine).
// ---------------------------------------------------------------------------------------------
async function checkYtDlpAvailable(): Promise<boolean> {
  try {
    await execFileAsync(resolveYtDlpBinary(), ['--version']);
    return true;
  } catch {
    return false;
  }
}
async function checkFfmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

interface LiveCheckResult {
  isLive: boolean;
  resolvedUrl: string | null;
}
// Deliberately NOT wrapped in withRetry's 3x exponential backoff - unlike a publish call (where
// losing a chunk is a real cost), a missed live-check this round is cheap: the poll loop simply
// tries this same source again next round (POLL_INTERVAL_MS when idle, or every round of an
// active session). Retrying 3x per source here would make a single poll cycle over
// audioEligibleSources() needlessly slow under any transient network hiccup, for no reliability
// benefit.
async function checkIsLive(url: string): Promise<LiveCheckResult> {
  try {
    const { stdout } = await execFileAsync(
      resolveYtDlpBinary(),
      ['--skip-download', '--no-playlist', '--quiet', '--no-warnings', '--user-agent', YT_DLP_USER_AGENT, '--print', 'webpage_url', '--print', 'is_live', url],
      { timeout: YT_DLP_TIMEOUT_MS }
    );
    const lines = stdout.trim().split('\n').map((l) => l.trim());
    const resolvedUrl = lines[0] && /^https?:\/\//.test(lines[0]) ? lines[0] : null;
    const isLive = (lines[1] || '').toLowerCase() === 'true';
    return { isLive, resolvedUrl };
  } catch (err) {
    log.warn(`yt-dlp live-check failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return { isLive: false, resolvedUrl: null };
  }
}

/** Resolves the direct, currently-valid audio-only stream URL for a live video - re-resolved
 *  fresh every chunk (HLS manifest URLs commonly rotate/expire within minutes). Audio-only
 *  (`-f bestaudio`) so this never downloads/decodes the video track - meaningfully less network
 *  and CPU than a video-capable pull would cost. */
async function resolveBestAudioUrl(videoUrl: string): Promise<string | null> {
  try {
    const { stdout } = await withRetry(`yt-dlp resolve-audio-url ${videoUrl}`, () =>
      execFileAsync(resolveYtDlpBinary(), ['-f', 'bestaudio', '-g', '--no-warnings', '--user-agent', YT_DLP_USER_AGENT, videoUrl], { timeout: YT_DLP_TIMEOUT_MS })
    );
    const url = stdout.trim().split('\n')[0]?.trim();
    return url && /^https?:\/\//.test(url) ? url : null;
  } catch (err) {
    log.warn(`Failed to resolve audio stream URL for ${videoUrl}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function extractYoutubeVideoId(url: string | null): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1);
    return u.searchParams.get('v') || '';
  } catch {
    return '';
  }
}

// Live Desk audit (2026-09-06): calendarGate check, same contract/caching as
// checkCspanEligibility in live-intel-watcher.ts (duplicated rather than imported - see this
// file's own header comment on why these two processes intentionally don't share code). Fails
// CLOSED on any error reaching the server - never treats a gated source as eligible just because
// the check itself couldn't complete.
const CALENDAR_GATE_CACHE_MS = 60_000;
let cspanGateCache: { checkedAt: number; eligible: boolean } | null = null;
async function checkCspanEligibility(): Promise<boolean> {
  if (cspanGateCache && Date.now() - cspanGateCache.checkedAt < CALENDAR_GATE_CACHE_MS) {
    return cspanGateCache.eligible;
  }
  try {
    const res = await fetch(`${SERVER_BASE_URL}/api/live-desk/cspan-eligibility`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    const eligible = res.ok && (await res.json())?.eligible === true;
    cspanGateCache = { checkedAt: Date.now(), eligible };
    return eligible;
  } catch (err) {
    log.warn(`Could not reach ${SERVER_BASE_URL}/api/live-desk/cspan-eligibility - treating C-SPAN as NOT audio-eligible this round: ${err instanceof Error ? err.message : String(err)}`);
    cspanGateCache = { checkedAt: Date.now(), eligible: false };
    return false;
  }
}

/** Audio-eligible candidate sources - see BaseSourceConfig.audioPriority's own doc comment in
 *  live-intel-watcher.config.ts. Only 'youtube-channel'/'youtube-live-captions' kinds can carry a
 *  resolvable live-video URL in the first place. Async because a `calendarGate`-tagged source (only
 *  C-SPAN today) needs a live check against the Economic Calendar before it can even be considered
 *  a candidate - see BaseSourceConfig.calendarGate's doc comment. */
async function audioEligibleSources(): Promise<Array<Extract<WatcherSourceConfig, { kind: 'youtube-channel' | 'youtube-live-captions' }>>> {
  const staticallyEligible = SOURCES.filter(
    (s): s is Extract<WatcherSourceConfig, { kind: 'youtube-channel' | 'youtube-live-captions' }> =>
      s.enabled && typeof (s as any).audioPriority === 'number' && (s.kind === 'youtube-channel' || s.kind === 'youtube-live-captions')
  );
  const gated = staticallyEligible.filter((s) => s.calendarGate);
  if (gated.length === 0) return staticallyEligible;
  const cspanOk = await checkCspanEligibility();
  return staticallyEligible.filter((s) => (s.calendarGate === 'congress-testimony' ? cspanOk : true));
}
function sourceCheckUrl(s: Extract<WatcherSourceConfig, { kind: 'youtube-channel' | 'youtube-live-captions' }>): string {
  return s.kind === 'youtube-channel' ? `${s.channelUrl.replace(/\/+$/, '')}/live` : s.videoUrl;
}

/** Best-effort tie-break when more than one audio-eligible source is live at once: prefer
 *  whichever currency has an active High-impact Kalender Ekonomi event right now (±30min) - real
 *  calendar data already served by this same server, not a new source. Returns null (no tie-break
 *  signal) on any failure - the caller then just falls back to plain audioPriority order. */
async function getActiveHighImpactCurrency(): Promise<string | null> {
  try {
    const res = await fetch(`${SERVER_BASE_URL}/api/calendar`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data: any = await res.json();
    const events: any[] = Array.isArray(data?.events) ? data.events : [];
    const now = Date.now();
    const active = events.find((e) => e?.impact === 'High' && typeof e?.dateISO === 'string' && Math.abs(new Date(e.dateISO).getTime() - now) <= 30 * 60_000);
    return active?.currency || null;
  } catch {
    return null;
  }
}
/** Rough currency guess from a source id, ONLY used for the tie-break above - never published,
 *  never affects which source is treated as eligible in the first place. */
function sourceCurrencyGuess(sourceId: string): string | null {
  if (sourceId.startsWith('fed-')) return 'USD';
  if (sourceId.startsWith('ecb-')) return 'EUR';
  if (sourceId.startsWith('boe-')) return 'GBP';
  if (sourceId.startsWith('boj-')) return 'JPY';
  if (sourceId.startsWith('bi-')) return 'IDR';
  // Live Desk audit (2026-09-06): C-SPAN only ever becomes audio-eligible around a USD
  // Congress-testimony window (see calendarGate) - without this, if C-SPAN and the Fed's own
  // channel were BOTH live at once during a genuinely USD-active moment, this tie-break would match
  // 'fed-' first and override C-SPAN's audioPriority: 0 (the highest/lowest-number priority,
  // specifically set because a Congressional Fed Chair testimony is exceptionally market-moving),
  // silently undoing that ranking. Mapping it explicitly keeps both signals pointing the same way.
  if (sourceId.startsWith('cspan-')) return 'USD';
  return null;
}

interface AudioSession {
  source: Extract<WatcherSourceConfig, { kind: 'youtube-channel' | 'youtube-live-captions' }>;
  resolvedVideoUrl: string;
  videoId: string;
}

/** Picks AT MOST ONE audio session to run right now - the single-active-broadcast rule (brief
 *  §2.2). Checks every audio-eligible source's live status (sequentially, not in parallel - no
 *  reason to burst several yt-dlp/network calls at once for a check that only needs to happen
 *  every POLL_INTERVAL_MS). */
async function selectAudioSession(): Promise<AudioSession | null> {
  const candidates = await audioEligibleSources();
  const live: AudioSession[] = [];
  for (const source of candidates) {
    const { isLive, resolvedUrl } = await checkIsLive(sourceCheckUrl(source));
    if (isLive && resolvedUrl) live.push({ source, resolvedVideoUrl: resolvedUrl, videoId: extractYoutubeVideoId(resolvedUrl) });
  }
  if (live.length === 0) return null;
  live.sort((a, b) => (a.source.audioPriority ?? 999) - (b.source.audioPriority ?? 999));
  if (live.length > 1) {
    const activeCurrency = await getActiveHighImpactCurrency();
    if (activeCurrency) {
      const match = live.find((x) => sourceCurrencyGuess(x.source.id) === activeCurrency);
      if (match) {
        log.info(`Multiple audio-eligible sources live at once; picked ${match.source.id} via active Calendar currency (${activeCurrency}) over plain priority order.`);
        return match;
      }
    }
    log.info(`Multiple audio-eligible sources live at once (${live.map((x) => x.source.id).join(', ')}); picked ${live[0].source.id} by audioPriority.`);
  }
  return live[0];
}

// ---------------------------------------------------------------------------------------------
// Audio capture (ffmpeg) - real-time-paced (-re) so this never reads faster than the stream
// actually produces data, matching how a genuine live capture behaves. Audio-only, low bitrate
// (32kbps mono 16kHz - already well above what a speech-recognition model needs, and keeps the
// per-chunk upload tiny, ~120KB for 30s).
// ---------------------------------------------------------------------------------------------
let currentFfmpeg: ChildProcess | null = null;

function captureChunk(streamUrl: string, outPath: string, seconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', ['-y', '-re', '-i', streamUrl, '-t', String(seconds), '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '32k', outPath, '-loglevel', 'error']);
    currentFfmpeg = ff;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      log.warn(`ffmpeg capture exceeded ${CHUNK_TIMEOUT_MS}ms (stream stall?) - killing and treating as a failed chunk.`);
      ff.kill('SIGKILL');
    }, CHUNK_TIMEOUT_MS);
    ff.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      currentFfmpeg = null;
      log.error('ffmpeg failed to start', err);
      resolve(false);
    });
    ff.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      currentFfmpeg = null;
      resolve(code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0);
    });
  });
}

// ---------------------------------------------------------------------------------------------
// OpenRouter calls - STT (audio/transcriptions) + translate (chat/completions). Uses Node 22's
// built-in fetch/FormData/Blob (this project's package.json already requires Node >=22) - no new
// HTTP client dependency needed.
// ---------------------------------------------------------------------------------------------
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

interface SttResult {
  text: string;
}
async function transcribeChunk(filePath: string): Promise<SttResult | null> {
  try {
    const buf = await fsp.readFile(filePath);
    const form = new FormData();
    form.append('model', STT_MODEL);
    form.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'chunk.mp3');
    const res = await withRetry('openrouter stt', async () => {
      const r = await fetch(`${OPENROUTER_BASE}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
        body: form,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`OpenRouter STT HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
      return r;
    });
    const body: any = await res.json();
    const text = typeof body?.text === 'string' ? body.text : '';
    return { text };
  } catch (err) {
    log.error('OpenRouter transcription failed after retries', err);
    return null;
  }
}

interface TranslateResult {
  ok: boolean;
  text: string;
  modelUsed: string | null;
}
async function callOpenRouterChat(model: string, text: string): Promise<string | null> {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'Anda adalah penerjemah. Terjemahkan teks berikut ke Bahasa Indonesia secara akurat dan alami. Balas HANYA dengan hasil terjemahan, tanpa komentar, tanpa tanda kutip tambahan.',
        },
        { role: 'user', content: text },
      ],
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OpenRouter chat HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body: any = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  return typeof content === 'string' && content.trim() ? content.trim() : null;
}

/** Translates original-language STT output to Indonesian. Tries the free model first; on ANY
 *  failure (rate limit, model unavailable, timeout) falls back to the configured cheap paid model
 *  ONCE - brief §3.3's explicit "jangan sampai fitur mati total" requirement. Never throws: a
 *  failed translation still returns the ORIGINAL text upstream (see runAudioSession) rather than
 *  losing the chunk. */
async function translateToIndonesian(text: string): Promise<TranslateResult> {
  try {
    const translated = await callOpenRouterChat(TRANSLATE_MODEL_PRIMARY, text);
    if (translated) return { ok: true, text: translated, modelUsed: TRANSLATE_MODEL_PRIMARY };
    throw new Error('empty response');
  } catch (err) {
    log.warn(`Primary translate model (${TRANSLATE_MODEL_PRIMARY}) failed, trying fallback (${TRANSLATE_MODEL_FALLBACK}): ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const translated = await callOpenRouterChat(TRANSLATE_MODEL_FALLBACK, text);
    if (translated) return { ok: true, text: translated, modelUsed: TRANSLATE_MODEL_FALLBACK };
  } catch (err) {
    log.error(`Fallback translate model (${TRANSLATE_MODEL_FALLBACK}) also failed`, err);
  }
  return { ok: false, text, modelUsed: null };
}

function estimateCostUsd(audioSeconds: number): number {
  return Number(((audioSeconds / 60) * COST_PER_AUDIO_MINUTE_USD).toFixed(6));
}

// ---------------------------------------------------------------------------------------------
// Publish pipeline - same HTTP endpoints live-intel-watcher.ts's YouTube caption path already
// uses (ai-autofill to start an event, live-segment to append each subsequent round). Reusing
// these means Live Desk's frontend, LiveEvent store, segment/pairImpact/tone analysis, and
// finalization logic all work identically regardless of whether the text came from captions or
// from this audio pipeline - no server.ts publish-side changes needed for this file to exist.
// ---------------------------------------------------------------------------------------------
interface AutofillResult {
  title: string;
  summary: string;
  tone: 'Hawkish' | 'Dovish' | 'Neutral';
  verdict: 'Bullish' | 'Bearish' | 'Neutral';
  impact: 'High' | 'Medium' | 'Low';
  [key: string]: unknown;
}
async function postAutofill(source: WatcherSourceConfig, rawTranscript: string): Promise<AutofillResult> {
  const res = await fetch(`${SERVER_BASE_URL}/api/admin/live-events/ai-autofill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: basicAuthHeader() },
    body: JSON.stringify({ rawTranscript, type: 'speech', speaker: source.label }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ai-autofill HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as AutofillResult;
}
async function postPublish(source: WatcherSourceConfig, rawTranscript: string, autofill: AutofillResult, videoUrl: string, liveVideoId: string): Promise<{ id: string; title: string }> {
  const res = await fetch(`${SERVER_BASE_URL}/api/admin/live-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: basicAuthHeader() },
    body: JSON.stringify({
      type: 'speech',
      speaker: source.label,
      rawTranscript,
      title: autofill.title,
      summary: autofill.summary,
      tone: autofill.tone,
      marketEffects: [],
      segments: (autofill as any).segments,
      causalChain: (autofill as any).causalChain,
      pairImpacts: (autofill as any).pairImpacts,
      verdict: autofill.verdict,
      impact: autofill.impact,
      source: `${source.label} (audio-STT)`,
      sourceUrl: videoUrl,
      ...(liveVideoId ? { liveVideoId } : {}),
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`live-events publish HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as { id: string; title: string };
}
async function postLiveSegment(eventId: string, newChunk: string, isFinal: boolean): Promise<{ ok: boolean; status?: string }> {
  try {
    const res = await fetch(`${SERVER_BASE_URL}/api/admin/live-events/${encodeURIComponent(eventId)}/live-segment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: basicAuthHeader() },
      body: JSON.stringify({ newChunk, isFinal }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`live-segment HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 300)}`);
    return { ok: true, status: body?.event?.liveSession?.status };
  } catch (err) {
    log.error(`Failed to PATCH live-segment for event ${eventId}`, err);
    return { ok: false };
  }
}

/** Best-effort usage/cost telemetry - a failure here NEVER interrupts the main capture/publish
 *  loop (cost logging is observability, not a gate on the feature working). */
async function logUsage(entry: {
  liveEventId: string | null;
  sourceId: string;
  audioSeconds: number;
  sttModel: string;
  translateModel: string | null;
  sttSuccess: boolean;
  translateSuccess: boolean;
}): Promise<void> {
  try {
    await fetch(`${SERVER_BASE_URL}/api/admin/live-desk-audio/usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: basicAuthHeader() },
      body: JSON.stringify({ ...entry, estimatedCostUsd: estimateCostUsd(entry.audioSeconds) }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    log.warn(`Failed to log usage telemetry (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// One full session for a single selected broadcast - runs until the stream ends, LIVE_LOOP_MAX_MS
// is hit, or too many consecutive failures force a fallback to caption-only.
// ---------------------------------------------------------------------------------------------
let shuttingDown = false;

async function runAudioSession(session: AudioSession): Promise<void> {
  log.info(`Starting audio session: ${session.source.label} (${session.resolvedVideoUrl})`);
  const existing = state.sessions[session.source.id];
  let eventId = existing && existing.videoId === session.videoId ? existing.eventId : null;
  if (eventId) log.info(`Resuming existing event ${eventId} for this same video (worker was restarted mid-session).`);

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hev-live-desk-audio-'));
  const sessionStartMs = Date.now();
  let consecutiveFailures = 0;
  let chunkIndex = 0;

  try {
    while (!shuttingDown) {
      if (Date.now() - sessionStartMs > LIVE_LOOP_MAX_MS) {
        log.info('Hit LIVE_LOOP_MAX_MS cap for this session - ending (a fresh worker cycle will pick a live video back up, same as the caption watcher\'s own cap).');
        break;
      }
      const memMB = process.memoryUsage().rss / 1024 / 1024;
      if (memMB > SELF_MEMORY_CEILING_MB) {
        log.error(`[CIRCUIT BREAKER] own RSS ${memMB.toFixed(0)}MB exceeded ceiling (${SELF_MEMORY_CEILING_MB}MB) mid-session - exiting for a clean restart rather than risking the host.`);
        process.exit(1);
      }

      // Re-confirm liveness + re-resolve the stream URL every round (also doubles as end-of-stream
      // detection - is_live flips false the moment the broadcast ends).
      const liveCheck = await checkIsLive(sourceCheckUrl(session.source));
      if (!liveCheck.isLive) {
        log.info('Source is no longer live - finalizing session.');
        if (eventId) await postLiveSegment(eventId, '', true);
        delete state.sessions[session.source.id];
        await saveState();
        break;
      }

      const streamUrl = await resolveBestAudioUrl(liveCheck.resolvedUrl || session.resolvedVideoUrl);
      if (!streamUrl) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          log.warn('Too many consecutive failures resolving the audio stream URL - aborting this session to caption-only.');
          break;
        }
        await sleep(5_000);
        continue;
      }

      const chunkPath = path.join(tmpDir, `chunk-${chunkIndex}.mp3`);
      const captured = await captureChunk(streamUrl, chunkPath, CHUNK_SECONDS);
      if (!captured) {
        consecutiveFailures++;
        await fsp.unlink(chunkPath).catch(() => {});
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          log.warn('Too many consecutive audio-capture failures - aborting this session to caption-only.');
          break;
        }
        continue;
      }

      const stt = await transcribeChunk(chunkPath);
      await fsp.unlink(chunkPath).catch(() => {});

      if (!stt || !stt.text.trim()) {
        consecutiveFailures++;
        await logUsage({ liveEventId: eventId, sourceId: session.source.id, audioSeconds: CHUNK_SECONDS, sttModel: STT_MODEL, translateModel: null, sttSuccess: false, translateSuccess: false });
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          log.warn('Too many consecutive OpenRouter STT failures - aborting this session to caption-only.');
          break;
        }
        continue;
      }
      consecutiveFailures = 0;

      const translated = await translateToIndonesian(stt.text);
      await logUsage({
        liveEventId: eventId,
        sourceId: session.source.id,
        audioSeconds: CHUNK_SECONDS,
        sttModel: STT_MODEL,
        translateModel: translated.modelUsed,
        sttSuccess: true,
        translateSuccess: translated.ok,
      });
      // Never lose a chunk just because translation failed - fall back to the original-language
      // text (still real, still useful, just not translated) rather than dropping it.
      const textForPipeline = translated.ok ? translated.text : stt.text;

      if (!eventId) {
        const autofill = await postAutofill(session.source, textForPipeline);
        const published = await postPublish(session.source, textForPipeline, autofill, session.resolvedVideoUrl, session.videoId);
        eventId = published.id;
        state.sessions[session.source.id] = { eventId, videoId: session.videoId };
        await saveState();
        log.info(`Published new audio-sourced live event ${eventId}: "${published.title}"`);
      } else {
        const result = await postLiveSegment(eventId, textForPipeline, false);
        if (result.status === 'finalized') {
          // Server-side already decided this session is done (e.g. concurrently finalized via
          // admin action) - stop tracking it.
          delete state.sessions[session.source.id];
          await saveState();
          break;
        }
      }
      chunkIndex++;
    }
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------
// Main loop - idles (polling every POLL_INTERVAL_MS) when nothing audio-eligible is live,
// otherwise runs one session at a time to completion before looking for the next one. Exits
// immediately and cleanly on SIGTERM (server.ts's circuit breaker relies on this being fast).
// ---------------------------------------------------------------------------------------------
async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    log.error('OPENROUTER_API_KEY is not set - exiting. This worker should never be started without it.');
    process.exit(1);
  }
  if (process.env.LIVE_DESK_AUDIO_ENABLED !== 'true') {
    log.error('LIVE_DESK_AUDIO_ENABLED is not "true" - exiting. This worker should never be started without it.');
    process.exit(1);
  }
  if (!(await checkFfmpegAvailable())) {
    log.error('ffmpeg binary not found on PATH - exiting. This worker has no local-download fallback for ffmpeg (unlike yt-dlp) - it must be installed on the host itself.');
    process.exit(1);
  }
  if (!(await checkYtDlpAvailable())) {
    log.error(`yt-dlp not found (checked ${YT_DLP_LOCAL_PATH} then PATH) - exiting.`);
    process.exit(1);
  }
  try {
    basicAuthHeader();
  } catch (err) {
    log.error('Admin credentials not configured', err);
    process.exit(1);
  }

  await loadState();
  log.info(`Live Desk audio worker started. STT model=${STT_MODEL}, translate=${TRANSLATE_MODEL_PRIMARY} (fallback ${TRANSLATE_MODEL_FALLBACK}), chunk=${CHUNK_SECONDS}s, self memory ceiling=${SELF_MEMORY_CEILING_MB}MB.`);

  const shutdown = (signal: string) => {
    log.info(`${signal} received - shutting down.`);
    shuttingDown = true;
    currentFfmpeg?.kill('SIGTERM');
    // Give in-flight I/O a moment to unwind, then force-exit - server.ts's circuit breaker expects
    // this process to actually disappear promptly, not linger.
    setTimeout(() => process.exit(0), 2_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  while (!shuttingDown) {
    try {
      const memMB = process.memoryUsage().rss / 1024 / 1024;
      if (memMB > SELF_MEMORY_CEILING_MB) {
        log.error(`[CIRCUIT BREAKER] own RSS ${memMB.toFixed(0)}MB exceeds ceiling while idle - exiting for a clean restart.`);
        process.exit(1);
      }
      const session = await selectAudioSession();
      if (!session) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      await runAudioSession(session);
    } catch (err) {
      log.error('Unexpected error in main loop - backing off 30s before retrying', err);
      await sleep(30_000);
    }
  }
}

main().catch((err) => {
  log.error('Fatal error, exiting', err);
  process.exit(1);
});
