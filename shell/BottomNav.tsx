import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext';
import { MOBILE_PRIMARY_CATEGORIES, getCategoryDefinition } from '../../modules/registry';
import { useShell } from './ShellContext';

/**
 * Mobile bottom nav (§2): exactly five slots - four primary sections plus "More". Rendered as a
 * sibling of the header, never nested inside it: the header has backdrop-blur, and in Chromium
 * backdrop-filter establishes a containing block for position:fixed descendants, which would
 * anchor this bar to the header's own short box instead of the viewport bottom.
 */
export const BottomNav: React.FC<{ onOpenMore: () => void; isMoreOpen: boolean }> = ({
  onOpenMore,
  isMoreOpen,
}) => {
  const { t } = useTranslation();
  const { activeCategory, navigateToCategory } = useShell();

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-[var(--bg-header)] backdrop-blur-2xl border-t border-[var(--border-subtle)] font-mono"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label={t('shell.mainNavigation')}
    >
      <div className="flex items-stretch justify-around">
        {MOBILE_PRIMARY_CATEGORIES.map((categoryId) => {
          const category = getCategoryDefinition(categoryId);
          const isActive = !isMoreOpen && activeCategory === categoryId;
          const Icon = category.icon;
          return (
            <button
              key={categoryId}
              type="button"
              onClick={() => navigateToCategory(categoryId)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] transition-colors cursor-pointer relative ${
                // text-secondary rather than text-muted for inactive labels: text-muted sits right
                // at the WCAG AA edge in both themes, text-secondary clears 6.5:1.
                isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
              }`}
            >
              {isActive && <span className="absolute top-0 inset-x-3 h-[2px] bg-[var(--color-up)] rounded-full" />}
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[var(--color-up)]' : ''}`} />
              <span className={`text-[9px] tracking-wide ${isActive ? 'font-bold' : 'font-medium'}`}>
                {t(category.nameKey)}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={onOpenMore}
          aria-expanded={isMoreOpen}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] transition-colors cursor-pointer relative ${
            isMoreOpen ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
          }`}
        >
          {isMoreOpen && <span className="absolute top-0 inset-x-3 h-[2px] bg-[var(--color-up)] rounded-full" />}
          <MoreHorizontal className={`w-3.5 h-3.5 ${isMoreOpen ? 'text-[var(--color-up)]' : ''}`} />
          <span className={`text-[9px] tracking-wide ${isMoreOpen ? 'font-bold' : 'font-medium'}`}>
            {t('shell.more')}
          </span>
        </button>
      </div>
    </nav>
  );
};
