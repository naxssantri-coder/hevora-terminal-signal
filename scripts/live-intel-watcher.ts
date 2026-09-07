// ============================================================================================
// HEV Live Intelligence Watcher
//
// Standalone process (NOT part of server.ts / the main app) that:
//   1. Polls a configurable list of free/legal live sources (YouTube Live auto-captions via
//      yt-dlp, official central-bank/government RSS feeds, official public live-blog pages -
//      see live-intel-watcher.config.ts) for new text.
//   2. Filters new text by keyword relevance, batches it per-source into ~30-60s blocks.
//   3. Sends each block to POST /api/admin/live-events/ai-autofill (HTTP Basic Auth) for
//      structured AI analysis.
//   4. Auto-publishes to POST /api/admin/live-events when the AI's impact verdict is
//      "Medium"/"High"; logs only (never publishes) when it's "Low".
//   5. Dedupes per source (a hash of the last block(s) actually sent) so the same text is never
//      resent within one running event/session.
//   6. Retries external fetches and its own publish calls with exponential backoff, and never
//      polls a source faster than politeness allows.
//
// It runs TWO pipelines, selected per source by `category` in the config:
//   - 'live-intel' (default): everything described above.
//   - 'market-news': automated market news for the public Intel tab. HEADLINE-ONLY ingestion (see
//     the COPYRIGHT block above pollRss - the outlet's article text is never read, sent, stored or
//     displayed), a dedicated Gemini prompt, a per-run publish cap, a 3-hour freshness window, and
//     cross-source duplicate-headline detection so one story syndicated by five outlets publishes
//     once.
//
// Two ways to run this:
//   - Continuous (long-lived process, keeps its own setInterval loop alive):
//       npm run watch:live-intel
//   - Single run (polls every enabled source exactly once, flushes anything buffered
//     immediately, saves dedup state, then exits - meant to be invoked repeatedly by an
//     external scheduler like a GitHub Actions cron workflow instead of staying resident):
//       npm run watch:live-intel:once
//     (equivalent to `tsx scripts/live-intel-watcher.ts --once`)
//
// Requires ADMIN_USERNAME + (ADMIN_PASSWORD or ADMIN_PASSWORD_HASH) in the environment (same
// vars server.ts's requireAdminAuth already checks) plus GEMINI_API_KEY configured on the
// server this script talks to. yt-dlp (https://github.com/yt-dlp/yt-dlp) must be on PATH for
// any 'youtube-live-captions' source to work - other source kinds don't need it.
//
// INDEPENDENCE FROM THE PAID AUDIO PIPELINE (Live Desk audit, 2026-09-06, confirmed by full code
// trace - not just asserted): this script - the one that produces every transcript/analysis for
// all 12 institutional sources plus RSS - reads and needs NONE of OPENROUTER_API_KEY,
// LIVE_DESK_AUDIO_ENABLED, or scripts/live-desk-audio-worker.ts's settings/state (grep this file:
// zero matches for "AUDIO" or "OPENROUTER"). Its own scheduled trigger
// (.github/workflows/live-intel-watcher.yml) requires none of those as secrets either. The two
// server.ts endpoints both this script AND the audio worker publish through
// (POST /api/admin/live-events/ai-autofill, POST /api/admin/live-events) are gated by
// requireAdminAuth ONLY - no audio-related check of any kind sits in front of them, and
// server.ts's "Live Desk audio worker lifecycle" section (which spawns/kills/circuit-breaks the
// separate audio child process) never touches this script, its config, or these endpoints in the
// other direction either. Concretely: with LIVE_DESK_AUDIO_ENABLED unset/false and no
// OPENROUTER_API_KEY configured at all (this project's actual default, deliberately kept OFF
// since e1b6d97), this script still produces live transcripts/analysis for every enabled
// 'youtube-channel'/'youtube-live-captions'/'rss' source exactly as before that pipeline existed
// - the OpenRouter audio-STT worker is a genuinely optional, separately-toggled ADDITION (an
// alternate way to source a transcript when captions alone would miss something), never a
// prerequisite for this one. See LIVE_DESK_STATUS.md for the corresponding status-doc entry.
// ============================================================================================

import 'dotenv/config';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import {
  SOURCES,
  KEYWORDS,
  BLOCK_MIN_WAIT_MS,
  BLOCK_MAX_WAIT_MS,
  BLOCK_MAX_SENTENCES,
  RETRY_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  MIN_POLL_INTERVAL_MS,
  LIVE_ACTIVE_POLL_INTERVAL_MS,
  LIVE_LOOP_MAX_MS,
  LIVE_LOOP_SIBLING_POLL_INTERVAL_MS,
  MARKET_NEWS_MAX_PUBLISH_PER_RUN,
  MARKET_NEWS_MAX_AGE_MS,
  MARKET_NEWS_TITLE_SIMILARITY,
  MARKET_NEWS_DEDUP_WINDOW_MS,
  MARKET_NEWS_MAX_TITLE_HISTORY,
  FEED_REQUEST_HEADERS,
  HEV_SERVER_BASE_URL,
  type WatcherSourceConfig,
} from './live-intel-watcher.config';

const execFileAsync = promisify(execFile);

// HEV_SERVER_BASE_URL is user/env-configured and may or may not end with a trailing slash
// (e.g. "https://hevora.onrender.com" vs "https://hevora.onrender.com/") - every endpoint path
// below already starts with "/", so a trailing slash on the base URL would double up into "//"
// and 404 ("Cannot POST //api/..."). Stripped once here, used everywhere the base URL is needed,
// regardless of what the env var actually contains.
const SERVER_BASE_URL = HEV_SERVER_BASE_URL.replace(/\/+$/, '');

// ---------------------------------------------------------------------------------------------
// Logging - leveled, timestamped, always tagged with the source id so a multi-source run stays
// readable. Never silently swallows an error.
// ---------------------------------------------------------------------------------------------
function ts(): string {
  return new Date().toISOString();
}
const log = {
  info: (tag: string, msg: string) => console.log(`[${ts()}] [INFO] [${tag}] ${msg}`),
  warn: (tag: string, msg: string) => console.warn(`[${ts()}] [WARN] [${tag}] ${msg}`),
  error: (tag: string, msg: string, err?: unknown) =>
    console.error(`[${ts()}] [ERROR] [${tag}] ${msg}${err ? ' - ' + (err instanceof Error ? err.message : String(err)) : ''}`),
};

// ---------------------------------------------------------------------------------------------
// Persistent dedup state - data/live_intel_watcher_state.json, same DATA_DIR convention the
// main server uses for its own local-file archives. Independent file: this script never reads
// or writes anything the main server touches.
// ---------------------------------------------------------------------------------------------
const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'live_intel_watcher_state.json');
const MAX_HASHES_PER_SOURCE = 200; // bounds file size - old entries age out, plenty for dedup
const MAX_RSS_SEEN_IDS_PER_SOURCE = 500;

interface WatcherState {
  // Recently-sent block hashes per source - prevents resending the exact same text.
  sentHashes: Record<string, string[]>;
  // Recently-seen RSS item ids (guid/link) per source - prevents reprocessing old feed entries.
  rssSeenIds: Record<string, string[]>;
  // Tracks an in-progress YouTube Live session per source (only ever set for
  // 'youtube-live-captions' sources) - lets a fresh process invocation (a new scheduled GitHub
  // Actions run, or the tight live-poll loop hitting LIVE_LOOP_MAX_MS and returning) recognize
  // "this is still the same ongoing stream, keep appending to that event" instead of publishing a
  // duplicate new event, and lets it correctly finalize the right event once the stream ends.
  liveSessions: Record<string, { eventId: string; videoId: string }>;
  // Normalized headline fingerprints of market-news items already published, GLOBAL across all
  // news sources (not per-source like the fields above) - the whole point is catching the same
  // story syndicated by several different outlets, which per-source state structurally cannot do.
  newsTitles: { norm: string; at: number }[];
}

function emptyState(): WatcherState {
  return { sentHashes: {}, rssSeenIds: {}, liveSessions: {}, newsTitles: [] };
}

async function loadState(): Promise<WatcherState> {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = await fsp.readFile(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const cutoff = Date.now() - MARKET_NEWS_DEDUP_WINDOW_MS;
        return {
          sentHashes: parsed.sentHashes || {},
          rssSeenIds: parsed.rssSeenIds || {},
          liveSessions: parsed.liveSessions || {},
          // Prune on load so the similarity window is enforced by construction and the file can't
          // grow without bound across months of scheduled runs.
          newsTitles: Array.isArray(parsed.newsTitles)
            ? parsed.newsTitles.filter((n: any) => n && typeof n.norm === 'string' && typeof n.at === 'number' && n.at >= cutoff)
            : [],
        };
      }
    }
  } catch (err) {
    log.warn('state', `Failed to load ${STATE_FILE}, starting with empty dedup state`);
  }
  return emptyState();
}

let state: WatcherState = emptyState();
let stateDirty = false;

async function saveStateIfDirty(): Promise<void> {
  if (!stateDirty) return;
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    stateDirty = false;
  } catch (err) {
    log.error('state', 'Failed to persist dedup state', err);
  }
}

