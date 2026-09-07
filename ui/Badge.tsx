import React from 'react';

export type BadgeTone = 'neutral' | 'up' | 'down' | 'warning' | 'info';

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'border-[var(--border-strong)] text-[var(--text-secondary)] bg-[var(--bg-surface)]',
  up: 'border-[var(--color-up)]/40 text-[var(--color-up)] bg-[var(--color-up)]/10',
  down: 'border-[var(--color-down)]/40 text-[var(--color-down)] bg-[var(--color-down)]/10',
  warning: 'border-[var(--color-warn)]/40 text-[var(--color-warn)] bg-[var(--color-warn)]/10',
  info: 'border-[var(--border-strong)] text-[var(--text-primary)] bg-[var(--bg-surface)]',
};

/** Short status chip (§5: 'TP1 HIT', 'RUNNING', 'NO SIGNAL') - never a sentence. */
export const Badge: React.FC<{
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
  title?: string;
}> = ({ children, tone = 'neutral', className = '', title }) => (
  <span
    title={title}
    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${TONE_CLASS[tone]} ${className}`}
  >
    {children}
  </span>
);
