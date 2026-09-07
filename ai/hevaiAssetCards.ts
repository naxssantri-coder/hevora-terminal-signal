import type { CandlesResponse } from '../../lib/analytics';
import type { LinePoint } from '../charts/LineChart';
import type { DxyResponse, EconHistoryResponse, EconIndicatorId, MarketPrice, PairId } from '../../types';
import { detectMentionedPairs } from '../../lib/detectMentionedPairs';
import { detectMentionedEconIndicators, isDxyMentioned } from '../../lib/detectMentionedMacro';
import { formatNumber, formatPercent } from '../../lib/format';
import type { HevaiAssetCardData } from './HevaiAssetCard';

/** t() from useTranslation() - threaded through instead of imported, since this file is a plain
 *  data-builder with no component context of its own; every label below goes through it rather
 *  than being hardcoded, so the card never mixes one language's stat labels with the panel chrome's
 *  other language (see id.ts/en.ts's matching comment on the askAi.stat-, candleChartCaption-,
 *  lastReleased- and vsPrevious-prefixed keys for why this was worth calling out explicitly). */
type Translate = (key: string) => string;

function candlesToLinePoints(candles: CandlesResponse['candles'][string] | undefined): LinePoint[] {
  if (!candles || candles.length < 2) return [];
  return candles.map((c) => ({
    label: new Date(c.t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }),
    value: c.c,
  }));
}

function pairCard(
  pairId: PairId,
  price: MarketPrice,
  candles: CandlesResponse['candles'][string] | undefined,
  t: Translate
): HevaiAssetCardData {
  const changeUp = price.change24h >= 0;
  const stats: Array<{ label: string; value: string }> =
    price.category === 'crypto'
      ? [
          { label: t('askAi.stat24hHigh'), value: formatNumber(price.high24h, price.digits) },
          { label: t('askAi.stat24hLow'), value: formatNumber(price.low24h, price.digits) },
          { label: t('askAi.statVolume'), value: price.volume },
        ]
      : [
          { label: t('askAi.stat24hHigh'), value: formatNumber(price.high24h, price.digits) },
          { label: t('askAi.stat24hLow'), value: formatNumber(price.low24h, price.digits) },
          { label: t('askAi.statRange'), value: formatNumber(price.high24h - price.low24h, price.digits) },
        ];

  return {
    key: pairId,
    title: price.name,
    price: formatNumber(price.price, price.digits),
    changeLabel: formatPercent(price.change24h, 2, { signed: true }),
    changeUp,
    chartPoints: candlesToLinePoints(candles),
    chartCaption: t('askAi.candleChartCaption'),
    stats,
  };
}

function macroCard(indicatorId: EconIndicatorId, res: EconHistoryResponse | null, t: Translate): HevaiAssetCardData | null {
  if (!res || !res.success) return null;
  const points = (res.points || []).filter((p) => p.actual !== null);
  if (points.length === 0) return null;
  const latest = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const unit = res.indicator.unit === 'percent' ? '%' : '';
  const changeValue = prev && prev.actual !== null ? (latest.actual as number) - prev.actual : null;
  return {
    key: indicatorId,
    title: res.indicator.label,
    price: `${formatNumber(latest.actual, 2)}${unit}`,
    changeLabel:
      changeValue !== null
        ? `${changeValue >= 0 ? '+' : ''}${formatNumber(changeValue, 2)}${unit} ${t('askAi.vsPrevious')}`
        : undefined,
    changeUp: changeValue !== null ? changeValue >= 0 : undefined,
    chartPoints: points.map((p) => ({ label: p.date.slice(0, 7), value: p.actual as number })),
    chartInterpolation: indicatorId === 'FOMC' ? 'step' : 'linear',
    chartCaption: t('askAi.lastReleased').replace('{date}', latest.date.slice(0, 10)),
    stats: undefined,
  };
}

function dxyCard(res: DxyResponse | null, t: Translate): HevaiAssetCardData | null {
  if (!res || res.price === null) return null;
  const changeUp = res.changeSessionPct !== null ? res.changeSessionPct >= 0 : undefined;
  return {
    key: 'DXY',
    title: 'US Dollar Index (DXY)',
    price: formatNumber(res.price, 3),
    changeLabel: res.changeSessionPct !== null ? formatPercent(res.changeSessionPct, 2, { signed: true }) : undefined,
    changeUp,
    chartPoints: undefined,
    stats: res.trend15m !== null ? [{ label: t('askAi.stat15mTrend'), value: formatPercent(res.trend15m, 2, { signed: true }) }] : undefined,
  };
}

