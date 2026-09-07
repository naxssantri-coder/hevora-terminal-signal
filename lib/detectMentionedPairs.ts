import type { PairId } from '../types';
import { PAIR_KEYWORDS } from './assets/universe';

/**
 * Client-side mirror of server.ts's detectMentionedPairs (HEVAI overhaul PR 7) - same
 * PAIR_KEYWORDS table (src/lib/assets/universe.ts, the one source of truth for pair aliases),
 * same word-boundary matching, same 'ada' exclusion (ADAUSDT's real keyword but also an ordinary
 * Indonesian word - see universe.ts's own comment). Duplicated rather than imported from
 * server.ts because server.ts is a Node-only backend entrypoint, not something the client bundle
 * can pull in; this keeps the ONE alias table (PAIR_KEYWORDS) as the single source of truth while
 * the small matching function itself lives once per runtime.
 *
 * Used by HevaiPanel's inline live-price widget: which pairs an AI answer actually talks about,
 * so a mini price card can be attached without re-parsing prose from scratch.
 */

const EXCLUDED_KEYWORDS = new Set(['ada']);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectMentionedPairs(text: string): PairId[] {
  const lower = text.toLowerCase();
  const found: PairId[] = [];
  for (const pairId of Object.keys(PAIR_KEYWORDS) as PairId[]) {
    const symbolVariants = [pairId.toLowerCase()];
    if (pairId.length === 6 && !pairId.endsWith('USDT')) {
      symbolVariants.push(`${pairId.slice(0, 3)}/${pairId.slice(3)}`.toLowerCase());
    } else if (pairId.endsWith('USDT')) {
      const base = pairId.slice(0, -4);
      symbolVariants.push(`${base}/usdt`.toLowerCase(), `${base}-usdt`.toLowerCase());
    }
    const keywords = (PAIR_KEYWORDS[pairId] || []).filter((k) => !EXCLUDED_KEYWORDS.has(k.toLowerCase()));
    const candidates = [...symbolVariants, ...keywords];
    const matched = candidates.some((kw) => new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i').test(lower));
    if (matched) found.push(pairId);
  }
  return found;
}
