import React from 'react';
import { Compass } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext';
import { Panel } from '../ui';
import { useShell } from './ShellContext';

/** Unknown URL. Offers a way back rather than a bare 404 string. */
export const NotFoundView: React.FC<{ path: string }> = ({ path }) => {
  const { t } = useTranslation();
  const { navigateToRoute } = useShell();

  return (
    <Panel className="max-w-lg">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center shrink-0">
          <Compass className="w-5 h-5 text-[var(--text-secondary)]" />
        </span>
        <div className="space-y-3 min-w-0">
          <div>
            <h1 className="text-base font-bold text-[var(--text-primary)]">{t('shell.notFoundTitle')}</h1>
            <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed break-all">
              {t('shell.notFoundDetail')} <span className="font-mono">{path}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigateToRoute('/')}
            className="px-3 py-1.5 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors cursor-pointer"
          >
            {t('shell.backToOverview')}
          </button>
        </div>
      </div>
    </Panel>
  );
};
