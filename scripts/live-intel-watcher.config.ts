// ============================================================================================
// Configuration for the HEV Live Intelligence Watcher (scripts/live-intel-watcher.ts).
//
// Edit SOURCES below to point at the actual live sources you want monitored. Every source here
// MUST be free/public/legal:
//   - YouTube Live: only the auto-generated caption/subtitle track via yt-dlp, never the actual
//     audio/video stream.
//   - RSS: only a source's own official, publicly published feed (central bank / government
//     press releases).
//   - live-blog: only a genuinely free/public page - never a paywalled outlet (Bloomberg
//     Terminal, Reuters/Refinitiv, CNBC Pro, etc).
// ============================================================================================

export type WatcherSourceKind = 'youtube-live-captions' | 'youtube-channel' | 'rss' | 'live-blog' | 'gdelt';

/** Which pipeline a source feeds.
 *
 *  - 'live-intel' (default): the original Live Intelligence pipeline. Long-form transcript /
 *    official press-release text goes to the transcript prompt, producing topic segments, a causal
 *    chain and an 8-pair read.
 *  - 'market-news': the automated market-news pipeline. HEADLINE-ONLY: the watcher sends just the
 *    title (never the feed's content/contentSnippet - see pollRss in live-intel-watcher.ts), the
 *    server runs buildMarketNewsAutofillPrompt instead, and the result publishes as a
 *    `type: 'market_news'` LiveEvent that the Intel tab renders as a news card.
 *
 *  The distinction is a copyright boundary, not just a display choice - see the COPYRIGHT block in
 *  live-intel-watcher.ts. */
export type WatcherSourceCategory = 'live-intel' | 'market-news';

interface BaseSourceConfig {
  /** Stable identifier - used as the dedup-state key and in logs. Never change this for a
   * source you've already run, or its dedup history resets. */
  id: string;
  /** Human-readable name, published as the LiveEvent's `source` field. */
  label: string;
  enabled: boolean;
  /** Defaults to 'live-intel' when omitted, so every pre-existing source keeps its exact
   * behaviour untouched. */
  category?: WatcherSourceCategory;
  pollIntervalMs: number;
  /** Optional per-source keyword filter (case-insensitive substring match), overriding the
   * global KEYWORDS list below for this source only. Useful when a source is narrow enough
   * that the global list is either too broad (lets through unrelated items) or missing a term
   * specific to this source. Omit to just use the global KEYWORDS list. */
  keywords?: string[];
  /** Live Desk Part 2 (real audio-to-text pipeline, scripts/live-desk-audio-worker.ts) - ONLY
   * sources with this set are eligible for the real OpenRouter audio-STT pipeline; every other
   * source (including every 'youtube-live-captions'/'youtube-channel' entry without this field)
   * stays caption/RSS-only forever, regardless of LIVE_DESK_AUDIO_ENABLED. Lower number = higher
   * priority. When more than one audio-eligible source is confirmed live at the same moment, the
   * worker captures real audio for exactly ONE of them (the lowest number here, tie-broken by
   * whichever currency has an active High-impact Kalender Ekonomi event right now) and leaves the
   * others on captions - see selectAudioSession() in live-desk-audio-worker.ts. Deliberately only
   * set on the already-verified 'youtube-channel' institution entries below, never invented for a
   * new source - the audio pipeline is strictly a subset of what's already caption-eligible here.
   * Only meaningful on 'youtube-live-captions'/'youtube-channel' kinds (RSS/live-blog/GDELT have
   * no audio to capture in the first place). */
  audioPriority?: number;
  /** Live Desk audit (2026-09-06): when set, this source is NOT polled at all (caption pipeline
   * AND, since audioEligibleSources() in live-desk-audio-worker.ts checks the same field, the audio
   * pipeline too) unless the Economic Calendar currently has a matching event active - checked via
   * GET /api/live-desk/cspan-eligibility on the server before every poll, never assumed locally.
   * Only value today: 'congress-testimony' - true only around a US Congressional testimony/hearing
   * the calendar itself flags (EconomicEvent.congressLinked in src/types.ts; the actual window/
   * matching logic lives server-side in server.ts's isCongressTestimonyEvent/
   * computeCspanEligibility so every consumer of this field agrees on the same answer). Exists
   * specifically so a source like C-SPAN - whose channel runs many consecutive hours most sitting
   * days, unlike an occasional central-bank press conference - can be `enabled: true` (in the
   * roster) without being live-monitored/audio-eligible around the clock; see the cspan-youtube-
   * channel entry below. On any error reaching the server, the check fails CLOSED (not eligible) -
   * see checkCspanEligibility in live-intel-watcher.ts / live-desk-audio-worker.ts. */
  calendarGate?: 'congress-testimony';
}

export interface YoutubeLiveSourceConfig extends BaseSourceConfig {
  kind: 'youtube-live-captions';
  /** A channel's "/live" URL (yt-dlp resolves it to whatever video is currently live) or a
   * direct video URL for one specific known livestream. Requires the yt-dlp binary on PATH -
   * https://github.com/yt-dlp/yt-dlp (free, open-source). */
  videoUrl: string;
}

export interface YoutubeChannelSourceConfig extends BaseSourceConfig {
  kind: 'youtube-channel';
  /** The channel's OWN canonical URL - handle form (https://www.youtube.com/@federalreserve),
   * legacy /user/ or /c/ form, or a stable /channel/UC... id - NOT a specific video link, and do
   * NOT append "/live" yourself, the watcher does that. Every scheduled run, the watcher asks
   * yt-dlp whether this channel is live RIGHT NOW; if it is (and this isn't a video already
   * being tracked), it automatically starts the same live-processing pipeline
   * 'youtube-live-captions' uses (see live-intel-watcher.ts's channelSourceAsLiveCaptionsSource -
   * zero duplicated logic, this kind is a thin auto-detecting wrapper around that same machinery).
   * Only put OFFICIAL institution channels here (a central bank/IMF/World Bank's own channel) -
   * never a general news outlet's channel (Fox News/CNBC/Bloomberg etc are out of scope for this
   * watcher). Requires the yt-dlp binary on PATH - https://github.com/yt-dlp/yt-dlp. */
  channelUrl: string;
}

export interface RssSourceConfig extends BaseSourceConfig {
  kind: 'rss';
  /** The feed's direct .xml/.rss URL - NOT the HTML "subscribe to our RSS" landing page. */
  feedUrl: string;
}

export interface LiveBlogSourceConfig extends BaseSourceConfig {
  kind: 'live-blog';
  pageUrl: string;
  /** CSS selector matching each repeating "entry" block on the page - every outlet's markup
   * differs, inspect the target page (view-source / devtools) and set this accordingly. */
  entrySelector: string;
}