function hashText(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function wasAlreadySent(sourceId: string, hash: string): boolean {
  return (state.sentHashes[sourceId] || []).includes(hash);
}

function markSent(sourceId: string, hash: string): void {
  const list = state.sentHashes[sourceId] || [];
  list.push(hash);
  state.sentHashes[sourceId] = list.slice(-MAX_HASHES_PER_SOURCE);
  stateDirty = true;
}

// ---------------------------------------------------------------------------------------------
// Market-news headline dedup.
//
// Two layers, because they catch different things:
//   1. Exact normalized-title hash - the same outlet re-emitting an item with a new guid/link
//      (common when an article is edited, or a feed regenerates ids).
//   2. Similarity ratio - a DIFFERENT outlet covering the same story with near-identical wording
//      ("Gold hits record high as dollar slides" vs "Gold hits record high as the dollar slides").
//      A guid/link dedup cannot possibly catch this: different domain, different link, different id.
// ---------------------------------------------------------------------------------------------

/** Lowercase, strip punctuation and outlet suffixes, collapse whitespace. Deliberately aggressive:
 * two headlines that differ only in punctuation/casing/stopwords ARE the same headline for our
 * purposes. */
function normalizeHeadline(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*[-|–—]\s*[^-|–—]{0,40}$/, '') // trailing " - Reuters" / " | CNBC" style outlet tags
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|of|to|in|on|for|as|at|by|is|are|and|with|after|amid)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-overlap (Dice) similarity of two normalized headlines - 0..1. Chosen over edit distance
 * because news rewording is mostly word substitution/reordering, not character-level drift. */
function headlineSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  ta.forEach((tok) => {
    if (tb.has(tok)) overlap++;
  });
  return (2 * overlap) / (ta.size + tb.size);
}

/** Returns the matching prior headline when this one duplicates a story published within the
 * dedup window, or null when it's genuinely new. */
function findDuplicateHeadline(title: string): string | null {
  const norm = normalizeHeadline(title);
  if (!norm) return null;
  const cutoff = Date.now() - MARKET_NEWS_DEDUP_WINDOW_MS;
  for (const entry of state.newsTitles) {
    if (entry.at < cutoff) continue;
    if (entry.norm === norm) return entry.norm;
    if (headlineSimilarity(norm, entry.norm) >= MARKET_NEWS_TITLE_SIMILARITY) return entry.norm;
  }
  return null;
}

function markHeadlinePublished(title: string): void {
  const norm = normalizeHeadline(title);
  if (!norm) return;
  state.newsTitles.push({ norm, at: Date.now() });
  state.newsTitles = state.newsTitles.slice(-MARKET_NEWS_MAX_TITLE_HISTORY);
  stateDirty = true;
}

function wasRssIdSeen(sourceId: string, itemId: string): boolean {
  return (state.rssSeenIds[sourceId] || []).includes(itemId);
}

function markRssIdSeen(sourceId: string, itemId: string): void {
  const list = state.rssSeenIds[sourceId] || [];
  list.push(itemId);
  state.rssSeenIds[sourceId] = list.slice(-MAX_RSS_SEEN_IDS_PER_SOURCE);
  stateDirty = true;
}

// ---------------------------------------------------------------------------------------------
// Retry helper - shared by external source fetches and by our own publish calls.
// ---------------------------------------------------------------------------------------------
async function withRetry<T>(tag: string, label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = attempt === RETRY_ATTEMPTS - 1;
      log.warn(tag, `${label} failed (attempt ${attempt + 1}/${RETRY_ATTEMPTS})${isLast ? '' : ', retrying...'}: ${err instanceof Error ? err.message : String(err)}`);
      if (!isLast) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------------------------
// Keyword filter
// ---------------------------------------------------------------------------------------------
const KEYWORDS_LOWER = KEYWORDS.map((k) => k.toLowerCase());
/** Matches text against a source's own `keywords` override when it has one, otherwise the global
 * KEYWORDS list. Passing no `source` (or a source without an override) preserves the previous
 * global-only behavior. */
function isRelevant(text: string, source?: WatcherSourceConfig): boolean {
  const lower = text.toLowerCase();
  const list = source?.keywords?.length ? source.keywords.map((k) => k.toLowerCase()) : KEYWORDS_LOWER;
  return list.some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------------------------
// Per-source batching buffer - accumulates relevant lines, flushed on a shared ticker once
// either time or sentence-count threshold is crossed.
// ---------------------------------------------------------------------------------------------
interface SourceBuffer {
  lines: string[];
  firstLineAtMs: number | null;
}
const buffers = new Map<string, SourceBuffer>();

function getBuffer(sourceId: string): SourceBuffer {
  let buf = buffers.get(sourceId);
  if (!buf) {
    buf = { lines: [], firstLineAtMs: null };
    buffers.set(sourceId, buf);
  }
  return buf;
}

// For 'youtube-live-captions' sources, videoUrl in config is often a channel's "/live" alias
// (no specific video ID) rather than a directly embeddable link. This map holds the ACTUAL
// resolved video URL yt-dlp reported for the currently-live stream, refreshed each successful
// poll (see pollYoutubeLiveCaptions) - used as the real, embeddable sourceUrl at publish time
// instead of the static config alias.
const resolvedVideoUrl = new Map<string, string>();

/** Feeds one new line of real text from a source into its buffer, after the keyword filter.
 * Immediately flushes if the block-size threshold is reached. */
async function ingestLine(source: WatcherSourceConfig, rawLine: string): Promise<void> {
  const line = rawLine.trim();
  if (!line) return;
  if (!isRelevant(line, source)) return;

  const buf = getBuffer(source.id);
  buf.lines.push(line);
  if (buf.firstLineAtMs === null) buf.firstLineAtMs = Date.now();

  log.info(source.id, `Buffered relevant line (${buf.lines.length}/${BLOCK_MAX_SENTENCES} in current block): "${line.slice(0, 80)}${line.length > 80 ? '...' : ''}"`);

  if (buf.lines.length >= BLOCK_MAX_SENTENCES) {
    await flushBuffer(source);
  }
}

/** Ticker (runs every few seconds) - flushes any buffer that has waited long enough. */
async function flushDueBuffers(): Promise<void> {
  const now = Date.now();
  for (const source of SOURCES) {
    if (!source.enabled) continue;
    const buf = buffers.get(source.id);
    if (!buf || buf.lines.length === 0 || buf.firstLineAtMs === null) continue;
    const waited = now - buf.firstLineAtMs;
    if (waited >= BLOCK_MAX_WAIT_MS || (waited >= BLOCK_MIN_WAIT_MS && buf.lines.length > 0)) {
      await flushBuffer(source);
    }
  }
}

/** Used only by single-run (`--once`) mode: flushes every source's buffer immediately,
 * regardless of BLOCK_MIN_WAIT_MS/BLOCK_MAX_WAIT_MS, since the process is about to exit and
 * won't be around later to flush on the normal ticker - anything buffered now either goes out
 * now or is lost until the next scheduled run re-fetches the same source. */
async function flushAllBuffersNow(): Promise<void> {
  for (const source of SOURCES) {
    if (!source.enabled) continue;
    const buf = buffers.get(source.id);
    if (buf && buf.lines.length > 0) {
      await flushBuffer(source);
    }
  }
}

async function flushBuffer(source: WatcherSourceConfig): Promise<void> {
  const buf = buffers.get(source.id);
  if (!buf || buf.lines.length === 0) return;

  const block = buf.lines.join(' ');
  buf.lines = [];
  buf.firstLineAtMs = null;

  const hash = hashText(block);
  if (wasAlreadySent(source.id, hash)) {
    log.info(source.id, 'Flushed block is identical to a previously-sent block - skipping (dedup).');
    return;
  }

  // Only mark as sent when processBlock actually resolved the block (published, or deliberately
  // skipped as Low impact) - NOT on an ai-autofill/publish infra failure. Marking it sent
  // regardless of outcome was a real bug: a block that failed to publish (e.g. the double-slash
  // HEV_SERVER_BASE_URL bug) still got marked "sent", so it silently never got retried and was
  // permanently lost even after the underlying bug was fixed.
  const handled = await processBlock(source, block);
  if (handled) {
    markSent(source.id, hash);
  } else {
    log.warn(source.id, 'Leaving this block unmarked so it can be retried on the next scheduled run.');
  }
  await saveStateIfDirty();
}

// ---------------------------------------------------------------------------------------------
// Publish pipeline - AI autofill, then conditional auto-publish.
// ---------------------------------------------------------------------------------------------
interface AutofillResult {
  title: string;
  summary: string;
  tone: 'Hawkish' | 'Dovish' | 'Neutral';
  marketEffects: { asset: string; direction: 'Bullish' | 'Bearish' | 'Neutral'; reason: string }[];
  // Topic-segmented breakdown, causal chain, and forced 8-pair impact read added by server.ts's
  // buildLiveEventAutofillPrompt - optional here purely defensively (an older deployed server
  // without this feature would just omit them from its response), passed straight through to
  // postPublish below unmodified so automated watcher publishes get the same rich detail-page
  // data as AI-assisted admin publishes.
  segments?: { topic: string; statement: string; tone: 'Hawkish' | 'Dovish' | 'Neutral'; stanceScore: number }[];
  causalChain?: string[];
  pairImpacts?: { pairId: string; direction: 'Bullish' | 'Bearish' | 'Neutral'; confidence: number }[];
  /** Market-news only (type 'market_news') - the per-asset-class read that the Intel tab's news
   * cards render. Absent for every transcript-based source. */
  assetClassImpacts?: { assetClass: 'commodities' | 'crypto' | 'forex'; direction: 'Bullish' | 'Bearish' | 'Neutral'; reason: string }[];
  /** Tahap F (blueprint §49) - market-news only, per-headline geopolitical risk read, passed
   * straight through to postPublish below same as assetClassImpacts. */
  geopoliticalRisk?: { relevant: boolean; score: number; reason: string };
  /** Tahap D3 Tier 3 (blueprint §14) - market-news only, per-headline central bank gold rumor
   * read, same pass-through pattern as geopoliticalRisk above. */
  goldPurchaseRumor?: { relevant: boolean; country: string; tonnesEstimate: number | null; reason: string };
  /** Market-news only - false means the AI judged the headline not market-relevant. The item is
   * then marked handled (so it is never retried) but deliberately NOT published. */
  relevant?: boolean;
  verdict: 'Bullish' | 'Bearish' | 'Neutral';
  impact: 'High' | 'Medium' | 'Low';
}

/** True when an error looks like a Gemini/upstream quota or rate-limit rejection rather than a
 * transient network blip. These must NOT be hammered with the normal exponential-backoff retries:
 * a 429 during a run means the quota window is exhausted, and the correct behaviour is to stop
 * processing news this run and let the next scheduled run (15 minutes later) pick up where we left
 * off - the items are simply left unmarked, so nothing is lost. */
function isRateLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('ratelimit') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('too many requests')
  );
}

