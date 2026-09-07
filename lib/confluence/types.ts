/**
 * Confluence Engine types (§4).
 *
 * This layer produces CONTEXT, never an entry. Levels for entry/stop/target stay exclusively with
 * the backend signal engine; nothing here may be read as a trade instruction, and the UI says so.
 */

/** A state is never forced into a direction just to have one (§4). */
export type MarketStateBias =
  | 'Bullish'
  | 'Bearish'
  | 'Neutral'
  | 'Mixed'
  | 'Transition'
  | 'Insufficient Evidence'
  | 'Signal Conflict';

export type FactorStance = 'supporting' | 'contradicting' | 'neutral';

/**
 * One driver behind the state. Every field exists so the reader can walk
 * conclusion → factor → raw metric → source → timestamp without leaving the page (§4).
 */
export interface ConfluenceFactor {
  id: string;
  /** Short trader-language label, e.g. "Real yield 10Y". */
  label: string;
  /** The provider's own number, formatted for display. Never a re-derived figure. */
  rawValue: string;
  /** What changed versus the previous reading, when a previous reading exists. */
  change: string | null;
  source: string;
  /** ISO timestamp of the underlying datapoint, or null when the provider publishes no date. */
  timestamp: string | null;
  /** How often this input actually updates - a weekly input must not read as live (§3). */
  frequency: 'Realtime' | 'Near-realtime' | 'Delayed' | 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly';
  /** Whether it argues for or against the bias, from the sign of its own normalised score. */
  stance: FactorStance;
  /** -1..+1 in the direction of the ASSET (positive = bullish for this asset). */
  score: number;
  weight: number;
  /** One sentence, trader-language, explaining why this matters for this asset (§11). */
  reasoning: string;
  /** Route to the module that owns this metric, for drill-down. */
  route?: string;
}

export interface InvalidationCondition {
  /** What would have to happen for this read to stop holding. */
  condition: string;
  /** The measured basis for that level - never a round number picked by feel. */
  basis: string;
}

export interface HistoricalAnalog {
  /** How many comparable periods were found in the archive. Always shown (§4). */
  sampleSize: number;
  up: number;
  down: number;
  /** Window the archive actually covers, so a thin sample is visible as thin. */
  lookbackDays: number;
  /** Null when there is not enough archived history to say anything. */
  summary: string | null;
}

export interface NextCatalyst {
  event: string;
  dateISO: string;
  /** The calendar provider's own impact rating - not a re-scored one. */
  impact: string;
  currency: string;
}

export interface CrossAssetAnomaly {
  /** e.g. "Gold and DXY both rising" - stated, never explained away (§4). */
  description: string;
  detail: string;
}

/** One point on a chart series - deliberately the same shape as components/charts' LinePoint, so
 * ConfluenceView can hand it straight to <LineChart> with no conversion. Not imported from there:
 * this file is business logic and must not depend on a presentation component. */
export interface ChartPoint {
  label: string;
  value: number;
}

/**
 * Price against its own moving average (§9), built only when the factor it illustrates actually
 * exists - see `assembleConfluence`'s `chartHistory` input. A chart that shows a line the engine
 * never scored would be a claim this layer did not actually make.
 */
export interface TrendChart {
  price: ChartPoint[];
  movingAverage: ChartPoint[];
  window: number;
  /** The asset's own quoted precision (spec.digits) - never guessed from the price's magnitude. */
  digits: number;
}

/**
 * An input that SHOULD be part of this read and deliberately is not (§10).
 *
 * The difference between "this factor is quiet today" and "we cannot get this data at all" is
 * invisible once a factor is simply left out of the list, and for flow data that gap is exactly
 * where a fabricated number would hide. So the absence is published with its reason instead.
 */
export interface UnavailableInput {
  label: string;
  /** Why it is missing, in plain terms - e.g. 'Provider not wired'. */
  status: string;
  detail: string;
}

export interface ConfluenceResult {
  asset: string;
  bias: MarketStateBias;
  /** 0-100. Null whenever the bias is Insufficient Evidence. */
  confidence: number | null;
  /** Short qualifier shown next to the number, e.g. "Reduced Conviction". */
  convictionLabel: string;
  factors: ConfluenceFactor[];
  supporting: ConfluenceFactor[];
  contradicting: ConfluenceFactor[];
  /** Factors whose input arrived within the recency window, newest first. */
  whatChanged: ConfluenceFactor[];
  conflictNote: string;
  invalidation: InvalidationCondition[];
  nextCatalyst: NextCatalyst | null;
  analog: HistoricalAnalog | null;
  anomaly: CrossAssetAnomaly | null;
  /** Trader-language narrative (§11). Built from the factors, never free-form invention. */
  narrative: string;
  liveFactorCount: number;
  requiredFactorCount: number;
  /** Inputs this asset's read is knowingly missing, named rather than quietly skipped (§10). */
  unavailableInputs: UnavailableInput[];
  /** Null for every asset whose engine has no trend/MA factor to illustrate (§9 - see core.ts). */
  trendChart: TrendChart | null;
}
