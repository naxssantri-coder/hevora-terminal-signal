// ============================================================================================
// One-shot maintenance script: delete live event(s) from the live-events store.
//
// Exists because the admin "Live Intel" tab was removed, so there is no longer a UI to delete a
// stale event - but the server-side endpoints are all still there. This calls the SAME public
// read endpoint and the SAME admin delete endpoint the old UI used
// (GET /api/live-events, DELETE /api/admin/live-events/:id) - it adds no new server surface and
// grants itself no special access; it is just a scripted caller of what already exists.
//
// Usage (dry run by default - it will NOT delete anything until you pass --yes):
//
//   # see what would be deleted
//   npm run delete:live-event -- --match="Kevin Warsh"
//
//   # actually delete
//   npm run delete:live-event -- --match="Kevin Warsh" --yes
//
//   # or target one exact event id
//   npm run delete:live-event -- --id=live-1234567890-abc123 --yes
//
// --match is a case-insensitive substring test against each event's title, speaker and source.
// It is deliberately conservative: it prints every match in full and refuses to delete without
// --yes, because this permanently removes records from the store and there is no undo.
//
// Environment (same vars the watcher already uses - no new secrets):
//   ADMIN_USERNAME           required
//   ADMIN_PASSWORD           or ADMIN_PASSWORD_HASH (requireAdminAuth accepts either)
//   HEV_SERVER_BASE_URL      defaults to http://localhost:3000 - point at production to clean
//                            production, e.g. HEV_SERVER_BASE_URL=https://your-app.onrender.com
// ============================================================================================

import 'dotenv/config';
import { HEV_SERVER_BASE_URL } from './live-intel-watcher.config';

const SERVER_BASE_URL = HEV_SERVER_BASE_URL.replace(/\/+$/, '');

interface LiveEventSummary {
  id: string;
  createdAt: string;
  type: string;
  title: string;
  speaker: string | null;
  source: string | null;
}

function basicAuthHeader(): string {
  const user = process.env.ADMIN_USERNAME || '';
  const pass = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD_HASH || '';
  if (!user || !pass) {
    throw new Error('ADMIN_USERNAME and (ADMIN_PASSWORD or ADMIN_PASSWORD_HASH) must be set in the environment.');
  }
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

async function main(): Promise<void> {
  const matchTerm = argValue('match');
  const targetId = argValue('id');
  const confirmed = process.argv.includes('--yes');

  if (!matchTerm && !targetId) {
    console.error('Nothing to do: pass --match="some text" or --id=<event id>.');
    console.error('Example: npm run delete:live-event -- --match="Kevin Warsh"');
    process.exit(1);
  }

  console.log(`\nServer: ${SERVER_BASE_URL}`);

  const res = await fetch(`${SERVER_BASE_URL}/api/live-events?limit=500`);
  if (!res.ok) {
    console.error(`Failed to read live events: HTTP ${res.status}`);
    process.exit(1);
  }
  const data = await res.json();
  const events: LiveEventSummary[] = Array.isArray(data?.events) ? data.events : [];
  console.log(`Store currently holds ${events.length} event(s).\n`);

  const needle = (matchTerm || '').toLowerCase();
  const matches = events.filter((e) => {
    if (targetId) return e.id === targetId;
    const haystack = [e.title, e.speaker || '', e.source || ''].join(' ').toLowerCase();
    return haystack.includes(needle);
  });

  if (matches.length === 0) {
    console.log(`No event matched ${targetId ? `id "${targetId}"` : `"${matchTerm}"`}. Nothing to delete.`);
    process.exit(0);
  }

  console.log(`${matches.length} matching event(s):`);
  matches.forEach((e) => {
    console.log(`  - ${e.id}`);
    console.log(`      title:   ${e.title}`);
    console.log(`      type:    ${e.type}   speaker: ${e.speaker || '-'}   source: ${e.source || '-'}`);
    console.log(`      created: ${e.createdAt}`);
  });

  if (!confirmed) {
    console.log('\nDRY RUN - nothing was deleted. Re-run with --yes to actually delete these.\n');
    process.exit(0);
  }

  console.log('');
  let deleted = 0;
  for (const e of matches) {
    const del = await fetch(`${SERVER_BASE_URL}/api/admin/live-events/${encodeURIComponent(e.id)}`, {
      method: 'DELETE',
      headers: { Authorization: basicAuthHeader() },
    });
    if (del.ok) {
      deleted++;
      console.log(`  deleted ${e.id}  "${e.title}"`);
    } else {
      const body = await del.text().catch(() => '');
      console.error(`  FAILED  ${e.id}: HTTP ${del.status} ${body.slice(0, 200)}`);
    }
  }

  console.log(`\n${deleted}/${matches.length} deleted.\n`);
  // Explicit exit for the same reason verify-feeds.ts does it: a lingering keep-alive socket can
  // otherwise hold the event loop open after the work is done.
  process.exit(deleted === matches.length ? 0 : 1);
}

main().catch((err) => {
  console.error('delete-live-event failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
