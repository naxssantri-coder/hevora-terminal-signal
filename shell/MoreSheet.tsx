import React, { useEffect } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext';
import { MOBILE_MORE_CATEGORIES, getCategoryDefinition, listModulesByCategory } from '../../modules/registry';
import { useShell } from './ShellContext';

/**
 * Mobile module navigator behind "More" (§2) - grouped by category, explicitly NOT a flat list.
 * Same registry as the desktop sidebar, so the two can never drift apart.
 */
export const MoreSheet: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { activeModule, navigateToModule, isSignedIn } = useShell();

  // Body scroll lock while the full-screen navigator is up, plus Escape to dismiss.
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="lg:hidden fixed inset-0 z-[60] flex flex-col bg-[var(--bg-base)]" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-header)]">
        <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-[var(--text-primary)]">
          {t('shell.allModules')}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('shell.close')}
          className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto px-4 py-4 space-y-6 font-mono"
        style={{ paddingBottom: 'calc(84px + env(safe-area-inset-bottom))' }}
      >
        {MOBILE_MORE_CATEGORIES.map((categoryId) => {
          const category = getCategoryDefinition(categoryId);
          const modules = listModulesByCategory(categoryId).filter((mod) => mod.mobileVisibility);
          if (modules.length === 0) return null;
          const CategoryIcon = category.icon;

          return (
            <section key={categoryId} className="space-y-2">
              <div className="flex items-center gap-2 text-[var(--text-muted)]">
                <CategoryIcon className="w-3 h-3" />
                <h2 className="text-[10px] font-bold uppercase tracking-[0.2em]">{t(category.nameKey)}</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {modules.map((mod) => {
                  const Icon = mod.icon;
                  const isActive = activeModule?.id === mod.id;
                  const isLocked = mod.permissions === 'premium' && !isSignedIn;
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      onClick={() => {
                        navigateToModule(mod);
                        onClose();
                      }}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-[var(--bg-surface)] border-[var(--border-strong)]'
                          : 'bg-[var(--bg-panel)] border-[var(--border-subtle)] active:bg-[var(--bg-surface)]'
                      }`}
                    >
                      <span className="w-8 h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center shrink-0">
                        <Icon className={`w-4 h-4 ${isActive ? 'text-[var(--color-up)]' : 'text-[var(--text-secondary)]'}`} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                            {t(mod.nameKey)}
                          </span>
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
                        </span>
                        <span className="block text-[10px] text-[var(--text-secondary)] truncate mt-0.5">
                          {t(mod.descriptionKey)}
                        </span>
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};
