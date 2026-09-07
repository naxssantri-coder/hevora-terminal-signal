/**
 * The FX pairs the Confluence Engine covers, and what actually drives each one.
 *
 * The asymmetry that matters here is which side of the quote the dollar is on. A firming dollar
 * pushes EUR/USD DOWN and USD/CHF UP - the same DXY reading, opposite conclusions - so the sign
 * is carried per pair rather than assumed. Getting that backwards would produce a read that is
 * confidently wrong rather than obviously broken, which is why it lives in data, next to a test.
 */

export interface ForexSpec {
  id: string;
  name: string;
  /** True when USD is the BASE currency (USD/CHF, USD/CAD): a stronger dollar lifts the quote. */
  usdIsBase: boolean;
  /** The non-USD currency in the pair. */
  counterCurrency: string;
  /** Decimals this pair is quoted in. */
  digits: number;
  /**
   * The counterpart policy-rate indicator, or null where no provider is wired. Switzerland and
   * Canada have none in this build, so those pairs carry no rate-differential factor at all
   * rather than a differential computed against a stand-in.
   */
  counterRateIndicator: 'ECBDFR' | 'BOEBR' | 'BOJPR' | null;
  /**
   * How the pair responds to equity-market fear, expressed in the PAIR's direction.
   * USD/CHF falls in risk-off (both are havens, but the franc is the stronger one here);
   * USD/CAD rises in risk-off; EUR/USD and GBP/USD fall as the dollar catches the bid.
   */
  riskDirection: 1 | -1 | null;
  /** Only CAD: crude is a genuine terms-of-trade driver for it, and CL=F is wired and verified. */
  usesOil: boolean;
  /** Currencies whose high-impact releases are catalysts for this pair. */
  eventCurrencies: string[];
}

export const FOREX_SPECS: ForexSpec[] = [
  {
    id: 'EURUSD', name: 'EUR/USD', usdIsBase: false, counterCurrency: 'EUR', digits: 5,
    counterRateIndicator: 'ECBDFR', riskDirection: -1, usesOil: false,
    eventCurrencies: ['USD', 'EUR'],
  },
  {
    id: 'GBPUSD', name: 'GBP/USD', usdIsBase: false, counterCurrency: 'GBP', digits: 5,
    counterRateIndicator: 'BOEBR', riskDirection: -1, usesOil: false,
    eventCurrencies: ['USD', 'GBP'],
  },
  {
    id: 'USDCHF', name: 'USD/CHF', usdIsBase: true, counterCurrency: 'CHF', digits: 5,
    // No SNB policy rate is wired, so this pair runs without a rate differential.
    counterRateIndicator: null, riskDirection: -1, usesOil: false,
    eventCurrencies: ['USD', 'CHF'],
  },
  {
    id: 'USDCAD', name: 'USD/CAD', usdIsBase: true, counterCurrency: 'CAD', digits: 5,
    // No BoC policy rate is wired either, but crude is - and for CAD that is the bigger driver.
    counterRateIndicator: null, riskDirection: 1, usesOil: true,
    eventCurrencies: ['USD', 'CAD'],
  },
];

export const getForexSpec = (id: string): ForexSpec | undefined => FOREX_SPECS.find((spec) => spec.id === id);
