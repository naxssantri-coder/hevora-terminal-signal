import React, { useState } from 'react';
import { Info } from 'lucide-react';

/**
 * Info-icon + on-demand tooltip for methodology/disclaimer text (§ non-negotiable rule 3): moves
 * the long footnote paragraphs every panel used to print in full down to a compact icon, without
 * deleting a single word of the explanation - click/hover reveals the exact same text.
 *
 * Click-to-toggle rather than hover-only so it works on touch; Escape and an outside click both
 * close it via the button losing focus (onBlur), no extra listeners needed.
 */
export const InfoTooltip: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  const [open, setOpen] = useState(false);

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        aria-label="Methodology"
        aria-expanded={open}
        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-20 top-5 right-0 w-64 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-panel)] p-2.5 shadow-lg font-mono text-[10px] leading-relaxed text-[var(--text-secondary)] normal-case tracking-normal"
        >
          {text}
        </span>
      )}
    </span>
  );
};