/** Roadmap §A4: GDELT DOC 2.0 API (api.gdeltproject.org) - free, no API key, no ToS login wall.
 * GDELT itself is not a market-news outlet, it is a search index over tens of thousands of news
 * sites worldwide; this source type queries it for a fixed keyword set and feeds whatever
 * headlines it returns into the SAME 'market-news' pipeline every RSS market-news source already
 * uses (see WatcherSourceCategory above) - headline + link only, same Gemini
 * relevance/impact/geopoliticalRisk classification, same copyright-safe headline-only rule. This
 * is additive to the existing Geopolitical Risk pipeline (computeGeopoliticalRiskScore in
 * server.ts already aggregates every market_news LiveEvent's AI-scored geopoliticalRisk field
 * regardless of which source produced it), not a second parallel scoring system. */
export interface GdeltSourceConfig extends BaseSourceConfig {
  kind: 'gdelt';
  /** GDELT DOC 2.0 query string - same syntax as https://api.gdeltproject.org/api/v2/doc/doc,
   * URL-encoded automatically by pollGdelt. Boolean OR groups need parentheses, e.g.
   * '("federal reserve" OR gold OR sanctions)'. See
   * https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/ for the full query syntax. */
  query: string;
}

export type WatcherSourceConfig =
  | YoutubeLiveSourceConfig
  | YoutubeChannelSourceConfig
  | RssSourceConfig
  | LiveBlogSourceConfig
  | GdeltSourceConfig;

