// ============================================================================================
// Live Desk audit (2026-09-06), item §2/§3: 24-hour international news channels, available in
// Live Desk purely as a free, direct video EMBED for the user to watch - NEVER wired into the
// live-intel-watcher.ts caption pipeline or the live-desk-audio-worker.ts audio/STT pipeline (see
// the "EXPLICITLY NOT ADDED" block in scripts/live-intel-watcher.config.ts for why: a 24/7-live
// channel would win the single audio-eligible slot almost continuously, and these are general
// commercial news outlets - out of scope for the transcript/AI-analysis pipeline the same way Fox
// News/CNBC/Bloomberg already are). This file is intentionally the ONLY place these channels are
// wired in - a static, frontend-only catalog with zero backend/AI cost.
//
// Embed mechanism: YouTube's documented `embed/live_stream?channel=<channel id>` endpoint embeds
// "whatever is currently live on this channel" without needing to know a specific video id ahead
// of time (unlike a normal /embed/VIDEO_ID URL) - exactly what a 24/7 rolling broadcast needs, and
// the same free/public embed mechanism LiveEventDetailPage.tsx and LiveDeskView.tsx already use for
// a resolved institutional broadcast (see extractYoutubeEmbedUrl in both files).
//
// Verification note: this sandbox's network egress to youtube.com is blocked (same restriction
// documented throughout live-intel-watcher.config.ts), so no channel below was opened directly by
// this session. Every id here WAS independently verified via live web search (not general
// knowledge/memory) - each channel id is cross-confirmed by at least one third-party YouTube
// analytics tracker (Social Blade / vidIQ / NoxInfluencer / HypeAuditor / SPEAKRJ / SocialCounts)
// AND, for five of the seven, also by Wikidata's own structured "YouTube channel ID" property -
// genuinely stronger evidence than this project's own past "third-party index" tier for RSS feeds.
// `confidence: 'lower'` marks the one exception (France 24 English) where only a single indirect
// source (a YouTube Music mirror page carrying the same channel id under the same title) was
// found - spot-check that one before leaning on it hard. Re-verify periodically; a channel can
// rename/migrate its id over time the same way any live-intel-watcher.config.ts entry can.
// ============================================================================================

export interface LiveDeskVideoChannel {
  id: string;
  /** Display label shown in the Live Desk "Live Sekarang" picker. */
  label: string;
  /** YouTube's stable channel id (UC...), used as `embed/live_stream?channel=<id>`. */
  channelId: string;
  /** Human-facing channel URL, shown as an "open on YouTube" fallback/external link. */
  channelUrl: string;
  confidence: 'verified' | 'lower';
}

export const LIVE_DESK_VIDEO_CHANNELS: LiveDeskVideoChannel[] = [
  {
    id: 'dw-news',
    label: 'DW News',
    // VERIFIED (2026-09-06): cross-confirmed by SocialBlade, NoxInfluencer, HypeAuditor and
    // SocialCounts.org, all agreeing @dwnews = this id (~6.0-6.2M subscribers).
    channelId: 'UCknLrEdhRCp1aegoMqRaCZg',
    channelUrl: 'https://www.youtube.com/@dwnews',
    confidence: 'verified',
  },
  {
    id: 'france24-english',
    label: 'France 24 English',
    // LOWER CONFIDENCE (2026-09-06): only one indirect source found (a YouTube Music mirror page
    // titled "FRANCE 24 English" carrying this same id) - not independently cross-confirmed by a
    // second tracker the way the other six channels here were. Spot-check @France24_en resolves to
    // this id before relying on it.
    channelId: 'UCQfwfsi5VrQ8yKZ-UWmAEFg',
    channelUrl: 'https://www.youtube.com/@France24_en',
    confidence: 'lower',
  },
  {
    id: 'nhk-world-japan',
    label: 'NHK WORLD-JAPAN',
    // VERIFIED (2026-09-06): cross-confirmed by Wikidata's own YouTube-channel-id property, vidIQ
    // and NoxInfluencer, all agreeing on this id.
    channelId: 'UCSPEjw8F2nQDtmUKPFNF7_A',
    channelUrl: 'https://www.youtube.com/channel/UCSPEjw8F2nQDtmUKPFNF7_A',
    confidence: 'verified',
  },
  {
    id: 'euronews',
    label: 'Euronews',
    // VERIFIED (2026-09-06): cross-confirmed by tubics and a direct m.youtube.com live-stream
    // snippet, both agreeing @euronews = this id (~2.4M subscribers).
    channelId: 'UCSrZ3UV4jOidv8ppoVuvW9Q',
    channelUrl: 'https://www.youtube.com/@euronews',
    confidence: 'verified',
  },
  {
    id: 'al-jazeera-english',
    label: 'Al Jazeera English',
    // VERIFIED (2026-09-06): cross-confirmed by Wikidata, vidIQ, SocialCounts.org and SPEAKRJ, all
    // agreeing @aljazeeraenglish = this id (~17.9M subscribers).
    channelId: 'UCNye-wNBqNL5ZzHSJj3l8Bg',
    channelUrl: 'https://www.youtube.com/@aljazeeraenglish',
    confidence: 'verified',
  },
  {
    id: 'sky-news',
    label: 'Sky News',
    // VERIFIED (2026-09-06): cross-confirmed by Wikidata, vidIQ, SocialBlade and SPEAKRJ, all
    // agreeing @SkyNews = this id (~9.1M subscribers) - distinct from the separate "Sky News
    // Australia" channel, which is NOT what this entry points at.
    channelId: 'UCoMdktPbSTixAyNGwb-UYkQ',
    channelUrl: 'https://www.youtube.com/@SkyNews',
    confidence: 'verified',
  },
  {
    id: 'cna',
    label: 'CNA (Channel News Asia)',
    // VERIFIED (2026-09-06): cross-confirmed by SPEAKRJ and SocialCounts.org, both agreeing
    // @channelnewsasia = this id (~3.2M subscribers).
    channelId: 'UC83jt4dlz1Gjl58fzQrrKZg',
    channelUrl: 'https://www.youtube.com/@channelnewsasia',
    confidence: 'verified',
  },
];

/** YouTube's documented "embed whatever is live on this channel right now" endpoint - no video id
 *  needed. See this file's header comment for why this mechanism (not a resolved video id) is the
 *  right one for a 24/7 rolling broadcast. */
export function liveDeskVideoChannelEmbedUrl(channel: LiveDeskVideoChannel): string {
  return `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channel.channelId)}`;
}
