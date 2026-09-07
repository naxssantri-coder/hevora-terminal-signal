import React from 'react';
import { useTranslation } from '../../i18n/LanguageContext';
import { RiskConsentState } from '../../lib/useRiskConsent';
import { RiskConsentGate } from '../RiskConsentGate';

/**
 * Wraps any surface that prints signal numbers behind the recorded risk consent.
 *
 * Both non-granted branches return INSTEAD of the children, never layered over them: rendering
 * signals underneath a blocking overlay would still ship the numbers to the DOM, which defeats
 * the point of gating them behind a consent that has not been confirmed.
 */
export const SignalGate: React.FC<{
  state: RiskConsentState;
  onAcknowledged: () => void;
  children: React.ReactNode;
}> = ({ state, onAcknowledged, children }) => {
  const { t } = useTranslation();

  // Status not known yet. Deliberately not the signals: a slow or hanging request would otherwise
  // leave them visible for exactly as long as the check takes - the fail-open window this gate
  // exists to close.
  if (state === 'checking') {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-3 font-mono">
        <div className="w-7 h-7 border-2 border-[var(--border-subtle)] border-t-[var(--color-up)] rounded-full animate-spin" />
        <span className="text-xs text-[var(--text-muted)] tracking-widest uppercase">{t('riskGate.checking')}</span>
      </div>
    );
  }

  if (state === 'required') return <RiskConsentGate onAcknowledged={onAcknowledged} />;

  return <>{children}</>;
};
