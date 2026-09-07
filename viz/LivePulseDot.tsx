import React from 'react';

/**
 * Small pulsing "LIVE" indicator for a card header - the same dot+pulse language
 * DataQualityBadge already uses for its LIVE state, pulled out standalone for cards that want
 * just the dot (or the dot + label) without the full source/age chip.
 */
export const LivePulseDot: React.FC<{ label?: string; className?: string }> = ({ label = 'LIVE', className = '' }) => (
  <span className={`inline-flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-wider text-[var(--color-up)] ${className}`}>
    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-up)] animate-subtle-pulse shrink-0" />
    {label}
  </span>
);
