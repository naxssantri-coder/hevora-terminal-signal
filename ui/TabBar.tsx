import React from 'react';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

/**
 * In-page sub-tab switcher (§ nav consolidation) - for a hub whose merged content is too much for
 * one scroll but does NOT warrant a separate route/registry entry (SubNav.tsx already owns
 * between-MODULE navigation; this is between-SECTION navigation inside one module). Switching
 * tabs never re-fetches or remounts the whole page - each tab's own component keeps its own data
 * hooks, so returning to a tab shows what was already loaded rather than a fresh skeleton.
 */
export const TabBar: React.FC<{
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
  /** 'underline' (Institutional Detail Page visual fix, dense-data reference: CoinGlass) - a thin
   *  blue underline on the active tab instead of a bordered pill button, for a sub-tab switcher
   *  sitting directly on top of a flat data surface (funding/OI/volume/liquidation chart tabs)
   *  where the bordered-pill style reads as one more "card" stacked on the surface below it.
   *  Opt-in per caller ONLY - every other of this component's 20+ call sites (top-level page tabs
   *  across Pasar/Analisis/Makro/Kalender/etc) keeps the exact 'default' pill look untouched. */
  variant?: 'default' | 'underline';
}> = ({ tabs, active, onChange, className = '', variant = 'default' }) => (
  <div
    role="tablist"
    className={`flex items-center gap-1.5 overflow-x-auto no-scrollbar font-mono ${
      variant === 'underline' ? 'border-b border-[var(--border-subtle)]' : 'border-b border-[var(--border-subtle)] pb-2.5'
    } ${className}`}
  >
    {tabs.map((tab) => {
      const isActive = tab.id === active;
      if (variant === 'underline') {
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-2 text-[11px] tracking-wide transition-colors duration-150 cursor-pointer border-b-2 -mb-px ${
              isActive
                ? 'text-[var(--text-primary)] font-bold border-[var(--color-brand)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] border-transparent'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      }
      return (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={isActive}
          onClick={() => onChange(tab.id)}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] tracking-wide transition-colors duration-150 cursor-pointer border ${
            isActive
              ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-bold border-[var(--border-strong)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)] border-transparent'
          }`}
        >
          {tab.icon}
          {tab.label}
        </button>
      );
    })}
  </div>
);