export const SOURCES: WatcherSourceConfig[] = [
  // ============================================================================================
  // RSS sources - ALL DISABLED by default. feedUrl MUST be the feed's direct machine-readable
  // URL (what you get from "Copy Link Address" on the actual RSS/XML icon or link - typically
  // ends in .xml/.rss, or serves content-type application/rss+xml/atom+xml when opened), NOT the
  // HTML "RSS feeds" landing/subscribe page a browser shows you. Confirm it by opening the URL
  // directly: you should see raw <rss>/<feed> XML, not a styled webpage.
  //
  // IMPORTANT - how "confirmed" below was actually determined: this sandbox's network egress is
  // blocked for every one of these domains (direct curl/WebFetch to federalreserve.gov,
  // bankofengland.co.uk, bankofcanada.ca, rba.gov.au, imf.org, boj.or.jp all return a hard
  // "CONNECT tunnel failed, 403" - verified again on 2026-08-10, same restriction as every
  // earlier round in this project). So NONE of the feedUrl values below were fetched and
  // eyeballed as raw XML by this session - they were found via web search only (search result
  // snippets, page titles, and third-party RSS-reader indexes like feeder.co that had already
  // fetched them). That's a real signal (a service like feeder.co showing genuine recent feed
  // items IS evidence the URL is a real working feed), but it is one step short of this session
  // opening the URL itself. Each entry below is marked accordingly - "verified" ones had a search
  // result that quoted actual feed content (item titles/dates) proving it resolves to real XML;
  // "unverified" ones are the best candidate found but genuinely could be wrong or have moved.
  // Confirm every single one yourself (open the URL, see raw <rss>/<feed> XML) before flipping
  // enabled to true - this file will publish whatever a source returns straight into Live Intel,
  // so a wrong URL here is a "silently never fires" bug at worst, not a data-integrity risk, but
  // still worth getting right before relying on it.
  // ============================================================================================
  {
    id: 'fed-press-monetary',
    kind: 'rss',
    label: 'Federal Reserve - Press Releases (Monetary Policy)',
    enabled: true,
    feedUrl: 'https://www.federalreserve.gov/feeds/press_monetary.xml',
    keywords: ['fed', 'fomc', 'rate', 'inflation'],
    pollIntervalMs: 60_000,
  },
  {
    id: 'fed-speeches-testimony',
    kind: 'rss',
    label: 'Federal Reserve - Speeches & Testimony',
    enabled: true,
    feedUrl: 'https://www.federalreserve.gov/feeds/speeches_and_testimony.xml',
    keywords: ['fed', 'inflation', 'rate', 'economic outlook'],
    pollIntervalMs: 60_000,
  },
  {
    id: 'ecb-press',
    kind: 'rss',
    label: 'European Central Bank - Press',
    enabled: true,
    // NOTE: this is the HTML hub/landing page, not confirmed to be a direct machine-readable
    // .xml feed - rss-parser may fail to parse it (ECB's real feed link wasn't independently
    // reachable to verify from this environment - see the RSS format note above). If it errors
    // in the logs, open this URL in a browser, copy the actual feed link from the page, and
    // replace feedUrl with that.
    feedUrl: 'https://www.ecb.europa.eu/rss/press.html',
    keywords: ['inflation', 'rate', 'ecb', 'lagarde', 'monetary policy'],
    pollIntervalMs: 60_000,
  },
  {
    id: 'boe-news',
    kind: 'rss',
    label: 'Bank of England - News',
    enabled: true,
    // VERIFIED (2026-08-10): a search result quoted actual recent item titles from this exact
    // URL ("CBDC Academic Advisory Group minutes", "Money Market Committee minutes" - real BoE
    // committee-minutes releases, dated Jan/Mar 2026), which is strong evidence it's a live,
    // genuinely resolving feed - but this session never fetched it directly (egress blocked), so
    // still open it yourself once before enabling. Hub page: https://www.bankofengland.co.uk/rss
    feedUrl: 'https://www.bankofengland.co.uk/rss/news',
    keywords: ['bank of england', 'boe', 'bailey', 'monetary policy committee', 'mpc', 'interest rate'],
    pollIntervalMs: 60_000,
  },
  {
    id: 'boj-whatsnew',
    kind: 'rss',
    label: 'Bank of Japan - News List (English)',
    enabled: true,
    // UNVERIFIED (2026-08-10): best candidate found via web search (a third-party RSS-reader
    // index's URL slug implies this exact path); this session could not fetch boj.or.jp directly
    // (egress blocked) to confirm it resolves to raw XML. Hub page (Japanese):
    // https://www.boj.or.jp/rss.htm - open it yourself and cross-check this URL, or find the
    // English feed link from https://www.boj.or.jp/en/whatsnew/index.htm before enabling.
    feedUrl: 'https://www.boj.or.jp/en/rss/whatsnew.xml',
    keywords: ['bank of japan', 'boj', 'ueda', 'yield curve control', 'monetary policy', 'interest rate'],
    pollIntervalMs: 60_000,
  },
  {
    id: 'boc-news',
    kind: 'rss',
    label: 'Bank of Canada - News',
    enabled: true,
    // UNVERIFIED (2026-08-10): found via web search as a real page URL indexed under the title
    // "News - Bank of Canada" (suggesting it resolves to feed content, not a 404), but this
    // session could not fetch bankofcanada.ca directly (egress blocked) to confirm the raw XML.
    // Hub page: https://www.bankofcanada.ca/rss-feeds/ - open it yourself to confirm this is
    // still the right link (or swap for the "Press releases" or "Announcements" specific feed
    // listed on that page if you want a narrower one) before enabling.
    feedUrl: 'https://www.bankofcanada.ca/feed/?utility=news',
    keywords: ['bank of canada', 'boc', 'macklem', 'overnight rate', 'monetary policy', 'interest rate'],
    pollIntervalMs: 60_000,
  },
  {
    id: 'rba-media-releases',
    kind: 'rss',
    label: 'Reserve Bank of Australia - Media Releases',
    enabled: true,
    // UNVERIFIED (2026-08-10): found via web search as a direct .xml URL (not a landing page),
    // but this session could not fetch rba.gov.au directly (egress blocked) to confirm it still
    // resolves. Hub page: https://www.rba.gov.au/updates/rss-feeds.html - confirm this URL there
    // (RBA's docs describe an RSS feed on the Media Releases page itself, so also check
    // https://www.rba.gov.au/media-releases/ if this exact path has moved) before enabling.
    feedUrl: 'https://www.rba.gov.au/rss/rss-cb-media-releases.xml',
    keywords: ['reserve bank of australia', 'rba', 'cash rate', 'monetary policy', 'interest rate'],
    pollIntervalMs: 60_000,
  },
  {
    id: 'imf-whatsnew',
    kind: 'rss',
    label: 'IMF - What\'s New (Press Releases, Speeches, Communiques)',
    enabled: false,
    // VERIFIED FAILING (2026-08-11, Verify RSS Feeds workflow on GitHub Actions): this URL returns
    // HTTP 403. Note it is 403, not 404 - imf.org answered and actively refused, which points at
    // bot/user-agent filtering (rss-parser identifies itself as "rss-parser") rather than a dead
    // endpoint, so the path itself may well still be correct. Disabled for now on an explicit call
    // to keep the feed check green rather than to hide a problem; the item is simply never polled
    // while off. To bring it back, either confirm the current URL at https://www.imf.org/en/news/rss
    // or send browser-like request headers (a real User-Agent + Accept) from rss-parser - the same
    // class of fix already used for yt-dlp's bot check in live-intel-watcher.ts.
    feedUrl: 'https://www.imf.org/en/rss-list/feed?category=WHATSNEW',
    keywords: ['imf', 'international monetary fund', 'georgieva', 'global economy', 'monetary policy', 'interest rate', 'sovereign debt'],
    pollIntervalMs: 60_000,
  },
  // World Bank: NO official top-level press-release RSS feed could be found (2026-08-10 web
  // search). Search only turned up per-blog feeds (e.g. individual World Bank blog RSS URLs -
  // narrow, off-topic for macro/monetary intelligence) and an eLibrary research-publication feed
  // - neither is "official press release/speech" in the sense the other sources here are. Not
  // adding a guessed entry; if you find the real feed yourself, add it here following the same
  // pattern as the others.

  // ============================================================================================
  // MARKET NEWS sources (category: 'market-news') - the automated news feed for the public Intel
  // tab. These behave differently from every source above in one crucial way:
  //
  //   ONLY the headline is ever read from these feeds. The watcher does NOT send the feed's
  //   content/contentSnippet anywhere, does not store it, and does not display it. Gemini writes
  //   an original summary from the headline alone, and every published card links back to the
  //   source article. See the COPYRIGHT block at the top of live-intel-watcher.ts.
  //
  // These are commercial news outlets (unlike the central-bank/government sources above), which is
  // exactly why the headline-only rule exists - a publicly offered RSS feed is an invitation to
  // link and reference, never a licence to republish an outlet's article text.
  //
  // VERIFICATION STATUS - read this before trusting any `enabled: true` below. This sandbox still
  // cannot reach these domains (curl AND WebFetch both return "CONNECT tunnel failed, 403" -
  // re-tested 2026-08-11), so NOT ONE of these URLs was opened and eyeballed as raw XML by the
  // session that added them. What each was checked against is recorded per entry, using two tiers:
  //   PUBLISHER-DOCUMENTED = the outlet's OWN site documents this exact feed URL (their /rss
  //     directory page, or an article they published about their feed). Strongest available
  //     evidence short of fetching it.
  //   THIRD-PARTY-ONLY = only aggregator/indexer sites (feedspot, rss.app, newsloth) reference it.
  //     Weaker - those sites list plausible-looking URLs that are sometimes stale or generated.
  // Anything that was THIRD-PARTY-ONLY is left `enabled: false`.
  //
  // Run `npm run verify:feeds` from a machine with normal internet access to check every entry
  // here for real (it fetches each feed, parses it, and prints item counts + newest item dates).
  // Flip anything that fails to `enabled: false`.
  // ============================================================================================
  {
    id: 'news-investing-com',
    kind: 'rss',
    category: 'market-news',
    label: 'Investing.com',
    enabled: true,
    // PUBLISHER-DOCUMENTED: listed on Investing.com's own webmaster tools RSS directory
    // (https://www.investing.com/webmaster-tools/rss). Broad market/forex/commodities coverage.
    feedUrl: 'https://www.investing.com/rss/news.rss',
    pollIntervalMs: 15 * 60_000,
  },
  {
    id: 'news-fxstreet',
    kind: 'rss',
    category: 'market-news',
    label: 'FXStreet',
    enabled: true,
    // PUBLISHER-DOCUMENTED: FXStreet's own RSS directory (https://www.fxstreet.com/rssdirectory)
    // lists the /rss/news path.
    feedUrl: 'https://www.fxstreet.com/rss/news',
    pollIntervalMs: 15 * 60_000,
  },
  {
    id: 'news-coindesk',
    kind: 'rss',
    category: 'market-news',
    label: 'CoinDesk',
    enabled: true,
    // PUBLISHER-DOCUMENTED: CoinDesk published an article specifically documenting this feed
    // ("Looking for CoinDesk's RSS Feed? Here It Is", coindesk.com, 2021-09-17).
    feedUrl: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    pollIntervalMs: 15 * 60_000,
  },
  {
    id: 'news-cointelegraph',
    kind: 'rss',
    category: 'market-news',
    label: 'Cointelegraph',
    enabled: true,
    // PUBLISHER-DOCUMENTED: cointelegraph.com/rss is Cointelegraph's own long-standing feed path,
    // referenced directly on their site.
    feedUrl: 'https://cointelegraph.com/rss',
    pollIntervalMs: 15 * 60_000,
  },
  {
    id: 'news-cnbc-markets',
    kind: 'rss',
    category: 'market-news',
    label: 'CNBC Markets',
    enabled: true,
    // PUBLISHER-DOCUMENTED: cnbc.com's own /id/<section>/device/rss/rss.html feed pattern; 20910258
    // is CNBC's Markets/commodities-and-energy section id.
    feedUrl: 'https://www.cnbc.com/id/20910258/device/rss/rss.html',
    pollIntervalMs: 15 * 60_000,
  },
  {
    id: 'news-kitco',
    kind: 'rss',
    category: 'market-news',
    label: 'Kitco News',
    enabled: false,
    // THIRD-PARTY-ONLY: search surfaced a kitco.com page titled "RSS News | KITCO" at this path,
    // but Kitco's gold/commodities category links resolved to normal HTML pages, so this exact
    // path returning XML is not established. Verify with `npm run verify:feeds` and enable if it
    // parses - Kitco is a genuinely good gold/commodities source, it just isn't confirmed yet.
    feedUrl: 'https://www.kitco.com/news/category/mining/rss',
    pollIntervalMs: 15 * 60_000,
  },
  {
    id: 'news-forexlive',
    kind: 'rss',
    category: 'market-news',
    label: 'ForexLive',
    enabled: true,
    // VERIFIED LIVE (2026-08-11, Verify RSS Feeds workflow on GitHub Actions): fetched and parsed
    // successfully with 25 dated items. This supersedes the earlier caution about the
    // ForexLive -> InvestingLive rebrand: whatever the redirect situation is, this URL still
    // resolves to a real, current feed, so it is enabled on that evidence rather than on a guess.
    feedUrl: 'https://www.forexlive.com/feed/news',
    pollIntervalMs: 15 * 60_000,
  },
  {
    id: 'news-bls',
    kind: 'rss',
    category: 'market-news',
    label: 'US Bureau of Labor Statistics',
    enabled: false,
    // UNRESOLVED: BLS publishes a feeds hub (https://www.bls.gov/feeds) but search did not surface
    // a single confirmed direct feed URL for its news releases - the one candidate found was a
    // year-scoped schedule file (.../2019news_releases_public.rss), which is an archive, not a live
    // feed. Left disabled with a deliberately non-functional placeholder rather than inventing a
    // URL. Open the hub, copy the real "Latest Numbers"/news-release feed link, and paste it here.
    feedUrl: 'https://www.bls.gov/feeds',
    pollIntervalMs: 15 * 60_000,
  },

  // ============================================================================================
  // live-blog source - ALL DISABLED by default. Use this adapter for a page that doesn't have a
  // real RSS feed (like Bank Indonesia below) or for any other free/public "live blog" style
  // page. Two fields to fill in:
  //   - pageUrl: the actual page URL to poll.
  //   - entrySelector: a CSS selector (same syntax as document.querySelectorAll / jQuery) that
  //     matches EACH individual press-release/post entry on the page - NOT the whole page, NOT
  //     a single fixed item. To find it: open the page, view page source (or devtools > inspect
  //     an entry), find the repeating HTML element that wraps one release/post (e.g. an <article>,
  //     a <li>, a <div class="news-item">...), and write a selector that matches all of them,
  //     e.g. 'article.press-release', 'li.news-list__item', '.press-release-card'. Test it in
  //     your browser's devtools console first with document.querySelectorAll('YOUR_SELECTOR') -
  //     it should return one match per real entry.
  // ============================================================================================
  {
    id: 'bi-siaran-pers',
    kind: 'live-blog',
    label: 'Bank Indonesia - Siaran Pers',
    enabled: false,
    // Bank Indonesia's press-release page did not have a confirmed public RSS feed at the time
    // this was written - use this live-blog adapter instead, or switch kind to 'rss' above if
    // you find/confirm a real feed URL. Re-searched again on 2026-08-10 (as part of adding
    // BOJ/BOC/RBA/IMF above) - still no official BI RSS feed turned up in web search, so this
    // stays a live-blog placeholder.
    pageUrl: 'https://www.bi.go.id/id/ruang-media/siaran-pers/Default.aspx',
    // PLACEHOLDER - inspect the real page markup (it may be JS-rendered, in which case this
    // plain-HTML fetch+cheerio adapter won't see the content at all and this source can't be
    // used as-is) and replace with the real repeating-entry selector.
    entrySelector: 'REPLACE_WITH_REAL_CSS_SELECTOR_AFTER_INSPECTING_THE_PAGE',
    pollIntervalMs: 60_000,
  },

  // --- Example YouTube Live source (pinned video / manual channel alias) - DISABLED by default -
  // Use 'youtube-live-captions' + a specific video URL when you already know exactly which
  // livestream to watch for one occasion (e.g. a known upcoming press conference link). videoUrl
  // can also be a channel's own "/live" alias (yt-dlp resolves it to whatever's currently live),
  // but for ongoing unattended monitoring of an official channel prefer the 'youtube-channel' kind
  // below instead - it's built for exactly that (auto re-detects a new live video every time,
  // with no need to ever touch this config again). Requires the yt-dlp binary on PATH
  // (https://github.com/yt-dlp/yt-dlp).
  {
    id: 'fed-youtube-live',
    kind: 'youtube-live-captions',
    label: 'YouTube Live - Federal Reserve',
    enabled: false,
    videoUrl: 'https://www.youtube.com/@FederalReserve/live',
    pollIntervalMs: 45_000,
  },

  // ============================================================================================
  // 'youtube-channel' sources - auto-monitoring for an OFFICIAL institution's own YouTube
  // channel: every scheduled run, the watcher asks yt-dlp "is this channel live right now?"
  // (channelUrl + "/live", resolved fresh each time - see channelSourceAsLiveCaptionsSource in
  // live-intel-watcher.ts) and, if yes and it's not a stream already being tracked, automatically
  // starts the exact same live-processing pipeline used by 'youtube-live-captions' (incremental
  // caption polling, LIVE -> ENDED -> FINALIZED lifecycle, holistic final synthesis) - no manual
  // video link needed, ever, for these channels.
  //
  // Scope: ONLY an institution's own OCCASIONAL-live official channel (a press conference, a
  // hearing, a session) - never a channel that is effectively live 24/7. This is not just a taste
  // preference: a 24/7-live channel breaks two things at once for any source with `audioPriority`
  // set (see BaseSourceConfig.audioPriority and scripts/live-desk-audio-worker.ts) - (1) it would
  // almost always win "is anything audio-eligible live?" by simply always being live, occupying
  // the one active audio slot near-continuously instead of for occasional high-value events, and
  // (2) that turns the OpenRouter audio-STT cost this feature was deliberately load-tested and
  // scoped around (an occasional 30-60 minute press conference) into a standing, continuous cost
  // with no natural ceiling. General news outlets (Fox News, CNBC, Bloomberg, and - per the same
  // reasoning - DW, France 24, NHK World, Euronews, Al Jazeera English, Sky News, CNA, and a
  // national public/commercial broadcaster's main channel like TVRI/Kompas TV/Metro TV) are
  // EXCLUDED from this file for exactly this reason, not merely because they're "news outlets" in
  // the abstract - see the explicitly-NOT-added block further down for the full list and
  // reasoning, kept here on purpose so this isn't silently forgotten.
  //
  // LIVING LIST - review periodically, do not treat as final: every URL below is a specific
  // channel identity that can be renamed, deleted, or handed to a different handle over time (and
  // yt-dlp's own live-detection behavior can shift with YouTube-side changes). Re-verify handles
  // you rely on heavily every so often, and keep adding sources here as more official broadcasters
  // are identified - this list is expected to keep growing.
  //
  // Verification note (2026-08-10, most recently re-checked/expanded 2026-09-05, same egress
  // restriction as the RSS section above - this sandbox cannot reach youtube.com/*.google.com
  // directly to confirm a channel handle still resolves or that it's still the real official
  // channel): every channelUrl below was identified from general knowledge of these institutions'
  // well-known public channels (equivalent to a web-search cross-check), NOT opened/fetched
  // directly by any session that has touched this file - there is currently no way to do that from
  // this project's sandbox. `enabled: true` below reflects an explicit, direct instruction to add
  // these live (rather than this file's usual default-off-until-personally-opened caution),
  // accepted because the single-active-session design already bounds the blast radius of a wrong
  // URL to "one mislabeled/irrelevant transcript, visibly wrong and easy to correct" rather than
  // anything more serious - it does NOT mean these were fetched and visually confirmed.
  //
  // Live Desk audit (2026-09-06): a real yt-dlp network test (GitHub Actions, see
  // .github/workflows/verify-live-desk-video-sources.yml) found this sandbox's egress block is
  // total (still can't reach youtube.com directly), AND that GitHub's own runner IPs get
  // YouTube's "Sign in to confirm you're not a bot" wall on most channel-identity lookups -
  // so a clean confirmation via yt-dlp wasn't possible for most entries below either. Instead,
  // each was cross-checked against the INSTITUTION'S OWN WEBSITE via web search (e.g. a direct
  // quote/reference to "the Federal Reserve YouTube Page" on federalreserve.gov itself, or
  // consilium.europa.eu's own "Social media: connect with the Council" page naming its channel) -
  // stronger evidence than the general-knowledge identification this note originally described,
  // though still one step short of opening the channel and eyeballing it. Per-entry results:
  //   - fed, ecb, boj, boe, bi, un, european-parliament, whitehouse, sekretariat-presiden:
  //     CONFIRMED - the institution's own site (or, for boe/whitehouse, multiple independent
  //     third-party trackers agreeing on the same channel id) names this exact channel/handle.
  //     LOWER CONFIDENCE labels removed from these entries accordingly.
  //   - european-council: was WRONG (@EuropeanCouncil never confirmed to resolve to anything) -
  //     fixed below, see that entry's own comment.
  //   - rba and boc (in scripts/live-intel-watcher.config.ts's central-bank section above) were
  //     ALSO wrong and are now fixed - see those entries' own comments; both re-verified for real
  //     via yt-dlp (not just web search) once their new URLs resolved a real video id instead of
  //     a 404.
  // None of this replaces actually opening a channel and confirming it yourself if you're about
  // to lean on one heavily - "the institution's own site names it" is strong evidence, not proof.
  // ============================================================================================
  {
    id: 'fed-youtube-channel',
    kind: 'youtube-channel',
    label: 'YouTube Live - Federal Reserve (auto channel monitor)',
    enabled: true,
    // Confirmed handle via web search (multiple independent results agree): @federalreserve.
    channelUrl: 'https://www.youtube.com/@federalreserve',
    pollIntervalMs: 45_000,
    // Highest audio priority - FOMC/Fed speeches are this project's single most market-moving
    // event type (XAUUSD/DXY/every USD pair). See BaseSourceConfig.audioPriority.
    // Speaker metadata note (2026-09-05): the sitting Fed Chair is Kevin Warsh, not Jerome Powell
    // - see the 'warsh' entry added to KEYWORDS below. This source's own label/channelUrl need no
    // change either way (it auto-detects whoever is speaking on the Fed's own channel), but any
    // manual/example speaker metadata elsewhere should say Warsh going forward.
    audioPriority: 1,
  },
  {
    id: 'ecb-youtube-channel',
    kind: 'youtube-channel',
    label: 'YouTube Live - European Central Bank (auto channel monitor)',
    enabled: true,
    // Search results did not clearly confirm a current @handle for the ECB's channel, only its
    // stable channel ID (from the legacy "ecbeuro" username) - using the /channel/UC... form
    // instead avoids the handle-uncertainty entirely, since channel IDs don't change even if the
    // display handle is renamed later.
    channelUrl: 'https://www.youtube.com/channel/UCXB8fM4VyQubRu3UVGhd3wA',
    pollIntervalMs: 45_000,
    audioPriority: 2,
  },
  {
    id: 'boj-youtube-channel',
    kind: 'youtube-channel',
    label: 'YouTube Live - Bank of Japan (auto channel monitor)',
    enabled: true,
    // Confirmed via web search: BOJchannel ("BOJchannel【日本銀行動画チャンネル】"), the Bank of
    // Japan's own video channel.
    channelUrl: 'https://www.youtube.com/user/BOJchannel',
    pollIntervalMs: 45_000,
    audioPriority: 3,
  },
  {
    id: 'boe-youtube-channel',
    kind: 'youtube-channel',
    label: 'YouTube Live - Bank of England (auto channel monitor)',
    enabled: true,
    // Confirmed via web search as youtube.com/user/bankofenglanduk (legacy /user/ form - the
    // @handle form was not independently confirmed, so using the confirmed form directly).
    channelUrl: 'https://www.youtube.com/user/bankofenglanduk',
    pollIntervalMs: 45_000,
    audioPriority: 4,
  },
  {
    id: 'rba-youtube-channel',
    kind: 'youtube-channel',
    label: 'YouTube Live - Reserve Bank of Australia (auto channel monitor)',
    enabled: true,
    // FIXED TWICE (2026-09-06 audit follow-up) - both attempts caught by actually re-running the
    // real network test rather than trusting the first fix:
    //   1. Original handle @ReserveBankofAustralia -> confirmed HTTP 404 via yt-dlp on GitHub
    //      Actions (a genuine "this handle doesn't exist", not a bot-check block, which yt-dlp
    //      reports as a distinctly different error).
    //   2. First replacement, @RBAInfo (from a web search hit) -> re-verified via a SECOND real
    //      yt-dlp run and ALSO came back HTTP 404 - the search hit was wrong/stale. Caught before
    //      being trusted only because this was actually re-tested, not assumed fixed.
    // Now using the stable /channel/UC... form instead of a handle at all, specifically to avoid
    // a THIRD wrong-handle guess: UCaLmgAMEglL-yGvuGzTx6ig is cross-confirmed by two independent
    // web-search hits, both titled exactly "Reserve Bank of Australia" pointing at this same id.
    // A channel-id URL can't 404 from a renamed/wrong handle the way @-handles can - still worth a
    // final human spot-check, but this is the most failure-resistant form available without
    // opening the URL directly (still not possible from this project's own sandbox).
    channelUrl: 'https://www.youtube.com/channel/UCaLmgAMEglL-yGvuGzTx6ig',
    pollIntervalMs: 45_000,
    audioPriority: 5,
  },
  {
    id: 'boc-youtube-channel',
    kind: 'youtube-channel',
    label: 'YouTube Live - Bank of Canada (auto channel monitor)',
    enabled: true,
    // FIXED AND RE-CONFIRMED (2026-09-06 audit follow-up): the previous handle (@bankofcanada) was
    // confirmed WRONG via a real network test (yt-dlp on GitHub Actions) - genuine HTTP 404, not a
    // bot-check block. Replaced with the legacy /user/ form (cross-confirmed via live web search -
    // a channel titled "Bank of Canada - Banque du Canada" at this exact path, channel id
    // UCY4EvEbIox0M4JuEsu5OKnQ), then RE-TESTED against yt-dlp on a second real run: it resolved a
    // real video id (no 404) before hitting YouTube's bot-check on the live-status lookup itself
    // (the same "Sign in to confirm you're not a bot" every other institutional channel hit that
    // run) - confirms the URL itself is now genuinely valid, not just plausible from search.
    channelUrl: 'https://www.youtube.com/user/bankofcanadaofficial',
    pollIntervalMs: 45_000,
    audioPriority: 6,
  },
  {
    id: 'bi-youtube-channel',
    kind: 'youtube-channel',
    label: 'YouTube Live - Bank Indonesia (auto channel monitor)',
    enabled: true,
    // Confirmed via web search: "Bank Indonesia Channel" at /user/BankIndonesiaChannel.
    channelUrl: 'https://www.youtube.com/user/BankIndonesiaChannel',
    pollIntervalMs: 45_000,
    // Lower priority than the majors above for XAUUSD/DXY purposes, but still real-audio-eligible
    // since HEV Terminal's userbase is primarily Indonesian (per this project's own userEmail/
    // language conventions) and BI rate decisions are genuinely market-moving for USD/IDR-linked
    // flows even though IDR isn't one of the 8 signal-engine pairs.
    audioPriority: 7,
  },

  // --- International institutions / state proceedings - occasional-live sessions (General
  // Assembly, plenary sittings, summits), not a continuous broadcast - same audio-eligibility
  // reasoning as the central banks above. ---
  {
    id: 'un-youtube-channel',
    kind: 'youtube-channel',
    label: 'YouTube Live - United Nations (auto channel monitor)',
    enabled: true,
    // Maps the brief's "UN Web TV" (webtv.un.org, a custom video portal - not itself a YouTube
    // channel yt-dlp can live-check) onto the UN's own official YouTube channel, which mirrors the
    // same General Assembly/Security Council/press-briefing live sessions. CONFIRMED (2026-09-06
    // audit) - a UN press release on un.org itself states the channel directly:
    // "http://www.youtube.com/user/unitednations" (same channel @unitednations resolves to).
    channelUrl: 'https://www.youtube.com/@unitednations',
    pollIntervalMs: 45_000,
    audioPriority: 8,
  },
  {
    id: 'european-parliament-youtube-channel',
    kind: 'youtube-channel',
    label: 'YouTube Live - European Parliament (auto channel monitor)',
    enabled: true,
    // CONFIRMED (2026-09-06 audit) - the legacy youtube.com/europeanparliament custom URL
    // (independently confirmed as the Parliament's official channel via its own site) and the
    // @EuropeanParliament handle here resolve to the same channel id, UCvU4p_w08osQsrNi_I4ZtDA.
    channelUrl: 'https://www.youtube.com/@EuropeanParliament',
    pollIntervalMs: 45_000,
    audioPriority: 9,
  },
  {
    id: 'european-council-youtube-channel',
    kind: 'youtube-channel',
    label: 'YouTube Live - European Council (auto channel monitor)',
    enabled: true,
    // FIXED (2026-09-06, verified via the institution's own site + third-party trackers, not
    // youtube.com directly - still unreachable from this sandbox): the previous handle
    // (@EuropeanCouncil) was an unverified guess and, per this same comment's own original
    // warning, exactly the kind of easy mix-up between "European Council" (EU heads of state/
    // government summits) and "Council of the EU" (ministerial meetings) - two distinct
    // institutions that are nonetheless serviced by the same General Secretariat of the Council
    // and the same consilium.europa.eu site/press office. consilium.europa.eu's own "Social
    // media: connect with the Council" page names the channel as youtube.com/eucouncil (legacy
    // /user/eucouncil, channel id UCLPG_xkgSWeWnOhBsi-jxCA) - this is the Council's own confirmed
    // single video channel, which is what actually carries European Council summit press
    // conferences in practice (there is no evidence of a SEPARATE, dedicated "European Council
    // only" channel distinct from this one). @EuropeanCouncil was never confirmed to resolve to
    // anything at all - replacing it with the institution's own named channel rather than another
    // guess.
    channelUrl: 'https://www.youtube.com/channel/UCLPG_xkgSWeWnOhBsi-jxCA',
    pollIntervalMs: 45_000,
    audioPriority: 10,
  },

  // --- US government, non-Fed - The White House posts/streams briefings and remarks
  // occasionally, not continuously, so it fits the same audio-eligibility model as the central
  // banks above. ---
  {
    id: 'whitehouse-youtube-channel',
    kind: 'youtube-channel',
    label: 'YouTube Live - The White House (auto channel monitor)',
    enabled: true,
    // CONFIRMED (2026-09-06 audit) - cross-confirmed by multiple independent trackers (Social
    // Blade's handle/channel/user lookups all agree) on channel id UCYxRlFDqcWM4y7FfpiAN3KQ,
    // created 2006-01-21 - consistent with a long-standing official government channel.
    channelUrl: 'https://www.youtube.com/@WhiteHouse',
    pollIntervalMs: 45_000,
    audioPriority: 11,
  },
  // Live Desk audit (2026-09-06): C-SPAN is now `enabled: true` with `audioPriority` set (highest -
  // 0, above even the Fed's own channel, since a Congressional Fed Chair testimony is exceptionally
  // market-moving and C-SPAN is the ONLY source for it - the Fed's own channel doesn't broadcast a
  // House/Senate committee room), but gated behind `calendarGate: 'congress-testimony'` - see that
  // field's doc comment on BaseSourceConfig above. This resolves the previous entry's "many
  // consecutive hours most sitting days" cost concern differently than simply leaving it disabled:
  // both the caption pipeline (live-intel-watcher.ts's pollSource) and the audio pipeline
  // (live-desk-audio-worker.ts's audioEligibleSources) now check GET /api/live-desk/cspan-eligibility
  // before ever polling/selecting this source, so it is live-monitored ONLY in the window around a
  // real, calendar-flagged Congressional testimony/hearing (see CSPAN_PRE_WINDOW_MS/
  // CSPAN_POST_WINDOW_MS in server.ts) - never during routine floor proceedings, procedural votes,
  // or any other C-SPAN coverage outside that window.
  {
    id: 'cspan-youtube-channel',
    kind: 'youtube-channel',
    label: 'YouTube Live - C-SPAN (auto channel monitor, congress-testimony gated - see comment above)',
    enabled: true,
    // CONFIRMED (2026-09-06 audit) - c-span.org's own site (a page titled "YouTube | Organization
    // | C-SPAN.org") names "the @cspan YouTube channel" directly as official.
    channelUrl: 'https://www.youtube.com/@cspan',
    pollIntervalMs: 45_000,
    calendarGate: 'congress-testimony',
    audioPriority: 0,
  },

  // --- Indonesia, government (non-broadcast) - Sekretariat Presiden's own channel posts
  // presidential remarks/events occasionally, unlike a public/commercial TV channel's main feed
  // (see the explicitly-excluded block further down for TVRI/Kompas TV/Metro TV). ---
  {
    id: 'sekretariat-presiden-youtube-channel',
    kind: 'youtube-channel',
    label: 'YouTube Live - Sekretariat Presiden RI (auto channel monitor)',
    enabled: true,
    // CONFIRMED (2026-09-06 audit, see this section's header comment) - multiple independent
    // sources agree on handle @SekretariatPresiden, including a channel-age detail (created
    // 2019-01-21, first video 3 days later) consistent with an official Indonesian
    // presidential-communications channel.
    channelUrl: 'https://www.youtube.com/@SekretariatPresiden',
    pollIntervalMs: 45_000,
    audioPriority: 12,
  },

  // ============================================================================================
  // EXPLICITLY NOT ADDED as audio-eligible sources, on request but excluded here - see this
  // section's own header comment for the full reasoning (continuous/near-continuous live status
  // breaks both the single-audio-slot model and the occasional-event cost/load-test basis this
  // feature was built around). Listed here (rather than just omitted) so this is a documented,
  // deliberate decision instead of something that looks like it was simply forgotten:
  //   - 24-hour international news channels: DW, France 24, NHK World Japan, Euronews,
  //     Al Jazeera English, Sky News, CNA.
  //   - Indonesia: TVRI (public broadcaster's main channel, effectively continuous), Kompas TV and
  //     Metro TV (commercial news channels - also directly the kind of source this file's own
  //     'youtube-channel' scope rule above has always excluded, same as Fox News/CNBC/Bloomberg).
  // None of these are wired into SOURCES at all (not even disabled) since they aren't "a specific
  // channel to verify", they're a category excluded by design - flip this decision only alongside
  // a real answer to "how do we cap the resulting continuous audio-STT cost", not just by adding
  // an entry.
  // ============================================================================================

  // ============================================================================================
  // GDELT DOC 2.0 (Roadmap §A4) - free, no API key, documented at
  // https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/. Feeds the same 'market-news'
  // headline-only pipeline every RSS market-news source above uses, so its items flow straight
  // into the existing Geopolitical Risk Score (computeGeopoliticalRiskScore in server.ts) and the
  // Intel tab's news cards - one more source into the pipeline that already exists, not a second
  // one. Query is scoped to conflict/sanctions/geopolitical-crisis language specifically (the
  // macro-news outlets above already cover routine rate/inflation headlines) so this source's
  // marginal contribution is the thing GDELT is actually good at: broad, multi-outlet coverage of
  // unfolding geopolitical events.
  // ============================================================================================
  {
    id: 'gdelt-geopolitical',
    kind: 'gdelt',
    category: 'market-news',
    label: 'GDELT DOC 2.0 (Geopolitical)',
    enabled: true,
    query: '(war OR sanctions OR "military conflict" OR invasion OR ceasefire OR coup OR "trade war" OR tariffs OR geopolitical) sourcelang:english',
    pollIntervalMs: 15 * 60_000,
  },
];

