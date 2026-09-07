import React from 'react';
import { useTranslation } from '../../i18n/LanguageContext';
import { listModulesByCategory } from '../../modules/registry';
import { useShell } from './ShellContext';

/**
 * Horizontal sub-nav for the active section - MOBILE ONLY (Fase 10 §1).
 *
 * The desktop Sidebar already lists every module within its category, expanded, with the active
 * one highlighted - rendering this bar too on the same screen put the identical set of links in
 * two places at once, which read as "two navigations for one thing" rather than as redundancy on
 * purpose. On mobile the Sidebar is not rendered at all (`hidden lg:flex`), so this remains the
 * only way to move between a category's modules once inside it - BottomNav only switches
 * category, and MoreSheet only covers categories outside the four primary slots. `lg:hidden`
 * keeps it exactly where the Sidebar is absent, and nowhere else.
 */
export const SubNav: React.FC = () => {
  const { t } = useTranslation();
  const { activeCategory, activeModule, navigateToModule } = useShell();

  if (!activeCategory) return null;
  const modules = listModulesByCategory(activeCategory);
  if (modules.length < 2) return null;

  return (
    <nav className="lg:hidden flex items-center gap-1.5 overflow-x-auto no-scrollbar font-mono border-b border-[var(--border-subtle)] pb-2.5 mb-4">
      {modules.map((mod) => {
        const isActive = activeModule?.id === mod.id;
        return (
          <button
            key={mod.id}
            type="button"
            onClick={() => navigateToModule(mod)}
            aria-current={isActive ? 'page' : undefined}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] tracking-wide transition-colors duration-150 cursor-pointer border ${
              isActive
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-bold border-[var(--border-strong)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)] border-transparent'
            }`}
          >
            {t(mod.nameKey)}
            {mod.status === 'planned' && (
              <span className="text-[8px] font-bold tracking-wider text-[var(--text-muted)] border border-[var(--border-subtle)] rounded px-1 py-px">
                {t('shell.soon')}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
};
