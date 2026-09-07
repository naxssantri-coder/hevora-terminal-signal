import React from 'react';
import { Lock } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext';
import { ModuleDefinition } from '../../modules/registry';
import { Panel } from '../ui';

/**
 * Rendered when a signed-out visitor reaches a premium module directly by URL - the nav path
 * already opens the auth modal, but a deep link or a shared bookmark bypasses it, and the module
 * must not render (nor fetch) behind the user's back.
 */
export const AccessGate: React.FC<{ module: ModuleDefinition; onSignIn: () => void }> = ({
  module,
  onSignIn,
}) => {
  const { t } = useTranslation();

  return (
    <Panel className="max-w-lg">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center shrink-0">
          <Lock className="w-4.5 h-4.5 text-[var(--text-secondary)]" />
        </span>
        <div className="space-y-3">
          <div>
            <h1 className="text-base font-bold text-[var(--text-primary)]">{t(module.nameKey)}</h1>
            <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
              {t('shell.signInRequired')}
            </p>
          </div>
          <button
            type="button"
            onClick={onSignIn}
            className="px-4 py-1.5 rounded bg-[var(--text-primary)] text-[var(--bg-base)] font-mono text-[11px] font-extrabold uppercase tracking-wider hover:opacity-90 transition-opacity cursor-pointer"
          >
            {t('nav.login')}
          </button>
        </div>
      </div>
    </Panel>
  );
};
