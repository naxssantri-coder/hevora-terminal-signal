import React, { useMemo } from 'react';
import {
  CotResponse,
  CryptoDerivativesResponse,
  CryptoDominanceResponse,
  EconomicEvent,
  FearGreedResponse,
  MarketPrice,
  StablecoinSupplyResponse,
} from '../../types';
import { useEndpoint } from '../../lib/useEndpoint';
import { buildBtcConfluence } from '../../lib/confluence/crypto';
import { LoadingState } from '../ui';
import { ConfluenceView } from './ConfluenceView';

/**
 * MARKET STATE block for BTC/USDT (§4): the data wiring only, rendered by the shared
 * ConfluenceView so crypto is held to the same disclosure rules as gold and commodities.
 *
 * Every endpoint below is one this terminal already publishes. The read has no ETF-flow factor
 * and says so on the page rather than quietly omitting it - see CRYPTO_UNAVAILABLE_INPUTS.
 */
export const BtcConfluencePanel: React.FC<{
  btc: MarketPrice | undefined;
  events: EconomicEvent[];
  onOpen: (route: string) => void;
}> = ({ btc, events, onOpen }) => {
  const derivatives = useEndpoint<CryptoDerivativesResponse>(
    '/api/crypto/derivatives?instId=BTC-USDT-SWAP',
    5 * 60_000
  );
  const dominance = useEndpoint<CryptoDominanceResponse>('/api/crypto/dominance', 30 * 60_000);
  const fearGreed = useEndpoint<FearGreedResponse>('/api/sentiment/fear-greed', 30 * 60_000);
  const cot = useEndpoint<CotResponse>('/api/positioning/cot', 60 * 60_000);
  const stablecoins = useEndpoint<StablecoinSupplyResponse>('/api/flow/stablecoins', 60 * 60_000);

  const result = useMemo(() => {
    const fgPoints = fearGreed.data?.unavailable ? [] : (fearGreed.data?.points ?? []);
    // The index is published newest-first by the provider and normalised oldest-first upstream;
    // reading the last entry keeps this correct either way only if the array is ordered, so the
    // latest is taken by timestamp rather than by position.
    const latestFg = [...fgPoints]
      .filter((p) => p.value !== null)
      .sort((a, b) => new Date(a.timestamp ?? 0).getTime() - new Date(b.timestamp ?? 0).getTime())
      .pop();
    const btcCot = cot.data?.positions?.BTCUSDT;
    const supply = stablecoins.data?.unavailable ? [] : (stablecoins.data?.points ?? []);

    return buildBtcConfluence({
      quote: {
        price: btc?.price ?? null,
        change24h: btc?.change24h ?? null,
        lastUpdated: btc?.lastUpdated ?? null,
      },
      derivatives: {
        fundingRate: derivatives.data?.unavailable ? null : (derivatives.data?.fundingRate ?? null),
        fundingTime: derivatives.data?.fundingTime ?? null,
        openInterestChange24h: derivatives.data?.unavailable
          ? null
          : (derivatives.data?.openInterestChange24h ?? null),
        openInterestTime: derivatives.data?.openInterestTime ?? null,
      },
      cot: {
        net: btcCot?.netContracts ?? null,
        percentile: btcCot?.percentile ?? null,
        reportDate: btcCot?.reportDate ?? null,
      },
      fearGreed: {
        value: latestFg?.value ?? null,
        classification: latestFg?.classification ?? null,
        timestamp: latestFg?.timestamp ?? null,
      },
      dominance: {
        btc: dominance.data?.unavailable ? null : (dominance.data?.btcDominance ?? null),
        // The endpoint publishes one reading, so a change can only be shown once a second one
        // exists. Until then the factor is excluded rather than compared against itself.
        previousBtc: null,
        updatedAt: dominance.data?.updatedAt ?? null,
      },
      stablecoins: supply,
      dailyHistory: [],
      events,
    });
  }, [btc, derivatives.data, dominance.data, fearGreed.data, cot.data, stablecoins.data, events]);

  const stillLoading = derivatives.isLoading && cot.isLoading && fearGreed.isLoading;
  if (stillLoading) return <LoadingState variant="cards" />;

  return <ConfluenceView result={result} onOpen={onOpen} />;
};