function basicAuthHeader(): string {
  const user = process.env.ADMIN_USERNAME || '';
  // requireAdminAuth accepts either the real plaintext ADMIN_PASSWORD, or (as a fallback) the
  // literal ADMIN_PASSWORD_HASH string itself as the password - convenient for scripted/headless
  // callers like this one that shouldn't need the real plaintext password configured separately.
  const pass = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD_HASH || '';
  if (!user || !pass) {
    throw new Error('ADMIN_USERNAME and (ADMIN_PASSWORD or ADMIN_PASSWORD_HASH) must be set in the environment.');
  }
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

function isMarketNewsSource(source: WatcherSourceConfig): boolean {
  return source.category === 'market-news';
}

function eventTypeForSource(source: WatcherSourceConfig): string {
  if (isMarketNewsSource(source)) return 'market_news';
  if (source.kind === 'youtube-live-captions' || source.kind === 'youtube-channel') return 'speech';
  if (source.kind === 'rss') return 'press_release';
  return 'other';
}

async function postAutofill(source: WatcherSourceConfig, rawTranscript: string): Promise<AutofillResult> {
  const res = await fetch(`${SERVER_BASE_URL}/api/admin/live-events/ai-autofill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: basicAuthHeader() },
    body: JSON.stringify({ rawTranscript, type: eventTypeForSource(source), speaker: source.label }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`ai-autofill HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
  }
  return (await res.json()) as AutofillResult;
}

// Minimal shape this script actually reads back from the publish response (the real response is
// the full LiveEvent object server-side, but this script only ever needs these two fields - to
// remember which event a fresh live session is now tracking, and to log its title).
interface PublishedLiveEvent {
  id: string;
  title: string;
}

async function postPublish(
  source: WatcherSourceConfig,
  rawTranscript: string,
  autofill: AutofillResult,
  liveVideoId?: string,
  /** Market-news only: the ARTICLE's own permalink from the feed item, so the card's "read at the
   * original source" link points at the actual story rather than at the feed URL. Referencing an
   * article by link is exactly what a public RSS feed is for; republishing its text is not. */
  articleUrl?: string
): Promise<PublishedLiveEvent> {
  const res = await fetch(`${SERVER_BASE_URL}/api/admin/live-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: basicAuthHeader() },
    body: JSON.stringify({
      type: eventTypeForSource(source),
      speaker: source.label,
      rawTranscript,
      title: autofill.title,
      summary: autofill.summary,
      tone: autofill.tone,
      marketEffects: autofill.marketEffects,
      segments: autofill.segments,
      causalChain: autofill.causalChain,
      pairImpacts: autofill.pairImpacts,
      assetClassImpacts: autofill.assetClassImpacts,
      geopoliticalRisk: autofill.geopoliticalRisk,
      goldPurchaseRumor: autofill.goldPurchaseRumor,
      verdict: autofill.verdict,
      impact: autofill.impact,
      source: source.label,
      // For YouTube sources, prefer the ACTUAL resolved video URL captured during this run's
      // caption fetch (see resolvedVideoUrl above) over the config's static channel/live alias -
      // the resolved link is what the Intel tab can actually embed as a real player.
      // Bug fix (Live Desk audit): 'feedUrl' used to be a fallback here, which meant an RSS
      // live-intel item with no resolvable per-item link (see articleUrl above/below) published
      // with sourceUrl pointing at the FEED'S OWN raw .xml/.rss URL - a real live example was
      // "Bank of Canada - News" linking to a raw XML document instead of a readable press-release
      // page. A feed URL is never something a reader can usefully open, so it is deliberately NOT
      // a fallback anymore: no real per-item link means no link at all (sourceUrl: null), which
      // the Intel/Live Desk UI already renders correctly (no dead/misleading link shown) - see
      // that UI's own comment for the corresponding frontend half of this fix.
      sourceUrl:
        articleUrl
          ? articleUrl
          : 'pageUrl' in source
          ? source.pageUrl
          : 'videoUrl' in source
          ? resolvedVideoUrl.get(source.id) || source.videoUrl
          : null,
      // Only set when starting a brand-new YouTube Live session (see
      // pollYoutubeLiveCaptionsOnce below) - server.ts's publishLiveEventRecord attaches a
      // `liveSession` field to the created event only when this is a real, non-empty video id.
      ...(liveVideoId ? { liveVideoId } : {}),
    }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`live-events publish HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
  }
  return (await res.json()) as PublishedLiveEvent;
}

// Returns true when this block has been definitively handled (either actually published, or
// deliberately left unpublished because impact was Low) - the caller should mark it as sent/seen
// so it's never reprocessed. Returns false on an infra failure (ai-autofill or publish call
// failed after all retries) - the caller should NOT mark it as sent, so the same block/item gets
// picked up and retried on the next scheduled run instead of being silently lost forever.
async function processBlock(source: WatcherSourceConfig, block: string, articleUrl?: string): Promise<boolean> {
  log.info(source.id, `Flushing block (${block.length} chars) to AI autofill...`);
  let autofill: AutofillResult;
  try {
    autofill = await withRetry(source.id, 'ai-autofill', () => postAutofill(source, block));
  } catch (err) {
    log.error(source.id, 'AI autofill failed after all retries - will retry this block on the next scheduled run', err);
    return false;
  }

  log.info(source.id, `AI autofill result: tone=${autofill.tone} verdict=${autofill.verdict} impact=${autofill.impact} title="${autofill.title}"`);

  if (autofill.impact === 'Medium' || autofill.impact === 'High') {
    try {
      // articleUrl (the RSS item's OWN link, when this block came from one - see pollRss's
      // live-intel branch) takes priority over postPublish's other sourceUrl fallbacks, same as
      // the market-news pipeline already does - see postPublish's own comment for why the feed
      // URL itself is never used as a fallback.
      await withRetry(source.id, 'publish', () => postPublish(source, block, autofill, undefined, articleUrl));
      log.info(source.id, `Published live event (impact=${autofill.impact}).`);
      return true;
    } catch (err) {
      log.error(source.id, 'Publish failed after all retries - will retry this block on the next scheduled run', err);
      return false;
    }
  }

  log.info(source.id, 'Impact=Low - logged only, not auto-published (avoids spamming users with low-signal updates).');
  return true;
}

// ---------------------------------------------------------------------------------------------
// Source adapter: RSS
//
// Serves BOTH source categories, because the fetch/parse/dedup skeleton is genuinely the same:
//   - 'live-intel' (default): central-bank / government press releases. Sends title + the feed's
//     own contentSnippet, exactly as before - these are public-domain government communications.
//   - 'market-news': commercial news outlets. HEADLINE ONLY. See the copyright rule below.
//
// ===== COPYRIGHT RULE FOR MARKET-NEWS SOURCES - DO NOT WEAKEN =====
// From a market-news feed this reads exactly four things: the item's TITLE, its LINK, its
// TIMESTAMP, and the configured SOURCE NAME. It never reads, sends, stores or displays
// item.content / item.contentSnippet / item['content:encoded'] - the outlet's actual article
// text. The summary shown on the site is written from scratch by Gemini from the headline alone
// (buildMarketNewsAutofillPrompt in server.ts), and every published card links back to the
// original article. Referencing a story by headline and linking to it is what a public RSS feed
// exists for; reproducing its prose is not, no matter how short the excerpt.
// ==================================================================
// ---------------------------------------------------------------------------------------------
// Shares FEED_REQUEST_HEADERS with verify-feeds.ts so a feed proven green by the Verify RSS Feeds
// workflow is fetched here with identical headers - see that constant's comment for why the
// rss-parser defaults get rejected by some publishers.
const rssParser = new Parser({ timeout: 15_000, headers: FEED_REQUEST_HEADERS });

/** Per-run publish budget for market-news items, shared across every news source (see
 * MARKET_NEWS_MAX_PUBLISH_PER_RUN). Reset at the start of each runOnce/continuous cycle. */
let marketNewsPublishedThisRun = 0;
/** Set once a Gemini rate limit is hit - stops every remaining news source this run from calling
 * the AI at all, instead of each one discovering the same 429 independently. */
let marketNewsRateLimited = false;

function resetMarketNewsRunBudget(): void {
  marketNewsPublishedThisRun = 0;
  marketNewsRateLimited = false;
}

/** Per-run tally for the end-of-run summary log - purely observational. */
const newsRunStats = {
  read: 0,
  tooOld: 0,
  duplicate: 0,
  irrelevant: 0,
  lowImpact: 0,
  published: 0,
  deferred: 0,
};

function itemTimestampMs(item: any): number | null {
  const raw = item.isoDate || item.pubDate || item.published || item.updated;
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return isNaN(ms) ? null : ms;
}

/**
 * Handles ONE market-news feed item end to end: age gate -> headline dedup -> AI relevance/impact
 * -> publish. Returns 'handled' when the item is fully resolved and should be marked seen (whether
 * or not it was published), 'retry' when an infra failure means it should be reprocessed next run,
 * and 'stop' when the per-run budget or a rate limit means this run should stop touching news.
 */
async function processMarketNewsItem(
  // Widened from the RSS-only type: pollGdelt (Roadmap §A4) reuses this same headline -> AI ->
  // publish pipeline with a GdeltSourceConfig, passing an item shaped identically to an
  // rss-parser Item ({title, link, pubDate/isoDate}) - everything below only ever reads those
  // three fields plus source.id/source.label, both of which every source kind has.
  source: WatcherSourceConfig,
  item: any
): Promise<'handled' | 'retry' | 'stop'> {
  const title = String(item.title || '').trim();
  if (!title) return 'handled'; // nothing to work with; never worth revisiting

  if (marketNewsRateLimited) return 'stop';
  if (marketNewsPublishedThisRun >= MARKET_NEWS_MAX_PUBLISH_PER_RUN) return 'stop';

  // --- Age gate: only genuinely recent items. An item with no parseable date is treated as too
  // old rather than assumed fresh - guessing "it's probably new" is how a feed's entire back
  // catalogue ends up published on first run.
  const tsMs = itemTimestampMs(item);
  if (tsMs === null || Date.now() - tsMs > MARKET_NEWS_MAX_AGE_MS) {
    newsRunStats.tooOld++;
    log.info(source.id, `Skipping (older than ${Math.round(MARKET_NEWS_MAX_AGE_MS / 60000)}m or undated): "${title.slice(0, 80)}"`);
    return 'handled';
  }

  // --- Cross-source headline dedup (see findDuplicateHeadline).
  const dup = findDuplicateHeadline(title);
  if (dup) {
    newsRunStats.duplicate++;
    log.info(source.id, `Skipping duplicate story (matches an already-published headline): "${title.slice(0, 80)}"`);
    return 'handled';
  }

  // --- AI. NOTE: `title` is the ONLY article-derived text that crosses this boundary.
  let autofill: AutofillResult;
  try {
    autofill = await withRetry(source.id, 'news ai-autofill', () => postAutofill(source, title));
  } catch (err) {
    if (isRateLimitError(err)) {
      marketNewsRateLimited = true;
      newsRunStats.deferred++;
      log.warn(source.id, 'Gemini rate limit / quota hit - deferring all remaining news items to the next scheduled run (nothing lost, items stay unmarked).');
      return 'stop';
    }
    newsRunStats.deferred++;
    log.error(source.id, 'News AI autofill failed after all retries - will retry this item on the next scheduled run', err);
    return 'retry';
  }

  if (autofill.relevant === false) {
    newsRunStats.irrelevant++;
    log.info(source.id, `AI judged not market-relevant, not publishing: "${title.slice(0, 80)}"`);
    return 'handled';
  }

  if (autofill.impact !== 'Medium' && autofill.impact !== 'High') {
    newsRunStats.lowImpact++;
    log.info(source.id, `Impact=Low - logged only, not published: "${title.slice(0, 80)}"`);
    return 'handled';
  }

  if (!autofill.title.trim() || !autofill.summary.trim()) {
    newsRunStats.irrelevant++;
    log.warn(source.id, `AI returned an empty title/summary - not publishing rather than showing a blank card: "${title.slice(0, 80)}"`);
    return 'handled';
  }

  const articleUrl = typeof item.link === 'string' && item.link.trim() ? item.link.trim() : undefined;
  try {
    // rawTranscript carries ONLY the original headline - it is what the AI was given, and keeping
    // it makes the published record auditable ("what did the AI actually see?"). It is never the
    // article body, and the public Intel card renders the AI's summary, not this field.
    await withRetry(source.id, 'news publish', () => postPublish(source, title, autofill, undefined, articleUrl));
  } catch (err) {
    newsRunStats.deferred++;
    log.error(source.id, 'News publish failed after all retries - will retry on the next scheduled run', err);
    return 'retry';
  }

  markHeadlinePublished(title);
  marketNewsPublishedThisRun++;
  newsRunStats.published++;
  log.info(source.id, `Published market news (impact=${autofill.impact}, verdict=${autofill.verdict}): "${autofill.title}"`);
  return 'handled';
}

/** End-of-run one-liner so a scheduled run's logs answer "what did the news pipeline actually do?"
 * without having to read every line above it. */
function logMarketNewsRunSummary(): void {
  const anyNewsSource = SOURCES.some((s) => s.enabled && s.category === 'market-news');
  if (!anyNewsSource) return;
  log.info(
    'market-news',
    `Run summary: ${newsRunStats.read} item(s) read | ${newsRunStats.tooOld} too old/undated | ` +
      `${newsRunStats.duplicate} duplicate headline | ${newsRunStats.irrelevant} not market-relevant | ` +
      `${newsRunStats.lowImpact} low impact | ${newsRunStats.published} PUBLISHED | ` +
      `${newsRunStats.deferred} deferred to next run` +
      (marketNewsRateLimited ? ' | stopped early: Gemini rate limit' : '') +
      (marketNewsPublishedThisRun >= MARKET_NEWS_MAX_PUBLISH_PER_RUN ? ` | hit per-run cap (${MARKET_NEWS_MAX_PUBLISH_PER_RUN})` : '')
  );
}

// ---------------------------------------------------------------------------------------------
// Full-article-body fetch for live-intel (government/central-bank) RSS items - bug fix, 2026-08-29
// audit (see the call site in pollRss for the full writeup of what this fixes). Follows the
// item's own link and extracts the page's visible text via cheerio (same library pollLiveBlog
// already uses above) - a generic strip-and-extract, not a per-page CSS selector, since item.link
// is a different URL on every item. Government press/speech pages are plain server-rendered HTML
// (confirmed live against federalreserve.gov as part of this fix), so no JS rendering is needed.
// live-intel RSS-only - the market-news copyright rule (headline-only, see the COPYRIGHT block
// above pollRss) is completely untouched, this function is never called from that path.
// ---------------------------------------------------------------------------------------------
const ARTICLE_BODY_FETCH_TIMEOUT_MS = 15_000;
// Verification round 1 (2026-08-29 audit) caught this too low: capped at 12,000 chars, the real
// Warsh Jackson Hole transcript ("Warsh, In Our Time", federalreserve.gov) hit the cap exactly
// (12,021 = 21-char title prefix + the full 12,000-char body limit) - a strong sign it was cut off
// mid-speech, before whatever later passage actually drove the hawkish market reaction FXStreet
// reported. server.ts's own AI-autofill prompt (buildLiveEventAutofillPrompt) applies no length
// cap of its own - the model comfortably handles far more than this - so the cap only needs to be
// generous enough for a long prepared remarks transcript (a 45-60 minute Fed speech runs roughly
// 15,000-27,000 characters), not tight for cost/context reasons. Raised well past that with real
// headroom, re-verified live against the same real speech afterward.
const MAX_ARTICLE_BODY_CHARS = 40_000;

async function fetchArticleBodyText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARTICLE_BODY_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HEVORA-LiveIntelWatcher/1.0)' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, nav, header, footer, noscript, iframe, svg').remove();
    // Prefer a real content container when the page has one - <main>/<article> covers the large
    // majority of government sites without needing a per-page selector; falls back to <body> text
    // (already script/nav/footer-stripped above) for pages that use neither.
    const container = $('main').length ? $('main') : $('article').length ? $('article') : $('body');
    const text = container.text().replace(/\s+/g, ' ').trim();
    return text.length > 0 ? text.slice(0, MAX_ARTICLE_BODY_CHARS) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Enriches an already-relevance-checked RSS item's text with its article's real body, when doing
 * so genuinely adds substance. Falls back to `snippetText` unchanged on any fetch/parse failure or
 * when the extracted body isn't actually longer than what the snippet already had - never a
 * regression from the pre-fix behavior, purely additive. */
