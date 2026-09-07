import React, { useEffect } from 'react';
import { X, ShieldAlert } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext';

interface DisclaimerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Full-length risk disclaimer, moved out of the Footer (which used to print this same paragraph
 * on every single page) into an on-demand modal. The short one-line summary stays in the Footer;
 * the per-chart short disclaimer strip in MarketView is untouched (Bagian 3 scope).
 */
export const DisclaimerModal: React.FC<DisclaimerModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[var(--overlay-backdrop)] backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="disclaimer-modal-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        // !p-0 overrides hev-card-v2's own 20px/22px padding - this modal's header/body sections
        // already manage their own edges (like Panel's `flush` mode), so the class's padding would
        // otherwise stack on top of theirs.
        className="w-full max-w-lg hev-card-v2 !p-0 border border-[var(--border-subtle)] rounded-[18px] shadow-2xl overflow-hidden font-mono"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
            <h2 id="disclaimer-modal-title" className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wide">
              {t('disclaimer.title')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)] transition-colors cursor-pointer"
            aria-label={t('intel.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 text-[11px] text-[var(--text-secondary)] leading-relaxed">
          {t('disclaimer.body')}
        </div>

        <div className="px-5 py-3.5 border-t border-[var(--border-subtle)] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[var(--text-primary)] text-[var(--bg-base)] text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer"
          >
            {t('disclaimer.understand')}
          </button>
        </div>
      </div>
    </div>
  );
};