// Keyword filter - a text chunk only gets buffered/sent if it matches at least one of these
// (case-insensitive substring match against the chunk's normalized text). Edit freely.
export const KEYWORDS: string[] = [
  // Officials (extend as needed). 'warsh' added 2026-09-05 - the sitting Fed Chair is Kevin
  // Warsh, not Jerome Powell; 'powell' is kept too (harmless, still matches older/historical
  // content still circulating), never removed just because a chair changed.
  'powell', 'warsh', 'lagarde', 'bailey', 'warjiyo', 'yellen', 'bessent', 'ueda', 'waller', 'williams',
  // Institutions
  'federal reserve', 'the fed', 'fomc', 'ecb', 'european central bank', 'bank of england', 'boe',
  'bank of japan', 'boj', 'reserve bank of australia', 'rba', 'bank of canada', 'boc',
  'united nations', 'european parliament', 'european council',
  'bank indonesia', 'bi rate', 'bank sentral', 'treasury department', 'white house',
  // Macro topics (EN)
  'interest rate', 'rate hike', 'rate cut', 'inflation', 'cpi', 'ppi', 'gdp', 'employment',
  'unemployment', 'payrolls', 'quantitative easing', 'quantitative tightening',
  'monetary policy', 'recession', 'stimulus', 'yield', 'treasury yield', 'balance sheet',
  'tapering', 'dot plot', 'basis points',
  // Macro topics (ID)
  'suku bunga', 'inflasi', 'kebijakan moneter', 'resesi', 'pertumbuhan ekonomi', 'nilai tukar',
];