async function enrichRssTextWithArticleBody(item: any, snippetText: string): Promise<string> {
  const link = typeof item.link === 'string' ? item.link.trim() : '';
  if (!link) return snippetText;
  const bodyText = await fetchArticleBodyText(link);
  if (!bodyText || bodyText.length <= snippetText.length) return snippetText;
  return [item.title, bodyText].filter(Boolean).join(' - ');
}

async function pollRss(source: Extract<WatcherSourceConfig, { kind: 'rss' }>): Promise<void> {
  const isNews = isMarketNewsSource(source);

  let feed;
  try {
    feed = await withRetry(source.id, 'rss fetch', () => rssParser.parseURL(source.feedUrl));
  } catch (err) {
    log.error(source.id, `Failed to fetch/parse RSS feed ${source.feedUrl}`, err);
    return;
  }

  const items = feed.items || [];
  log.info(source.id, `Feed returned ${items.length} item(s).`);
  if (isNews) newsRunStats.read += items.length;

  // Oldest-first, so if there are several new items at once they get processed in the order
  // they were actually published.
  const newItems = items
    .filter((item) => {
      const itemId = item.guid || item.link || `${item.title}-${item.pubDate}`;
      return itemId && !wasRssIdSeen(source.id, itemId);
    })
    .reverse();

  for (const item of newItems) {
    const itemId = item.guid || item.link || `${item.title}-${item.pubDate}`;

    if (isNews) {
      const outcome = await processMarketNewsItem(source, item);
      if (outcome === 'stop') {
        log.info(source.id, 'Stopping news processing for this run (per-run budget reached or rate limited).');
        break;
      }
      if (outcome === 'handled') {
        markRssIdSeen(source.id, itemId!);
        stateDirty = true;
      }
      // 'retry' deliberately leaves the item unmarked so the next scheduled run picks it up.
      continue;
    }

    // --- live-intel path. Government/central-bank press releases: the feed's own snippet is part
    // of the public release itself, so it is included here (and only here).
    const snippetText = [item.title, item.contentSnippet || item.content || ''].filter(Boolean).join(' - ');
    // Each RSS item is already one discrete, complete release - process it as its own block
    // immediately rather than folding it into the line-by-line batching buffer.
    if (!isRelevant(snippetText, source)) {
      log.info(source.id, `New RSS item did not match the keyword filter, skipping: "${item.title}"`);
      markRssIdSeen(source.id, itemId!); // deliberately irrelevant - never needs revisiting
      stateDirty = true;
      continue;
    }
    // Bug fix (2026-08-29 audit): the feed's own contentSnippet is sometimes just a title-length
    // blurb, NOT the actual release/speech text the comment above assumes - confirmed live against
    // the Federal Reserve's own "Speeches & Testimony" feed (a real Fed Chair speech reached
    // processBlock with only ~200 chars, giving the AI almost nothing to judge market significance
    // from and mis-scoring a clearly market-moving speech as Low impact). Once an item has already
    // cleared the keyword-relevance gate above, try enriching it with the article's actual full
    // text before sending it on - only ever additive (falls straight back to snippetText on any
    // failure or a body shorter than the snippet already had), never a regression from before this
    // fix, and never fetched for items that fail the relevance check (keeps the added request
    // volume bounded to genuinely-relevant new items only).
    const text = await enrichRssTextWithArticleBody(item, snippetText);
    const hash = hashText(text);
    if (wasAlreadySent(source.id, hash)) {
      markRssIdSeen(source.id, itemId!); // already published under this exact hash before
      stateDirty = true;
      continue;
    }
    // Only mark this RSS item id as "seen" once it's actually been resolved (published, or
    // deliberately skipped as Low impact) - NOT on an ai-autofill/publish infra failure. Marking
    // it seen unconditionally here was a real bug: a relevant item that failed to publish (e.g.
    // the double-slash HEV_SERVER_BASE_URL bug) still got marked "seen", so newItems' dedup
    // filter above would exclude it forever - it silently never got retried, even after the
    // underlying bug was fixed.
    // Bug fix (Live Desk audit): the item's own link was already available here but never passed
    // through - see postPublish's own comment for what publishing without it used to do
    // (fall back to the raw feed .xml/.rss URL as sourceUrl, e.g. "Bank of Canada - News" linking
    // to raw XML instead of the actual press-release page).
    const articleUrl = typeof item.link === 'string' && item.link.trim() ? item.link.trim() : undefined;
    const handled = await processBlock(source, text, articleUrl);
    if (handled) {
      markRssIdSeen(source.id, itemId!);
      markSent(source.id, hash);
      stateDirty = true;
    } else {
      log.warn(source.id, `Leaving "${item.title}" unmarked so it can be retried on the next scheduled run.`);
    }
  }
  await saveStateIfDirty();
}
// ---------------------------------------------------------------------------------------------
// Source adapter: GDELT DOC 2.0 (Roadmap §A4)
//
// Free, keyless search API over a huge multi-outlet news index (blog.gdeltproject.org). Only
// TITLE, URL and publish date are ever read here - same headline-only rule as the RSS
// market-news adapter above, and this kind only ever runs with category: 'market-news' (see
// GdeltSourceConfig's doc comment), so it always goes through the exact same
// processMarketNewsItem() -> Gemini classification -> publish path. Its output lands in the same
// LiveEvent store as every other source, which is why the Geopolitical Risk Score endpoint
// (computeGeopoliticalRiskScore in server.ts) picks up GDELT-sourced items automatically without
// any change on that end.
// ---------------------------------------------------------------------------------------------

