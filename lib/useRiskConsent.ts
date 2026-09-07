import { useCallback, useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import type { RiskAcknowledgmentStatus } from '../types';

export type RiskConsentState =
  /** Signed out - the module's own auth gate handles this case, consent is not applicable yet. */
  | 'anonymous'
  /** Request in flight. Signals must stay hidden. */
  | 'checking'
  /** User must read and sign the current disclaimer version. */
  | 'required'
  /** Confirmed acknowledgment of the current version - signals may render. */
  | 'granted';

/**
 * Recorded risk-consent status, extracted from MarketView so every surface that prints signal
 * numbers (Market, Live Signals, Scalping Radar, Watchlist) enforces the same rule from the same
 * code instead of each re-implementing it.
 *
 * FAIL CLOSED. 'granted' is returned only on a positive, successful answer. Every other outcome -
 * still loading, HTTP error, network failure, malformed body - resolves to 'checking' or
 * 'required', never 'granted'. The point of the feature is that a recorded consent exists before
 * anyone sees a signal; showing signals when we cannot confirm one would open the hole in exactly
 * the moment it matters most.
 */
export const useRiskConsent = (): { state: RiskConsentState; markGranted: () => void } => {
  const { isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [state, setState] = useState<RiskConsentState>('anonymous');

  useEffect(() => {
    let cancelled = false;

    if (!isSignedIn) {
      setState('anonymous');
      return undefined;
    }

    setState('checking');

    (async () => {
      try {
        const token = await getToken();
        const res = await fetch('/api/user/risk-acknowledgment', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          // A 500, a 401, anything non-OK: treat as "not acknowledged" and show the gate. The user
          // can still read and sign; the POST surfaces its own error if the server is genuinely
          // down, which is honest - better than silently handing out signals with no record.
          if (!cancelled) setState('required');
          return;
        }
        const data: RiskAcknowledgmentStatus = await res.json();
        if (!cancelled) setState(data.needsAcknowledgment ? 'required' : 'granted');
      } catch (err) {
        // Network failure or unparseable body - same rule, the gate stays up.
        if (!cancelled) setState('required');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSignedIn, getToken]);

  const markGranted = useCallback(() => setState('granted'), []);

  return { state, markGranted };
};