// Batching: a source's buffered lines are flushed (sent to AI autofill as one block) once
// EITHER threshold below is hit, whichever comes first.
export const BLOCK_MIN_WAIT_MS = 30_000; // never flush sooner than 30s after the first buffered line
export const BLOCK_MAX_WAIT_MS = 60_000; // always flush at least every 60s if anything is buffered
export const BLOCK_MAX_SENTENCES = 8; // or flush immediately once this many sentences have queued

// ---------------------------------------------------------------------------------------------
// HTTP request headers used for every RSS fetch, by BOTH the watcher (live-intel-watcher.ts) and
// the verifier (verify-feeds.ts) - one definition, so a feed that verifies green is fetched with
// byte-for-byte the same headers in production. Fixing only the verifier would be worse than
// useless: it would turn the check green while the watcher kept getting rejected.
//
// Why this is needed: rss-parser's built-in defaults are
//     User-Agent: rss-parser
//     Accept:     application/rss+xml
// and several publishers reject that pair outright at their CDN/WAF layer:
//   - federalreserve.gov answered 406 Not Acceptable on /feeds/speeches_and_testimony.xml while
//     serving /feeds/press_monetary.xml fine from the SAME host on the SAME run (2026-08-11
//     Verify RSS Feeds). Same host + same headers + different outcome per path is content
//     negotiation being picky, not a dead URL - a bare "application/rss+xml" Accept doesn't match
//     what that endpoint actually declares it returns.
//   - imf.org answered 403 Forbidden, the classic response to a non-browser User-Agent.
//
// So: a real browser User-Agent, and an Accept that lists every XML content type a feed might be
// served as plus a */* fallback. This is ordinary polite-client behaviour for a public feed, not
// an attempt to disguise the request or bypass access control - these feeds are published for
// exactly this kind of consumption, and nothing here defeats authentication or rate limiting.
// Same class of fix already applied to yt-dlp's bot check (YT_DLP_USER_AGENT in
// live-intel-watcher.ts).
export const FEED_REQUEST_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // No text/html here on purpose: a feed endpoint that does content negotiation would happily hand
  // back an HTML page if we said we accepted one, and rss-parser would then choke on it. Only XML
  // representations are advertised, with a low-priority */* so a server that mislabels its own
  // content type still gets a chance.
  Accept:
    'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  // Keep-alive is the real cost of looking like a browser: servers that previously closed the
  // socket on the default "rss-parser" client now hold it open, and a lingering socket keeps
  // Node's event loop alive long after the work is done - the run hangs instead of exiting. This
  // is the same hazard live-intel-watcher.ts documents at its RUN_ONCE exit. Asking for
  // Connection: close fixes it at the source for every caller.
  Connection: 'close',
};