/** GDELT's seendate is "YYYYMMDDTHHMMSSZ" (no dashes/colons) - not reliably parsed by `new
 * Date()` as-is across JS engines, so convert to a real ISO-8601 string first. Returns null on
 * anything that doesn't match the expected shape rather than guessing. */
function gdeltDateToIso(seendate: unknown): string | null {
  if (typeof seendate !== 'string') return null;
  const m = seendate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const [, year, month, day, hour, minute, second] = m;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}

interface GdeltArticle {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
}

async function pollGdelt(source: Extract<WatcherSourceConfig, { kind: 'gdelt' }>): Promise<void> {
  const isNews = isMarketNewsSource(source);
  const apiUrl =
    `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(source.query)}` +
    `&mode=artlist&maxrecords=75&format=json&sort=datedesc`;

  let articles: GdeltArticle[];
  try {
    articles = await withRetry(source.id, 'gdelt fetch', async () => {
      const res = await fetch(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HEVORA-LiveIntelWatcher/1.0)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      // GDELT returns an HTML error page (not JSON) for a malformed query instead of a non-200
      // status - fail loudly here rather than let JSON.parse throw an opaque SyntaxError.
      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Error(`Non-JSON response (first 200 chars): ${body.slice(0, 200)}`);
      }
      return Array.isArray(parsed?.articles) ? (parsed.articles as GdeltArticle[]) : [];
    });
  } catch (err) {
    log.error(source.id, 'Failed to fetch/parse GDELT DOC 2.0 response', err);
    return;
  }

  log.info(source.id, `GDELT returned ${articles.length} article(s).`);
  if (isNews) newsRunStats.read += articles.length;

  // Oldest-first, same processing order as pollRss.
  const newItems = articles
    .filter((a) => a.url && !wasRssIdSeen(source.id, a.url))
    .reverse();

  for (const article of newItems) {
    const itemId = article.url as string;
    // Shaped identically to what rss-parser hands processMarketNewsItem: title/link/isoDate.
    const item = { title: article.title, link: article.url, isoDate: gdeltDateToIso(article.seendate) };

    if (isNews) {
      const outcome = await processMarketNewsItem(source, item);
      if (outcome === 'stop') {
        log.info(source.id, 'Stopping GDELT processing for this run (per-run budget reached or rate limited).');
        break;
      }
      if (outcome === 'handled') {
        markRssIdSeen(source.id, itemId);
        stateDirty = true;
      }
      continue;
    }
    // GdeltSourceConfig is only ever configured with category: 'market-news' (see its doc
    // comment) - this branch exists only so a future non-news use doesn't silently no-op forever.
    log.warn(source.id, 'GDELT source is not category "market-news" - skipping (unsupported).');
  }
  await saveStateIfDirty();
}

// ---------------------------------------------------------------------------------------------
// Source adapter: official live-blog page (generic CSS-selector based, HTML diffed for new
// entries against the source's own seen-hash dedup set)
// ---------------------------------------------------------------------------------------------
async function pollLiveBlog(source: Extract<WatcherSourceConfig, { kind: 'live-blog' }>): Promise<void> {
  let html: string;
  try {
    html = await withRetry(source.id, 'live-blog fetch', async () => {
      const res = await fetch(source.pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HEVORA-LiveIntelWatcher/1.0)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
  } catch (err) {
    log.error(source.id, `Failed to fetch live-blog page ${source.pageUrl}`, err);
    return;
  }

  let entries: string[];
  try {
    const $ = cheerio.load(html);
    entries = $(source.entrySelector)
      .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter(Boolean);
  } catch (err) {
    log.error(source.id, `Failed to parse live-blog HTML with selector "${source.entrySelector}"`, err);
    return;
  }

  if (entries.length === 0) {
    log.warn(source.id, `entrySelector "${source.entrySelector}" matched 0 elements on ${source.pageUrl} - check the selector.`);
    return;
  }

  for (const entryText of entries) {
    const hash = hashText(entryText);
    if (wasAlreadySent(source.id, hash)) continue; // already processed this exact entry before
    await ingestLine(source, entryText);
    // Note: ingestLine buffers rather than sends immediately, so this entry only actually counts
    // as "sent" (for dedup) once its containing block is flushed - markSent happens in
    // flushBuffer, not here, to avoid double-marking.
  }
}

// ---------------------------------------------------------------------------------------------
// Source adapter: YouTube Live auto-captions via yt-dlp (free/open-source CLI tool) - fetches
// ONLY the caption/subtitle track, never downloads or re-streams audio/video.
//
// LIMITATION (documented honestly, not silently skipped): local speech-to-text (Whisper/
// faster-whisper) as a fallback for sources with NO captions was evaluated and is NOT
// implemented. This deployment is a single Node.js process on Render (README.md's own
// "MANDAT SINGLE-INSTANCE" - no auto-scaling, one persistent process handling price sync + the
// signal engine + this watcher's own polling). Whisper/faster-whisper needs a Python runtime and
// heavyweight ML dependencies (torch + a model file, hundreds of MB to multiple GB) that aren't
// part of this Node.js deployment at all, and running continuous speech-to-text inference
// alongside the existing persistent loop on Render's free/starter CPU-only tier risks starving
// or crashing the whole app - not something to bolt on as an unverified side effect. Bottom line:
// captions remain the ONLY transcript source. This is a real gap for a source with genuinely no
// captions (not all YouTube Lives have them enabled), and is called out explicitly rather than
// papered over with a fake/stub fallback.
// ---------------------------------------------------------------------------------------------

// Same resolution rule as server.ts's resolveYtDlpBinary: prefer a locally-downloaded binary at
// bin/yt-dlp (relative to cwd) if one exists there, otherwise fall back to the bare "yt-dlp"
// command (PATH lookup) - covers whatever environment this script is actually run from (local
// dev, the GitHub Actions watcher workflow, which already pip-installs yt-dlp onto PATH itself).
const YT_DLP_LOCAL_PATH = path.join(process.cwd(), 'bin', 'yt-dlp');
let resolvedYtDlpBinary: string | null = null;
function resolveYtDlpBinary(): string {
  if (resolvedYtDlpBinary) return resolvedYtDlpBinary;
  resolvedYtDlpBinary = fs.existsSync(YT_DLP_LOCAL_PATH) ? YT_DLP_LOCAL_PATH : 'yt-dlp';
  return resolvedYtDlpBinary;
}

// YouTube increasingly answers requests from datacenter/cloud IPs (which is exactly what a
// GitHub Actions runner or Render both are) with "Sign in to confirm you're not a bot" - yt-dlp
// surfaces this as a plain error. withRetry (below) already retries any yt-dlp failure with a
// short exponential backoff, which covers this when it's transient - deliberately NOT
// --cookies-from-browser, since that needs a real logged-in browser session a headless scheduled
// process can't maintain unattended. Same realistic desktop User-Agent as server.ts's manual
// admin fetch (one commonly-recommended, non-guaranteed mitigation for this error).
const YT_DLP_BOT_CHECK_PATTERN = /sign in to confirm you.?re not a bot/i;
const YT_DLP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let ytDlpAvailable: boolean | null = null;

async function checkYtDlpAvailable(): Promise<boolean> {
  if (ytDlpAvailable !== null) return ytDlpAvailable;
  try {
    await execFileAsync(resolveYtDlpBinary(), ['--version']);
    ytDlpAvailable = true;
  } catch {
    ytDlpAvailable = false;
  }
  return ytDlpAvailable;
}

/** Minimal WebVTT parser - strips cue-number/timestamp lines and returns the plain caption text
 * lines, with consecutive exact duplicates collapsed (auto-caption VTT commonly repeats the same
 * line across several overlapping cues). */
function parseVttToLines(vttContent: string): string[] {
  const lines = vttContent.split(/\r?\n/);
  const out: string[] = [];
  let last = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === 'WEBVTT') continue;
    if (/^\d+$/.test(trimmed)) continue; // cue number
    if (/-->/.test(trimmed)) continue; // timestamp range
    if (/^(Kind|Language):/i.test(trimmed)) continue;
    const clean = trimmed.replace(/<[^>]+>/g, ''); // strip inline VTT styling tags
    if (clean && clean !== last) {
      out.push(clean);
      last = clean;
    }
  }
  return out;
}

