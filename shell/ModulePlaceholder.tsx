import React from 'react';
import { ArrowRight, Construction } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext';
import { ModuleDefinition, getCategoryLandingRoute } from '../../modules/registry';
import { Panel } from '../ui';
import { useShell } from './ShellContext';

/**
 * What a registered-but-not-yet-built module renders.
 *
 * It shows the module's identity, the data series it will need, and the roadmap phase that
 * delivers it - and deliberately shows NO numbers at all. Filling a coming-soon screen with
 * sample values is exactly the kind of fake data §1 forbids, and a trader who mistakes a mock
 * for a reading is worse off than one who sees nothing.
 */
export const ModulePlaceholder: React.FC<{ module: ModuleDefinition }> = ({ module }) => {
  const { t } = useTranslation();
  const { navigateToRoute } = useShell();
  const Icon = module.icon;
  const fallbackRoute = getCategoryLandingRoute(module.category);

  return (
    <Panel className="max-w-2xl">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-[var(--text-secondary)]" />
        </span>
        <div className="min-w-0 space-y-3">
          <div>
            <h1 className="text-base font-bold text-[var(--text-primary)]">{t(module.nameKey)}</h1>
            <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
              {t(module.descriptionKey)}
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-warn)]">
            <Construction className="w-3.5 h-3.5" />
            <span>{t('shell.moduleNotAvailable')}</span>
            <span className="text-[var(--text-muted)]">· {t('shell.phase')} {module.phase}</span>
          </div>

          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
            {t('shell.noFakeDataNotice')}
          </p>

          <div className="space-y-1.5">
            <div className="text-[9px] font-mono font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
              {t('shell.requiredData')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {module.requiredData.map((series) => (
                <span
                  key={series}
                  className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5"
                >
                  {series}
                </span>
              ))}
            </div>
          </div>

          {fallbackRoute !== module.route && (
            <button
              type="button"
              onClick={() => navigateToRoute(fallbackRoute)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors cursor-pointer"
            >
              {t('shell.goToAvailable')}
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
};
