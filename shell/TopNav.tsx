import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext';
import { MODULE_CATEGORIES, ModuleCategory, ModuleDefinition, listModulesByCategory } from '../../modules/registry';
import { useShell } from './ShellContext';

/**
 * Desktop horizontal top nav (replaces the persistent left Sidebar - navigation architecture
 * change, round 3: the user explicitly asked for this after having approved the grouped sidebar
 * earlier, so this supersedes that decision rather than adding a second nav surface next to it).
 * Renders inside AppShell's sticky header, below Navbar - same module registry data, same
 * category order, same "sub-items only for the reader's own category" idea the sidebar's
 * accordion had, just laid out as a menu bar with dropdowns instead of a collapsible column.
 *
 * A single-module category (Dashboard) has nothing to drop down - it stays a plain tab, no
 * chevron, click navigates straight there. A multi-module category is a tab with a chevron; hover
 * OR click opens a dropdown of its modules below the tab (click-outside, Escape, or picking an
 * item all close it). The active category's tab is highlighted whether or not its dropdown is
 * currently open, matching the sidebar's old highlight rule.
 *
 * Mobile/tablet (<lg) keeps the existing bottom nav + "More" sheet entirely - this component
 * renders nothing there (`hidden lg:block` on the root), it does not touch SubNav/BottomNav/
 * MoreSheet at all.
 */
export const TopNav: React.FC = () => {
  const { t } = useTranslation();
  const { activeModule, navigateToModule, navigateToCategory, isSignedIn } = useShell();
  const [openCategory, setOpenCategory] = useState<ModuleCategory | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // Click outside the whole nav closes whichever dropdown is open - same pattern Navbar's own
  // notification-bell dropdown already uses.
  useEffect(() => {
    if (!openCategory) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenCategory(null);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenCategory(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openCategory]);

  const renderDropdownItem = (mod: ModuleDefinition) => {
    const isActive = activeModule?.id === mod.id;
    const isLocked = mod.permissions === 'premium' && !isSignedIn;
    const Icon = mod.icon;

    return (
      <button
        key={mod.id}
        type="button"
        onClick={() => {
          navigateToModule(mod);
          setOpenCategory(null);
        }}
        aria-current={isActive ? 'page' : undefined}
        title={t(mod.descriptionKey)}
        className={`w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-left transition-colors duration-150 cursor-pointer ${
          isActive
            ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)] border border-transparent'
        }`}
      >
        <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[var(--color-up)]' : ''}`} />
        <span className={`flex-1 truncate text-[11px] ${isActive ? 'font-bold' : 'font-medium'}`}>{t(mod.nameKey)}</span>
        {mod.status === 'planned' && (
          <span className="shrink-0 text-[8px] font-bold tracking-wider text-[var(--text-muted)] border border-[var(--border-subtle)] rounded px-1 py-px">
            {t('shell.soon')}
          </span>
        )}
        {isLocked && mod.status !== 'planned' && (
          <span className="shrink-0 text-[8px] font-black tracking-wider text-[var(--color-brand)] border border-[var(--color-brand)]/40 bg-[var(--color-brand)]/10 rounded-full px-1.5 py-px">
            PRO
          </span>
        )}
      </button>
    );
  };

  return (
    <nav
      ref={navRef}
      className="hidden lg:flex items-center gap-1 px-4 sm:px-6 h-11 border-t border-[var(--border-subtle)] font-mono relative"
      aria-label={t('shell.mainNavigation')}
    >
      {MODULE_CATEGORIES.slice()
        .sort((a, b) => a.order - b.order)
        .map((category) => {
          const modules = listModulesByCategory(category.id).filter((mod) => mod.desktopVisibility);
          if (modules.length === 0) return null;

          const isActiveCategory = activeModule?.category === category.id;
          const CategoryIcon = category.icon;

          // A single-module category (Dashboard) has nothing to drop down - it stays the plain
          // tab it always was, no chevron pretending there is more underneath.
          if (modules.length === 1) {
            const mod = modules[0];
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => navigateToModule(mod)}
                aria-current={isActiveCategory ? 'page' : undefined}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-[0.15em] transition-colors duration-150 cursor-pointer ${
                  isActiveCategory
                    ? 'text-[var(--text-primary)] bg-[var(--bg-surface)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--card-hover-bg)]'
                }`}
              >
                <CategoryIcon className="w-3.5 h-3.5 shrink-0" />
                {t(category.nameKey)}
              </button>
            );
          }

          const isOpen = openCategory === category.id;

          return (
            <div
              key={category.id}
              className="relative"
              onMouseEnter={() => setOpenCategory(category.id)}
              onMouseLeave={() => setOpenCategory((prev) => (prev === category.id ? null : prev))}
            >
              <button
                type="button"
                onClick={() => {
                  // A click always lands on the category's own landing route (same behaviour
                  // navigateToCategory already gives BottomNav/MoreSheet) - hover already opens
                  // the dropdown to browse, so a click is a real navigation intent, not just
                  // "toggle the menu".
                  navigateToCategory(category.id);
                  setOpenCategory(null);
                }}
                aria-expanded={isOpen}
                aria-current={isActiveCategory ? 'page' : undefined}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-[0.15em] transition-colors duration-150 cursor-pointer ${
                  isActiveCategory
                    ? 'text-[var(--text-primary)] bg-[var(--bg-surface)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--card-hover-bg)]'
                }`}
              >
                <CategoryIcon className="w-3.5 h-3.5 shrink-0" />
                {t(category.nameKey)}
                <ChevronDown className={`w-3 h-3 shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
              </button>

              {isOpen && (
                <div className="absolute left-0 top-full pt-1 w-56 z-50">
                  <div className="bg-[var(--bg-panel)] border border-[var(--border-strong)] rounded-xl shadow-2xl p-1.5 space-y-0.5">
                    {modules.map(renderDropdownItem)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
    </nav>
  );
};