/** Parses a VTT cue timestamp like "00:01:23.456" or "01:23.456" into seconds - real numbers
 * from the caption file itself, never estimated. Returns null on anything unrecognized. */
function vttTimestampToSeconds(ts: string): number | null {
  const m = ts.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})\.(\d{1,3})$/);
  if (!m) return null;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const minutes = parseInt(m[2], 10);
  const seconds = parseInt(m[3], 10);
  const millis = parseInt(m[4].padEnd(3, '0').slice(0, 3), 10);
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

/** Same parsing as parseVttToLines, but also keeps each line's cue START time (a real timestamp
 * lifted from the VTT file - never estimated/invented) - only the live-poll loop needs this, so
 * it's kept as a separate function rather than complicating the simpler one above. */
function parseVttToTimedLines(vttContent: string): { text: string; startSec: number | null }[] {
  const lines = vttContent.split(/\r?\n/);
  const out: { text: string; startSec: number | null }[] = [];
  let last = '';
  let currentStartSec: number | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === 'WEBVTT') continue;
    if (/^\d+$/.test(trimmed)) continue; // cue number
    const timingMatch = trimmed.match(/^(\S+)\s*-->\s*(\S+)/);
    if (timingMatch) {
      currentStartSec = vttTimestampToSeconds(timingMatch[1]);
      continue;
    }
    if (/^(Kind|Language):/i.test(trimmed)) continue;
    const clean = trimmed.replace(/<[^>]+>/g, '');
    if (clean && clean !== last) {
      out.push({ text: clean, startSec: currentStartSec });
      last = clean;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Semi-real-time YouTube Live polling: once a source is confirmed ACTUALLY live, instead of
// waiting for the video to finish (or for the next scheduled run 15 minutes later), this loop
// polls captions every LIVE_ACTIVE_POLL_INTERVAL_MS (~15-20s) for as long as the stream stays
// live, appending each round's genuinely NEW caption text to the SAME published live event via
// PATCH .../:id/live-segment (server.ts) - never publishing a separate new event per round. Once
// the stream ends, one final call runs the server's full holistic re-analysis over everything
// collected. No paid API involved: only yt-dlp (already used) and the existing Gemini key, and
// each round only sends the small new chunk to Gemini, not the whole growing transcript.
// ---------------------------------------------------------------------------------------------

// Re-entrancy guard: continuous mode (main()) schedules each source on its own setInterval at
// source.pollIntervalMs. If a previous invocation of pollYoutubeLiveCaptions for the SAME source
// is still inside its own tight loop below (which can run for up to LIVE_LOOP_MAX_MS), a new
// setInterval tick for that source must be skipped, not start a second overlapping loop hitting
// the same source/event concurrently. Single-run (--once) mode never re-enters the same source
// within one process anyway (runOnce polls each source exactly once, sequentially), so this is a
// no-op there.
const sourcesCurrentlyLooping = new Set<string>();

// How many consecutive "not live" reads to tolerate before actually finalizing a session - a
// single transient yt-dlp/network hiccup shouldn't prematurely end a session that's still
// genuinely live and cut off the rest of the speech.
const NOT_LIVE_STREAK_TO_FINALIZE = 2;
const notLiveStreakBySource = new Map<string, number>();

function extractYoutubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1) || null;
    return u.searchParams.get('v');
  } catch {
    return null;
  }
}

type LiveCaptionRound =
  | { ok: true; isLive: boolean; resolvedVideoId: string | null; newLines: string[]; roundStartTimestampSec: number | null }
  | { ok: false };

/** One yt-dlp invocation: resolves the actual live status + video id, and extracts ONLY the
 * caption lines not already marked sent for this source (immediately marking each newly-seen
 * line as sent, via the same sentHashes bucket every other source kind already uses) - this is
 * the "bandingkan dengan caption sebelumnya, ambil HANYA bagian baru" step. */