/**
 * Bug fix (visual consolidation follow-up): detectMentionedPairs iterates PAIR_KEYWORDS in a FIXED
 * key order, not text position - so when an answer naturally mentions more than one pair (exactly
 * what a continuity-aware follow-up does, e.g. "Sama seperti XAU tadi, BTC juga tertekan..." after
 * asking "kalo gtu btc gmn?"), the caller's single-card cap always landed on whichever pair sorts
 * first in that fixed order (XAUUSD), never necessarily the one the turn is actually about. The
 * user's OWN question for this turn is the most reliable signal of what this turn is about - "kalo
 * gtu btc gmn?" names BTC explicitly even though the answer text mentions XAU first for context.
 *
 * Second bug fix (production report): the ANSWER-TEXT FALLBACK below this comment used to exist -
 * "if the question doesn't name anything, fall back to whatever the answer mentions". That fallback
 * is exactly why a price/chart card kept showing up for questions that were never about a specific
 * asset's price at all (a Fear & Greed sentiment question, "what does this GDP print mean for the
 * market") - those questions don't name BTC/XAU themselves, but a real answer discussing sentiment
 * or macro impact almost always names specific assets in its own narrative, which the fallback then
 * misread as "this turn is about that asset's price". Removed entirely: a card now only renders when
 * THIS TURN'S OWN QUESTION names a pair/indicator, which is also all the "kalo gtu btc gmn?" fix
 * above ever actually needed - that question names BTC directly, so it was never relying on the
 * answer-text fallback to begin with. Known remaining edge case, not fully solved by this change: a
 * question that explicitly names an asset while still being fundamentally a macro/impact question
 * (e.g. "apa dampak GDP ke BTC dan XAU?") will still show a card, since the asset IS named in the
 * question - distinguishing "asks about this asset's price" from "asks about a macro topic that
 * happens to name this asset" is a genuine semantic judgment call a keyword check can't reliably
 * make either way without risking new false negatives on legitimate short follow-ups.
 */
function resolveMentionedPairs(question: string): PairId[] {
  return detectMentionedPairs(question);
}

function resolveMentionedIndicators(question: string): EconIndicatorId[] {
  return detectMentionedEconIndicators(question);
}

function resolveDxyMentioned(question: string): boolean {
  return isDxyMentioned(question);
}

/**
 * Assembles the asset/macro cards for one turn (chart-redesign pass) - pure, zero-fetch itself:
 * every input here was already fetched by HevaiPanel (prices from the existing App.tsx /api/signals
 * poll, candles/econHistory/dxy from HevaiPanel's own gated useEndpoint calls, only active while the
 * panel is open and only for indicators actually mentioned). Detection reuses detectMentionedPairs
 * (PR 7's own alias table) for pairs and the small macro-keyword mirror above for macro indicators -
 * no new parsing approach invented.
 *
 * `question` is this turn's own question text, and (bug fix - see resolveMentionedPairs above) the
 * ONLY text consulted to decide whether a card renders at all: the answer text is deliberately not
 * passed in anymore, since that's what let a card leak in for questions that were never about a
 * specific asset's price. `answerText` for the actual pair whose price IS being shown still gets
 * pulled from the live `prices`/`candles` inputs below, not re-parsed from the model's prose.
 */
export function buildHevaiAssetCards(
  question: string,
  prices: Record<PairId, MarketPrice>,
  candles: CandlesResponse | null,
  econByIndicator: Partial<Record<EconIndicatorId, EconHistoryResponse | null>>,
  dxy: DxyResponse | null,
  t: Translate
): HevaiAssetCardData[] {
  const cards: HevaiAssetCardData[] = [];

  for (const pairId of resolveMentionedPairs(question)) {
    const price = prices[pairId];
    if (!price || !Number.isFinite(price.price)) continue;
    cards.push(pairCard(pairId, price, candles?.candles?.[pairId], t));
  }

  for (const indicatorId of resolveMentionedIndicators(question)) {
    const card = macroCard(indicatorId, econByIndicator[indicatorId] ?? null, t);
    if (card) cards.push(card);
  }

  if (resolveDxyMentioned(question)) {
    const card = dxyCard(dxy, t);
    if (card) cards.push(card);
  }

  return cards;
}
