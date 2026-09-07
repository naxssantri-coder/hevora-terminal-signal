// ============================================================================================
// Feed verifier for scripts/live-intel-watcher.config.ts.
//
// Why this exists: every RSS URL in that config was found via web search, because the sandbox
// this project is developed in cannot reach those domains (the egress proxy returns "CONNECT
// tunnel failed, 403" for all of them). Search evidence is a real signal but it is NOT the same
// as opening the URL and seeing raw <rss>/<feed> XML come back.
//
// Run this from any machine with normal internet access:
//     npm run verify:feeds
//
// For every RSS source in SOURCES it fetches the feed, parses it with the exact same rss-parser
// the watcher itself uses, and prints:
//     status | source id | items found | newest item date | newest item title
// so a feed that 404s, returns HTML instead of XML, or has gone stale is immediately obvious.
// Exits non-zero if any ENABLED source fails, so it is usable as a CI/pre-deploy check.
//
// Nothing here publishes anything or calls the AI - it is purely a read-only connectivity check.
// ============================================================================================

import 'dotenv/config';
import Parser from 'rss-parser';
import { SOURCES, FEED_REQUEST_HEADERS } from './live-intel-watcher.config';

// Same headers the watcher itself uses (see FEED_REQUEST_HEADERS) - this check is only meaningful
// if it exercises the exact request the real fetch will make.
const parser = new Parser({ timeout: 20_000, headers: FEED_REQUEST_HEADERS });

interface Row {
  id: string;
  label: string;
  category: string;
  enabled: boolean;
  ok: boolean;
  items: number;
  newestDate: string;
  /** Live Desk audit (2026-09-06 follow-up) - the RSS-article-link fix (see postPublish's
   *  sourceUrl comment in live-intel-watcher.ts). Does the newest item actually carry its OWN
   *  per-item `link` (as opposed to the feed just not providing one, which is the one case the
   *  fix's `sourceUrl: null` fallback is meant to handle gracefully)? */
  itemHasLink: boolean;
  /** The newest item's real link (article/press-release page), for eyeballing in the job log -
   *  never the feed's own feedUrl. */
  itemLink: string;
  /** A live HTTP HEAD/GET on itemLink actually resolving (2xx/3xx) - proves it's a real, currently
   *  reachable article page, not just a plausible-looking string the feed happened to include. */
  itemLinkReachable: boolean | null;
  newestTitle: string;
  error: string;
}

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
}

async function checkFeed(source: Extract<(typeof SOURCES)[number], { kind: 'rss' }>): Promise<Row> {
  const base: Row = {
    id: source.id,
    label: source.label,
    category: source.category || 'live-intel',
    enabled: source.enabled,
    ok: false,
    items: 0,
    newestDate: '-',
    itemHasLink: false,
    itemLink: '-',
    itemLinkReachable: null,
    newestTitle: '-',
    error: '',
  };

  try {
    const feed = await parser.parseURL(source.feedUrl);
    const items = feed.items || [];
    base.items = items.length;

    if (items.length === 0) {
      base.error = 'parsed as a feed but contains zero items';
      return base;
    }

    // Newest item by real date - a feed whose items carry no parseable date is a problem for the
    // market-news pipeline specifically, since its age gate depends on that date.
    const dated = items
      .map((i) => ({ t: new Date(i.isoDate || i.pubDate || '').getTime(), title: i.title || '', link: i.link || '' }))
      .filter((x) => !isNaN(x.t))
      .sort((a, b) => b.t - a.t);

    if (dated.length === 0) {
      base.error = 'items have no parseable pubDate/isoDate (market-news age filter cannot work)';
      base.newestTitle = String(items[0].title || '').slice(0, 60);
      return base;
    }

    base.ok = true;
    base.newestDate = new Date(dated[0].t).toISOString().replace('T', ' ').slice(0, 16);
    base.newestTitle = dated[0].title.slice(0, 60);

    // Live Desk audit (2026-09-06 follow-up): does this item carry its own per-article link, and
    // is it actually a different, live-resolving URL from the feed's own feedUrl? A feed answering
    // "yes" here is exactly what postPublish's sourceUrl fix needs to produce a readable article
    // link instead of falling back to null.
    base.itemHasLink = Boolean(dated[0].link && dated[0].link.trim());
    base.itemLink = base.itemHasLink ? dated[0].link.trim() : '-';
    if (base.itemHasLink) {
      try {
        const res = await fetch(base.itemLink, { method: 'HEAD', headers: FEED_REQUEST_HEADERS, signal: AbortSignal.timeout(15_000), redirect: 'follow' });
        base.itemLinkReachable = res.ok || (res.status >= 300 && res.status < 400);
        // Some sites reject HEAD (405/403) but serve GET fine - retry with GET before concluding
        // unreachable, so this doesn't misreport a real, working article link as broken.
        if (!base.itemLinkReachable) {
          const res2 = await fetch(base.itemLink, { method: 'GET', headers: FEED_REQUEST_HEADERS, signal: AbortSignal.timeout(15_000), redirect: 'follow' });
          base.itemLinkReachable = res2.ok;
        }
      } catch {
        base.itemLinkReachable = false;
      }
    }

    return base;
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err);
    return base;
  }
}