async function fetchYoutubeLiveCaptionRound(source: Extract<WatcherSourceConfig, { kind: 'youtube-live-captions' }>): Promise<LiveCaptionRound> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hev-live-intel-'));
  const outputTemplate = path.join(tmpDir, 'captions');
  try {
    // --print webpage_url resolves the config's videoUrl (which may just be a channel's "/live"
    // alias) to the ACTUAL specific video URL currently live; --print is_live reports whether
    // it's genuinely streaming right now (vs. a finished/upcoming/regular video) - both resolved
    // in the same call that fetches captions, one extra printed line, no extra network round trip.
    let sawBotCheck = false;
    const { stdout } = await withRetry(source.id, 'yt-dlp caption fetch', () =>
      execFileAsync(resolveYtDlpBinary(), [
        '--skip-download',
        '--write-auto-sub',
        '--sub-langs',
        'en.*,id.*',
        '--sub-format',
        'vtt',
        '--no-playlist',
        '--quiet',
        '--no-warnings',
        '--user-agent',
        YT_DLP_USER_AGENT,
        '--print',
        'webpage_url',
        '--print',
        'is_live',
        '-o',
        outputTemplate,
        source.videoUrl,
      ]).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        if (YT_DLP_BOT_CHECK_PATTERN.test(message)) {
          sawBotCheck = true;
          log.warn(source.id, `yt-dlp hit YouTube's "Sign in to confirm you're not a bot" check - withRetry above will retry this a few times with backoff (sometimes transient on datacenter IPs).`);
        }
        throw err;
      })
    );
    if (sawBotCheck) {
      log.info(source.id, `Bot-check eventually cleared after retrying.`);
    }
    const outLines = stdout.trim().split('\n').map((l) => l.trim());
    const resolvedUrl = outLines[0] && /^https?:\/\//.test(outLines[0]) ? outLines[0] : null;
    const isLive = (outLines[1] || '').toLowerCase() === 'true';
    if (resolvedUrl) {
      if (resolvedVideoUrl.get(source.id) !== resolvedUrl) {
        log.info(source.id, `Resolved live video URL: ${resolvedUrl}`);
      }
      resolvedVideoUrl.set(source.id, resolvedUrl);
    }
    const resolvedVideoId = resolvedUrl ? extractYoutubeVideoId(resolvedUrl) : null;

    const files = (await fsp.readdir(tmpDir)).filter((f) => f.endsWith('.vtt'));
    const newLines: string[] = [];
    // The earliest new line's own cue timestamp this round - a real number from the caption
    // file, applied to whatever segment(s) this round's chunk produces (the AI groups/rewrites
    // lines into segments, so there's no exact per-segment sub-timing available - this is an
    // honest "approximately when this conversation started", not a fabricated precise mapping).
    let roundStartTimestampSec: number | null = null;
    for (const file of files) {
      const content = await fsp.readFile(path.join(tmpDir, file), 'utf8');
      for (const { text, startSec } of parseVttToTimedLines(content)) {
        const hash = hashText(text);
        if (wasAlreadySent(source.id, hash)) continue; // this exact caption line already went out
        markSent(source.id, hash);
        newLines.push(text);
        if (roundStartTimestampSec === null && startSec !== null) roundStartTimestampSec = startSec;
      }
    }
    return { ok: true, isLive, resolvedVideoId, newLines, roundStartTimestampSec };
  } catch (err) {
    log.error(source.id, `yt-dlp failed to fetch captions for ${source.videoUrl} (is it actually live right now?)`, err);
    return { ok: false };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

type LiveSegmentStatus = 'live' | 'ended' | 'finalized';

/** PATCHes a round's new chunk (or a final:true finalize call) to the server. Returns the
 * event's resulting liveSession.status when the server reports it (even on an HTTP-level
 * failure, if a body was still returned) - the 3-state model means "the call didn't 200" and
 * "the session is now fully finalized" are genuinely different outcomes the caller needs to tell
 * apart (see finalizeLiveSession below). */
async function postLiveSegment(eventId: string, newChunk: string, isFinal: boolean, videoTimestampSec?: number | null): Promise<{ ok: boolean; status?: LiveSegmentStatus }> {
  let responseStatus: LiveSegmentStatus | undefined;
  try {
    await withRetry('live-segment', `PATCH live-segment (${isFinal ? 'final' : 'incremental'}) for ${eventId}`, async () => {
      const res = await fetch(`${SERVER_BASE_URL}/api/admin/live-events/${encodeURIComponent(eventId)}/live-segment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: basicAuthHeader() },
        body: JSON.stringify({ newChunk, isFinal, ...(typeof videoTimestampSec === 'number' ? { videoTimestampSec } : {}) }),
      });
      const bodyJson: any = await res.json().catch(() => null);
      if (bodyJson?.event?.liveSession?.status) responseStatus = bodyJson.event.liveSession.status;
      if (!res.ok) {
        throw new Error(`live-segment HTTP ${res.status}: ${JSON.stringify(bodyJson)?.slice(0, 300)}`);
      }
    });
    return { ok: true, status: responseStatus };
  } catch (err) {
    log.error('live-segment', `Failed to PATCH live-segment for event ${eventId} after all retries`, err);
    return { ok: false, status: responseStatus };
  }
}

/** Ends a source's tracked live session: tells the server to run its final holistic re-analysis
 * and, on success, mark liveSession.status 'finalized' - only THEN clears the session from local
 * state. If the server instead reports (or defaults to) 'ended' - meaning it recorded the stream
 * stopping but the final AI re-analysis itself failed - this keeps tracking the session so a
 * later round retries isFinal:true, instead of silently abandoning it stuck on 'ended' forever. */
async function finalizeLiveSession(sourceId: string, reason: string): Promise<void> {
  const session = state.liveSessions[sourceId];
  if (!session) return;
  log.info(sourceId, `Finalizing live session for event ${session.eventId} (${reason})...`);
  const result = await postLiveSegment(session.eventId, '', true);
  if (result.status === 'finalized') {
    log.info(sourceId, `Live session finalized - final holistic analysis applied to event ${session.eventId}.`);
    delete state.liveSessions[sourceId];
    stateDirty = true;
    await saveStateIfDirty();
    return;
  }
  log.warn(sourceId, `Live session for event ${session.eventId} is not fully finalized yet (status=${result.status || 'unknown'}) - will retry finalizing on a later round.`);
}

/** Gives every OTHER enabled source a chance to be checked during a long live-poll loop, so a
 * multi-hour YouTube session doesn't starve RSS/live-blog sources of their normal ~15-min-ish
 * cadence for the whole duration (see LIVE_LOOP_SIBLING_POLL_INTERVAL_MS). */
async function pollSiblingSourcesOnce(excludeSourceId: string): Promise<void> {
  for (const s of SOURCES) {
    if (!s.enabled || s.id === excludeSourceId) continue;
    log.info('live-loop', `Sibling poll: checking "${s.label}" while the live-poll loop is running...`);
    await pollSource(s);
  }
}

/** One round of the live-poll loop: fetches this round's new captions, and either starts a new
 * live session, appends to the ongoing one, or (not/no-longer live) finalizes it. Returns whether
 * the caller's loop should keep polling this source - NOT the same thing as "is it live right
 * now": a transient not-live/error read on an ACTIVE session returns keepPolling:true too, so the
 * loop gets NOT_LIVE_STREAK_TO_FINALIZE rounds to confirm the stream really ended before
 * finalizing, instead of a single hiccup silently cutting the session off early. */
async function pollYoutubeLiveCaptionsOnce(source: Extract<WatcherSourceConfig, { kind: 'youtube-live-captions' }>): Promise<{ keepPolling: boolean }> {
  const round = await fetchYoutubeLiveCaptionRound(source);
  const hasActiveSession = Boolean(state.liveSessions[source.id]);

  if (!round.ok || !round.isLive) {
    if (!hasActiveSession) {
      // Nothing to protect via retrying - this source was never (or is no longer) tracking a
      // session, so exit immediately on the first not-live read. Keeps the common "not live at
      // all" case a single quick check, same cost as before this feature existed.
      notLiveStreakBySource.set(source.id, 0);
      if (!round.ok) log.warn(source.id, 'yt-dlp failed this round.');
      else log.info(source.id, 'Not currently live.');
      return { keepPolling: false };
    }

    const streak = (notLiveStreakBySource.get(source.id) || 0) + 1;
    notLiveStreakBySource.set(source.id, streak);
    if (streak < NOT_LIVE_STREAK_TO_FINALIZE) {
      log.info(source.id, `Not-live read ${streak}/${NOT_LIVE_STREAK_TO_FINALIZE} while a live session is active - retrying before finalizing (avoids ending the session on one transient hiccup).`);
      return { keepPolling: true };
    }
    await finalizeLiveSession(source.id, round.ok ? 'stream reports not-live' : 'yt-dlp repeatedly failed to fetch this stream');
    return { keepPolling: false };
  }
  notLiveStreakBySource.set(source.id, 0);

  const videoId = round.resolvedVideoId || source.id; // fallback so state still round-trips if URL parsing ever fails
  const existing = state.liveSessions[source.id];

  if (existing && existing.videoId !== videoId) {
    // A different stream started without us ever catching the in-between "not live" moment
    // (can happen across the gap between separate scheduled runs) - finalize the OLD event with
    // whatever it already has, then fall through to start a fresh session below.
    await finalizeLiveSession(source.id, 'a different stream is now live at this source');
  }

  const currentSession = state.liveSessions[source.id];
  const chunk = round.newLines.filter((l) => isRelevant(l, source)).join(' ');

  if (!currentSession || currentSession.videoId !== videoId) {
    if (!chunk) {
      log.info(source.id, 'Stream just went live but no relevant captions yet - waiting for a later round to start the event.');
      return { keepPolling: true };
    }
    log.info(source.id, `New live session detected (video ${videoId}) - publishing initial event...`);
    let autofill: AutofillResult;
    try {
      autofill = await withRetry(source.id, 'ai-autofill (live session start)', () => postAutofill(source, chunk));
    } catch (err) {
      log.error(source.id, 'Initial ai-autofill for new live session failed after all retries - will retry next round', err);
      return { keepPolling: true };
    }
    try {
      const published = await withRetry(source.id, 'publish (live session start)', () => postPublish(source, chunk, autofill, videoId));
      state.liveSessions[source.id] = { eventId: published.id, videoId };
      stateDirty = true;
      await saveStateIfDirty();
      log.info(source.id, `Live session started: event ${published.id} ("${published.title}").`);
    } catch (err) {
      log.error(source.id, 'Initial publish for new live session failed after all retries - will retry next round', err);
    }
    return { keepPolling: true };
  }

  if (!chunk) {
    log.info(source.id, 'Live session continuing - no new relevant captions this round (no AI call made, saves quota).');
    return { keepPolling: true };
  }

  const appended = await postLiveSegment(currentSession.eventId, chunk, false, round.roundStartTimestampSec);
  if (appended.ok) {
    log.info(source.id, `Appended new segment to live event ${currentSession.eventId} (${chunk.length} chars).`);
  } else {
    log.warn(source.id, `Failed to append this round's segment to event ${currentSession.eventId} after all retries - this text is lost for that event (already marked seen so it won't be resent).`);
  }
  return { keepPolling: true };
}

async function pollYoutubeLiveCaptions(source: Extract<WatcherSourceConfig, { kind: 'youtube-live-captions' }>): Promise<void> {
  if (!(await checkYtDlpAvailable())) {
    log.warn(source.id, 'yt-dlp is not installed / not on PATH - skipping this source. Install it from https://github.com/yt-dlp/yt-dlp.');
    return;
  }
  if (sourcesCurrentlyLooping.has(source.id)) {
    log.info(source.id, 'Already inside an active live-poll loop for this source - skipping this scheduled tick.');
    return;
  }

  sourcesCurrentlyLooping.add(source.id);
  try {
    const loopStartMs = Date.now();
    let lastSiblingPollAt = Date.now();
    for (;;) {
      const { keepPolling } = await pollYoutubeLiveCaptionsOnce(source);
      if (!keepPolling) break;

      if (Date.now() - loopStartMs >= LIVE_LOOP_MAX_MS) {
        log.warn(
          source.id,
          `Live-poll loop hit its ${Math.round(LIVE_LOOP_MAX_MS / 60_000)}-minute safety cap while the stream is still live - stopping for this run. State is persisted, so the next scheduled run resumes appending to the same event instead of losing the thread or duplicating it.`
        );
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, LIVE_ACTIVE_POLL_INTERVAL_MS));

      if (Date.now() - lastSiblingPollAt >= LIVE_LOOP_SIBLING_POLL_INTERVAL_MS) {
        await pollSiblingSourcesOnce(source.id);
        lastSiblingPollAt = Date.now();
      }
    }
  } finally {
    sourcesCurrentlyLooping.delete(source.id);
  }
}

// ---------------------------------------------------------------------------------------------
// Source adapter: 'youtube-channel' (auto-monitored official institution channel, no manual
// video link) - a THIN wrapper, zero duplicated logic. It builds the equivalent
// 'youtube-live-captions'-shaped source (channelUrl -> videoUrl = channelUrl + "/live") and hands
// it straight to the exact same pollYoutubeLiveCaptions() used above - same yt-dlp live-check,
// same incremental-caption polling, same sentHashes/liveSessions dedup state (keyed by
// source.id, which this adapter preserves unchanged), same LIVE -> ENDED -> FINALIZED lifecycle,
// same holistic final re-analysis. The only new behavior 'youtube-channel' actually adds is
// "resolve a channel handle to its live URL" - everything after that point IS the
// 'youtube-live-captions' pipeline, verbatim.
// ---------------------------------------------------------------------------------------------
function channelSourceAsLiveCaptionsSource(
  source: Extract<WatcherSourceConfig, { kind: 'youtube-channel' }>
): Extract<WatcherSourceConfig, { kind: 'youtube-live-captions' }> {
  const base = source.channelUrl.trim().replace(/\/+$/, '');
  const liveUrl = /\/live$/i.test(base) ? base : `${base}/live`;
  const { channelUrl: _channelUrl, ...rest } = source;
  return { ...rest, kind: 'youtube-live-captions', videoUrl: liveUrl };
}

async function pollYoutubeChannel(source: Extract<WatcherSourceConfig, { kind: 'youtube-channel' }>): Promise<void> {
  await pollYoutubeLiveCaptions(channelSourceAsLiveCaptionsSource(source));
}

// Live Desk audit (2026-09-06): calendarGate check - see BaseSourceConfig.calendarGate's doc
// comment in live-intel-watcher.config.ts. Cached for CALENDAR_GATE_CACHE_MS so a single run/cycle
// that happens to poll a gated source more than once (or the continuous-mode setInterval loop
// ticking every pollIntervalMs) doesn't hit the server once per source per tick - the underlying
// Economic Calendar itself is already cached server-side for minutes at a time, so this adds no
// meaningful staleness beyond what that cache already has.
const CALENDAR_GATE_CACHE_MS = 60_000;
let cspanGateCache: { checkedAt: number; eligible: boolean } | null = null;
async function checkCspanEligibility(): Promise<boolean> {
  if (cspanGateCache && Date.now() - cspanGateCache.checkedAt < CALENDAR_GATE_CACHE_MS) {
    return cspanGateCache.eligible;
  }
  try {
    const res = await fetch(`${SERVER_BASE_URL}/api/live-desk/cspan-eligibility`, { signal: AbortSignal.timeout(15_000) });
    const eligible = res.ok && (await res.json())?.eligible === true;
    cspanGateCache = { checkedAt: Date.now(), eligible };
    return eligible;
  } catch (err) {
    // Fail CLOSED - never assume eligible just because the check itself failed. A missed real
    // testimony (this returning false when it should have returned true, e.g. during a genuine
    // server outage) is a quiet miss; the reverse (treating C-SPAN as eligible when the calendar
    // couldn't actually be checked) is exactly the always-on cost this gate exists to prevent.
    log.error('cspan-gate', `Could not reach ${SERVER_BASE_URL}/api/live-desk/cspan-eligibility - treating C-SPAN as NOT eligible this round`, err);
    cspanGateCache = { checkedAt: Date.now(), eligible: false };
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------
async function pollSource(source: WatcherSourceConfig): Promise<void> {
  try {
    if (source.calendarGate === 'congress-testimony' && !(await checkCspanEligibility())) {
      log.info(source.id, 'Skipped - no Congress-testimony/hearing window currently active on the Economic Calendar (see calendarGate).');
      return;
    }
    if (source.kind === 'rss') await pollRss(source);
    else if (source.kind === 'live-blog') await pollLiveBlog(source);
    else if (source.kind === 'youtube-live-captions') await pollYoutubeLiveCaptions(source);
    else if (source.kind === 'youtube-channel') await pollYoutubeChannel(source);
    else if (source.kind === 'gdelt') await pollGdelt(source);
  } catch (err) {
    // Defensive catch-all - an adapter bug should never crash the whole watcher process.
    log.error(source.id, 'Unhandled error while polling this source', err);
  }
}

const activeTimers: NodeJS.Timeout[] = [];

// `--once` (or WATCHER_RUN_ONCE=true) selects single-run mode: poll every enabled source exactly
// one time, flush anything buffered immediately, persist dedup state, then exit - for an external
// scheduler (e.g. a GitHub Actions cron workflow) to invoke repeatedly instead of this process
// staying resident with its own setInterval loop.
const RUN_ONCE = process.argv.includes('--once') || process.env.WATCHER_RUN_ONCE === 'true';

async function runOnce(): Promise<void> {
  log.info('startup', `HEV Live Intelligence Watcher (single run) - publishing to ${SERVER_BASE_URL}`);

  try {
    basicAuthHeader(); // fail fast if admin credentials aren't configured
  } catch (err) {
    log.error('startup', 'Cannot run: admin credentials missing', err);
    process.exit(1);
  }

  state = await loadState();

  const enabledSources = SOURCES.filter((s) => s.enabled);
  if (enabledSources.length === 0) {
    log.warn('startup', 'No sources are enabled in live-intel-watcher.config.ts. Edit SOURCES and set enabled: true on at least one. Exiting (nothing to do).');
    return;
  }

  resetMarketNewsRunBudget();

  // Sequential, not parallel: keeps log output readable and avoids hammering yt-dlp / external
  // feeds all at once - a single scheduled run has no tight latency requirement.
  for (const source of enabledSources) {
    log.info('startup', `Polling "${source.label}" (${source.kind}${source.category === 'market-news' ? ', market-news' : ''})...`);
    await pollSource(source);
  }

  await flushAllBuffersNow();
  await saveStateIfDirty();
  logMarketNewsRunSummary();
  log.info('shutdown', 'Single run complete, exiting.');
}

async function main(): Promise<void> {
  log.info('startup', `HEV Live Intelligence Watcher starting - publishing to ${SERVER_BASE_URL}`);

  try {
    basicAuthHeader(); // fail fast if admin credentials aren't configured
  } catch (err) {
    log.error('startup', 'Cannot start: admin credentials missing', err);
    process.exit(1);
  }

  state = await loadState();

  const enabledSources = SOURCES.filter((s) => s.enabled);
  if (enabledSources.length === 0) {
    log.warn('startup', 'No sources are enabled in live-intel-watcher.config.ts. Edit SOURCES and set enabled: true on at least one before running this for real. The process will stay alive and idle.');
  }

  for (const source of enabledSources) {
    const interval = Math.max(source.pollIntervalMs, MIN_POLL_INTERVAL_MS);
    log.info('startup', `Watching "${source.label}" (${source.kind}) every ${Math.round(interval / 1000)}s`);
    // Fire once immediately, then on the interval.
    pollSource(source).catch((err) => log.error(source.id, 'Initial poll failed', err));
    activeTimers.push(setInterval(() => pollSource(source), interval));
  }

  // Market-news per-run budget in continuous mode: `runOnce` resets it once per invocation, but a
  // long-lived process has no "run" boundary, so re-open the budget on the same 15-minute cadence
  // the scheduled workflow uses. Without this a continuous process would publish at most 5 news
  // items ever and then go quiet.
  if (SOURCES.some((src) => src.enabled && src.category === 'market-news')) {
    resetMarketNewsRunBudget();
    activeTimers.push(
      setInterval(() => {
        logMarketNewsRunSummary();
        resetMarketNewsRunBudget();
        newsRunStats.read = 0;
        newsRunStats.tooOld = 0;
        newsRunStats.duplicate = 0;
        newsRunStats.irrelevant = 0;
        newsRunStats.lowImpact = 0;
        newsRunStats.published = 0;
        newsRunStats.deferred = 0;
      }, 15 * 60 * 1000)
    );
  }

  // Shared flush ticker - checks every 5s whether any source's buffer has waited long enough.
  activeTimers.push(setInterval(() => {
    flushDueBuffers().catch((err) => log.error('flush-ticker', 'Unhandled error while flushing buffers', err));
  }, 5_000));

  // Periodically persist dedup state even if nothing has flushed recently (belt-and-suspenders -
  // flushBuffer/pollRss/pollLiveBlog already save right after they mark something dirty).
  activeTimers.push(setInterval(() => {
    saveStateIfDirty().catch((err) => log.error('state', 'Periodic state save failed', err));
  }, 30_000));

  const shutdown = async (signal: string) => {
    log.info('shutdown', `Received ${signal}, persisting state and exiting...`);
    activeTimers.forEach(clearInterval);
    await saveStateIfDirty();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

if (RUN_ONCE) {
  // Explicit process.exit(0) on success: open keep-alive sockets left behind by fetch/rss-parser
  // can otherwise hold the event loop open indefinitely even after runOnce() has resolved, which
  // would hang a scheduled CI job (e.g. GitHub Actions) well past when the work is actually done.
  runOnce()
    .then(() => process.exit(0))
    .catch((err) => {
      log.error('startup', 'Fatal error during single run', err);
      process.exit(1);
    });
} else {
  main().catch((err) => {
    log.error('startup', 'Fatal error during startup', err);
    process.exit(1);
  });
}