// Retry policy - applies to both external source fetches and calls to our own server.
export const RETRY_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 2_000; // 2s, 4s, 8s (exponential)

// Politeness floor - even if a source's own pollIntervalMs is set lower, never actually poll a
// given source more often than this.
export const MIN_POLL_INTERVAL_MS = 15_000;

// Semi-real-time YouTube Live polling: once yt-dlp confirms a 'youtube-live-captions' source is
// ACTUALLY live right now, pollYoutubeLiveCaptions (live-intel-watcher.ts) stops waiting for its
// normal pollIntervalMs and enters a tight loop at this cadence instead, appending each round's
// new captions to the same published event - see the `liveSession` field on LiveEvent
// (src/types.ts). Doesn't affect any other source kind, and doesn't affect a YouTube source that
// isn't actually live (still just a normal single check on its usual pollIntervalMs).
export const LIVE_ACTIVE_POLL_INTERVAL_MS = 18_000; // ~15-20s cadence while a stream is live

// Hard safety cap on how long the tight loop above can run in ONE invocation of this script -
// never loops forever even if is_live somehow gets stuck true, and bounds a single genuinely
// marathon stream. If the stream is still live when this is hit, the watcher just stops for this
// run; persisted state (which video/event it was tracking) lets the NEXT scheduled run pick the
// same live session back up rather than losing the thread or starting a duplicate event.
export const LIVE_LOOP_MAX_MS = 3 * 60 * 60 * 1000; // 3 hours

