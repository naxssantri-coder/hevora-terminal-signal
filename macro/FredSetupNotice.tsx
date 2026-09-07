import React from 'react';
import { KeyRound } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext';

/**
 * FRED_API_KEY missing is a setup gap, not a provider outage, and the two must not look the same:
 * an outage is something to wait out, a missing key is something to go and fix.
 */
export const FredSetupNotice: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3 p-4 rounded-[14px] border border-dashed border-[var(--color-warn)]/50 bg-[var(--color-warn)]/5">
      <KeyRound className="w-4 h-4 text-[var(--color-warn)] shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--color-warn)]">
          {t('macro.needsSetupTitle')}
        </p>
        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{t('macro.needsSetupDetail')}</p>
      </div>
    </div>
  );
};