async function main(): Promise<void> {
  const rssSources = SOURCES.filter((s): s is Extract<typeof s, { kind: 'rss' }> => s.kind === 'rss');
  console.log(`\nChecking ${rssSources.length} RSS source(s) from live-intel-watcher.config.ts...\n`);

  const rows: Row[] = [];
  for (const source of rssSources) {
    process.stdout.write(`  ... ${source.id}\r`);
    rows.push(await checkFeed(source));
  }

  console.log(
    `${pad('STATUS', 8)}${pad('ON', 4)}${pad('CATEGORY', 13)}${pad('SOURCE ID', 24)}${pad('ITEMS', 7)}${pad('NEWEST ITEM', 18)}TITLE`
  );
  console.log('-'.repeat(120));
  for (const r of rows) {
    console.log(
      `${pad(r.ok ? 'OK' : 'FAIL', 8)}${pad(r.enabled ? 'yes' : 'no', 4)}${pad(r.category, 13)}${pad(r.id, 24)}${pad(String(r.items), 7)}${pad(r.newestDate, 18)}${r.newestTitle}`
    );
    if (!r.ok) console.log(`${' '.repeat(8)}└─ ${r.error}`);
    else if (r.category !== 'market-news') {
      // Live Desk audit (2026-09-06 follow-up): only live-intel sources feed postPublish's
      // sourceUrl link-vs-feed distinction - market-news items are shown differently and aren't
      // what that fix was about.
      const linkNote = !r.itemHasLink
        ? 'this item has NO per-item link - sourceUrl will correctly be null (icon hidden), not the feed URL'
        : `${r.itemLinkReachable ? 'REACHABLE' : 'UNREACHABLE'} -> ${r.itemLink}`;
      console.log(`${' '.repeat(8)}└─ article link: ${linkNote}`);
    }
  }

  const failedEnabled = rows.filter((r) => !r.ok && r.enabled);
  const failedDisabled = rows.filter((r) => !r.ok && !r.enabled);
  const okDisabled = rows.filter((r) => r.ok && !r.enabled);

  console.log('');
  console.log(`  ${rows.filter((r) => r.ok).length}/${rows.length} feed(s) resolved to real, dated XML.`);
  if (okDisabled.length > 0) {
    console.log(`  ${okDisabled.length} working but DISABLED - consider enabling: ${okDisabled.map((r) => r.id).join(', ')}`);
  }
  if (failedDisabled.length > 0) {
    console.log(`  ${failedDisabled.length} failing and already disabled (no action needed): ${failedDisabled.map((r) => r.id).join(', ')}`);
  }
  if (failedEnabled.length > 0) {
    console.log(`\n  ${failedEnabled.length} ENABLED source(s) failed - set enabled: false or fix the URL:`);
    failedEnabled.forEach((r) => console.log(`    - ${r.id}  (${r.label})`));
    process.exit(1);
  }
  console.log('\n  All enabled feeds are healthy.\n');
  // Explicit success exit, same reason live-intel-watcher.ts does it for --once: even with
  // Connection: close requested, a slow or misbehaving server can leave a socket open long enough
  // to keep the event loop alive after the work is finished, which reads as a hung CI job rather
  // than a passing one. The failure paths already exit explicitly; this makes success symmetric.
  process.exit(0);
}

main().catch((err) => {
  console.error('verify-feeds failed:', err);
  process.exit(1);
});