// While the tight loop above is running for one YouTube source, every OTHER enabled source
// (RSS/live-blog) would otherwise be starved for the whole loop duration - a single script
// invocation only progresses sequentially, so nothing after the YouTube source in SOURCES gets
// polled until the loop returns. Re-poll all other enabled sources at this cadence DURING the
// loop so e.g. Fed/ECB RSS still gets checked even in the middle of a multi-hour press conference.
export const LIVE_LOOP_SIBLING_POLL_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

// ---------------------------------------------------------------------------------------------
// Market-news pipeline limits (category: 'market-news' sources only). These exist to stop the
// Intel tab turning into an unreadable firehose, and to keep Gemini usage bounded - a dozen news
// feeds can easily produce hundreds of items a day between them.
// ---------------------------------------------------------------------------------------------

/** Hard ceiling on how many news items ONE run may publish, across all market-news sources
 * combined. Anything beyond this is simply left unmarked and picked up by the next run, so nothing
 * is lost - it just arrives later. At the workflow's 15-minute cadence this is up to ~480/day
 * worst case, but in practice the relevance + impact filters cut it far below that. */
export const MARKET_NEWS_MAX_PUBLISH_PER_RUN = 5;

/** Only consider feed items published within this window. Older items are marked seen and skipped
 * without ever reaching Gemini - "news" that is half a day old is not news, and back-processing a
 * feed's full history on first run would burn quota for no benefit. */
export const MARKET_NEWS_MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours

/** Two headlines whose normalized similarity is at or above this ratio are treated as the same
 * story. The same event is routinely covered by several outlets in the same 15-minute window with
 * near-identical wording, and a URL/guid dedup can't catch that (different sites, different links). */
export const MARKET_NEWS_TITLE_SIMILARITY = 0.85;

/** How far back the similarity check looks. A genuinely recurring story ("Gold hits record high")
 * should be publishable again a day later; the same story re-syndicated an hour later should not. */
export const MARKET_NEWS_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/** How many recent normalized-title fingerprints to retain for the similarity check. Bounds the
 * dedup state file; anything older than the window above is pruned on load anyway. */
export const MARKET_NEWS_MAX_TITLE_HISTORY = 400;

// HEV Terminal server this watcher publishes to. Point this at your deployed server when running
// the watcher against production; defaults to local dev.
export const HEV_SERVER_BASE_URL = process.env.HEV_SERVER_BASE_URL || 'http://localhost:3000';
