/**
 * The commodity universe the Confluence Engine covers, and what actually drives each one.
 *
 * Every symbol here was probed live before it was listed (scripts/verify-sources.ts, run #3:
 * Yahoo futures 15/15 OK). The per-symbol switches below are NOT cosmetic - they decide which
 * factors get built at all, and a factor that is not built is excluded from the weighting rather
 * than scored zero. That is why, for example, natural gas has no inventory factor: the EIA series
 * wired into this build is crude stocks, and pointing a gas read at a crude number to fill the
 * slot would be exactly the kind of quiet fabrication §10 forbids.
 */

export type CommodityGroup = 'energy' | 'metals' | 'agriculture';

export interface CommoditySpec {
  symbol: string;
  name: string;
  group: CommodityGroup;
  /** Decimals for the quote, matching how the contract is actually quoted. */
  digits: number;
  /**
   * How equity-market fear reads for this contract. Precious metals catch a safe-haven bid (+1);
   * energy and industrial metals are demand assets, so fear is a headwind (-1). null = the link
   * is too weak to claim, and no risk factor is built.
   */
  riskDirection: 1 | -1 | null;
  /** Non-yielding stores of value carry the real-yield factor; a barrel of oil does not. */
  usesRealYield: boolean;
  /** Only contracts whose inventory series is actually wired (EIA crude stocks). */
  usesCrudeInventories: boolean;
  /** Weight of the dollar factor - highest where the contract is most purely a dollar trade. */
  dollarWeight: number;
  /** Weight of the positioning factor - highest in agriculture, where COT is the deepest input. */
  cotWeight: number;
  /**
   * Symbols with no confluence read of their own, and why. Gold futures track the same market as
   * the XAU/USD panel, which has a deeper factor set - publishing a second, thinner gold read
   * would just be two answers to one question.
   */
  defersTo?: string;
}

export const COMMODITY_SPECS: CommoditySpec[] = [
  {
    symbol: 'CL=F', name: 'WTI Crude', group: 'energy', digits: 2,
    riskDirection: -1, usesRealYield: false, usesCrudeInventories: true,
    dollarWeight: 0.15, cotWeight: 0.2,
  },
  {
    symbol: 'BZ=F', name: 'Brent Crude', group: 'energy', digits: 2,
    // Brent has no US inventory series of its own; it inherits nothing. The crude-stocks factor is
    // built for it because US stocks move the global crude complex, and the factor says WTI in its
    // own label so the reader can see the borrow rather than having it hidden.
    riskDirection: -1, usesRealYield: false, usesCrudeInventories: true,
    dollarWeight: 0.15, cotWeight: 0.2,
  },
  {
    symbol: 'NG=F', name: 'Natural Gas', group: 'energy', digits: 3,
    riskDirection: -1, usesRealYield: false, usesCrudeInventories: false,
    dollarWeight: 0.12, cotWeight: 0.25,
  },
  {
    symbol: 'GC=F', name: 'Gold Futures', group: 'metals', digits: 2,
    riskDirection: 1, usesRealYield: true, usesCrudeInventories: false,
    dollarWeight: 0.25, cotWeight: 0.2, defersTo: 'XAU/USD',
  },
  {
    symbol: 'SI=F', name: 'Silver', group: 'metals', digits: 3,
    riskDirection: 1, usesRealYield: true, usesCrudeInventories: false,
    dollarWeight: 0.25, cotWeight: 0.2,
  },
  {
    symbol: 'HG=F', name: 'Copper', group: 'metals', digits: 4,
    // Copper is an industrial metal: risk-off is a demand problem, not a safe-haven bid.
    riskDirection: -1, usesRealYield: false, usesCrudeInventories: false,
    dollarWeight: 0.2, cotWeight: 0.2,
  },
  {
    symbol: 'PL=F', name: 'Platinum', group: 'metals', digits: 2,
    riskDirection: 1, usesRealYield: true, usesCrudeInventories: false,
    dollarWeight: 0.22, cotWeight: 0.2,
  },
  {
    symbol: 'PA=F', name: 'Palladium', group: 'metals', digits: 2,
    riskDirection: 1, usesRealYield: true, usesCrudeInventories: false,
    dollarWeight: 0.22, cotWeight: 0.2,
  },
  // Agriculture: weather and harvests drive these, and no weather feed is wired. Rather than
  // pretend otherwise, the ag reads lean on positioning and the market's own trend, and the panel
  // carries fewer factors - which the coverage floor makes visible instead of papering over.
  {
    symbol: 'ZW=F', name: 'Wheat', group: 'agriculture', digits: 2,
    riskDirection: null, usesRealYield: false, usesCrudeInventories: false,
    dollarWeight: 0.2, cotWeight: 0.3,
  },
  {
    symbol: 'ZC=F', name: 'Corn', group: 'agriculture', digits: 2,
    riskDirection: null, usesRealYield: false, usesCrudeInventories: false,
    dollarWeight: 0.2, cotWeight: 0.3,
  },
  {
    symbol: 'ZS=F', name: 'Soybeans', group: 'agriculture', digits: 2,
    riskDirection: null, usesRealYield: false, usesCrudeInventories: false,
    dollarWeight: 0.2, cotWeight: 0.3,
  },
  {
    symbol: 'KC=F', name: 'Coffee', group: 'agriculture', digits: 2,
    riskDirection: null, usesRealYield: false, usesCrudeInventories: false,
    dollarWeight: 0.18, cotWeight: 0.3,
  },
  {
    symbol: 'SB=F', name: 'Sugar', group: 'agriculture', digits: 2,
    riskDirection: null, usesRealYield: false, usesCrudeInventories: false,
    dollarWeight: 0.18, cotWeight: 0.3,
  },
  {
    symbol: 'CC=F', name: 'Cocoa', group: 'agriculture', digits: 0,
    riskDirection: null, usesRealYield: false, usesCrudeInventories: false,
    dollarWeight: 0.18, cotWeight: 0.3,
  },
  {
    symbol: 'CT=F', name: 'Cotton', group: 'agriculture', digits: 2,
    riskDirection: null, usesRealYield: false, usesCrudeInventories: false,
    dollarWeight: 0.18, cotWeight: 0.3,
  },
];

export const getCommoditySpec = (symbol: string): CommoditySpec | undefined =>
  COMMODITY_SPECS.find((spec) => spec.symbol === symbol);

/** Contracts that get their own confluence read (everything except the ones that defer). */
export const CONFLUENCE_COMMODITIES = COMMODITY_SPECS.filter((spec) => !spec.defersTo);
